// GET /api/outbox
// Response: { comments: PostedComment[] }.

import { connection } from "next/server";
import { getDemoOutbox } from "@/lib/ramp/source";

/** Comments approved while running on demo data (no Ramp account connected). */
export async function GET() {
  // Next 16 with Cache Components would otherwise prerender this route at build time.
  // connection() marks it as request time, so it returns the outbox as it is now.
  await connection();
  return Response.json({ comments: getDemoOutbox() });
}
