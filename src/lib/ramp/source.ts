// Chooses where Ramp data comes from: the generated demo company or the live Ramp Developer API.
// Both sides implement RampSource, so the engine, binder and UI never know which one they are using.

import { getFixture } from "../fixtures/generate";
import type { CommentObjectType, PostedComment, RampBill, RampSnapshot, RampTransaction, RecheckItem, RecheckResult, ReceiptUpload, SourceInfo, ThreadReply } from "./types";
import { AUTO_RESOLVABLE, resolution } from "../engine/recheck";
import { RampApiClient, loginFromRampCli, type RampAuth, type SnapshotNotes } from "./api-client";

/** Audit period, inclusive on both ends. */
export interface Period {
  from: string; // YYYY-MM-DD
  to: string;
}

/** The one interface the rest of the app reads Ramp data through. */
export interface RampSource {
  info: SourceInfo;
  snapshot(period: Period): Promise<RampSnapshot & { notes?: SnapshotNotes }>;
  /** Raw bytes of a receipt image or invoice, or null when only metadata is available. */
  file(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]): Promise<PostedComment>;
  /** One record with its receipts and approval history, for the record viewer. */
  record(type: RecordKind, id: string): Promise<unknown | null>;
  /** What Ramp shows now for findings the UI is watching: fixed or not, and replies on the thread. */
  recheck(items: RecheckItem[]): Promise<RecheckResult[]>;
  /** Attaches a receipt file to a card transaction. */
  uploadReceipt(transactionId: string, userId: string, file: ReceiptUpload): Promise<{ id: string | null; destination: string }>;
}

// Sample data has no people to answer, so replies are simulated a few seconds after a follow-up.
const SIM_REPLY_MS = 6_000;
const SIM_FIX_MS = 10_000;
const SIM_REPLY: Record<string, string> = {
  MISSING_RECEIPT: "Found it, just uploaded the receipt. Sorry for the delay!",
  NOT_APPROVED: "Sent it to my manager for approval just now.",
  NO_APPROVAL: "Routing it for approval now.",
  MISSING_INVOICE: "Attached the invoice from the vendor portal.",
  RECEIPT_MISMATCH: "The difference is the tip. I added a note to the transaction.",
  SPLIT_PURCHASE: "It was one order. The supplier split the charge. I will get it approved as one purchase.",
  SELF_APPROVAL: "Good catch. I asked finance to approve it instead.",
  RESTRICTED_MCC: "That was a client dinner. Adding the attendees now.",
  APPROVAL_AFTER_PAYMENT: "Payment went out early to avoid a late fee. I added a note.",
  NEW_VENDOR_FAST_PAYMENT: "They are our new contract manufacturer. The W-9 and contract are on file.",
  DUPLICATE_INVOICE: "You are right, it was entered twice. AP is voiding one.",
};

/** Record types the record viewer can open by id. */
export type RecordKind = "transaction" | "bill" | "vendor" | "user" | "receipt";

/** Looks up one record in a snapshot and attaches its receipts and approval, for the record viewer. */
export function recordFromSnapshot(snap: RampSnapshot, type: RecordKind, id: string): unknown | null {
  if (type === "transaction") {
    const t = snap.transactions.find((x) => x.id === id);
    return t ? { transaction: t, receipts: snap.receipts.filter((r) => r.transaction_id === id), approval: snap.approvals.find((a) => a.entity_id === id) ?? null } : null;
  }
  if (type === "bill") {
    const b = snap.bills.find((x) => x.id === id);
    return b ? { bill: b, approval: snap.approvals.find((a) => a.entity_id === id) ?? null } : null;
  }
  if (type === "vendor") return snap.vendors.find((x) => x.id === id) ?? null;
  if (type === "user") return snap.users.find((x) => x.id === id) ?? null;
  return snap.receipts.find((x) => x.id === id) ?? null;
}

// Comments approved while on sample data are kept here so the UI can show them.
const demoOutbox: PostedComment[] = [];
/** Copy of the comments "sent" on sample data, for the UI. */
export const getDemoOutbox = () => demoOutbox.slice();

