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

// A tool call may parse with a model and then fetch a full Ramp snapshot.
export const maxDuration = 120;

/** Wraps a value as the text content block MCP tool results expect. */
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/** Smallest date range that covers every request; defaults to FY2025. */
function period(reqs: z.infer<typeof AuditRequestSchema>[]) {
  const from = reqs.map((r) => r.period_from).filter(Boolean).sort()[0] ?? "2025-01-01";
  const to = reqs.map((r) => r.period_to).filter(Boolean).sort().at(-1) ?? "2025-12-31";
  return { from: from!, to: to! };
}

/**
 * Shapes engine results for an agent: one entry per request plus deduplicated exceptions with
 * their Ramp records and draft comments. Evidence rows are left out unless asked for, since they can be large.
 */
function summarize(results: RequestResult[], includeRows: boolean, maxExceptions: number) {
  // Findings arrive sorted by severity, then dollars, so a cap keeps the ones that matter.
  const all = uniqueFindings(results);
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
    exceptions_total: all.length,
    exceptions_by_severity: Object.fromEntries(["high", "medium", "low"].map((s) => [s, all.filter((f) => f.severity === s).length])),
    exceptions: all.slice(0, maxExceptions).map((f) => ({
      id: f.id,
      code: f.code,
      severity: f.severity,
      amount_usd: f.amount != null ? f.amount / 100 : null,
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
          "Turn an auditor's PBC request list (pasted email or CSV text) into typed requests: type, period, dollar threshold and selected items. Keyword rules read spreadsheets and documents; a language model reads short emails, or any list when use_model is set. Review these before answering them.",
        inputSchema: z.object({ text: z.string().min(1).describe("The request list as text"), use_model: z.boolean().default(false).describe("Read with a language model even when the keyword rules can") }),
        annotations: { readOnlyHint: true },
      },
      async ({ text, use_model }) => {
        const parsed = await parseRequests(normalizeText(text), { useModel: use_model });
        return json(parsed);
      },
    );

    server.registerTool(
      "answer_audit_requests",
      {
        title: "Answer audit requests from Ramp",
        description:
          "Pull evidence from Ramp and run the audit checks for each request. Pass either the raw request list text or requests returned by read_request_list. Returns each request's result, exception counts by severity, and the top exceptions (most severe and largest first) with dollars at stake, the Ramp records behind them and a drafted follow-up comment. Nothing is posted to Ramp.",
        inputSchema: z.object({
          text: z.string().optional().describe("Raw request list; parsed first if given"),
          requests: z.array(AuditRequestSchema).optional().describe("Requests from read_request_list, possibly edited"),
          include_rows: z.boolean().default(false).describe("Include every evidence row (large)"),
          max_exceptions: z.number().int().min(1).max(500).default(25).describe("Exceptions to return, most severe and largest first"),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ text, requests, include_rows, max_exceptions }) => {
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
        const warnings = (snap as { notes?: { warnings: string[] } }).notes?.warnings ?? [];
        return json({ business: snap.business_name, data_source: source.info.label, parser, warnings, ...summarize(results, include_rows, max_exceptions) });
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
        const record = await getSource().record(type, id);
        if (!record) return { ...json({ error: `No ${type} ${id}` }), isError: true };
        return json(record);
      },
    );
  },
  { serverInfo: { name: "tickmark", version: "0.1.0" } },
);

// Streamable HTTP transport uses GET, POST and DELETE on the same path.
export { handler as GET, handler as POST, handler as DELETE };
