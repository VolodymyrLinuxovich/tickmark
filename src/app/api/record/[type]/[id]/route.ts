import { getSource } from "@/lib/ramp/source";

export async function GET(_req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const snap = await getSource().snapshot({ from: "2025-01-01", to: "2025-12-31" });
  const pick = {
    transaction: () => {
      const t = snap.transactions.find((x) => x.id === id);
      return t && { transaction: t, receipts: snap.receipts.filter((r) => r.transaction_id === id), approval: snap.approvals.find((a) => a.entity_id === id) ?? null };
    },
    bill: () => {
      const b = snap.bills.find((x) => x.id === id);
      return b && { bill: b, approval: snap.approvals.find((a) => a.entity_id === id) ?? null };
    },
    vendor: () => snap.vendors.find((x) => x.id === id),
    user: () => snap.users.find((x) => x.id === id),
    receipt: () => snap.receipts.find((x) => x.id === id),
  }[type as "transaction"];
  const record = pick?.();
  if (!record) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ type, id, source: snap.source, record });
}
