import { getSource } from "@/lib/ramp/source";
import { z } from "zod";

const Body = z.object({
  object_type: z.enum(["bills", "transactions"]),
  object_id: z.string().min(1),
  message: z.string().min(1).max(4000),
  mention_user_ids: z.array(z.string()).max(10).default([]),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid comment" }, { status: 400 });
  const { object_type, object_id, message, mention_user_ids } = parsed.data;
  try {
    const posted = await getSource().postComment(object_type, object_id, message, mention_user_ids);
    return Response.json(posted);
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 300) }, { status: 502 });
  }
}
