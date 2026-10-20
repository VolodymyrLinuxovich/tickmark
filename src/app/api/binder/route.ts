import { getSource } from "@/lib/ramp/source";
import { runAll } from "@/lib/engine/run";
import { buildBinder } from "@/lib/binder/build";
import { AuditRequestSchema } from "@/lib/parse/schema";
import { z } from "zod";

export const maxDuration = 300;

const Body = z.object({ requests: z.array(AuditRequestSchema).min(1).max(100), auditor: z.string().nullable().optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid requests" }, { status: 400 });
  const source = getSource();
  const reqs = parsed.data.requests;
  const from = reqs.map((r) => r.period_from).filter(Boolean).sort()[0] ?? "2025-01-01";
  const to = reqs.map((r) => r.period_to).filter(Boolean).sort().at(-1) ?? "2025-12-31";
  const snap = await source.snapshot({ from: from!, to: to! });
  // Rerun from source data so the binder never contains numbers the server did not compute.
  const results = runAll(reqs, snap);
  const zip = await buildBinder(results, snap, source, parsed.data.auditor ?? null);
  const name = `${snap.business_name.replace(/[^A-Za-z0-9]+/g, "-").replace(/-$/, "")}-audit-binder.zip`;
  return new Response(new Blob([zip as BlobPart], { type: "application/zip" }), {
    headers: { "Content-Disposition": `attachment; filename="${name}"` },
  });
}
