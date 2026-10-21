// Ramp Developer API client. Endpoints, auth and pagination follow
// docs.ramp.com/developer-api/v1:
// - client credentials token at /developer/v1/token (a developer app), or
// - a user access token (RAMP_ACCESS_TOKEN, or the token saved by `ramp auth login`).
// List endpoints page with page.next.
// Money fields are integers in minor units (cents for USD). ApiSource in source.ts wraps this
// client; the rest of the app only sees the RampSnapshot that snapshot() returns.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  CommentObjectType,
  RampApproval,
  RampBill,
  RampDepartment,
  RampReceipt,
  RampSnapshot,
  RampTransaction,
  RampUser,
  RampVendor,
  SourceInfo,
} from "./types";

/** Read-only scopes requested for the client credentials token. Writes (comments) get a separate token. */
export const READ_SCOPES = [
  "transactions:read",
  "receipts:read",
  "bills:read",
  "users:read",
  "departments:read",
  "vendors:read",
  "approvals:read",
  "business:read",
  "audit_logs:read",
].join(" ");

/** A developer app (client id and secret, exchanged for a token) or a ready-made bearer token. */
export type RampAuth =
  | { kind: "client_credentials"; clientId: string; clientSecret: string }
  | { kind: "token"; token: string; origin: string };

/** Non-2xx response from Ramp. Keeps the status and Ramp's x-trace-id so failures can be reported to Ramp support. */
export class RampHttpError extends Error {
  constructor(public status: number, public url: string, public trace: string | null, body: string) {
    super(`Ramp API ${status} on ${new URL(url).pathname}${trace ? ` (trace ${trace})` : ""}: ${body.slice(0, 200)}`);
  }
}

// Used to find transaction ids inside audit log reference URLs and labels.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const addDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 864e5).toISOString().replace(".000Z", "Z");

/** Reads the access token the Ramp CLI saved for an environment, if any. */
export interface CliLogin {
  token: string;
  scopes: string[];
}

/** Reads the token and granted scopes the Ramp CLI saved for an environment, if any. */
export function loginFromRampCli(env: "sandbox" | "production"): CliLogin | null {
  try {
    // The CLI stores one [sandbox] or [production] section in config.toml; a tiny line scan avoids a TOML dependency.
    const dir = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "ramp") : path.join(homedir(), ".config", "ramp");
    const text = readFileSync(path.join(dir, "config.toml"), "utf8");
    let section = "";
    let token = "";
    let scopes = "";
    for (const line of text.split("\n")) {
      const h = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (h) section = h[1].trim().replace(/^"|"$/g, "");
      if (section !== env) continue;
      token = line.match(/^\s*access_token\s*=\s*"([^"]+)"/)?.[1] ?? token;
      scopes = line.match(/^\s*granted_scopes\s*=\s*"([^"]*)"/)?.[1] ?? scopes;
    }
    return token ? { token, scopes: scopes.split(/\s+/).filter(Boolean) } : null;
  } catch {
    return null; // no CLI config
  }
}

/** Runs async work over items with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** How approvals were obtained, plus any partial-read warnings, shown next to results so gaps are not silent. */
export interface SnapshotNotes {
  approvals: "approvals_api" | "fallback" | "none";
  warnings: string[];
}

/** Thin wrapper over the Ramp Developer API: token handling, retries, pagination and the snapshot read. */
export class RampApiClient {
  private token: { value: string; expires: number } | null = null;

  constructor(public base: string, private auth: RampAuth) {}

