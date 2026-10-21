// POST /api/receipts/attach
// Multipart: `file` (the receipt email, PDF or photo), `transaction_id`, `user_id`.
// Response: { id, destination, file_name } or { error }. Writes to Ramp: the UI calls it only
// when the user presses Attach on a match they reviewed.

import { getSource } from "@/lib/ramp/source";
import { readReceipt } from "@/lib/receipts/extract";
import { uploadFor } from "@/lib/receipts/render";
import { rampError } from "@/lib/receipts/errors";

export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const transactionId = String(form?.get("transaction_id") ?? "");
  const userId = String(form?.get("user_id") ?? "");
  if (!(file instanceof File) || !transactionId || !userId || file.size > 4_000_000) return Response.json({ error: "Invalid upload" }, { status: 400 });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await readReceipt(file.name, bytes, file.type);
    const upload = await uploadFor(doc, { bytes, name: file.name, content_type: file.type });
    const res = await getSource().uploadReceipt(transactionId, userId, upload);
    return Response.json({ ...res, file_name: upload.file_name });
  } catch (err) {
    const e = rampError(err, "receipts:write");
    return Response.json({ error: e.error }, { status: e.status });
  }
}
