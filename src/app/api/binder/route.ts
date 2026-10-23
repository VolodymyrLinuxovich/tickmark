// POST /api/binder
// Body: { requests: AuditRequest[] (1 to 100), auditor?: string | null, statuses?: { [findingId]: { status, note? } } }.
// Response: a ZIP download (index, workpapers and evidence files), named after the business.
// Read only: builds the binder from Ramp data and posts nothing back to Ramp.

import { getSource } from "@/lib/ramp/source";
import { runAll } from "@/lib/engine/run";
import { buildBinder } from "@/lib/binder/build";
import { AuditRequestSchema } from "@/lib/parse/schema";
import { z } from "zod";
import { PlanSchema } from "@/lib/ask/plan";
import { runPlan } from "@/lib/ask/run";
import type { RequestResult } from "@/lib/engine/types";

// Building the ZIP can download every receipt and invoice file, so this route gets the longest limit.
export const maxDuration = 300;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Status = z.object({ status: z.enum(["open", "resolved", "waived"]), note: z.string().max(500).optional() });
const Body = z.object({
  requests: z.array(AuditRequestSchema).min(1).max(100),
  auditor: z.string().nullable().optional(),
  // Exception statuses set in the app, keyed by finding id. Shown in the workpapers and the index.
  statuses: z.record(z.string(), Status).optional(),
  // "Ask your books" questions added to the binder. The plan is rerun here on Ramp data.
  // `period` is the one Ask answered on, so the rerun returns the rows the user saw.
  extras: z.array(z.object({ question: z.string().max(500), plan: PlanSchema, period: z.object({ from: Day, to: Day }).optional() })).max(20).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid requests" }, { status: 400 });
  const source = getSource();
  const reqs = parsed.data.requests;
  // One snapshot covers the widest period across all requests; defaults to FY2025.
  const from = reqs.map((r) => r.period_from).filter(Boolean).sort()[0] ?? "2025-01-01";
  const to = reqs.map((r) => r.period_to).filter(Boolean).sort().at(-1) ?? "2025-12-31";
  // The snapshot also covers the periods Ask questions were answered on.
  const asked = (parsed.data.extras ?? []).flatMap((x) => (x.period ? [x.period] : []));
  const snapFrom = [from!, ...asked.map((x) => x.from)].sort()[0];
  const snapTo = [to!, ...asked.map((x) => x.to)].sort().at(-1)!;
  const snap = await source.snapshot({ from: snapFrom, to: snapTo });
  // Rerun from source data so the binder never contains numbers the server did not compute.
  // A wider snapshot must not change the checks: requests with no period keep the binder's own one.
  const widened = snapFrom < from! || snapTo > to!;
  const results = runAll(widened ? reqs.map((r) => ({ ...r, period_from: r.period_from ?? from!, period_to: r.period_to ?? to! })) : reqs, snap);
  (parsed.data.extras ?? []).forEach((x, i) => {
    // Keep the question's own limit ("top 5"), but no screen cap: the binder lists every match.
    const period = x.period ?? { from: from!, to: to! };
    const r = runPlan(x.plan, snap, undefined, { cap: Infinity, period });
    const extra: RequestResult = {
      request: { ref: `ASK-${String(i + 1).padStart(2, "0")}`, text: x.question, type: "unsupported", period_from: period.from, period_to: period.to, min_amount: null, selections: [], interpretation: r.title },
      status: "complete",
      headline: r.rows.length < r.total ? `Top ${r.rows.length} of ${r.total} matching ${r.entity}` : `${r.total} matching ${r.entity}`,
      procedure: [`Asked: "${x.question}". Ran the filter (${r.filters.join(", ") || "all records"}) on every ${r.entity.replace(/s$/, "")} in Ramp for the period.`],
      columns: r.columns,
      rows: r.rows.map((row) => ({ record: row.record, cells: row.cells, tickmarks: [], finding_ids: [], files: [] })),
      findings: [],
      population: r.total,
      tested: r.rows.length,
    };
    results.push(extra);
  });
  const zip = await buildBinder(results, snap, source, parsed.data.auditor ?? null, parsed.data.statuses ?? {});
  const name = `${snap.business_name.replace(/[^A-Za-z0-9]+/g, "-").replace(/-$/, "")}-audit-binder.zip`;
  return new Response(new Blob([zip as BlobPart], { type: "application/zip" }), {
    headers: { "Content-Disposition": `attachment; filename="${name}"` },
  });
}
