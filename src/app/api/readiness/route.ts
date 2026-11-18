// GET /api/readiness?days=90
// Response: Readiness (see lib/engine/readiness.ts) plus the data source, or { error } with 502.
// Read only. Runs the year-end checks on the last `days` days (30 to 180) of Ramp data, so problems
// show up while they are days old. Drafted follow-ups come back inside the findings and are not posted.

import { getSource } from "@/lib/ramp/source";
import { trailingYear } from "@/lib/engine/live-sample";
import { asOfDate, computeReadiness } from "@/lib/engine/readiness";
import { readinessDays } from "@/lib/engine/readiness-days";

export const maxDuration = 120;

export async function GET(req: Request) {
  const days = readinessDays(new URL(req.url).searchParams.get("days"));
  const source = getSource();
  try {
    const t0 = Date.now();
    // Live data reads the trailing year, the same period the app warms on open, so this is usually cached.
    const snap = await source.snapshot(trailingYear());
    const asOf = asOfDate(snap, source.info.kind !== "fixture");
    return Response.json({ ...computeReadiness(snap, asOf, days), source: source.info, ms: Date.now() - t0 });
  } catch (err) {
    return Response.json({ error: `Could not read from Ramp: ${String(err).slice(0, 300)}` }, { status: 502 });
  }
}
