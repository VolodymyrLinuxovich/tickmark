// Turns an uploaded request list (CSV, XLSX or pasted text) into rows and plain text.

import ExcelJS from "exceljs";

export interface InputRow {
  ref: string;
  area: string;
  text: string;
  period_from: string | null;
  period_to: string | null;
}

export interface RawSelection {
  request_ref: string | null;
  ref: string;
  date: string;
  description: string;
  amount: number;
}

export interface NormalizedInput {
  rows: InputRow[]; // empty when the input is free text
  selections: RawSelection[];
  text: string; // full text rendering, used by the Claude parser
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function col(header: string[], ...names: string[]): number {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.findIndex((x) => x === n || x.startsWith(n));
    if (i >= 0) return i;
  }
  return -1;
}

export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

export const money = (s: string | number) => (typeof s === "number" ? s : Number(String(s).replace(/[$,\s]/g, "")));

function requestRows(table: string[][]): InputRow[] | null {
  if (table.length < 2) return null;
  const header = table[0];
  const iReq = col(header, "request", "description", "item");
  if (iReq < 0) return null;
  const iRef = col(header, "ref", "pbc", "no", "#");
  const iArea = col(header, "area", "category", "section");
  const iFrom = col(header, "periodstart", "from", "start");
  const iTo = col(header, "periodend", "to", "end");
  return table.slice(1).map((r, i) => ({
    ref: (iRef >= 0 ? r[iRef] : "").trim() || `PBC-${String(i + 1).padStart(2, "0")}`,
    area: iArea >= 0 ? (r[iArea] ?? "").trim() : "",
    text: (r[iReq] ?? "").trim(),
    period_from: iFrom >= 0 ? toIsoDate(r[iFrom]) : null,
    period_to: iTo >= 0 ? toIsoDate(r[iTo]) : null,
  })).filter((r) => r.text);
}

function selectionRows(table: string[][]): RawSelection[] | null {
  if (table.length < 2) return null;
  const header = table[0];
  const iAmt = col(header, "amount");
  const iDate = col(header, "date", "postingdate", "gldate");
  if (iAmt < 0 || iDate < 0) return null;
  const iDesc = col(header, "description", "merchant", "memo");
  const iRef = col(header, "selection", "sample", "ref");
  const iReq = col(header, "pbc", "request");
  return table.slice(1).map((r, i) => ({
    request_ref: iReq >= 0 ? (r[iReq] ?? "").trim() || null : null,
    ref: (iRef >= 0 ? r[iRef] : "").trim() || `S-${String(i + 1).padStart(2, "0")}`,
    date: (r[iDate] ?? "").trim(),
    description: iDesc >= 0 ? (r[iDesc] ?? "").trim() : "",
    amount: money(r[iAmt] ?? ""),
  })).filter((s) => s.date && Number.isFinite(s.amount));
}

const render = (name: string, table: string[][]) => `## Sheet: ${name}\n` + table.map((r) => r.join(" | ")).join("\n");

function fromTables(tables: { name: string; rows: string[][] }[]): NormalizedInput {
  let rows: InputRow[] = [];
  const selections: RawSelection[] = [];
  for (const t of tables) {
    const sel = selectionRows(t.rows);
    if (sel && !requestRows(t.rows)) {
      selections.push(...sel);
      continue;
    }
    const req = requestRows(t.rows);
    if (req && !rows.length) rows = req;
    else if (sel) selections.push(...sel);
  }
  return { rows, selections, text: tables.map((t) => render(t.name, t.rows)).join("\n\n") };
}

export async function normalizeFile(name: string, bytes: Uint8Array): Promise<NormalizedInput> {
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const tables: { name: string; rows: string[][] }[] = [];
    wb.eachSheet((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (r) => {
        const vals: string[] = [];
        r.eachCell({ includeEmpty: true }, (c, colNumber) => {
          vals[colNumber - 1] = cellText(c.value);
        });
        rows.push(Array.from(vals, (v) => v ?? ""));
      });
      tables.push({ name: ws.name, rows });
    });
    return fromTables(tables);
  }
  const text = new TextDecoder().decode(bytes);
  if (/\.csv$/i.test(name)) return fromTables([{ name, rows: parseCsv(text) }]);
  return normalizeText(text);
}

export function normalizeText(text: string): NormalizedInput {
  const looksCsv = text.split("\n")[0].split(",").length >= 3 && /request/i.test(text.split("\n")[0]);
  if (looksCsv) return fromTables([{ name: "pasted", rows: parseCsv(text) }]);
  return { rows: [], selections: [], text };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return String(v.result ?? "");
    if ("text" in v) return String(v.text);
  }
  return String(v);
}
