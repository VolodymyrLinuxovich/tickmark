// Turns an uploaded request list (CSV, XLSX, PDF or pasted text) into rows and plain text.

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

export function parseCsv(text: string, delimiter = ","): string[][] {
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
    } else if (c === '"' && !cell.trim()) quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// ---------- dates and amounts ----------

const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export const monthNumber = (name: string): number | null => MONTH_INDEX[name.toLowerCase().slice(0, name.toLowerCase().startsWith("sept") ? 4 : 3)] ?? null;

const year4 = (y: string) => (y.length === 2 ? `20${y}` : y);

function iso(y: string | number, m: number, d: number): string | null {
  const yy = Number(y);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && yy >= 1990 && yy <= 2100)) return null;
  const dt = new Date(Date.UTC(yy, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Excel stores dates as days since 1899-12-30. */
export function fromExcelSerial(n: number): string | null {
  if (!(n > 20000 && n < 80000)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
}

/** Reads 2025-03-14, 3/14/25, 03/14/2025, 14-Mar-2025, March 14, 2025, 14 March 2025 and Excel serials. US order for slashes. */
export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return iso(year4(m[3]), +m[1], +m[2]);
  m = t.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ,]+(\d{2}|\d{4})$/);
  if (m && monthNumber(m[2])) return iso(year4(m[3]), monthNumber(m[2])!, +m[1]);
  m = t.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  if (m && monthNumber(m[1])) return iso(m[3], monthNumber(m[1])!, +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(t)) return fromExcelSerial(Number(t));
  return null;
}

/** Parses $1,234.56, 1234.5, (1,234.56), -$42.10, USD 7,500. Parentheses mean negative. */
export function money(s: string | number): number {
  if (typeof s === "number") return s;
  let t = s.trim();
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t) || /^\$\s*-/.test(t);
  t = t.replace(/[()$,\s-]|usd/gi, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return negative ? -Number(t) : Number(t);
}

// ---------- tables ----------

type Role = "ref" | "text" | "request" | "title" | "area" | "from" | "to" | "other";
type SelRole = "amount" | "date" | "desc" | "ref" | "link";

