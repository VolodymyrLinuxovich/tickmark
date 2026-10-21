// A local stand-in for the Ramp Developer API, shaped like docs.ramp.com/developer-api/v1:
// client credentials token, page.next pagination, repeated entity_ids, scope checks,
// agent-tools bill history, audit log events, comments and pre-signed file URLs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { buildFixture } from "../src/lib/fixtures/generate";
import type { RampSnapshot } from "../src/lib/ramp/types";

export const APP = { clientId: "ramp_id_test", clientSecret: "ramp_sec_test" };
export const CLI_TOKEN = "cli-token-no-approvals";
const APP_TOKEN = "app-token-all-scopes";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da6364f8cf00000301010018dd8db00000000049454e44ae426082",
  "hex",
);

export interface MockRamp {
  url: string;
  snap: RampSnapshot;
  log: { method: string; path: string; query: URLSearchParams; auth: string }[];
  comments: { type: string; id: string; body: unknown }[];
  maxEntityIds: number;
  failNextWith429: boolean;
  close(): Promise<void>;
}

export async function startMockRamp(): Promise<MockRamp> {
  const snap = structuredClone(buildFixture(20251231).snapshot);
  let base = "";
  const state: MockRamp = {
    url: "",
    snap,
    log: [],
    comments: [],
    maxEntityIds: 0,
    failNextWith429: true,
    close: () => new Promise((r) => server.close(() => r())),
  };
  // Pre-signed URLs, like Ramp's receipt_url and attachment urls.
  const signed = (kind: string, id: string) => `${base}/files/${kind}/${id}?X-Amz-Signature=test`;

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", "x-trace-id": "trace-test", ...headers });
    res.end(JSON.stringify(body));
  };

  const page = <T,>(res: ServerResponse, path: string, q: URLSearchParams, rows: T[]) => {
    const size = Math.min(Number(q.get("page_size") ?? 20), 100);
    const start = Number(q.get("start") ?? 0);
    const data = rows.slice(start, start + size);
    let next: string | null = null;
    if (start + size < rows.length) {
      const nq = new URLSearchParams(q);
      nq.set("start", String(start + size));
      next = `${base}${path}?${nq}`;
    }
    send(res, 200, { data, page: { next } });
  };

  const inRange = (iso: string | null | undefined, from?: string | null, to?: string | null) => !!iso && (!from || iso >= from) && (!to || iso <= to);

  const body = (req: IncomingMessage) =>
    new Promise<string>((r) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => r(b));
    });

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url!, base);
    const q = u.searchParams;
    const auth = req.headers.authorization ?? "";
    state.log.push({ method: req.method!, path: u.pathname, query: q, auth });
    const p = u.pathname;

    if (p.startsWith("/files/")) {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(PNG);
    }
    if (p === "/developer/v1/token" && req.method === "POST") {
      const raw = await body(req);
      const form = new URLSearchParams(raw);
      const expected = `Basic ${Buffer.from(`${APP.clientId}:${APP.clientSecret}`).toString("base64")}`;
      if (auth !== expected || form.get("grant_type") !== "client_credentials") return send(res, 401, { error: "invalid_client" });
      return send(res, 200, { access_token: APP_TOKEN, token_type: "Bearer", expires_in: 864000, scope: form.get("scope") ?? "" });
    }
    const token = auth.replace(/^Bearer /, "");
    if (token !== APP_TOKEN && token !== CLI_TOKEN) return send(res, 401, { error: "unauthorized" });

    if (state.failNextWith429 && p === "/developer/v1/users") {
      state.failNextWith429 = false;
      return send(res, 429, { error: "rate limited" }, { "retry-after": "0" });
    }

    switch (p) {
      case "/developer/v1/business":
        return send(res, 200, { business_name_legal: "Acme Robotics, Inc." });
      case "/developer/v1/users":
        return page(res, p, q, snap.users);
      case "/developer/v1/departments":
        return page(res, p, q, snap.departments);
      case "/developer/v1/vendors":
        return page(res, p, q, snap.vendors);
      case "/developer/v1/transactions":
        return page(res, p, q, snap.transactions.filter((t) => inRange(t.user_transaction_time, q.get("from_date"), q.get("to_date"))));
      case "/developer/v1/receipts":
        return page(
          res,
          p,
          q,
          snap.receipts.filter((r) => inRange(r.created_at, q.get("from_date"), q.get("to_date"))).map((r) => ({ ...r, receipt_url: signed("receipts", r.id) })),
        );
      case "/developer/v1/bills":
        return page(
          res,
          p,
          q,
          snap.bills
            .filter((b) => inRange(b.issued_at, q.get("from_issued_date"), q.get("to_issued_date")))
            .map((b) => ({ ...b, attachments: b.attachments.map((a) => ({ ...a, url: signed("bills", b.id) })) })),
        );
      case "/developer/v1/approvals": {
        if (token === CLI_TOKEN) return send(res, 403, { error: "missing scope approvals:read" });
        const ids = q.getAll("entity_ids");
        state.maxEntityIds = Math.max(state.maxEntityIds, ids.length);
        const type = (q.get("entity_type") ?? "").toLowerCase();
        return page(res, p, q, snap.approvals.filter((a) => a.entity_type === type && ids.includes(a.entity_id)));
      }
      case "/developer/v1/agent-tools/get-bill-history": {
        const { bill_id } = JSON.parse(await body(req)) as { bill_id: string };
        const a = snap.approvals.find((x) => x.entity_id === bill_id);
        return send(res, 200, {
          bill_id,
          events: [
            { event_type: "CREATED", date: snap.bills.find((b) => b.id === bill_id)?.created_at, approval_chain_events: [] },
            ...(a?.approval_history ?? []).map((h) => ({
              event_type: "APPROVAL",
              date: h.action_at,
              approval_chain_events: [{ status: "Approved", step_date: h.action_at, assigned_entities: [{ assigned_user_id: h.user_id }] }],
            })),
          ],
        });
      }
      case "/developer/v1/audit-logs/events": {
        const types = q.getAll("event_types");
        const events = snap.approvals
          .filter((a) => a.entity_type === "transaction")
          .flatMap((a) =>
            a.approval_history.map((h) => ({
              actor_id: h.user_id,
              actor_type: "user",
              event_time: h.action_at,
              event_type: "Approval step approved",
              event_details: { references: [{ label: "Transaction", resource_name: "Transaction", url: `https://demo.ramp.com/business-overview/transactions/${a.entity_id}` }] },
            })),
          )
          .filter((e) => !types.length || types.includes(e.event_type));
        return page(res, p, q, events);
      }
    }
    const cm = p.match(/^\/developer\/v1\/comments\/(bills|transactions)\/([^/]+)$/);
    if (cm && req.method === "POST") {
      state.comments.push({ type: cm[1], id: cm[2], body: JSON.parse(await body(req)) });
      return send(res, 201, { id: "comment-1" });
    }
    const one = p.match(/^\/developer\/v1\/(transactions|bills|vendors|users)\/([^/]+)$/);
    if (one) {
      const list = { transactions: snap.transactions, bills: snap.bills, vendors: snap.vendors, users: snap.users }[one[1] as "users"] as { id: string }[];
      const hit = list.find((x) => x.id === one[2]);
      return hit ? send(res, 200, hit) : send(res, 404, { error: "not found" });
    }
    send(res, 404, { error: `no route ${p}` });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.url = base;
  return state;
}