/** Serves the seeded Acme Robotics demo company. Comments go to an in-memory outbox instead of Ramp. */
class FixtureSource implements RampSource {
  info = getFixture().snapshot.source;
  async snapshot() {
    return getFixture().snapshot;
  }
  async file() {
    return null; // binder renders a document from the record instead
  }
  async record(type: RecordKind, id: string) {
    return recordFromSnapshot(getFixture().snapshot, type, id);
  }
  async postComment(object_type: CommentObjectType, object_id: string, message: string, mention_user_ids: string[]) {
    const c: PostedComment = { object_type, object_id, message, mention_user_ids, posted_at: new Date().toISOString(), destination: "Sample data outbox (no Ramp account connected)" };
    demoOutbox.push(c);
    return c;
  }
  async uploadReceipt() {
    return { id: null, destination: "Sample data (no Ramp account connected)" };
  }
  /**
   * Simulated responses, timed from when the follow-up went out (`since`, sent by the UI because
   * serverless instances share no memory): a reply after a few seconds, then the fix.
   */
  async recheck(items: RecheckItem[]): Promise<RecheckResult[]> {
    const snap = getFixture().snapshot;
    const now = Date.now();
    const userName = (id: string | null | undefined) => {
      const u = snap.users.find((x) => x.id === id);
      return u ? `${u.first_name} ${u.last_name}` : "their manager";
    };
    return items.map((it) => {
      const base: RecheckResult = { finding_id: it.finding_id, resolved: false, how: null, replies: [], checked_at: new Date(now).toISOString(), simulated: true };
      if (it.attached && it.code === "MISSING_RECEIPT") return { ...base, resolved: true, how: "Receipt attached from Tickmark" };
      const since = it.since ? Date.parse(it.since) : NaN;
      if (Number.isNaN(since) || now - since < SIM_REPLY_MS) return base;
      const owner = it.owner ?? "The owner";
      const replies: ThreadReply[] = [{ id: `sim-${it.finding_id}`, author: owner, message: SIM_REPLY[it.code] ?? "Thanks, looking into it.", created_at: new Date(since + SIM_REPLY_MS).toISOString() }];
      if (now - since < SIM_FIX_MS || !AUTO_RESOLVABLE.has(it.code)) return { ...base, replies };
      const approver = userName(snap.approvals.find((a) => a.entity_id === it.object_id)?.approval_history.at(-1)?.user_id);
      const how = it.code === "MISSING_RECEIPT" ? `Receipt uploaded by ${owner}` : it.code === "MISSING_INVOICE" ? `Invoice attached by ${owner}` : `Approved by ${approver}`;
      return { ...base, replies, resolved: true, how };
    });
  }
}

// A full snapshot is many paginated calls, so it is reused for a few minutes across requests in the same process.
const SNAPSHOT_TTL_MS = 5 * 60_000;

