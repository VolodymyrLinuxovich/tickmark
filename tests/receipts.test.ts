import { describe, expect, it } from "vitest";
import { findAmounts, findDates, findTotal, merchantHints, parseEmail, readReceipt } from "../src/lib/receipts/extract";
import { matchReceipts, scorePair, type ReceiptTarget } from "../src/lib/receipts/match";
import { demoInbox } from "../src/lib/receipts/demo-inbox";
import { emailToPdf, uploadFor } from "../src/lib/receipts/render";
import { resolution } from "../src/lib/engine/recheck";
import { getFixture } from "../src/lib/fixtures/generate";
import { buildIndex, runRequest } from "../src/lib/engine/run";

const enc = (s: string) => new TextEncoder().encode(s);

describe("receipt reading", () => {
  it("reads amounts, totals and dates in common formats", () => {
    expect(findAmounts("Paid $1,240.00 and USD 12.50 and 99.99 USD")).toEqual([124000, 1250, 9999]);
    expect(findTotal("Subtotal: $10.00\nTip: $2.00\nTotal: $12.00")).toBe(1200);
    expect(findDates("On Mar 3, 2026 and 2026-03-04 and 03/05/2026 and 6 March 2026")).toEqual(["2026-03-04", "2026-03-05", "2026-03-03", "2026-03-06"]);
  });

  it("takes the brand from the sender domain", () => {
    expect(merchantHints('"Asana Billing" <billing@mail.asana.com>')).toContain("asana");
  });

  it("parses multipart, base64, quoted-printable and encoded subjects", () => {
    const raw = [
      "From: Digi-Key <orders@digikey.com>",
      "Subject: =?utf-8?B?WW91ciByZWNlaXB0?=",
      "Date: Tue, 03 Mar 2026 17:42:00 +0000",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Order total: =2412.50",
      "--b1",
      "Content-Type: text/html",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("<p>Total <b>$12.50</b></p>").toString("base64"),
      "--b1--",
    ].join("\r\n");
    const e = parseEmail(raw);
    expect(e.subject).toBe("Your receipt");
    expect(e.date).toBe("2026-03-03");
    expect(e.text).toContain("$12.50");
  });

  it("keeps a PDF attachment as the file to send to Ramp", async () => {
    const pdf = await emailToPdf({ name: "x", kind: "text", from: null, subject: "Receipt", dates: [], amounts: [], total: null, hints: [], text: "Total: $5.00", attachment: null });
    const raw = ["From: A <a@b.com>", "Subject: r", 'Content-Type: multipart/mixed; boundary="z"', "", "--z", "Content-Type: text/plain", "", "See attached", "--z", 'Content-Type: application/pdf; name="r.pdf"', "Content-Transfer-Encoding: base64", 'Content-Disposition: attachment; filename="r.pdf"', "", Buffer.from(pdf).toString("base64"), "--z--"].join("\r\n");
    const doc = await readReceipt("mail.eml", enc(raw));
    expect(doc.attachment?.name).toBe("r.pdf");
    expect(doc.total).toBe(500); // read from the attached PDF
    const up = await uploadFor(doc, { bytes: enc(raw), name: "mail.eml", content_type: "message/rfc822" });
    expect(up.file_name).toBe("r.pdf");
  });

  it("renders a plain email to a PDF for upload", async () => {
    const doc = await readReceipt("asana.eml", enc("From: Asana <r@asana.com>\r\nSubject: Receipt — Asana\r\n\r\nTotal: $558.00\r\n"));
    const up = await uploadFor(doc, { bytes: enc(""), name: "asana.eml", content_type: "" });
    expect(up.content_type).toBe("application/pdf");
    expect(Buffer.from(up.bytes).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("receipt matching", () => {
  const t: ReceiptTarget = { finding_id: "f1", transaction_id: "t1", user_id: "u1", owner: "Avery Chen", merchant: "ASANA.COM", amount: 55800, date: "2026-03-03" };

  it("explains a strong match", async () => {
    const doc = await readReceipt("a.eml", enc("From: Asana <receipts@asana.com>\r\nDate: Tue, 03 Mar 2026 10:00:00 +0000\r\nSubject: Your receipt\r\n\r\nTotal: $558.00\r\n"));
    const s = scorePair(doc, t)!;
    expect(s.score).toBe(1);
    expect(s.reasons).toEqual(["Total $558.00 matches", "Merchant ASANA.COM", "Same day"]);
  });

  it("rejects a receipt whose amount does not agree", async () => {
    const doc = await readReceipt("a.eml", enc("From: Asana <receipts@asana.com>\r\nSubject: r\r\n\r\nTotal: $600.00\r\n"));
    expect(scorePair(doc, t)).toBeNull();
  });

  it("does not match on amount alone", async () => {
    const doc = await readReceipt("x.txt", enc("Thanks!\nTotal: $558.00\nJanuary 2 2020"));
    expect(matchReceipts([doc], [t])).toEqual([]);
  });

  it("pairs every demo email with the charge it was written for and nothing else", async () => {
    const snap = getFixture().snapshot;
    const targets: ReceiptTarget[] = snap.transactions.filter((x) => !x.receipts.length).slice(0, 40).map((x, i) => ({
      finding_id: `f${i}`, transaction_id: x.id, user_id: x.card_holder.user_id, owner: `${x.card_holder.first_name} ${x.card_holder.last_name}`, merchant: x.merchant_name, amount: x.entity_amount.value, date: x.user_transaction_time.slice(0, 10),
    }));
    expect(targets.length).toBeGreaterThan(10);
    const files = demoInbox(targets);
    const docs = await Promise.all(files.map((f) => readReceipt(f.name, enc(f.content), "message/rfc822")));
    const matches = matchReceipts(docs, targets);
    const written = files.filter((f) => f.transaction_id).length;
    expect(matches.length).toBe(written);
    for (const m of matches) expect(m.transaction_id).toBe(files[m.doc].transaction_id);
  });
});

describe("recheck", () => {
  const name = () => "Jordan Lee";
  it("resolves a missing receipt once Ramp shows one", () => {
    const txn = getFixture().snapshot.transactions[0];
    expect(resolution("MISSING_RECEIPT", { txn: { ...txn, receipts: [], all_requirements_met_and_approved: false }, name }).resolved).toBe(false);
    expect(resolution("MISSING_RECEIPT", { txn: { ...txn, receipts: ["r1"] }, name })).toEqual({ resolved: true, how: "Receipt attached in Ramp" });
  });
  it("resolves an approval only when Ramp shows it approved", () => {
    const a = { entity_id: "x", entity_type: "transaction" as const, status: "PENDING" as const, approval_history: [], next_approvers: [] };
    expect(resolution("NOT_APPROVED", { approval: a, name }).resolved).toBe(false);
    const done = { ...a, status: "APPROVED" as const, approval_history: [{ action_at: "2026-03-04T00:00:00Z", step_status: "APPROVED", user_email: null, user_id: "u9" }] };
    expect(resolution("NOT_APPROVED", { approval: done, name })).toEqual({ resolved: true, how: "Approved in Ramp by Jordan Lee" });
  });
  it("never auto-resolves a control failure like self-approval", () => {
    expect(resolution("SELF_APPROVAL", { name }).resolved).toBe(false);
  });
  it("sample planted missing receipt is still found", () => {
    const res = runRequest({ ref: "R", text: "", type: "receipt_completeness", period_from: "2025-01-01", period_to: "2025-12-31", min_amount: null, selections: [] } as never, buildIndex(getFixture().snapshot));
    expect(res.findings.some((f) => f.code === "MISSING_RECEIPT")).toBe(true);
  });
});
