// Demo inbox for the receipt hunter. It writes receipt emails for about three quarters of the
// charges that are missing a receipt, plus a few unrelated emails, in the formats real merchants
// use (plain text, HTML, base64, "USD 12.00", a tip added, a day late). The UI labels it as generated.

import type { ReceiptTarget } from "./match";

export interface DemoFile {
  name: string;
  content: string; // the .eml text
  /** The charge this email was written for (none for unrelated mail). Used by tests only. */
  transaction_id?: string;
}

const slug = (s: string) => s.toLowerCase().replace(/\*.*$/, "").replace(/[^a-z0-9]+/g, "").slice(0, 24) || "merchant";
const title = (s: string) => s.replace(/\*.*$/, "").trim().replace(/\s+/g, " ");
const money = (c: number) => (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const rfcDate = (iso: string, addDays = 0) => new Date(Date.parse(`${iso}T17:42:00Z`) + addDays * 864e5).toUTCString().replace("GMT", "+0000");
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Stable small hash, so the same audit always gets the same demo inbox. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function email(opts: { from: string; to: string; subject: string; date: string; body: string; html?: boolean; base64?: boolean }): string {
  const type = opts.html ? "text/html" : "text/plain";
  const enc = opts.base64 ? "base64" : "7bit";
  const body = opts.base64 ? Buffer.from(opts.body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n") : opts.body;
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${opts.date}`,
    "MIME-Version: 1.0",
    `Content-Type: ${type}; charset="utf-8"`,
    `Content-Transfer-Encoding: ${enc}`,
    "",
    body,
    "",
  ].join("\r\n");
}

export function demoInbox(targets: ReceiptTarget[]): DemoFile[] {
  const files: DemoFile[] = [];
  const sorted = [...targets].sort((a, b) => hash(a.transaction_id) - hash(b.transaction_id));
  sorted.forEach((t, i) => {
    if (i % 4 === 3) return; // about a quarter stay missing, so the hunter also shows what it could not find
    const m = title(t.merchant);
    const domain = `${slug(t.merchant)}.com`;
    const to = `${t.owner.toLowerCase().replace(/[^a-z]+/g, ".")}@savetime.example`;
    const variant = hash(t.transaction_id + "v") % 5;
    const name = `${String(files.length + 1).padStart(2, "0")}-${slug(t.merchant)}.eml`;
    const order = `#${(hash(t.transaction_id) % 900000) + 100000}`;
    const push = (f: DemoFile) => files.push({ ...f, transaction_id: t.transaction_id });
    if (variant === 0) {
      push({ name, content: email({ from: `${m} <receipts@${domain}>`, to, subject: `Your receipt from ${m}`, date: rfcDate(t.date), body: `Thanks for your purchase.\n\nOrder ${order}\nDate: ${longDate(t.date)}\n\nItems                 $${money(t.amount)}\n\nTotal: $${money(t.amount)}\nCharged to Visa ending in 4417\n` }) });
    } else if (variant === 1) {
      push({ name, content: email({ from: `"${m} Billing" <billing@mail.${domain}>`, to, subject: `${m} payment confirmation ${order}`, date: rfcDate(t.date, 1), html: true, body: `<html><body><h2>${m}</h2><p>Payment received on ${longDate(t.date)}.</p><table><tr><td>Subtotal</td><td>$${money(t.amount)}</td></tr><tr><td><b>Amount paid</b></td><td><b>$${money(t.amount)}</b></td></tr></table></body></html>` }) });
    } else if (variant === 2) {
      push({ name, content: email({ from: `${m} <no-reply@${domain}>`, to, subject: `Receipt ${order}`, date: rfcDate(t.date), base64: true, body: `${m}\nReceipt ${order}\n${t.date}\n\nAmount charged: USD ${money(t.amount)}\n` }) });
    } else if (variant === 3 && t.amount > 2000) {
      // Restaurant style: the receipt shows the pre-tip total plus the tip line.
      const tip = Math.min(Math.round(t.amount * 0.004), 90);
      push({ name, content: email({ from: `${m} <hello@${domain}>`, to, subject: `Your ${m} receipt`, date: rfcDate(t.date), body: `${m}\n${longDate(t.date)}\n\nSubtotal: $${money(t.amount - tip)}\nTip: $${money(tip)}\nTotal: $${money(t.amount - tip)}\n` }) });
    } else {
      push({ name, content: email({ from: `${m} <orders@${domain}>`, to, subject: `Order confirmation from ${m}`, date: rfcDate(t.date, 2), body: `Hi ${t.owner.split(" ")[0]},\n\nYour order ${order} is confirmed.\n\nOrder total: ${money(t.amount)} USD\n` }) });
    }
  });
  // Unrelated mail: none of these should match a charge.
  files.push({ name: `${String(files.length + 1).padStart(2, "0")}-newsletter.eml`, content: email({ from: "Ramp <news@ramp.com>", to: "finance@savetime.example", subject: "What's new in Ramp this month", date: rfcDate(targets[0]?.date ?? "2026-01-15"), body: "New features for finance teams. Save up to $500 on software this quarter.\n" }) });
  files.push({ name: `${String(files.length + 1).padStart(2, "0")}-calendar.eml`, content: email({ from: "Calendar <calendar@savetime.example>", to: "finance@savetime.example", subject: "Invitation: Audit kickoff with Hartwell & Co.", date: rfcDate(targets[0]?.date ?? "2026-01-15", 3), body: "Audit kickoff. Thursday 10am. Conference room B.\n" }) });
  return files;
}
