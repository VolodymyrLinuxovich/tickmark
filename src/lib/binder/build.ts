// Binder stage, the last step of the pipeline: turns request results into the ZIP the
// auditor receives. Layout: "00 Index.xlsx" (requests, exceptions, evidence rows),
// README.txt, and one folder per request holding Workpaper.pdf and an Evidence folder.
// A workpaper is the auditor's standard record of one test: what was asked, what was
// done, what was seen and what failed.

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { REQUEST_TYPE_INFO } from "../parse/schema";
import type { RampSnapshot } from "../ramp/types";
import type { RampSource } from "../ramp/source";
import { TICKMARKS, type RequestResult } from "../engine/types";
import { usd } from "../engine/run";

// pdf-lib's standard fonts only cover WinAnsi; keep text inside it.
const clean = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7e\n]/g, "");

/** Folder name for a request, stripped of characters that are illegal in Windows or macOS paths. */
const folderName = (r: RequestResult) => clean(`${r.request.ref} ${REQUEST_TYPE_INFO[r.request.type].label}`).replace(/[\\/:*?"<>|]/g, "");
/** File-name-safe text, capped at 60 characters. */
const safe = (s: string) => clean(s).replace(/[\\/:*?"<>|]/g, "").slice(0, 60).trim();

interface Ctx {
  business: string;
  auditor: string | null;
  sourceLabel: string;
  generatedAt: Date;
}

/** Where the finance team stands on one exception, set in the app before download. */
export interface ExceptionStatus {
  status: "open" | "resolved" | "waived";
  note?: string;
}
export type ExceptionStatuses = Record<string, ExceptionStatus>;

const STATUS_LABEL: Record<ExceptionStatus["status"], string> = { open: "Open", resolved: "Resolved", waived: "Waived" };

/** Workpaper reference for the nth request in the binder: WP-01, WP-02, ... */
const wpRef = (i: number) => `WP-${String(i + 1).padStart(2, "0")}`;

/** "2026-10-21" to "Oct 21, 2026". */
const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One line an auditor reads first: what the test concluded. */
function conclusion(r: RequestResult): string {
  if (r.status === "manual") return "Not tested by Tickmark. The request is outside Ramp data and is assigned to the finance team.";
  if (!r.findings.length) return `No exceptions noted. ${r.tested} item${r.tested === 1 ? "" : "s"} tested; procedures performed without exception.`;
  const n = r.findings.length;
  return `Exceptions noted. See exception${n > 1 ? `s 1-${n}` : " 1"} below. Resolve or document each one before the binder goes to the auditor.`;
}

/** Minimal flowing-text layout over pdf-lib: wraps text, draws tables and starts a new page with a header when space runs out. Pages are US Letter in points. */
class Writer {
  page!: PDFPage;
  y = 0;
  constructor(readonly doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private ctx: Ctx, private title: string) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([612, 792]);
    this.y = 750;
    this.page.drawText(clean(`${this.ctx.business}  |  ${this.title}`), { x: 48, y: 770, size: 8, font: this.font, color: rgb(0.45, 0.45, 0.45) });
    const right = clean(`Prepared ${longDate(this.ctx.generatedAt)} from ${this.ctx.sourceLabel}`);
    this.page.drawText(right, { x: 564 - this.font.widthOfTextAtSize(right, 8), y: 770, size: 8, font: this.font, color: rgb(0.45, 0.45, 0.45) });
  }
  ensure(h: number) {
    if (this.y - h < 60) this.newPage();
  }
  /** Footer on every page: workpaper reference on the left, "Page n of m" on the right. Call once, after all content. */
  footers(ref: string) {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const grey = rgb(0.45, 0.45, 0.45);
      p.drawLine({ start: { x: 48, y: 42 }, end: { x: 564, y: 42 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
      p.drawText(clean(ref), { x: 48, y: 30, size: 8, font: this.font, color: grey });
      const label = `Page ${i + 1} of ${pages.length}`;
      p.drawText(label, { x: 564 - this.font.widthOfTextAtSize(label, 8), y: 30, size: 8, font: this.font, color: grey });
    });
  }
  /** Prepared by and reviewed by lines, the sign-off every workpaper carries. */
  signOff() {
    this.ensure(70);
    this.y -= 6;
    const grey = rgb(0.35, 0.35, 0.35);
    const line = (x: number, y: number, w: number) => this.page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color: rgb(0.55, 0.55, 0.55) });
    const rows: [string, string, string][] = [
      ["Prepared by", "Tickmark, from Ramp records", longDate(this.ctx.generatedAt)],
      ["Reviewed by", "", ""],
    ];
    for (const [label, who, when] of rows) {
      this.page.drawText(label, { x: 48, y: this.y, size: 9, font: this.bold, color: rgb(0.1, 0.1, 0.1) });
      line(130, this.y - 2, 250);
      if (who) this.page.drawText(clean(who), { x: 134, y: this.y + 1, size: 9, font: this.font, color: grey });
      this.page.drawText("Date", { x: 400, y: this.y, size: 9, font: this.bold, color: rgb(0.1, 0.1, 0.1) });
      line(430, this.y - 2, 134);
      if (when) this.page.drawText(when, { x: 434, y: this.y + 1, size: 9, font: this.font, color: grey });
      this.y -= 26;
    }
  }
  wrap(text: string, size: number, width: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    for (const line of this.wrap(text, size, 516 - (opts.indent ?? 0), font)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: 48 + (opts.indent ?? 0), y: this.y, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.1])) });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 4;
  }
  table(columns: string[], rows: string[][], widths: number[]) {
    const size = 7.5;
    const drawRow = (cells: string[], bold: boolean) => {
      const wrapped = cells.map((c, i) => this.wrap(c, size, widths[i] - 6, bold ? this.bold : this.font).slice(0, 4));
      const h = Math.max(...wrapped.map((w) => w.length)) * (size + 2.5) + 4;
      this.ensure(h);
      let x = 48;
      wrapped.forEach((lines, i) => {
        lines.forEach((l, k) => this.page.drawText(l, { x: x + 2, y: this.y - k * (size + 2.5), size, font: bold ? this.bold : this.font, color: rgb(0.1, 0.1, 0.1) }));
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: 48, y: this.y + size }, end: { x: 564, y: this.y + size }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
    };
    drawRow(columns, true);
    for (const r of rows) drawRow(r, false);
    this.y -= 8;
  }
}

