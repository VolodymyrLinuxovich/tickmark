import { describe, expect, it } from "vitest";
import { getFixture, FISCAL_YEAR, CARD_APPROVAL_LIMIT } from "../src/lib/fixtures/generate";
import { readinessRequests } from "../src/lib/engine/readiness";
import { buildIndex, runRequest, uniqueFindings } from "../src/lib/engine/run";
import type { RampSnapshot } from "../src/lib/ramp/types";

/** The sample company plus one bill with no invoice, one bill with no approval and one large card charge with no approval. */
function withGaps(): RampSnapshot {
  const s: RampSnapshot = structuredClone(getFixture().snapshot);
  const [noInvoice, noApproval] = s.bills;
  noInvoice.attachments = [];
  const big = s.transactions.find((t) => t.state === "CLEARED")!;
  big.entity_amount.value = CARD_APPROVAL_LIMIT + 100;
  s.approvals = s.approvals.filter((a) => a.entity_id !== noApproval.id && a.entity_id !== big.id);
  return s;
}

describe("drafted follow-ups", () => {
  it("drafts a follow-up for every exception that points at a Ramp record", () => {
    const ix = buildIndex(withGaps());
    const findings = uniqueFindings(readinessRequests(FISCAL_YEAR.start, FISCAL_YEAR.end).map((r) => runRequest(r, ix)));
    const codes = new Set(findings.map((f) => f.code));
    for (const c of ["MISSING_INVOICE", "NO_APPROVAL", "NOT_APPROVED"] as const) {
      expect(codes).toContain(c);
    }
    const withRecord = findings.filter((f) => f.code !== "SELECTION_NOT_FOUND" && f.records.some((r) => r.id));
    const missing = withRecord.filter((f) => !f.comment || !f.comment.message.trim());
    expect(missing.map((f) => f.code)).toEqual([]);
    for (const f of withRecord) {
      expect(f.records.map((r) => r.id)).toContain(f.comment!.object_id);
    }
  });

  it("does not say there is no approval when Ramp has an open one with no named approver", () => {
    const s: RampSnapshot = structuredClone(getFixture().snapshot);
    const t = s.transactions.find((x) => x.state === "CLEARED")!;
    s.approvals = s.approvals.filter((a) => a.entity_id !== t.id);
    s.approvals.push({ entity_id: t.id, entity_type: "transaction", status: "PENDING", approval_history: [], next_approvers: [] });
    const ix = buildIndex(s);
    const findings = uniqueFindings(readinessRequests(FISCAL_YEAR.start, FISCAL_YEAR.end).map((r) => runRequest(r, ix)));
    const f = findings.find((x) => x.code === "NOT_APPROVED" && x.records.some((r) => r.id === t.id))!;
    expect(f.comment!.message).toContain("Its approval in Ramp is pending");
    expect(f.comment!.message).not.toContain("has no approval");
  });
});
