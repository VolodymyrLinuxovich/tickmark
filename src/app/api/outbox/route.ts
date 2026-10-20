import { connection } from "next/server";
import { getDemoOutbox } from "@/lib/ramp/source";

/** Comments approved while running on demo data (no Ramp account connected). */
export async function GET() {
  await connection();
  return Response.json({ comments: getDemoOutbox() });
}