/** Renders one request's workpaper PDF: request text, procedure, evidence table with tickmarks, exceptions and the tickmark legend. */
async function workpaper(r: RequestResult, ctx: Ctx, ref: string, statuses: ExceptionStatuses): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, ctx, `${ref}  ${r.request.ref} workpaper`);
  w.text(`${r.request.ref}  ${REQUEST_TYPE_INFO[r.request.type].label}`, { size: 16, bold: true, gap: 2 });
  w.text(r.headline, { size: 10, color: r.findings.length ? [0.62, 0.32, 0] : [0.1, 0.45, 0.25], gap: 10 });
  w.text("Conclusion", { bold: true, size: 9 });
  w.text(conclusion(r), { size: 9, gap: 8 });
  w.text("Request", { bold: true, size: 9 });
  w.text(r.request.text, { size: 9, gap: 8 });
  w.text("Procedure performed", { bold: true, size: 9 });
  for (const p of r.procedure) w.text(`- ${p}`, { size: 9, indent: 6, gap: 1 });
  w.y -= 8;
  if (r.rows.length) {
    w.text(`Evidence (${r.rows.length})`, { bold: true, size: 9 });
    const cols = [...r.columns, "Tickmarks"];
    const total = 516;
    const tickW = 52;
    const base = (total - tickW) / r.columns.length;
    const widths = [...r.columns.map(() => base), tickW];
    w.table(cols, r.rows.map((row) => [...row.cells, row.tickmarks.join(" ")]), widths);
  }
  if (r.findings.length) {
    w.text(`Exceptions (${r.findings.length})`, { bold: true, size: 9 });
    r.findings.forEach((f, i) => {
      const st = statuses[f.id];
      w.text(`${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`, { size: 9, bold: true, indent: 6, gap: 0 });
      w.text(f.detail, { size: 9, indent: 18, gap: 0 });
      w.text(`Status: ${STATUS_LABEL[st?.status ?? "open"]}${st?.note ? `. ${st.note}` : ""}`, { size: 8.5, indent: 18, color: st?.status === "resolved" ? [0.1, 0.45, 0.25] : st?.status === "waived" ? [0.35, 0.35, 0.35] : [0.62, 0.32, 0], gap: 0 });
      if (f.records.length) w.text(`Records: ${f.records.map((x) => `${x.label} (${x.type} ${x.id})`).join("; ")}`, { size: 7.5, indent: 18, color: [0.4, 0.4, 0.4], gap: 6 });
    });
  }
  w.text("Tickmarks", { bold: true, size: 9 });
  w.text(Object.entries(TICKMARKS).map(([k, v]) => `${k} = ${v}`).join("    "), { size: 8, color: [0.35, 0.35, 0.35], gap: 10 });
  w.signOff();
  w.footers(`${ctx.business}  |  ${ref}  ${r.request.ref}`);
  return doc.save();
}

