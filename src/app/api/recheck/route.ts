// POST /api/recheck
// Body: { items: RecheckItem[] (1 to 60) }. Response: { results: RecheckResult[] } or { error }.
// Read only. The results view calls it every few seconds for findings it is watching: ones with a
// follow-up sent or a receipt attached. It reports whether Ramp now shows the fix, plus thread replies.

import { z } from "zod";
import { getSource } from "@/lib/ramp/source";

export const maxDuration = 60;

const Item = z.object({
  finding_id: z.string().min(1).max(200),
  code: z.string().min(1).max(40),
  object_type: z.enum(["bills", "transactions"]),
  object_id: z.string().min(1).max(100),
  posted_message: z.string().max(4000).optional(),
  since: z.string().max(40).optional(),
  owner: z.string().max(120).optional(),
  attached: z.boolean().optional(),
});
const Body = z.object({ items: z.array(Item).min(1).max(60) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid items" }, { status: 400 });
  try {
    return Response.json({ results: await getSource().recheck(parsed.data.items) });
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 502 });
  }
}
