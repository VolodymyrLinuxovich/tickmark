// POST /api/binder
// Body: { requests: AuditRequest[] (1 to 100), auditor?: string | null, statuses?: { [findingId]: { status, note? } } }.
// Response: a ZIP download (index, workpapers and evidence files), named after the business.
// Read only: builds the binder from Ramp data and posts nothing back to Ramp.

import { getSource } from "@/lib/ramp/source";
import { runAll } from "@/lib/engine/run";
import { buildBinder } from "@/lib/binder/build";
import { AuditRequestSchema } from "@/lib/parse/schema";
import { z } from "zod";
import { ExtrasSchema, StatusesSchema } from "@/lib/binder/options";
import { runPlan } from "@/lib/ask/run";
import type { RequestResult } from "@/lib/engine/types";

// Building the ZIP can download every receipt and invoice file, so this route gets the longest limit.
export const maxDuration = 300;

const Body = z.object({
  requests: z.array(AuditRequestSchema).min(1).max(100),
  auditor: z.string().nullable().optional(),
  statuses: StatusesSchema.optional(),
  extras: ExtrasSchema.optional(),
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
