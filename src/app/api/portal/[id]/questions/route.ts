// The auditor asks a question about one request. GET returns the questions only, for cheap polling.
import { z } from "zod";
import { addQuestion, getPortal } from "@/lib/portal/store";

const Body = z.object({ ref: z.string().max(40), text: z.string().trim().min(2).max(2000), name: z.string().trim().max(120).nullable().optional() });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const portal = await getPortal((await params).id);
  if (!portal) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ questions: portal.questions }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write a question first." }, { status: 400 });
  const q = await addQuestion((await params).id, { ref: parsed.data.ref, text: parsed.data.text, name: parsed.data.name || null });
  if (!q) return Response.json({ error: "This portal link is invalid or has expired." }, { status: 404 });
  return Response.json({ question: q });
}
