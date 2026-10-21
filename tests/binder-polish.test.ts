import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { getFixture } from "../src/lib/fixtures/generate";
import { buildIndex, matchBill, runRequest } from "../src/lib/engine/run";
import { buildBinder } from "../src/lib/binder/build";
import { getSource } from "../src/lib/ramp/source";
import type { AuditRequest } from "../src/lib/parse/schema";

const base: Omit<AuditRequest, "ref" | "type" | "text"> = { period_from: "2025-01-01", period_to: "2025-12-31", min_amount: null, selections: [], interpretation: "" };

describe("bill requests with auditor selections", () => {
  it("tests the picked bills only and reports one that is not in Ramp", () => {
    const { snapshot } = getFixture();
    const ix = buildIndex(snapshot);
    const [a, b] = snapshot.bills.filter((x) => x.paid_at).slice(0, 2);
    const pick = (ref: string, bill: typeof a) => ({ ref, date: bill.issued_at.slice(0, 10), description: bill.vendor.name, amount: bill.amount.amount / 100 });
    const req: AuditRequest = {
      ...base,
      ref: "PBC-B",
      type: "bill_support",
      text: "Invoice and approval for the selected bills",
      selections: [pick("B-1", a), pick("B-2", b), { ref: "B-3", date: "2025-05-05", description: "WIRE TO NOWHERE", amount: 123.45 }],
    };
    expect(matchBill(ix, req.selections[0])?.bill.id).toBe(a.id);
    const r = runRequest(req, ix);
    expect(r.rows).toHaveLength(3);
    expect(r.columns[0]).toBe("Ref");
    expect(r.findings.filter((f) => f.code === "SELECTION_NOT_FOUND")).toHaveLength(1);
  });
});

describe("control testing workpaper", () => {
  it("has a summary row per test with readable names", () => {
    const ix = buildIndex(getFixture().snapshot);
    const r = runRequest({ ...base, ref: "PBC-C", type: "control_testing", text: "Split purchases and self-approval" }, ix);
    const names = r.rows.map((x) => x.cells[0]);
    expect(names.slice(0, 5)).toEqual(["Split purchase", "Self-approval", "Approval after payment", "No approval recorded", "Restricted merchant category (MCC)"]);
    expect(r.rows.find((x) => x.cells[0] === "No approval recorded")?.tickmarks).toEqual(["T"]);
    expect(names.every((n) => !/_/.test(n) && n[0] === n[0].toUpperCase())).toBe(true);
  });
});

describe("binder", () => {
  it("adds workpaper refs and carries exception statuses into the index", async () => {
    const snap = getFixture().snapshot;
    const ix = buildIndex(snap);
    const r = runRequest({ ...base, ref: "PBC-C", type: "control_testing", text: "Controls" }, ix);
    const id = r.findings[0].id;
    const zip = await JSZip.loadAsync(await buildBinder([r], snap, getSource(), null, { [id]: { status: "resolved", note: "PO attached" } }));
    const xlsx = Object.keys(zip.files).find((n) => n.endsWith("00 Index.xlsx"))!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await zip.file(xlsx)!.async("uint8array")).buffer as ArrayBuffer);
    expect(wb.getWorksheet("Index")!.getRow(2).getCell(1).value).toBe("WP-01");
    const ex = wb.getWorksheet("Exceptions")!;
    const header = (ex.getRow(1).values as string[]).filter(Boolean);
    expect(header.slice(-2)).toEqual(["Status", "Note"]);
    const rows = ex.getSheetValues().slice(2) as string[][];
    expect(rows.some((row) => row.includes("Resolved") && row.includes("PO attached"))).toBe(true);
    expect(rows.filter((row) => row.includes("Open")).length).toBe(r.findings.length - 1);
  }, 30000);
});
