// GET /api/record/:type/:id
// Response: { type, id, source, record } with the raw Ramp record, or { error } with 400 or 404.
// Read only. Backs the record drawer in the workbench.

import { getSource, type RecordKind } from "@/lib/ramp/source";

const KINDS = new Set(["transaction", "bill", "vendor", "user", "receipt"]);

export async function GET(_req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  // Route params are a Promise in Next 16.
  const { type, id } = await params;
  if (!KINDS.has(type)) return Response.json({ error: "Unknown record type" }, { status: 400 });
  const source = getSource();
  const record = await source.record(type as RecordKind, id);
  if (!record) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ type, id, source: source.info, record });
}
