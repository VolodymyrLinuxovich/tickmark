// Keyword parser. Used when no Anthropic key is set, when the model refuses or
// errors, and as the baseline the Claude parser is compared with in tests.

import type { AuditRequest, ParsedList, RequestType, Selection } from "./schema";
import { money, toIsoDate, type InputRow, type NormalizedInput } from "./input";

export function classify(text: string, hasSelections: boolean): RequestType {
  const t = text.toLowerCase();
  if (/duplicate/.test(t)) return "duplicate_payments";
  if (/receipt/.test(t) && /(without|missing|no receipt|lack|not attached)/.test(t)) return "receipt_completeness";
  if (/(split|their own|self[- ]approv|segregation|restricted|prohibited|merchant categor)/.test(t)) return "control_testing";
  if (/(vendor master|vendor listing|new vendors|vendors (created|added|onboarded))/.test(t)) return "vendor_listing";
  if (/(user access|administrator|admin access|access listing|users with)/.test(t)) return "user_access";
  if (/(selected|selection|sample)/.test(t) && /(transaction|card|expense|charge)/.test(t)) return "transaction_support";
  if (/(bill|invoice|vendor payment|accounts payable)/.test(t)) return "bill_support";
  if (hasSelections && /(transaction|card|expense|charge)/.test(t)) return "transaction_support";
  return "unsupported";
}

export function findThreshold(text: string): number | null {
  const m = text.match(/(?:over|above|exceeding|greater than|>=?|of at least|in excess of)\s*\$\s?([\d,]+(?:\.\d+)?)/i) ?? text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:or more|and above|or greater)/i);
  return m ? money(m[1]) : null;
}

export function findPeriod(text: string): { from: string; to: string } | null {
  const fy = text.match(/\b(?:FY\s?|fiscal (?:year )?)(20\d{2})\b/i) ?? text.match(/year end(?:ed|ing)? (?:December 31,? )?(20\d{2})/i);
  if (fy) return { from: `${fy[1]}-01-01`, to: `${fy[1]}-12-31` };
  return null;
}

const INTERPRET: Record<RequestType, (r: { min: number | null; n: number }) => string> = {
  transaction_support: ({ n }) => `Match ${n || "the"} selected items to Ramp card transactions and pull receipt, approval and memo for each.`,
  bill_support: ({ min }) => `Pull invoice, approval history and payment for every bill${min ? ` of $${min.toLocaleString("en-US")} or more` : ""} in the period.`,
  receipt_completeness: ({ min }) => `List card transactions${min ? ` over $${min.toLocaleString("en-US")}` : ""} with no receipt attached.`,
  control_testing: () => "Test all card spend and bills for split purchases, self-approval, approval after payment and restricted merchant categories.",
  duplicate_payments: () => "Look for bills with the same vendor and invoice number, or the same vendor and amount within 7 days.",
  vendor_listing: () => "Export the vendor master and flag vendors paid within 14 days of being created.",
  user_access: () => "List Ramp users with owner, admin, bookkeeper or IT admin roles, with status and department.",
  unsupported: () => "Not answerable from Ramp data. Left for the team.",
};

export const interpret = (type: RequestType, min: number | null, n: number) => INTERPRET[type]({ min, n });

const SEL_LINE = /^\s*(?:[-*•]\s*)?(?:(S-\d+)\s*[:|,-]?\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s*[|,]?\s*(.+?)\s*[|,]?\s*\$?\s?([\d,]+\.\d{2})\s*$/;

function selectionsFromText(text: string): Selection[] {
  const out: Selection[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(SEL_LINE);
    if (m) out.push({ ref: m[1] ?? `S-${String(out.length + 1).padStart(2, "0")}`, date: m[2], description: m[3].trim(), amount: money(m[4]) });
  }
  return out;
}

function splitFreeText(text: string): InputRow[] {
  const lines = text.split("\n");
  const rows: InputRow[] = [];
  let cur: InputRow | null = null;
  for (const line of lines) {
    const m = line.match(/^\s*(?:(PBC[- ]?\d+)|(\d{1,2})[.)])\s*[:.-]?\s*(.*)$/i);
    if (m) {
      if (cur) rows.push(cur);
      const ref = m[1] ? m[1].toUpperCase().replace(" ", "-") : `PBC-${m[2].padStart(2, "0")}`;
      cur = { ref, area: "", text: m[3], period_from: null, period_to: null };
    } else if (cur && line.trim()) {
      cur.text += "\n" + line.trim();
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

export function parseWithRules(input: NormalizedInput): ParsedList {
  const warnings: string[] = [];
  const rows = input.rows.length ? input.rows : splitFreeText(input.text);
  if (!rows.length) warnings.push("No numbered requests found. Number each request (1. 2. 3.) or upload the PBC spreadsheet.");
  const globalPeriod = findPeriod(input.text);
  const requests: AuditRequest[] = rows.map((row) => {
    const inline = selectionsFromText(row.text);
    const attached = input.selections
      .filter((s) => !s.request_ref || s.request_ref === row.ref)
      .map(({ ref, date, description, amount }) => ({ ref, date, description, amount }));
    let type = classify(row.text, inline.length > 0);
    const selections = type === "transaction_support" ? (inline.length ? inline : attached) : [];
    if (type === "unsupported" && attached.length && /transaction|card/i.test(row.text)) type = "transaction_support";
    const period = row.period_from && row.period_to ? { from: row.period_from, to: row.period_to } : findPeriod(row.text) ?? globalPeriod;
    const min = findThreshold(row.text);
    return {
      ref: row.ref,
      text: row.text.split("\n").filter((l) => !SEL_LINE.test(l)).join("\n").trim(),
      type,
      period_from: period?.from ?? null,
      period_to: period?.to ?? null,
      min_amount: min,
      selections,
      interpretation: interpret(type, min, selections.length),
    };
  });
  const auditor = input.text.match(/\b([A-Z][A-Za-z&]+(?: & [A-Z][a-z]+)?(?: LLP| & Co\.?| CPAs?))/)?.[1] ?? null;
  return { auditor, requests, parser: "rules", warnings };
}

export { toIsoDate };
