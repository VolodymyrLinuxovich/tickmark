// POST /api/comment
// Body: { object_type: "bills" | "transactions", object_id, message, mention_user_ids? }.
// Response: the posted comment, including `destination` (where it went), or { error } with 400 or 502.
// This is the only route that writes to Ramp. The UI calls it only after the user presses
// "Approve and send" on a drafted comment; the MCP server never calls it. With no Ramp account
// connected, the sample source records the comment in an in-memory outbox instead.

import { getSource } from "@/lib/ramp/source";
import { z } from "zod";
import { rampError } from "@/lib/receipts/errors";

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
    const e = rampError(err, object_type === "bills" ? "bills:write" : "transactions:write");
    return Response.json({ error: e.error }, { status: e.status });
  }
}
