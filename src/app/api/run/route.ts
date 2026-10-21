// POST /api/run
// Body: { requests: AuditRequest[] (1 to 100) }. The workbench sends one request per call.
// Response: { results, business, source, warnings, counts, ms }, or { error } with 400 or 502.
// Read only. Pulls a Ramp snapshot for the period and runs the deterministic checks; drafted
// comments come back inside the findings and are not posted.

import { getSource } from "@/lib/ramp/source";
import { buildIndex, runRequest } from "@/lib/engine/run";
import { AuditRequestSchema } from "@/lib/parse/schema";
import { z } from "zod";

// The first call for a period pages through the Ramp API; later calls reuse the cached snapshot.
export const maxDuration = 120;

const Body = z.object({ requests: z.array(AuditRequestSchema).min(1).max(100) });

/** Smallest date range that covers every request; defaults to FY2025. */
function periodOf(reqs: z.infer<typeof Body>["requests"]) {
  const from = reqs.map((r) => r.period_from).filter(Boolean).sort()[0] ?? "2025-01-01";
  const to = reqs.map((r) => r.period_to).filter(Boolean).sort().at(-1) ?? "2025-12-31";
  return { from: from!, to: to! };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid requests" }, { status: 400 });
  const source = getSource();
  try {
    const t0 = Date.now();
    const snap = await source.snapshot(periodOf(parsed.data.requests));
    const ix = buildIndex(snap);
    const results = parsed.data.requests.map((r) => runRequest(r, ix));
    return Response.json({
      results,
      business: snap.business_name,
      source: source.info,
      warnings: (snap as { notes?: { warnings: string[] } }).notes?.warnings ?? [],
      counts: { transactions: snap.transactions.length, bills: snap.bills.length, receipts: snap.receipts.length, vendors: snap.vendors.length, users: snap.users.length },
      ms: Date.now() - t0,
    });
  } catch (err) {
    return Response.json({ error: `Could not read from Ramp: ${String(err).slice(0, 300)}` }, { status: 502 });
  }
}
