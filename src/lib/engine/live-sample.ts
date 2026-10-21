// Fits the sample request list to a connected Ramp business: trailing 12 months,
// and auditor selections drawn from its real card transactions.
// Used by the demo when a real Ramp account is connected. The built-in sample
// request list targets FY2025 of the demo company, so this rewrites its period and
// selections to fit whatever data the connected business actually has.

import type { ParsedList } from "../parse/schema";
import type { RampSource } from "../ramp/source";
import { monetaryUnitSample } from "./sampling";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Rewrites the sample list for live data: period becomes the trailing 12 months and
 * transaction support requests get 12 selections drawn by monetary unit sampling from
 * real cleared transactions. Selections are formatted like a bank statement line
 * (uppercase, truncated merchant) so the matcher is exercised as it would be on a real list.
 */
export async function fitSampleToLiveData(parsed: ParsedList, source: RampSource, today = new Date()): Promise<ParsedList> {
  const to = ymd(today);
  const from = ymd(new Date(today.getTime() - 365 * 864e5));
  const snap = await source.snapshot({ from, to });
  const txns = snap.transactions.filter((t) => (t.state === "CLEARED" || t.state === "COMPLETION") && t.entity_amount.value > 0);
  const sample = monetaryUnitSample(txns.map((t) => ({ id: t.id, amount: t.entity_amount.value })), 12, 7);
  const picked = txns.filter((t) => sample.selected.includes(t.id));
  const selections = picked.map((t, i) => {
    const d = new Date(t.accounting_date ?? t.user_transaction_time);
    return {
      ref: `S-${String(i + 1).padStart(2, "0")}`,
      date: `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`,
      description: `${t.merchant_name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 14)} ${(t.card_holder.last_name ?? "").toUpperCase()}`.trim(),
      amount: t.entity_amount.value / 100,
    };
  });
  const requests = parsed.requests.map((r) => ({
    ...r,
    text: r.text.replace(/FY ?2025|the year ended December 31, 2025|as of December 31, 2025/g, "the last 12 months"),
    period_from: from,
    period_to: to,
    selections: r.type === "transaction_support" ? selections : r.selections,
    interpretation: r.type === "transaction_support" ? `Match ${selections.length} selected items to Ramp card transactions and pull receipt, approval and memo for each.` : r.interpretation,
  }));
  const warnings = [
    ...parsed.warnings,
    `Sample list fitted to ${snap.business_name}: ${from} to ${to}, with ${selections.length} selections drawn from its ${txns.length} card transactions.`,
  ];
  if (!txns.length) warnings.push("This Ramp business has no cleared card transactions in the last 12 months, so transaction requests will be empty.");
  return { ...parsed, auditor: parsed.auditor ?? "Sample auditor", requests, warnings };
}
