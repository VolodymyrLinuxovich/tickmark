// POST /api/portal: share the current request list with an auditor. Returns the portal link and an owner
// key that only the controller's browser keeps (needed to answer questions). Stores no Ramp data.
import { z } from "zod";
import { AuditRequestSchema } from "@/lib/parse/schema";
import { createPortal } from "@/lib/portal/store";

const Body = z.object({
  requests: z.array(AuditRequestSchema).min(1).max(100),
  business: z.string().max(200),
  auditor: z.string().max(200).nullable().optional(),
  days: z.number().int().min(1).max(60).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid portal request" }, { status: 400 });
  try {
    const { portal, ownerKey } = await createPortal({ ...parsed.data, auditor: parsed.data.auditor ?? null });
    return Response.json({ id: portal.id, path: `/portal/${portal.id}`, owner_key: ownerKey, expires_at: portal.expires_at });
  } catch (err) {
    return Response.json({ error: `Could not save the portal: ${String(err).slice(0, 160)}` }, { status: 500 });
  }
}
