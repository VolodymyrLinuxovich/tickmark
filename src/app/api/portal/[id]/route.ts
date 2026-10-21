// GET /api/portal/[id]: the auditor's read-only view. Results are recomputed from Ramp on each visit,
// and drafted follow-up messages (internal to the finance team) are removed.
import { getSource } from "@/lib/ramp/source";
import { runAll } from "@/lib/engine/run";
import { getPortal, ownsPortal, publicView } from "@/lib/portal/store";

export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const portal = await getPortal(id);
  if (!portal) return Response.json({ error: "This portal link is invalid or has expired." }, { status: 404 });
  const owner = ownsPortal(portal, req.headers.get("x-portal-owner"));
  const from = portal.requests.map((r) => r.period_from).filter(Boolean).sort()[0] ?? "2025-01-01";
  const to = portal.requests.map((r) => r.period_to).filter(Boolean).sort().at(-1) ?? "2025-12-31";
  try {
    const snap = await getSource().snapshot({ from: from!, to: to! });
    const results = runAll(portal.requests, snap).map((r) => ({ ...r, findings: r.findings.map(({ comment: _c, ...f }) => (void _c, f)) }));
    return Response.json({ portal: publicView(portal), owner, business: snap.business_name, results }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch (err) {
    return Response.json({ portal: publicView(portal), owner, error: `Could not read from Ramp: ${String(err).slice(0, 160)}` }, { status: 502 });
  }
}