/** Stand-in documents for demo records, clearly labeled as generated from Ramp fields. */
async function demoDocument(kind: "receipt" | "invoice", lines: [string, string][], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(kind === "receipt" ? [300, 420] : [612, 792]);
  const { height } = page.getSize();
  let y = height - 44;
  page.drawText(clean(title), { x: 28, y, size: 14, font: bold });
  y -= 18;
  page.drawText(`DEMO ${kind.toUpperCase()}: rendered from Ramp record fields`, { x: 28, y, size: 7, font, color: rgb(0.6, 0.2, 0.1) });
  y -= 26;
  for (const [k, v] of lines) {
    page.drawText(clean(k), { x: 28, y, size: 9, font: bold });
    page.drawText(clean(v).slice(0, 70), { x: 130, y, size: 9, font });
    y -= 16;
  }
  return doc.save();
}

/**
 * Builds the full evidence binder ZIP. Evidence files are fetched from the source; when the
 * source cannot serve a file (demo data), a labeled stand-in PDF is rendered from the Ramp
 * record so the binder layout is still complete. At most 200 files per request keeps the ZIP bounded.
 */
export async function buildBinder(results: RequestResult[], snap: RampSnapshot, source: RampSource, auditor: string | null, statuses: ExceptionStatuses = {}): Promise<Uint8Array> {
  const ctx: Ctx = { business: snap.business_name, auditor, sourceLabel: source.info.label, generatedAt: new Date() };
  const zip = new JSZip();
  const root = zip.folder(safe(`${snap.business_name} audit binder`))!;

  // Index workbook.
  const wb = new ExcelJS.Workbook();
  const idx = wb.addWorksheet("Index");
  idx.columns = [
    { header: "Workpaper", width: 11 },
    { header: "Ref", width: 9 },
    { header: "Type", width: 20 },
    { header: "Request", width: 70 },
    { header: "Status", width: 12 },
    { header: "Result", width: 50 },
    { header: "Tested", width: 8 },
    { header: "Exceptions", width: 10 },
    { header: "Folder", width: 34 },
  ];
  idx.getRow(1).font = { bold: true };
  results.forEach((r, i) => idx.addRow([wpRef(i), r.request.ref, REQUEST_TYPE_INFO[r.request.type].label, r.request.text, r.status, r.headline, r.tested, r.findings.length, folderName(r)]));
  const fs = wb.addWorksheet("Exceptions");
  fs.columns = [
    { header: "Ref", width: 9 },
    { header: "Severity", width: 9 },
    { header: "Code", width: 24 },
    { header: "Exception", width: 60 },
    { header: "Detail", width: 70 },
    { header: "Owner", width: 18 },
    { header: "Ramp record ids", width: 40 },
    { header: "Status", width: 10 },
    { header: "Note", width: 50 },
  ];
  fs.getRow(1).font = { bold: true };
    // A finding can come up under several requests; list it once, under the first request that found it.
  const seen = new Set<string>();
  for (const r of results)
    for (const f of r.findings) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const st = statuses[f.id];
      fs.addRow([r.request.ref, f.severity, f.code, f.title, f.detail, f.owner?.name ?? "", f.records.map((x) => x.id).join(", "), STATUS_LABEL[st?.status ?? "open"], st?.note ?? ""]);
    }
  for (const r of results.filter((x) => x.rows.length)) {
    const ws = wb.addWorksheet(r.request.ref.slice(0, 31));
    ws.addRow([...r.columns, "Tickmarks", "Ramp id"]).font = { bold: true };
    for (const row of r.rows) ws.addRow([...row.cells, row.tickmarks.join(" "), row.record.id]);
    ws.columns.forEach((c) => (c.width = 22));
  }
  root.file("00 Index.xlsx", new Uint8Array(await wb.xlsx.writeBuffer()));

  root.file(
    "README.txt",
    [
      `${snap.business_name} audit evidence binder`,
      auditor ? `Prepared for ${auditor}` : "",
      `Generated ${ctx.generatedAt.toISOString()} from ${source.info.label}${source.info.kind === "fixture" ? " (demo data; receipts and invoices are rendered from record fields)" : ""}.`,
      "",
      "Each folder holds one request: Workpaper.pdf (procedure, evidence table, exceptions) and the supporting documents.",
      "00 Index.xlsx lists every request, every exception and the evidence rows with Ramp record ids.",
      "",
      "Tickmarks",
      ...Object.entries(TICKMARKS).map(([k, v]) => `  ${k}  ${v}`),
    ].filter((l, i) => l || i > 1).join("\n"),
  );

  const txn = new Map(snap.transactions.map((t) => [t.id, t]));
  const bill = new Map(snap.bills.map((b) => [b.id, b]));
  const receipt = new Map(snap.receipts.map((r) => [r.receipt_url, r]));
  for (const [i, r] of results.entries()) {
    const folder = root.folder(folderName(r))!;
    folder.file("Workpaper.pdf", await workpaper(r, ctx, wpRef(i), statuses));
    const files = r.rows.flatMap((row) => row.files.map((url) => ({ url, row })));
    for (const { url, row } of files.slice(0, 200)) {
      const live = await source.file(url).catch(() => null);
      const base = `${safe(row.record.label)} ${row.record.id.slice(0, 6)}`;
      if (live) {
        const ext = live.contentType.includes("pdf") ? "pdf" : live.contentType.includes("png") ? "png" : "jpg";
        folder.file(`Evidence/${base}.${ext}`, live.bytes);
        continue;
      }
      if (row.record.type === "transaction") {
        const t = txn.get(row.record.id);
        const rc = receipt.get(url);
        if (!t || !rc) continue;
        const total = (rc.ocr?.line_items ?? []).reduce((s, i) => s + (i.item_total_price ?? 0), 0);
        folder.file(
          `Evidence/${base} receipt.pdf`,
          await demoDocument("receipt", [
            ["Merchant", t.merchant_name],
            ["Date", rc.ocr?.line_items?.[0]?.item_date ?? ""],
            ["Item", rc.ocr?.line_items?.[0]?.item_name ?? ""],
            ["Total", usd(Math.round(total * 100))],
            ["Cardholder", `${t.card_holder.first_name} ${t.card_holder.last_name}`],
            ["Ramp receipt", rc.id],
          ], t.merchant_name),
        );
      } else if (row.record.type === "bill") {
        const b = bill.get(row.record.id);
        if (!b) continue;
        folder.file(
          `Evidence/${base} invoice.pdf`,
          await demoDocument("invoice", [
            ["Vendor", b.vendor.name],
            ["Bill to", snap.business_name],
            ["Invoice", b.invoice_number ?? ""],
            ["Issued", b.issued_at.slice(0, 10)],
            ["Due", b.due_at.slice(0, 10)],
            ["Description", b.memo ?? ""],
            ["Amount due", usd(b.amount.amount)],
            ["Ramp bill", b.id],
          ], `Invoice ${b.invoice_number ?? ""}`),
        );
      }
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
