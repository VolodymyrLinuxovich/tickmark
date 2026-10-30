// POST /api/warm
// Called when the app opens. Starts reading the connected Ramp business for the trailing
// 12 months, so the sample run finds it cached instead of waiting on many paginated calls.
// Returns at once with { warming }; the read continues in the background. Read only.

import { after } from "next/server";
import { getConnection } from "@/lib/ramp/source";
import { trailingYear } from "@/lib/engine/live-sample";

export const maxDuration = 60;

export async function POST() {
  const conn = getConnection();
  if (!conn.connected) return Response.json({ warming: false });
  const read = conn.source.snapshot(trailingYear());
  // after() keeps the function alive until the read is cached, without holding the response.
  after(() => read.then(() => undefined, () => undefined));
  return Response.json({ warming: true });
}
