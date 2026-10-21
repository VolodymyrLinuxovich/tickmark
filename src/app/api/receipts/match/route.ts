// POST /api/receipts/match
// Multipart: `targets` (JSON list of { finding_id, transaction_id }) and `files` (receipt emails,
// PDFs, photos), or JSON { demo: true, targets } for the generated demo inbox.
// Response: { targets, docs, matches }. Read only: nothing is attached until /api/receipts/attach.

import { z } from "zod";
import { getSource } from "@/lib/ramp/source";
import type { RampTransaction } from "@/lib/ramp/types";
import { readReceipt, type ReceiptDoc } from "@/lib/receipts/extract";
import { matchReceipts, type ReceiptTarget } from "@/lib/receipts/match";
import { demoInbox } from "@/lib/receipts/demo-inbox";

export const maxDuration = 60;

const Targets = z.array(z.object({ finding_id: z.string().min(1).max(200), transaction_id: z.string().min(1).max(100) })).min(1).max(500);
const MAX_FILES = 200;
const MAX_BYTES = 4_000_000;

/** Fills merchant, amount, date and owner for each charge from Ramp. */
async function resolveTargets(list: z.infer<typeof Targets>): Promise<ReceiptTarget[]> {
  const source = getSource();
  const out = await Promise.all(
    list.map(async ({ finding_id, transaction_id }) => {
      const rec = (await source.record("transaction", transaction_id)) as { transaction?: RampTransaction } | RampTransaction | null;
      const t = rec && "transaction" in rec ? rec.transaction : (rec as RampTransaction | null);
      if (!t) return null;
      const amount = t.entity_amount?.value ?? Math.round(((t as unknown as { amount?: number }).amount ?? 0) * 100);
      return {
        finding_id,
        transaction_id,
        user_id: t.card_holder.user_id,
        owner: `${t.card_holder.first_name} ${t.card_holder.last_name}`.trim(),
        merchant: t.merchant_name,
        amount,
        date: t.user_transaction_time.slice(0, 10),
      } satisfies ReceiptTarget;
    }),
  );
  return out.filter((x): x is ReceiptTarget => !!x);
}

const summary = (d: ReceiptDoc, i: number, content?: string) => ({ index: i, name: d.name, kind: d.kind, from: d.from, subject: d.subject, total: d.total, date: d.dates[0] ?? null, content });

export async function POST(req: Request) {
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const body = z.object({ demo: z.literal(true), targets: Targets }).safeParse(await req.json().catch(() => null));
      if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
      const targets = await resolveTargets(body.data.targets);
      const files = demoInbox(targets);
      const docs = await Promise.all(files.map((f) => readReceipt(f.name, new TextEncoder().encode(f.content), "message/rfc822")));
      return Response.json({ targets, docs: docs.map((d, i) => summary(d, i, files[i].content)), matches: matchReceipts(docs, targets), demo: true });
    }
    const form = await req.formData();
    const t = Targets.safeParse(JSON.parse(String(form.get("targets") ?? "[]")));
    if (!t.success) return Response.json({ error: "Invalid targets" }, { status: 400 });
    const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, MAX_FILES);
    if (!files.length) return Response.json({ error: "No files" }, { status: 400 });
    const targets = await resolveTargets(t.data);
    const docs = await Promise.all(files.map(async (f) => readReceipt(f.name, new Uint8Array(f.size > MAX_BYTES ? new ArrayBuffer(0) : await f.arrayBuffer()), f.type)));
    return Response.json({ targets, docs: docs.map((d, i) => summary(d, i)), matches: matchReceipts(docs, targets) });
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 502 });
  }
}
