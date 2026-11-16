import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiSource } from "../src/lib/ramp/source";
import { runAll } from "../src/lib/engine/run";
import { normalizeFile } from "../src/lib/parse/input";
import { parseWithRules } from "../src/lib/parse/rules";
import { APP, CLI_TOKEN, startMockRamp, type MockRamp } from "./mock-ramp";

let ramp: MockRamp;
const period = { from: "2025-01-01", to: "2025-12-31" };
let requests: Awaited<ReturnType<typeof parseWithRules>>["requests"];

beforeAll(async () => {
  ramp = await startMockRamp();
  const f = "public/samples/hartwell-pbc-fy2025.xlsx";
  requests = parseWithRules(await normalizeFile(f, new Uint8Array(readFileSync(f)))).requests;
});
afterAll(() => ramp.close());

describe("fallback email after an audit run", () => {
  it("keeps the Ramp bill link when the bill comes from the cached snapshot", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const bill = ramp.snap.bills[4];
    const link = `https://example.ramp.test/bills/${bill.id}`;
    bill.deep_link_url = link;
    ramp.noThread.add(bill.id);
    try {
      const snap = await src.snapshot(period);
      expect(snap.bills.some((b) => b.id === bill.id)).toBe(true);
      const before = ramp.log.length;
      const out = await src.postComment("bills", bill.id, "Please attach the invoice.", [], bill.bill_owner.id);
      expect(out.email?.body).toContain(`Open in Ramp: ${link}`);
      // Served from the snapshot, not fetched again.
      expect(ramp.log.slice(before).some((l) => l.path === `/developer/v1/bills/${bill.id}`)).toBe(false);
    } finally {
      delete bill.deep_link_url;
    }
  });
});

describe("comment 404s", () => {
  it("a record that does not exist is an error, not an email about a missing thread", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    await expect(src.postComment("bills", "00000000-0000-4000-8000-000000000000", "Hello", [])).rejects.toThrow(/404.*does not exist/);
  });

  it("a record with no thread still falls back to email", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const t = ramp.snap.transactions[7];
    ramp.noThread.add(t.id);
    const out = await src.postComment("transactions", t.id, "Please attach the receipt.", [], t.card_holder.user_id);
    expect(out.email).toBeTruthy();
  });
});

describe("bill history probe", () => {
  it("one missing bill does not switch off approval checks for every bill", async () => {
    ramp.billHistoryGone = false;
    // The client probes the first bill Ramp lists. That bill's history answers "does not exist".
    ramp.billHistoryMissing.add(ramp.snap.bills[0].id);
    try {
      const src = new ApiSource("sandbox", { kind: "token", token: CLI_TOKEN, origin: "Ramp CLI login" }, ramp.url);
      const snap = await src.snapshot(period);
      expect(snap.bill_approvals_unavailable).toBeUndefined();
      expect(snap.approvals.filter((a) => a.entity_type === "bill").length).toBeGreaterThan(0);
      expect(snap.notes.warnings.join(" ")).toMatch(/unavailable for 1 bills/);
      expect(snap.notes.warnings.join(" ")).not.toMatch(/no longer serves bill history/);
    } finally {
      ramp.billHistoryGone = true;
      ramp.billHistoryMissing.clear();
    }
  });
});

describe("workpapers when bill approvals could not be read", () => {
  it("say the bill approval tests were not performed instead of passed", async () => {
    const src = new ApiSource("sandbox", { kind: "token", token: CLI_TOKEN, origin: "Ramp CLI login" }, ramp.url);
    const snap = await src.snapshot(period);
    expect(snap.bill_approvals_unavailable).toBe(true);
    const results = runAll(requests, snap);

    const ct = results.find((r) => r.request.type === "control_testing");
    expect(ct).toBeTruthy();
    const row = (name: string) => ct!.rows.find((r) => r.cells[0] === name)!;
    expect(row("Approval after payment").cells[1]).toMatch(/^Not tested/);
    expect(row("Approval after payment").tickmarks).not.toContain("T");
    const txnCount = snap.transactions.filter((t) => (t.state === "CLEARED" || t.state === "COMPLETION") && t.user_transaction_time >= period.from && t.user_transaction_time <= `${period.to}T23:59:59Z`).length;
    // Self-approval counts transactions only: no bill was tested for it.
    const selfN = Number(/(\d+) records/.exec(row("Self-approval").cells[1])?.[1]);
    expect(selfN).toBeLessThanOrEqual(txnCount);
    expect(ct!.procedure.join(" ")).toMatch(/bills were not tested for approval/);
    expect(ct!.procedure.join(" ")).toMatch(/Approval timing: not performed/);

    const bs = results.find((r) => r.request.type === "bill_support");
    if (bs && bs.rows.length) {
      expect(bs.procedure.join(" ")).toMatch(/were not tested/);
      const col = bs.columns.indexOf("Approved by");
      for (const r of bs.rows.filter((x) => x.record.id)) {
        expect(r.cells[col]).toBe("Not read from Ramp");
      }
    }
  });

  it("still say every bill was checked when approvals were read", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const results = runAll(requests, await src.snapshot(period));
    const ct = results.find((r) => r.request.type === "control_testing")!;
    expect(ct.rows.find((r) => r.cells[0] === "Approval after payment")!.cells[1]).not.toMatch(/^Not tested/);
    expect(ct.procedure.join(" ")).toMatch(/with the bill owner on every bill/);
  });
});
