// Audit readiness: the year-end checks run on recent weeks, before any auditor asks.
// Ramp's audit prep guide warns that collection starting when the PBC list lands means chasing receipts
// that are months old. This runs the same deterministic tests on a rolling window so problems are found
// and followed up while they are days old. Nothing is sent from here; drafted comments go through the
// same approve-and-send flow as the workbench.

import type { AuditRequest } from "../parse/schema";
import type { RampSnapshot } from "../ramp/types";
import { POLICY, buildIndex, runRequest, uniqueFindings } from "./run";
import type { Finding, FindingCode } from "./types";

const DAY = 864e5;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Findings on records younger than this are "fresh": the cardholder still remembers the purchase. */
export const FRESH_DAYS = 30;
/** Weeks shown in the trend. */
export const WEEKS = 12;

/** The checks a readiness run covers: everything that can be fixed now instead of at year end. */
export function readinessRequests(from: string, to: string): AuditRequest[] {
  const base = { period_from: from, period_to: to, selections: [], min_amount: null };
  return [
    { ...base, ref: "R-1", type: "receipt_completeness", text: "Card transactions without a receipt", min_amount: POLICY.receiptThreshold / 100, interpretation: "Card transactions at or above the receipt threshold with no receipt." },
    { ...base, ref: "R-2", type: "control_testing", text: "Approvals, split purchases and restricted merchants", interpretation: "Approvals, self-approval, split purchases and restricted merchants on card transactions and bills." },
    { ...base, ref: "R-3", type: "bill_support", text: "Bill invoices and approvals", interpretation: "Invoice and approval for every bill." },
    { ...base, ref: "R-4", type: "duplicate_payments", text: "Bills paid twice", interpretation: "Bills with the same vendor and invoice, or the same amount within a week." },
  ];
}

export interface ReadinessOwner {
  user_id: string | null;
  name: string;
  open: number;
  fresh: number;
  oldest_days: number;
}

export interface Readiness {
  as_of: string;
  from: string;
  to: string;
  business: string;
  /** Percent of in-scope records with no open exception, 0 to 100. */
  score: number;
  records: number;
  clean: number;
  open: number;
  high: number;
  fresh: number;
  /** Median age in days of the records behind open exceptions. */
  median_age_days: number | null;
  by_code: { code: FindingCode; n: number }[];
  weeks: { start: string; records: number; clean: number }[];
  owners: ReadinessOwner[];
  /** Fresh exceptions with a drafted follow-up, most important first. */
  fix_now: (Finding & { age_days: number })[];
}

/**
 * The date a record happened, for ageing an exception: the card swipe for a transaction, the invoice
 * date for a bill. A finding's age is its newest record's age, since that is when it could first be fixed.
 */
function recordDates(snap: RampSnapshot) {
  const m = new Map<string, string>();
  for (const t of snap.transactions) {
    m.set(t.id, t.user_transaction_time);
  }
  for (const b of snap.bills) {
    m.set(b.id, b.issued_at);
  }
  return m;
}

/**
 * The day a readiness run counts back from. Live Ramp data uses today. The sample company's records
 * stop at the end of its fiscal year, so it uses its latest record instead of an empty window.
 */
export function asOfDate(snap: RampSnapshot, live: boolean, today = new Date()): Date {
  if (live) {
    return today;
  }
  const last = snap.transactions.map((t) => t.user_transaction_time).sort().at(-1);
  return last ? new Date(last.slice(0, 10) + "T00:00:00Z") : today;
}

/** Runs the readiness checks on the `days` before `asOf` and scores the result. */
export function computeReadiness(snap: RampSnapshot, asOf: Date, days = 90): Readiness {
  const to = ymd(asOf);
  const from = ymd(new Date(asOf.getTime() - (days - 1) * DAY));
  const ix = buildIndex(snap);
  const results = readinessRequests(from, to).map((r) => runRequest(r, ix));
  const findings = uniqueFindings(results);

  const inWindow = (iso: string | null | undefined) => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
  const txns = snap.transactions.filter((t) => (t.state === "CLEARED" || t.state === "COMPLETION") && inWindow(t.user_transaction_time));
  const bills = snap.bills.filter((b) => inWindow(b.issued_at) || inWindow(b.paid_at));
  const scope = new Set([...txns.map((t) => t.id), ...bills.map((b) => b.id)]);

  const dates = recordDates(snap);
  const ageOf = (f: Finding) => {
    const newest = f.records.map((r) => dates.get(r.id)).filter((d): d is string => !!d).sort().at(-1);
    return newest ? Math.max(0, Math.floor((asOf.getTime() - new Date(newest).getTime()) / DAY)) : 0;
  };

  const flagged = new Set<string>();
  for (const f of findings) {
    for (const r of f.records) {
      if (scope.has(r.id)) {
        flagged.add(r.id);
      }
    }
  }
  const records = scope.size;
  const clean = records - flagged.size;

  const aged = findings.map((f) => ({ ...f, age_days: ageOf(f) }));
  const ages = aged.map((f) => f.age_days).sort((a, b) => a - b);
  const median = ages.length ? ages[Math.floor(ages.length / 2)] : null;

  const codes = new Map<FindingCode, number>();
  for (const f of findings) {
    codes.set(f.code, (codes.get(f.code) ?? 0) + 1);
  }

  const owners = new Map<string, ReadinessOwner>();
  for (const f of aged) {
    const key = f.owner?.user_id ?? "none";
    const o = owners.get(key) ?? { user_id: f.owner?.user_id ?? null, name: f.owner?.name ?? "No owner", open: 0, fresh: 0, oldest_days: 0 };
    o.open++;
    if (f.age_days < FRESH_DAYS) {
      o.fresh++;
    }
    o.oldest_days = Math.max(o.oldest_days, f.age_days);
    owners.set(key, o);
  }

  // Weekly trend: for each week, how many of that week's records are clean today.
  const weeks: Readiness["weeks"] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const end = new Date(asOf.getTime() - w * 7 * DAY);
    const start = new Date(end.getTime() - 6 * DAY);
    const s = ymd(start);
    const e = ymd(end);
    const inWeek = [...txns.filter((t) => t.user_transaction_time.slice(0, 10) >= s && t.user_transaction_time.slice(0, 10) <= e).map((t) => t.id), ...bills.filter((b) => b.issued_at.slice(0, 10) >= s && b.issued_at.slice(0, 10) <= e).map((b) => b.id)];
    if (s < from) {
      continue;
    }
    weeks.push({ start: s, records: inWeek.length, clean: inWeek.filter((id) => !flagged.has(id)).length });
  }

  return {
    as_of: to,
    from,
    to,
    business: snap.business_name,
    score: records ? Math.round((clean / records) * 100) : 100,
    records,
    clean,
    open: findings.length,
    high: findings.filter((f) => f.severity === "high").length,
    fresh: aged.filter((f) => f.age_days < FRESH_DAYS).length,
    median_age_days: median,
    by_code: [...codes].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n),
    weeks,
    owners: [...owners.values()].sort((a, b) => b.fresh - a.fresh || b.open - a.open).slice(0, 8),
    fix_now: aged.filter((f) => f.age_days < FRESH_DAYS && f.comment).slice(0, 25),
  };
}
