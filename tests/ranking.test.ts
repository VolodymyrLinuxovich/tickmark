import { describe, expect, it } from "vitest";
import { getFixture } from "../src/lib/fixtures/generate";
import { buildIndex, runRequest, uniqueFindings } from "../src/lib/engine/run";
import type { AuditRequest } from "../src/lib/parse/schema";
import type { RampSnapshot } from "../src/lib/ramp/types";

const req = (type: AuditRequest["type"]): AuditRequest => ({
  ref: "T-1", text: "", type, period_from: "2025-01-01", period_to: "2025-12-31", min_amount: null, selections: [], interpretation: "",
});

/** Fixture with three cleared charges left waiting on an approval Ramp opened: $30, $500 and $6,000. */
function withPending(): { snap: RampSnapshot; ids: string[] } {
  const snap = structuredClone(getFixture().snapshot);
  const picks = snap.transactions.filter((t) => t.state === "CLEARED" && t.user_transaction_time.startsWith("2025")).slice(0, 3);
  const pickIds = new Set(picks.map((t) => t.id));
  snap.approvals = snap.approvals.filter((a) => !pickIds.has(a.entity_id));
  [3000, 50000, 600000].forEach((cents, i) => {
    picks[i].entity_amount.value = cents;
    snap.approvals.push({ entity_id: picks[i].id, entity_type: "transaction", status: "PENDING", approval_history: [], next_approvers: [] });
  });
  return { snap, ids: picks.map((t) => t.id) };
}

describe("ranking exceptions", () => {
  it("grades a pending approval by size", () => {
    const { snap, ids } = withPending();
    const r = runRequest(req("control_testing"), buildIndex(snap));
    const sev = (id: string) => r.findings.find((f) => f.code === "NOT_APPROVED" && f.records[0].id === id)?.severity;
    expect(ids.map(sev)).toEqual(["low", "medium", "high"]);
  });

  it("lists findings by severity, then by dollars at stake", () => {
    const { snap } = withPending();
    const fs = uniqueFindings([runRequest(req("control_testing"), buildIndex(snap)), runRequest(req("receipt_completeness"), buildIndex(snap))]);
    const rank = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < fs.length; i++) {
      const [a, b] = [fs[i - 1], fs[i]];
      expect(rank[a.severity] < rank[b.severity] || (a.severity === b.severity && a.amount! >= b.amount!)).toBe(true);
    }
    expect(fs.every((f) => typeof f.amount === "number")).toBe(true);
  });

  it("counts a duplicate bill once, not twice", () => {
    const snap = structuredClone(getFixture().snapshot);
    const dup = runRequest(req("duplicate_payments"), buildIndex(snap)).findings.find((f) => f.code === "DUPLICATE_INVOICE")!;
    const bill = snap.bills.find((b) => b.id === dup.records[0].id)!;
    expect(dup.amount).toBe(bill.amount.amount);
  });
});
