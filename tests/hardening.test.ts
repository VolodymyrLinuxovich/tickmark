import { describe, expect, it } from "vitest";
import { getFixture } from "../src/lib/fixtures/generate";
import { buildIndex, duplicateBills, lastApproval, runRequest } from "../src/lib/engine/run";
import type { AuditRequest } from "../src/lib/parse/schema";
import type { RampSnapshot } from "../src/lib/ramp/types";

const clone = (): RampSnapshot => structuredClone(getFixture().snapshot);

const req = (type: AuditRequest["type"], extra: Partial<AuditRequest> = {}): AuditRequest => ({
  ref: "T-1", text: "", type, period_from: "2025-01-01", period_to: "2025-12-31", min_amount: null, selections: [], interpretation: "", ...extra,
});

describe("approval steps from live Ramp data", () => {
  it("matches step_status loosely and ignores rejected steps", () => {
    const snap = clone();
    const a = snap.approvals.find((x) => x.entity_type === "transaction")!;
    a.approval_history = [
      { action_at: "2025-03-01T00:00:00Z", step_status: "Approved", user_email: "x@y", user_id: "u1" },
      { action_at: "2025-03-02T00:00:00Z", step_status: "REJECTED", user_email: "z@y", user_id: "u2" },
    ];
    expect(lastApproval(buildIndex(snap), a.entity_id).last?.user_id).toBe("u1");
  });

  it("treats a policy auto-approval as approved, not as missing or self-approved", () => {
    const snap = clone();
    for (const a of snap.approvals) {
      if (a.entity_type !== "transaction") continue;
      a.approval_history = [{ action_at: "2025-03-01T00:00:00Z", step_status: "AUTO_APPROVED", user_email: null, user_id: null }];
    }
    const r = runRequest(req("control_testing"), buildIndex(snap));
    expect(r.findings.filter((f) => f.code === "NOT_APPROVED" || (f.code === "SELF_APPROVAL" && f.records[0].type === "transaction"))).toEqual([]);
  });
});

describe("receipts", () => {
  it("does not report a receipt missing when only its id was loaded", () => {
    const snap = clone();
    const t = snap.transactions.find((x) => x.entity_amount.value > 50000 && x.receipts.length)!;
    snap.receipts = snap.receipts.filter((r) => r.transaction_id !== t.id); // receipt uploaded after the fetch window
    const r = runRequest(req("receipt_completeness"), buildIndex(snap));
    expect(r.findings.some((f) => f.records.some((x) => x.id === t.id))).toBe(false);
  });

  it("ignores refunds", () => {
    const snap = clone();
    const t = snap.transactions.find((x) => !x.receipts.length)!;
    t.entity_amount.value = -250000;
    const r = runRequest(req("receipt_completeness"), buildIndex(snap));
    expect(r.findings.some((f) => f.records.some((x) => x.id === t.id))).toBe(false);
  });
});

describe("duplicates", () => {
  it("skips archived bills and only compares within a vendor", () => {
    const snap = clone();
    const dupes = duplicateBills(snap.bills);
    expect(dupes).toHaveLength(1);
    const [a] = dupes[0].records;
    snap.bills.find((b) => b.id === a.id)!.archived_at = "2025-03-25T00:00:00Z";
    expect(duplicateBills(snap.bills)).toHaveLength(0);
  });
});

describe("transaction states", () => {
  it("excludes declined and pending transactions from testing", () => {
    const snap = clone();
    const n = snap.transactions.length;
    snap.transactions.slice(0, 10).forEach((t) => (t.state = "DECLINED"));
    const r = runRequest(req("receipt_completeness"), buildIndex(snap));
    expect(r.population).toBe(n - 10);
  });
});
