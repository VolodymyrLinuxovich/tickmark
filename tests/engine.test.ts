import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getFixture } from "../src/lib/fixtures/generate";
import { normalizeFile, normalizeText } from "../src/lib/parse/input";
import { parseWithRules } from "../src/lib/parse/rules";
import { buildIndex, matchSelection, runAll, runRequest } from "../src/lib/engine/run";
import { scoreAgainstPlanted } from "../src/lib/engine/eval";
import { monetaryUnitSample } from "../src/lib/engine/sampling";
import type { AuditRequest } from "../src/lib/parse/schema";

const EXPECTED_TYPES = ["unsupported", "transaction_support", "bill_support", "receipt_completeness", "control_testing", "duplicate_payments", "vendor_listing", "user_access", "unsupported"];

async function parsedSample(kind: "xlsx" | "csv" | "email") {
  if (kind === "email") return parseWithRules(normalizeText(readFileSync("public/samples/hartwell-request-email.txt", "utf8")));
  const file = kind === "xlsx" ? "hartwell-pbc-fy2025.xlsx" : "hartwell-pbc-fy2025.csv";
  return parseWithRules(await normalizeFile(file, new Uint8Array(readFileSync(`public/samples/${file}`))));
}

describe("rules parser", () => {
  it.each(["xlsx", "email"] as const)("reads every request and selection from the %s sample", async (kind) => {
    const parsed = await parsedSample(kind);
    expect(parsed.requests.map((r) => r.type)).toEqual(EXPECTED_TYPES);
    expect(parsed.requests[1].selections).toHaveLength(12);
    expect(parsed.requests[2].min_amount).toBe(10000);
    expect(parsed.requests[3].min_amount).toBe(75);
    expect(parsed.requests.every((r) => r.period_from === "2025-01-01" && r.period_to === "2025-12-31")).toBe(true);
  });

  it("reads the CSV sample without selections", async () => {
    const parsed = await parsedSample("csv");
    expect(parsed.requests).toHaveLength(9);
    expect(parsed.requests[2].type).toBe("bill_support");
  });
});

describe("engine on the demo company", () => {
  it.each(["xlsx", "email"] as const)("finds all planted exceptions with no false alarms (%s)", async (kind) => {
    const parsed = await parsedSample(kind);
    const results = runAll(parsed.requests, getFixture().snapshot);
    const report = scoreAgainstPlanted(results);
    const missed = report.planted.filter((p) => !p.found).map((p) => p.key);
    expect(missed).toEqual([]);
    expect(report.extra.map((f) => f.title)).toEqual([]);
    expect(report.recall).toBe(1);
    expect(report.precision).toBe(1);
  });

  it("matches every auditor selection to the right transaction", () => {
    const ix = buildIndex(getFixture().snapshot);
    const { selections, snapshot } = getFixture();
    for (const s of selections) {
      const m = matchSelection(ix, s);
      expect(m, s.ref).not.toBeNull();
      expect(m!.txn.entity_amount.value).toBe(Math.round(s.amount * 100));
      expect(s.description).toContain(m!.txn.card_holder.last_name.toUpperCase());
    }
    expect(snapshot.transactions.length).toBeGreaterThan(500);
  });

  it("reports a selection that is not in Ramp", () => {
    const ix = buildIndex(getFixture().snapshot);
    const req: AuditRequest = {
      ref: "PBC-X", text: "Selected card transactions", type: "transaction_support", period_from: "2025-01-01", period_to: "2025-12-31", min_amount: null,
      selections: [{ ref: "S-99", date: "05/05/2025", description: "WIRE FEE", amount: 12345.67 }], interpretation: "",
    };
    const r = runRequest(req, ix);
    expect(r.findings.map((f) => f.code)).toEqual(["SELECTION_NOT_FOUND"]);
  });

  it("draws a monetary unit sample when no selections are given", () => {
    const ix = buildIndex(getFixture().snapshot);
    const req: AuditRequest = {
      ref: "PBC-S", text: "Select a sample of 25 card transactions and provide support", type: "transaction_support", period_from: "2025-01-01", period_to: "2025-12-31", min_amount: null, selections: [], interpretation: "",
    };
    const r = runRequest(req, ix);
    expect(r.tested).toBe(25);
    expect(r.procedure[0]).toMatch(/monetary unit sample of 25/);
  });
});

describe("monetary unit sampling", () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, amount: (i % 17) * 100 + 50 }));

  it("returns exactly n items and is deterministic for a seed", () => {
    const a = monetaryUnitSample(items, 30, 7);
    const b = monetaryUnitSample(items, 30, 7);
    expect(a.selected).toHaveLength(30);
    expect(a.selected).toEqual(b.selected);
    expect(monetaryUnitSample(items, 30, 8).selected).not.toEqual(a.selected);
  });

  it("always selects items at or above the interval", () => {
    const withBig = [...items, { id: "big", amount: 1_000_000 }];
    const s = monetaryUnitSample(withBig, 10, 3);
    expect(s.topStratum).toContain("big");
    expect(s.selected).toContain("big");
    expect(s.selected).toHaveLength(10);
  });

  it("weights selection by amount", () => {
    let small = 0;
    let large = 0;
    const pop = [...Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, amount: 10 })), ...Array.from({ length: 100 }, (_, i) => ({ id: `l${i}`, amount: 90 }))];
    for (let seed = 1; seed <= 50; seed++) {
      for (const id of monetaryUnitSample(pop, 20, seed).selected) id.startsWith("s") ? small++ : large++;
    }
    expect(large / (small + large)).toBeGreaterThan(0.8);
  });
});

describe("binder", () => {
  it("writes an index, a workpaper per request and evidence files", async () => {
    const { buildBinder } = await import("../src/lib/binder/build");
    const { getSource } = await import("../src/lib/ramp/source");
    const JSZip = (await import("jszip")).default;
    const parsed = await parsedSample("xlsx");
    const snap = getFixture().snapshot;
    const results = runAll(parsed.requests, snap);
    const zip = await JSZip.loadAsync(await buildBinder(results, snap, getSource(), parsed.auditor));
    const names = Object.keys(zip.files);
    expect(names.filter((n) => n.endsWith("Workpaper.pdf"))).toHaveLength(9);
    expect(names.some((n) => n.endsWith("00 Index.xlsx"))).toBe(true);
    const receipts = names.filter((n) => n.includes("PBC-02") && n.endsWith("receipt.pdf"));
    expect(receipts).toHaveLength(11); // 12 selections, one has no receipt
    const invoices = names.filter((n) => n.includes("PBC-03") && n.endsWith("invoice.pdf"));
    expect(invoices).toHaveLength(results[2].rows.length);
  }, 30000);
});
