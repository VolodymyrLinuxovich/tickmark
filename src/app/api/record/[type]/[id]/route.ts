import { getSource, type RecordKind } from "@/lib/ramp/source";

const KINDS = new Set(["transaction", "bill", "vendor", "user", "receipt"]);

export async function GET(_req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  if (!KINDS.has(type)) return Response.json({ error: "Unknown record type" }, { status: 400 });
  const source = getSource();
  const record = await source.record(type as RecordKind, id);
  if (!record) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ type, id, source: source.info, record });
}