  /**
   * Returns a bearer token. For a developer app it posts client_id:client_secret as Basic auth to
   * /developer/v1/token and caches the result until one minute before it expires.
   */
  private async accessToken(scope = READ_SCOPES): Promise<string> {
    if (this.auth.kind === "token") return this.auth.token;
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${this.base}/developer/v1/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.auth.clientId}:${this.auth.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    });
    if (!res.ok) throw new RampHttpError(res.status, `${this.base}/developer/v1/token`, res.headers.get("x-trace-id"), await res.text());
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  /** One API call. Retries 429 and 5xx up to four times, honoring Retry-After, else exponential backoff. */
  private async request<T>(method: "GET" | "POST", pathOrUrl: string, body?: unknown, scope?: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.base}${pathOrUrl}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.accessToken(scope)}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(55_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new RampHttpError(res.status, url, res.headers.get("x-trace-id"), await res.text());
      return (await res.json()) as T;
    }
  }

  get<T>(pathOrUrl: string) {
    return this.request<T>("GET", pathOrUrl);
  }

  /** Follows page.next until the list is exhausted. Repeated keys (entity_ids) are kept. */
  async list<T>(p: string, params: URLSearchParams | Record<string, string> = {}): Promise<T[]> {
    const qs = params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams(params);
    if (!qs.has("page_size")) qs.set("page_size", "100");
    let next: string | null = `${p}?${qs}`;
    const out: T[] = [];
    // page.next is a full URL that carries the cursor, so it is fetched as is. The page cap guards against a loop.
    for (let pages = 0; next && pages < 2000; pages++) {
      const page: { data: T[]; page?: { next: string | null } } = await this.get(next);
      out.push(...(page.data ?? []));
      next = page.page?.next ?? null;
    }
    return out;
  }

  /**
   * Reads everything one audit period needs in parallel. Users and transactions are required; the other
   * lists are optional, so a token missing one scope degrades to a warning instead of failing the run.
   */
  async snapshot(period: { from: string; to: string }, info: SourceInfo): Promise<RampSnapshot & { notes: SnapshotNotes }> {
    const range = { from_date: `${period.from}T00:00:00Z`, to_date: `${period.to}T23:59:59Z` };
    const notes: SnapshotNotes = { approvals: "none", warnings: [] };
    const optional = <T,>(label: string, p: Promise<T[]>): Promise<T[]> =>
      p.catch((e) => {
        notes.warnings.push(`${label} could not be read (${e instanceof RampHttpError ? e.status : "error"}).`);
        return [];
      });
    const [business, users, departments, transactions, receipts, bills, vendors] = await Promise.all([
      this.get<{ business_name_legal?: string; business_name_on_card?: string }>("/developer/v1/business").catch(() => ({} as { business_name_legal?: string; business_name_on_card?: string })),
      this.list<RampUser>("/developer/v1/users"),
      optional("Departments", this.list<RampDepartment>("/developer/v1/departments")),
      this.list<RampTransaction>("/developer/v1/transactions", range),
      // Receipts often arrive after the charge, so look 90 days past the period end.
      optional("Receipts", this.list<RampReceipt>("/developer/v1/receipts", { from_date: range.from_date, to_date: addDays(range.to_date, 90), include_ocr_data: "true" })),
      optional("Bills", this.list<RampBill>("/developer/v1/bills", { from_issued_date: range.from_date, to_issued_date: range.to_date })),
      optional("Vendors", this.list<RampVendor>("/developer/v1/vendors")),
    ]);
    // Approvals are keyed by entity id, so they can only be fetched once the transaction and bill ids are known.
    for (const t of transactions) normalizeTransaction(t);
    for (const b of bills) normalizeBill(b);

    let approvals: RampApproval[] = [];
    try {
      approvals = [
        ...(await this.approvals("TRANSACTION", transactions.map((t) => t.id))),
        ...(await this.approvals("BILL", bills.map((b) => b.id))),
      ];
      notes.approvals = "approvals_api";
    } catch (e) {
      if (!(e instanceof RampHttpError) || ![401, 403].includes(e.status)) throw e;
      // Tokens without approvals:read (for example a Ramp CLI login): rebuild from bill history and audit logs.
      approvals = [...(await this.billHistoryApprovals(bills, notes)), ...(await this.auditLogApprovals(range, transactions, notes))];
      notes.approvals = "fallback";
      notes.warnings.push("This token cannot read /approvals, so approvals were rebuilt from bill history and audit logs.");
    }

    return {
      business_name: business.business_name_legal ?? business.business_name_on_card ?? "Ramp business",
      source: info,
      users,
      departments,
      transactions,
      receipts,
      bills,
      vendors,
      approvals,
      notes,
    };
  }

  /** GET /approvals takes a list of entity_ids; ids go 50 per request with four requests in flight to stay under rate limits. */
  private async approvals(entityType: "TRANSACTION" | "BILL", ids: string[]): Promise<RampApproval[]> {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
    const pages = await pool(batches, 4, (batch) => {
      const qs = new URLSearchParams({ entity_type: entityType });
      batch.forEach((id) => qs.append("entity_ids", id));
      return this.list<RampApproval>("/developer/v1/approvals", qs);
    });
    return pages.flat();
  }

  /**
   * Fallback for bills: rebuilds approvals from each bill's history events. Only approved steps count
   * (not unapproved, rejected or pending). A bill with no approved step is marked PENDING.
   */
  private async billHistoryApprovals(bills: RampBill[], notes: SnapshotNotes): Promise<RampApproval[]> {
    interface Hist {
      events?: { date?: string; approval_chain_events?: { status?: string; step_date?: string; assigned_entities?: { assigned_user_id?: string }[] }[] }[];
    }
    let failed = 0;
    const out = await pool(bills, 6, async (b): Promise<RampApproval | null> => {
      try {
        const h = await this.request<Hist>("POST", "/developer/v1/agent-tools/get-bill-history", { bill_id: b.id, rationale: "Audit evidence: trace bill approvals" });
        const steps = (h.events ?? []).flatMap((e) =>
          (e.approval_chain_events ?? [])
            .filter((c) => /approv/i.test(String(c.status ?? "")) && !/(unapprov|reject|pending)/i.test(String(c.status ?? "")))
            .flatMap((c) => (c.assigned_entities ?? []).map((a) => ({ action_at: c.step_date ?? e.date ?? b.created_at, step_status: "APPROVED", user_email: null, user_id: a.assigned_user_id ?? null }))),
        );
        return { entity_id: b.id, entity_type: "bill", status: steps.length ? "APPROVED" : "PENDING", approval_history: steps, next_approvers: [] };
      } catch {
        failed++;
        return null;
      }
    });
    if (failed) notes.warnings.push(`Approval history was unavailable for ${failed} bills.`);
    return out.filter((x): x is RampApproval => !!x);
  }

  /**
   * Fallback for card transactions: approval events from the audit log, matched to transactions by the ids
   * found in each event's references. The window runs 60 days past the period because approvals lag charges.
   */
  private async auditLogApprovals(range: { from_date: string; to_date: string }, transactions: RampTransaction[], notes: SnapshotNotes): Promise<RampApproval[]> {
    const ids = new Set(transactions.map((t) => t.id));
    const qs = new URLSearchParams({ from_date: range.from_date, to_date: addDays(range.to_date, 60) });
    for (const t of ["Approval step approved", "Approved by manager", "Spend approved"]) qs.append("event_types", t);
    let events: { actor_id: string | null; event_time: string; event_details?: { references?: { label?: string; url?: string; resource_name?: string }[] } }[] = [];
    try {
      events = await this.list("/developer/v1/audit-logs/events", qs);
    } catch (e) {
      notes.warnings.push(`Transaction approvals could not be read from audit logs (${e instanceof RampHttpError ? e.status : "error"}).`);
      return [];
    }
    const byTxn = new Map<string, RampApproval>();
    for (const ev of events) {
      for (const ref of ev.event_details?.references ?? []) {
        for (const id of `${ref.url ?? ""} ${ref.label ?? ""}`.match(UUID) ?? []) {
          if (!ids.has(id.toLowerCase())) continue;
          const a = byTxn.get(id) ?? { entity_id: id, entity_type: "transaction" as const, status: "APPROVED" as const, approval_history: [], next_approvers: [] };
          a.approval_history.push({ action_at: ev.event_time, step_status: "APPROVED", user_email: null, user_id: ev.actor_id });
          byTxn.set(id, a);
        }
      }
    }
    return [...byTxn.values()];
  }

  /** Fetches a receipt image or bill attachment. Returns null on failure so the binder can fall back to a rendered record. */
  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    // Receipt and attachment URLs are pre-signed, so no bearer token is sent.
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  /**
   * Posts a follow-up comment on a bill or transaction. This is the only write in the app and runs only after
   * the user approves the draft. The read token is dropped before and after so the write scope never lingers.
   */
  async postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]) {
    const scope = objectType === "bills" ? "bills:write" : "transactions:write";
    if (this.auth.kind === "client_credentials") this.token = null; // write scope needs its own token
    try {
      await this.request("POST", `/developer/v1/comments/${objectType}/${objectId}`, { message, message_format: "PLAIN_TEXT", mention_user_ids: mentionUserIds }, scope);
    } finally {
      if (this.auth.kind === "client_credentials") this.token = null;
    }
  }
}

// Older and newer API responses differ slightly; fill the fields the engine relies on.
/** Fills entity_amount (in cents) from a legacy dollar amount, and defaults missing nested fields. */
function normalizeTransaction(t: RampTransaction & { amount?: number; currency_code?: string }) {
  if (!t.entity_amount && typeof t.amount === "number") t.entity_amount = { value: Math.round(t.amount * 100), currency: t.currency_code ?? "USD" };
  t.receipts ??= [];
  t.card_holder ??= { user_id: "", first_name: "Unknown", last_name: "" };
  t.merchant_name ??= "Unknown merchant";
}

/** Defaults bill fields the engine dereferences, so a sparse API response cannot crash a check. */
function normalizeBill(b: RampBill) {
  b.attachments ??= [];
  b.vendor ??= { id: "", name: "Unknown vendor" };
  b.bill_owner ??= { id: "" };
}
