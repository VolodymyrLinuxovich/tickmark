// Minimal Ramp Developer API client. Endpoints, auth and pagination follow
// docs.ramp.com/developer-api/v1 (token: client credentials grant; lists: page.next).

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

export const READ_SCOPES = [
  "transactions:read",
  "receipts:read",
  "bills:read",
  "users:read",
  "departments:read",
  "vendors:read",
  "approvals:read",
  "business:read",
].join(" ");

const addDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 864e5).toISOString().replace(".000Z", "Z");

export class RampApiClient {
  private token: { value: string; expires: number } | null = null;

  constructor(private base: string, private clientId: string, private clientSecret: string) {}

  private async accessToken(scope = READ_SCOPES): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${this.base}/developer/v1/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    });
    if (!res.ok) throw new Error(`Ramp token request failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async get<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.base}${pathOrUrl}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: "application/json" } });
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`GET ${url} failed (${res.status}, trace ${res.headers.get("x-trace-id") ?? "n/a"})`);
      return (await res.json()) as T;
    }
  }

  /** Follows page.next until the list is exhausted. */
  async list<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const qs = new URLSearchParams({ page_size: "100", ...params });
    let next: string | null = `${path}?${qs}`;
    const out: T[] = [];
    while (next) {
      const page: { data: T[]; page?: { next: string | null } } = await this.get(next);
      out.push(...page.data);
      next = page.page?.next ?? null;
    }
    return out;
  }

  async snapshot(period: { from: string; to: string }, info: SourceInfo): Promise<RampSnapshot> {
    const range = { from_date: `${period.from}T00:00:00Z`, to_date: `${period.to}T23:59:59Z` };
    const [business, users, departments, transactions, receipts, bills, vendors] = await Promise.all([
      this.get<{ business_name_on_card?: string; business_name_legal?: string }>("/developer/v1/business").catch(() => ({} as { business_name_legal?: string })),
      this.list<RampUser>("/developer/v1/users"),
      this.list<RampDepartment>("/developer/v1/departments"),
      this.list<RampTransaction>("/developer/v1/transactions", range),
      // Receipts often arrive after the charge, so look 90 days past the period end.
      this.list<RampReceipt>("/developer/v1/receipts", { from_date: range.from_date, to_date: addDays(range.to_date, 90), include_ocr_data: "true" }),
      this.list<RampBill>("/developer/v1/bills", { from_issued_date: range.from_date, to_issued_date: range.to_date }),
      this.list<RampVendor>("/developer/v1/vendors"),
    ]);
    const approvals = [
      ...(await this.approvals("TRANSACTION", transactions.map((t) => t.id))),
      ...(await this.approvals("BILL", bills.map((b) => b.id))),
    ];
    return {
      business_name: business.business_name_legal ?? "Ramp business",
      source: info,
      users,
      departments,
      transactions,
      receipts,
      bills,
      vendors,
      approvals,
    };
  }

  private async approvals(entityType: "TRANSACTION" | "BILL", ids: string[]): Promise<RampApproval[]> {
    const out: RampApproval[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const qs = new URLSearchParams({ entity_type: entityType });
      ids.slice(i, i + 50).forEach((id) => qs.append("entity_ids", id));
      out.push(...(await this.list<RampApproval>(`/developer/v1/approvals`, Object.fromEntries(qs))));
    }
    return out;
  }

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    // Receipt and attachment URLs are pre-signed, so no bearer token is sent.
    const res = await fetch(url);
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]) {
    const scope = objectType === "bills" ? "bills:write" : "transactions:write";
    this.token = null; // write scope needs its own token
    const res = await fetch(`${this.base}/developer/v1/comments/${objectType}/${objectId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken(scope)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message, message_format: "PLAIN_TEXT", mention_user_ids: mentionUserIds }),
    });
    this.token = null;
    if (!res.ok) throw new Error(`Posting comment failed (${res.status}): ${await res.text()}`);
  }
}