/** What a request-list column holds, from its header. */
function requestRole(header: string): Role | null {
  const h = header.toLowerCase().replace(/\s+/g, " ").trim();
  if (!h) return null;
  if (/period (start|from|begin)|^(start|from|begin)( date)?$/.test(h)) return "from";
  if (/period (end|to|through)|^(end|to|through)( date)?$/.test(h)) return "to";
  if (/date|due|status|contact|owner|assigned|prepared|responsib|comment|received|follow|priority|notes?$/.test(h)) return "other";
  if (/^(ref|reference|index|#|no\.?|id|number|pbc)\b|^(request|req|item|pbc) ?(#|no\.?|num|number|id|ref)/.test(h)) return "ref";
  if (/title|subject|summary|name/.test(h)) return "title";
  if (/descr|details|document|information/.test(h)) return "text";
  if (/request|^item$/.test(h)) return "request";
  if (/area|categor|section|account|cycle/.test(h)) return "area";
  return null;
}

/** What a selections column holds, from its header. */
function selectionRole(header: string): SelRole | null {
  const h = header.toLowerCase().replace(/\s+/g, " ").trim();
  if (!h) return null;
  if (/amount|amt|usd|value|total/.test(h)) return "amount";
  if (/date/.test(h) && !/due/.test(h)) return "date";
  if (/pbc|request|req\b/.test(h)) return "link";
  if (/sample|selection|^ref|^#|^no\.?$|item|line|^id$/.test(h)) return "ref";
  if (/descr|merchant|vendor|payee|memo|name|detail|supplier/.test(h)) return "desc";
  return null;
}

function roles<R extends string>(row: string[], fn: (h: string) => R | null): Map<R, number> {
  const out = new Map<R, number>();
  row.forEach((h, i) => {
    const r = fn(h);
    if (r && !out.has(r)) out.set(r, i);
  });
  return out;
}

const cell = (r: string[], i: number | undefined) => (i === undefined ? "" : (r[i] ?? "").trim());
const distinct = (r: string[]) => [...new Set(r.map((c) => c.trim()).filter(Boolean))];

/** A row only one value wide: a section heading, title or footer, often a merged cell. */
const isBanner = (r: string[]) => distinct(r).length === 1;

const HEADER_SCAN = 25;

function findRequestHeader(table: string[][]): { at: number; cols: Map<Role, number> } | null {
  for (let i = 0; i < Math.min(table.length, HEADER_SCAN); i++) {
    const row = table[i];
    if (isBanner(row)) continue;
    if (row.some((c) => c.trim().length > 50)) continue;
    const cols = roles(row, requestRole);
    // "Description" beats "Request" when both are present; a lone "Request" column holds the text.
    if (cols.has("request")) {
      if (!cols.has("text")) cols.set("text", cols.get("request")!);
      else if (!cols.has("title")) cols.set("title", cols.get("request")!);
      cols.delete("request");
    }
    if (cols.size >= 2 && (cols.has("text") || cols.has("title")) && !roles(row, selectionRole).has("amount")) return { at: i, cols };
  }
  return null;
}

function findSelectionHeader(table: string[][]): { at: number; cols: Map<SelRole, number> } | null {
  for (let i = 0; i < Math.min(table.length, HEADER_SCAN); i++) {
    if (isBanner(table[i]) || table[i].some((c) => c.trim().length > 50)) continue;
    const cols = roles(table[i], selectionRole);
    if (cols.has("amount") && cols.has("date")) return { at: i, cols };
  }
  return null;
}

/** Cell date: ISO and US dates stay as written, Excel serials become ISO. */
function dateCell(v: string): string {
  return /^\d{5}(\.\d+)?$/.test(v) ? (fromExcelSerial(Number(v)) ?? v) : v;
}

function requestRows(table: string[][]): InputRow[] | null {
  const head = findRequestHeader(table);
  if (!head) return null;
  const c = head.cols;
  const rows: InputRow[] = [];
  let section = "";
  for (const r of table.slice(head.at + 1)) {
    const values = distinct(r);
    if (!values.length) continue;
    const text = cell(r, c.get("text"));
    const title = cell(r, c.get("title"));
    if (isBanner(r) && (!text || values[0].length < 60)) {
      // Section heading like "Cash" or "ACCOUNTS PAYABLE"; long one-cell rows are notes.
      if (values[0].length < 60 && !/^(notes?|comments?|legend|key)\b/i.test(values[0])) section = values[0];
      continue;
    }
    if (!text && !title) continue;
    const full = title && text && title !== text ? `${title}: ${text}` : text || title;
    rows.push({
      ref: cell(r, c.get("ref")),
      area: cell(r, c.get("area")) || section,
      text: full,
      period_from: toIsoDate(dateCell(cell(r, c.get("from")))),
      period_to: toIsoDate(dateCell(cell(r, c.get("to")))),
    });
  }
  rows.forEach((row, i) => (row.ref ||= `PBC-${String(i + 1).padStart(2, "0")}`));
  return rows.length ? rows : null;
}

function selectionRows(table: string[][]): RawSelection[] | null {
  const head = findSelectionHeader(table);
  if (!head) return null;
  const c = head.cols;
  const out: RawSelection[] = [];
  for (const r of table.slice(head.at + 1)) {
    const date = dateCell(cell(r, c.get("date")));
    const amount = money(cell(r, c.get("amount")));
    if (!toIsoDate(date) || !Number.isFinite(amount)) continue; // totals, notes, blanks
    out.push({
      request_ref: cell(r, c.get("link")) || null,
      ref: cell(r, c.get("ref")) || `S-${String(out.length + 1).padStart(2, "0")}`,
      date,
      description: cell(r, c.get("desc")),
      amount,
    });
  }
  return out;
}

const render = (name: string, table: string[][]) =>
  `## Sheet: ${name}\n` +
  table
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => (isBanner(r) ? distinct(r)[0] : r.join(" | ")))
    .join("\n");

function fromTables(tables: { name: string; rows: string[][] }[]): NormalizedInput {
  const rows: InputRow[] = [];
  const selections: RawSelection[] = [];
  for (const t of tables) {
    const sel = selectionRows(t.rows);
    if (sel) {
      selections.push(...sel);
      continue;
    }
    const req = requestRows(t.rows);
    if (req) rows.push(...req);
  }
  return { rows, selections, text: tables.map((t) => render(t.name, t.rows)).join("\n\n") };
}

// ---------- files ----------

export async function normalizeFile(name: string, bytes: Uint8Array): Promise<NormalizedInput> {
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const tables: { name: string; rows: string[][] }[] = [];
    wb.eachSheet((ws) => {
      if (ws.state !== "visible") return;
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
  if (/\.pdf$/i.test(name)) return normalizeText(await pdfText(bytes));
  const text = new TextDecoder().decode(bytes);
  if (/\.csv$/i.test(name)) return fromTables([{ name, rows: parseCsv(text) }]);
  if (/\.eml$/i.test(name)) return normalizeText(emlBody(text));
  return normalizeText(text);
}

/** Pasted text: a table copied from Excel (tabs) or CSV when it has a header row, else free text. */
export function normalizeText(text: string): NormalizedInput {
  const clean = text.replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim());
  for (const delimiter of ["\t", ","]) {
    if (lines.filter((l) => l.includes(delimiter)).length < 3) continue;
    const table = delimiter === "\t" ? clean.split("\n").map((l) => l.split("\t")) : parseCsv(clean);
    const parsed = fromTables([{ name: "pasted", rows: table }]);
    if (parsed.rows.length >= 2) return { ...parsed, text: clean };
  }
  return { rows: [], selections: [], text: clean };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Body of a saved .eml file: drops MIME headers and undoes quoted-printable. */
function emlBody(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n");
  const subject = text.match(/^Subject: (.*)$/m)?.[1] ?? "";
  let body = text.slice(text.indexOf("\n\n") + 2);
  const plain = body.match(/Content-Type: text\/plain[^\n]*\n(?:[^\n]+\n)*\n([\s\S]*?)(?=\n--[^\n]+|$)/i);
  if (plain) body = plain[1];
  if (/quoted-printable/i.test(text)) {
    body = body.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return (subject ? `Subject: ${subject}\n\n` : "") + body;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result ?? "");
    if ("text" in v) return String(v.text);
    if ("error" in v) return "";
  }
  return String(v);
}
