import { describe, expect, it } from "vitest";
import { getFixture } from "../src/lib/fixtures/generate";
import { asOfDate, computeReadiness, FRESH_DAYS, readinessRequests } from "../src/lib/engine/readiness";
import { readinessDays } from "../src/lib/engine/readiness-days";
import type { RampSnapshot } from "../src/lib/ramp/types";

const snap = () => getFixture().snapshot;

describe("audit readiness", () => {
  it("reads the days window from a link: 30 to 180, and 90 for a missing or bad value", () => {
    expect(readinessDays("30")).toBe(30);
    expect(readinessDays("180")).toBe(180);
    expect(readinessDays("10")).toBe(30);
    expect(readinessDays("999")).toBe(180);
    expect(readinessDays("abc")).toBe(90);
    expect(readinessDays("")).toBe(90);
    expect(readinessDays(null)).toBe(90);
    expect(readinessDays(undefined)).toBe(90);
  });

  it("counts back from the sample company's last record, not today", () => {
    const s = snap();
    const last = s.transactions.map((t) => t.user_transaction_time).sort().at(-1)!.slice(0, 10);
    expect(asOfDate(s, false).toISOString().slice(0, 10)).toBe(last);
    const now = new Date("2026-11-16T12:00:00Z");
    expect(asOfDate(s, true, now)).toBe(now);
  });

  it("scores the window from the same checks as the year-end run", () => {
    const s = snap();
    const r = computeReadiness(s, asOfDate(s, false), 365);
    expect(r.records).toBeGreaterThan(0);
    expect(r.clean).toBeLessThanOrEqual(r.records);
    expect(r.score).toBe(Math.round((r.clean / r.records) * 100));
    // Acme's planted problems include a missing receipt, a self-approval and a duplicate invoice.
    const codes = r.by_code.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["MISSING_RECEIPT", "SELF_APPROVAL", "DUPLICATE_INVOICE"]));
    expect(r.by_code.reduce((n, c) => n + c.n, 0)).toBe(r.open);
  });

  it("only offers fresh exceptions with a drafted follow-up to fix now", () => {
    const s = snap();
    const r = computeReadiness(s, asOfDate(s, false), 365);
    for (const f of r.fix_now) {
      expect(f.age_days).toBeLessThan(FRESH_DAYS);
      expect(f.comment).toBeTruthy();
    }
  });

  it("ages an exception from its record and puts a new missing receipt in fix now", () => {
    const base = snap();
    const asOf = new Date("2026-11-16T00:00:00Z");
    const t = base.transactions.find((x) => x.entity_amount.value >= 20000 && (x.state === "CLEARED" || x.state === "COMPLETION"))!;
    const fresh = { ...t, id: "txn-fresh", user_transaction_time: "2026-11-12T15:00:00Z", accounting_date: "2026-11-12T15:00:00Z", receipts: [], all_requirements_met_and_approved: false };
    const s: RampSnapshot = { ...base, transactions: [fresh], receipts: [], bills: [], approvals: [] };
    const r = computeReadiness(s, asOf, 30);
    expect(r.records).toBe(1);
    expect(r.score).toBe(0);
    const f = r.fix_now.find((x) => x.code === "MISSING_RECEIPT");
    expect(f?.age_days).toBe(3);
    expect(r.weeks.at(-1)).toEqual({ start: "2026-11-10", records: 1, clean: 0 });
  });

  it("reports a clean window as fully ready", () => {
    const base = snap();
    const s: RampSnapshot = { ...base, transactions: [], bills: [] };
    const r = computeReadiness(s, new Date("2026-11-16T00:00:00Z"), 90);
    expect(r).toMatchObject({ records: 0, score: 100, open: 0, fix_now: [] });
  });

  it("covers receipts, controls, bills and duplicates over the window", () => {
    const reqs = readinessRequests("2026-08-19", "2026-11-16");
    expect(reqs.map((q) => q.type)).toEqual(["receipt_completeness", "control_testing", "bill_support", "duplicate_payments"]);
    expect(reqs.every((q) => q.period_from === "2026-08-19" && q.period_to === "2026-11-16")).toBe(true);
  });
});