/** Live Ramp source. Sandbox uses demo-api.ramp.com and production uses api.ramp.com unless RAMP_API_BASE_URL overrides it. */
export class ApiSource implements RampSource {
  info: SourceInfo;
  private client: RampApiClient;
  private cache = new Map<string, { at: number; p: Promise<RampSnapshot & { notes: SnapshotNotes }> }>();
  constructor(kind: "sandbox" | "production", auth: RampAuth, baseOverride?: string) {
    const base = baseOverride ?? (kind === "sandbox" ? "https://demo-api.ramp.com" : "https://api.ramp.com");
    this.client = new RampApiClient(base, auth);
    const how = auth.kind === "client_credentials" ? "developer app" : auth.origin;
    this.info = { kind, label: `${kind === "sandbox" ? "Ramp sandbox" : "Ramp"} (${how})`, base_url: base };
  }
  snapshot(period: Period) {
    const key = `${period.from}|${period.to}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.p;
    // The promise itself is cached so concurrent callers share one read. A failed read is evicted so the next call retries.
    const p = this.client.snapshot(period, this.info);
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, { at: Date.now(), p });
    return p;
  }
  file(url: string) {
    return this.client.download(url);
  }
  async record(type: RecordKind, id: string) {
    // Prefer the snapshot the user just ran on, so receipts and approvals come along.
    const recent = [...this.cache.values()].sort((a, b) => b.at - a.at);
    for (const c of recent) {
      const snap = await c.p.catch(() => null);
      const hit = snap && recordFromSnapshot(snap, type, id);
      if (hit) return hit;
    }
    const path = { transaction: "transactions", bill: "bills", vendor: "vendors", user: "users", receipt: "receipts" }[type];
    return this.client.get(`/developer/v1/${path}/${encodeURIComponent(id)}`).catch(() => null);
  }
  async postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]) {
    await this.client.postComment(objectType, objectId, message, mentionUserIds);
    return { object_type: objectType, object_id: objectId, message, mention_user_ids: mentionUserIds, posted_at: new Date().toISOString(), destination: this.info.label };
  }
  async uploadReceipt(transactionId: string, userId: string, file: ReceiptUpload) {
    // One key per transaction and file, so a double click or a retry attaches the receipt once.
    const key = `tickmark-${transactionId}-${file.file_name}-${file.bytes.length}`.slice(0, 200);
    const res = await this.client.uploadReceipt(transactionId, userId, file, key);
    this.cache.clear(); // the next run and binder should see the new receipt
    return { id: res.id ?? null, destination: this.info.label };
  }
  /** Names for user ids, from the latest snapshot, else one lookup each. */
  private async names(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const c of [...this.cache.values()].sort((a, b) => b.at - a.at)) {
      const snap = await c.p.catch(() => null);
      for (const u of snap?.users ?? []) if (!out.has(u.id)) out.set(u.id, `${u.first_name} ${u.last_name}`);
    }
    for (const id of new Set(ids)) {
      if (!id || out.has(id)) continue;
      const u = await this.client.get<{ first_name?: string; last_name?: string }>(`/developer/v1/users/${encodeURIComponent(id)}`).catch(() => null);
      out.set(id, u ? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "Ramp user" : "Ramp user");
    }
    return out;
  }
  async recheck(items: RecheckItem[]): Promise<RecheckResult[]> {
    const fetched = await Promise.all(
      items.map(async (it) => {
        const isTxn = it.object_type === "transactions";
        const [rec, comments, approval] = await Promise.all([
          this.client.get<RampTransaction | RampBill>(`/developer/v1/${it.object_type}/${encodeURIComponent(it.object_id)}`).catch(() => null),
          this.client.comments(it.object_type, it.object_id),
          it.code === "NOT_APPROVED" || it.code === "NO_APPROVAL" ? this.client.approvalFor(isTxn ? "TRANSACTION" : "BILL", it.object_id) : Promise.resolve(null),
        ]);
        return { it, isTxn, rec, comments, approval };
      }),
    );
    const ids = fetched.flatMap((x) => [...x.comments.map((c) => c.user_id), ...(x.approval?.approval_history ?? []).map((h) => h.user_id ?? "")]);
    const names = await this.names(ids);
    const name = (id: string | null | undefined) => (id && names.get(id)) || "Ramp user";
    let changed = false;
    const out = fetched.map(({ it, isTxn, rec, comments, approval }) => {
      const r = resolution(it.code, { txn: isTxn ? (rec as RampTransaction | null) : null, bill: isTxn ? null : (rec as RampBill | null), approval, name });
      if (r.resolved) changed = true;
      const replies = comments
        // Ramp prepends "@Name" mentions to the posted text, so Tickmark's own comment is matched by containment.
        .filter((c) => !it.posted_message || !c.message.includes(it.posted_message.trim()))
        .map((c) => ({ id: c.id, author: name(c.user_id), message: c.message, created_at: c.created_at }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { finding_id: it.finding_id, resolved: r.resolved, how: r.how, replies, checked_at: new Date().toISOString() };
    });
    if (changed) this.cache.clear();
    return out;
  }
}

/** The chosen source plus whether it is a real Ramp account, for the connection badge in the UI. */
export interface Connection {
  source: RampSource;
  connected: boolean;
  reason: string; // why this source was chosen, shown in the UI
}

// Chosen once per process; env vars do not change while the server runs.
let cached: Connection | null = null;

/**
 * Picks the data source.
 * TICKMARK_SOURCE: auto (default) | sandbox | production | sample.
 * Auth, in order: RAMP_CLIENT_ID + RAMP_CLIENT_SECRET, RAMP_ACCESS_TOKEN, then a `ramp auth login` token.
 * auto uses Ramp when any credential is found and sample data otherwise.
 */
export function getConnection(): Connection {
  if (cached) return cached;
  const mode = (process.env.TICKMARK_SOURCE ?? "auto").toLowerCase();
  const env: "sandbox" | "production" = mode === "production" || process.env.RAMP_ENV === "production" ? "production" : "sandbox";
  if (mode === "sample" || mode === "fixture") {
    cached = { source: new FixtureSource(), connected: false, reason: "Sample data was chosen with TICKMARK_SOURCE." };
    return cached;
  }
  let auth: RampAuth | null = null;
  if (process.env.RAMP_CLIENT_ID && process.env.RAMP_CLIENT_SECRET) auth = { kind: "client_credentials", clientId: process.env.RAMP_CLIENT_ID, clientSecret: process.env.RAMP_CLIENT_SECRET };
  else if (process.env.RAMP_ACCESS_TOKEN) auth = { kind: "token", token: process.env.RAMP_ACCESS_TOKEN, origin: "access token" };
  let reason = "No Ramp credentials are configured, so sample data is used.";
  if (!auth) {
    const cli = loginFromRampCli(env);
    // A CLI login made during signup only has application scopes; it can't read spend yet.
    if (cli && cli.scopes.length && !cli.scopes.includes("transactions:read")) {
      reason = `The Ramp CLI is logged in to the ${env} but cannot read transactions yet (granted: ${cli.scopes.join(", ")}). Finish the Ramp application, then run \`ramp auth login\` again.`;
    } else if (cli) auth = { kind: "token", token: cli.token, origin: "Ramp CLI login" };
  }
  if (auth) {
    cached = { source: new ApiSource(env, auth, process.env.RAMP_API_BASE_URL), connected: true, reason: "" };
  } else {
    cached = { source: new FixtureSource(), connected: false, reason };
  }
  return cached;
}

/** Shortcut for the chosen source. */
export const getSource = (): RampSource => getConnection().source;

/** Test hook: forget the chosen source so env changes take effect. */
export function resetSource() {
  cached = null;
}
