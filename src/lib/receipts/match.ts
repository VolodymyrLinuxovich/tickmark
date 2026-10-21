// Matches receipt files to card charges that are missing a receipt. Each pair gets a score
// from three signals (amount, merchant, date) and the reasons behind it, so the auditor can
// see why a file was matched before anything is attached in Ramp.

import type { ReceiptDoc } from "./extract";

/** A card charge with no receipt. */
export interface ReceiptTarget {
  finding_id: string;
  transaction_id: string;
  user_id: string;
  owner: string;
  merchant: string;
  amount: number; // cents
  date: string; // YYYY-MM-DD
}

export interface ReceiptMatch {
  doc: number; // index into the docs list
  finding_id: string;
  transaction_id: string;
  score: number; // 0..1
  confidence: "strong" | "likely";
  reasons: string[];
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayDiff = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);

const LEGAL = /\b(inc|llc|ltd|corp|co|company|the|com|www)\b/g;
/** "AMAZON.COM*2K4 MKTP" to ["amazon", "mktp"]: lowercase words of three letters or more. */
export const merchantWords = (s: string) =>
  s.toLowerCase().replace(/\*.*$/, " ").replace(/[^a-z0-9]+/g, " ").replace(LEGAL, " ").split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));

/** Score one file against one charge, or null when the amount does not agree at all. */
export function scorePair(doc: ReceiptDoc, t: ReceiptTarget): { score: number; reasons: string[] } | null {
  const reasons: string[] = [];
  let score = 0;

  // Amount: the total line is the strongest signal; tips, surcharges and FX allow $1 or 1%.
  const tol = Math.max(100, Math.round(t.amount * 0.01));
  if (doc.total != null && doc.total === t.amount) {
    score += 0.5;
    reasons.push(`Total ${usd(t.amount)} matches`);
  } else if (doc.amounts.includes(t.amount)) {
    score += 0.4;
    reasons.push(`Shows ${usd(t.amount)}`);
  } else {
    const near = [doc.total, ...doc.amounts].filter((a): a is number => a != null).find((a) => Math.abs(a - t.amount) <= tol);
    if (near == null) return null;
    score += 0.3;
    reasons.push(`Shows ${usd(near)}, within ${usd(Math.abs(near - t.amount))} of the charge`);
  }

  // Merchant: any word of the card descriptor found in the sender, subject, file name or text.
  const words = merchantWords(t.merchant);
  const hay = `${doc.hints.join(" ")} ${doc.text.toLowerCase().slice(0, 4000)}`;
  const hit = words.find((w) => doc.hints.includes(w)) ?? words.find((w) => w.length >= 4 && hay.includes(w));
  if (hit) {
    score += doc.hints.includes(hit) ? 0.3 : 0.2;
    reasons.push(`Merchant ${t.merchant}`);
  }

  // Date: receipts arrive on the day of the charge or a few days later.
  if (doc.dates.length) {
    const d = Math.min(...doc.dates.map((x) => dayDiff(x, t.date)));
    if (d <= 3) {
      score += 0.2;
      reasons.push(d === 0 ? "Same day" : `${d} day${d === 1 ? "" : "s"} apart`);
    } else if (d <= 10) {
      score += 0.1;
      reasons.push(`${d} days apart`);
    } else if (d > 45) score -= 0.2;
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/**
 * Pairs files with charges. Greedy by score, so each file and each charge is used once.
 * A pair needs an agreeing amount plus a merchant or date signal (score 0.6 or more).
 */
export function matchReceipts(docs: ReceiptDoc[], targets: ReceiptTarget[], minScore = 0.6): ReceiptMatch[] {
  const pairs: { doc: number; t: ReceiptTarget; score: number; reasons: string[] }[] = [];
  docs.forEach((doc, i) => {
    for (const t of targets) {
      const s = scorePair(doc, t);
      if (s && s.score >= minScore) pairs.push({ doc: i, t, ...s });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.doc - b.doc);
  const usedDocs = new Set<number>();
  const usedTxns = new Set<string>();
  const out: ReceiptMatch[] = [];
  for (const p of pairs) {
    if (usedDocs.has(p.doc) || usedTxns.has(p.t.transaction_id)) continue;
    usedDocs.add(p.doc);
    usedTxns.add(p.t.transaction_id);
    out.push({ doc: p.doc, finding_id: p.t.finding_id, transaction_id: p.t.transaction_id, score: Math.round(p.score * 100) / 100, confidence: p.score >= 0.8 ? "strong" : "likely", reasons: p.reasons });
  }
  return out;
}
