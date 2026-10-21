// The controller answers an auditor question. Requires the owner key kept by the controller's browser.
import { z } from "zod";
import { answerQuestion } from "@/lib/portal/store";

const Body = z.object({ owner_key: z.string().min(20).max(100), question_id: z.string().max(40), text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write an answer first." }, { status: 400 });
  const q = await answerQuestion((await params).id, parsed.data.owner_key, parsed.data.question_id, parsed.data.text);
  if (!q) return Response.json({ error: "Only the person who shared this portal can answer." }, { status: 403 });
  return Response.json({ question: q });
}
