// MCP server: lets an agent (Claude, Cursor, a Ramp agent) run Tickmark.
// Read-only by design. Follow-up comments are returned as drafts; sending them
// stays in the Tickmark app behind a person's approval.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { normalizeText } from "@/lib/parse/input";
import { parseRequests } from "@/lib/parse/claude";
import { AuditRequestSchema, REQUEST_TYPE_INFO } from "@/lib/parse/schema";
import { getSource } from "@/lib/ramp/source";
import { buildIndex, runRequest, uniqueFindings } from "@/lib/engine/run";
import type { RequestResult } from "@/lib/engine/types";

export const maxDuration = 120;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

function period(reqs: z.infer<typeof AuditRequestSchema>[]) {
  const from = reqs.map((r) => r.period_from).filter(Boolean).sort()[0] ?? "2025-01-01";
  const to = reqs.map((r) => r.period_to).filter(Boolean).sort().at(-1) ?? "2025-12-31";
  return { from: from!, to: to! };
}

function summarize(results: RequestResult[], includeRows: boolean) {
  return {
    requests: results.map((r) => ({
      ref: r.request.ref,
      type: REQUEST_TYPE_INFO[r.request.type].label,
      status: r.status,
      headline: r.headline,
      procedure: r.procedure,
      tested: r.tested,
      finding_ids: r.findings.map((f) => f.id),
      ...(includeRows ? { columns: r.columns, rows: r.rows.map((row) => ({ ramp_id: row.record.id, cells: row.cells, tickmarks: row.tickmarks.join("") })) } : {}),
    })),
    exceptions: uniqueFindings(results).map((f) => ({
      id: f.id,
      code: f.code,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      owner: f.owner?.name ?? null,
      ramp_records: f.records.map((r) => ({ type: r.type, id: r.id, label: r.label })),
      draft_comment: f.comment ? { on: `${f.comment.object_type}/${f.comment.object_id}`, message: f.comment.message } : null,
    })),
  };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "read_request_list",
      {
        title: "Read an audit request list",
        description:
          "Turn an auditor's PBC request list (pasted email or CSV text) into typed requests: type, period, dollar threshold and selected items. Review these before answering them.",
        inputSchema: z.object({ text: z.string().min(1).describe("The request list as text") }),
        annotations: { readOnlyHint: true },
      },
      async ({ text }) => {
        const parsed = await parseRequests(normalizeText(text));
        return json(parsed);
      },
    );

    server.registerTool(
      "answer_audit_requests",
      {
        title: "Answer audit requests from Ramp",
        description:
          "Pull evidence from Ramp and run the audit checks for each request. Pass either the raw request list text or requests returned by read_request_list. Returns each request's result, every exception with the Ramp records behind it, and a drafted follow-up comment. Nothing is posted to Ramp.",
        inputSchema: z.object({
          text: z.string().optional().describe("Raw request list; parsed first if given"),
          requests: z.array(AuditRequestSchema).optional().describe("Requests from read_request_list, possibly edited"),
          include_rows: z.boolean().default(false).describe("Include every evidence row (large)"),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ text, requests, include_rows }) => {
        let reqs = requests;
        let parser: string | null = null;
        if (!reqs?.length) {
          if (!text?.trim()) return { ...json({ error: "Pass text or requests" }), isError: true };
          const parsed = await parseRequests(normalizeText(text));
          reqs = parsed.requests;
          parser = parsed.parser;
        }
        const source = getSource();
        const snap = await source.snapshot(period(reqs));
        const ix = buildIndex(snap);
        const results = reqs.map((r) => runRequest(r, ix));
        return json({ business: snap.business_name, data_source: source.info.label, parser, ...summarize(results, include_rows) });
      },
    );

    server.registerTool(
      "get_ramp_record",
      {
        title: "Get a Ramp record",
        description: "Fetch the Ramp transaction, bill, vendor or user behind an exception, with its receipts and approval history.",
        inputSchema: z.object({ type: z.enum(["transaction", "bill", "vendor", "user"]), id: z.string() }),
        annotations: { readOnlyHint: true },
      },
      async ({ type, id }) => {
        const snap = await getSource().snapshot({ from: "2025-01-01", to: "2025-12-31" });
        const record =
          type === "transaction"
            ? (() => {
                const t = snap.transactions.find((x) => x.id === id);
                return t && { transaction: t, receipts: snap.receipts.filter((r) => r.transaction_id === id), approval: snap.approvals.find((a) => a.entity_id === id) ?? null };
              })()
            : type === "bill"
              ? (() => {
                  const b = snap.bills.find((x) => x.id === id);
                  return b && { bill: b, approval: snap.approvals.find((a) => a.entity_id === id) ?? null };
                })()
              : type === "vendor"
                ? snap.vendors.find((x) => x.id === id)
                : snap.users.find((x) => x.id === id);
        if (!record) return { ...json({ error: `No ${type} ${id}` }), isError: true };
        return json(record);
      },
    );
  },
  { serverInfo: { name: "tickmark", version: "0.1.0" } },
);

export { handler as GET, handler as POST, handler as DELETE };
