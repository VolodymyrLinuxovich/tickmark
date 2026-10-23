// GET /api/portal/[id]: the auditor's read-only view. Results are recomputed from Ramp on each visit,
// and drafted follow-up messages (internal to the finance team) are removed.
import { getSource } from "@/lib/ramp/source";
import { runAll } from "@/lib/engine/run";
import { z } from "zod";
import { getPortal, ownsPortal, publicView, updateShared } from "@/lib/portal/store";
import { AuditRequestSchema } from "@/lib/parse/schema";
import { ExtrasSchema, StatusesSchema } from "@/lib/binder/options";

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

// PATCH /api/portal/[id]: the controller keeps the shared portal in step with the app (request list,
// exception statuses, Ask questions). Requires the owner key kept by the controller's browser.
const Patch = z.object({
  owner_key: z.string().min(20).max(100),
  requests: z.array(AuditRequestSchema).min(1).max(100).optional(),
  statuses: StatusesSchema.optional(),
  extras: ExtrasSchema.optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid portal update" }, { status: 400 });
  const { owner_key, ...patch } = parsed.data;
  try {
    const p = await updateShared((await params).id, owner_key, patch);
    if (!p) return Response.json({ error: "This link has expired or was shared from another browser." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: `Could not update the portal: ${String(err).slice(0, 160)}` }, { status: 500 });
  }
}
