// Reads a receipt file (an email saved as .eml, a PDF, a photo or plain text) into the few
// facts needed to match it to a card charge: amounts, dates and merchant hints.
// Deterministic on purpose: every match can be explained by what was found in the file.

export interface Attachment {
  name: string;
  content_type: string;
  bytes: Uint8Array;
}

export interface ReceiptDoc {
  name: string;
  kind: "email" | "pdf" | "image" | "text";
  from: string | null;
  subject: string | null;
  /** YYYY-MM-DD dates found in the headers and text, most likely first. */
  dates: string[];
  /** Amounts in cents. `total` is the one on a "Total" or "Amount paid" line, when there is one. */
  amounts: number[];
  total: number | null;
  /** Lowercase words that may name the merchant: sender name and domain, subject, file name. */
  hints: string[];
  text: string;
  /** The PDF or image inside an email, which is the better file to attach to Ramp. */
  attachment: Attachment | null;
}

// ---------------------------------------------------------------- email (RFC 822 / MIME)

/** Undoes =?charset?B?...?= and =?charset?Q?...?= encoded words in a header. */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, data: string) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : Buffer.from(qpBytes(data.replace(/_/g, " ")));
      return new TextDecoder(charset.toLowerCase() === "utf8" ? "utf-8" : charset).decode(bytes);
    } catch {
      return data;
    }
  });
}

function qpBytes(s: string): Uint8Array {
  const clean = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(clean.slice(i + 1, i + 3))) {
      out.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(...Buffer.from(clean[i], "utf8"));
  }
  return new Uint8Array(out);
}

interface Part {
  headers: Map<string, string>;
  body: string; // raw, still transfer-encoded
}

function splitPart(raw: string): Part {
  const text = raw.replace(/\r\n?/g, "\n");
  const cut = text.indexOf("\n\n");
  const head = cut < 0 ? text : text.slice(0, cut);
  const body = cut < 0 ? "" : text.slice(cut + 2);
  const headers = new Map<string, string>();
  // Folded header lines start with whitespace and continue the previous header.
  for (const line of head.replace(/\n[ \t]+/g, " ").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return { headers, body };
}

const param = (header: string | undefined, name: string) =>
  header?.match(new RegExp(`${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, "i"))?.slice(1).find(Boolean) ?? null;

function decodeBody(p: Part): Uint8Array {
  const enc = (p.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  if (enc === "base64") return new Uint8Array(Buffer.from(p.body.replace(/\s+/g, ""), "base64"));
  if (enc === "quoted-printable") return qpBytes(p.body);
  return new Uint8Array(Buffer.from(p.body, "utf8"));
}

const htmlToText = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;|&dollar;/g, "$")
    .replace(/[ \t]+/g, " ");

/** Walks a MIME tree and collects its text and its attachments. */
function walk(p: Part, out: { plain: string[]; html: string[]; files: Attachment[] }, depth = 0) {
  const type = p.headers.get("content-type") ?? "text/plain";
  const boundary = param(type, "boundary");
  if (/^multipart\//i.test(type) && boundary && depth < 8) {
    const pieces = p.body.split(new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*$`, "m"));
    for (const piece of pieces.slice(1)) if (piece.trim()) walk(splitPart(piece.replace(/^\n/, "")), out, depth + 1);
    return;
  }
  const disposition = p.headers.get("content-disposition") ?? "";
  const filename = param(disposition, "filename") ?? param(type, "name");
  const charset = param(type, "charset") ?? "utf-8";
  const bytes = decodeBody(p);
  if (filename || /^(application\/pdf|image\/)/i.test(type)) {
    out.files.push({ name: decodeWords(filename ?? "attachment"), content_type: type.split(";")[0].trim().toLowerCase(), bytes });
    return;
  }
  let text: string;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  if (/text\/html/i.test(type)) out.html.push(htmlToText(text));
  else out.plain.push(text);
}

export interface ParsedEmail {
  from: string | null;
  subject: string | null;
  date: string | null;
  text: string;
  attachments: Attachment[];
}

export function parseEmail(raw: string): ParsedEmail {
  const root = splitPart(raw);
  const out = { plain: [] as string[], html: [] as string[], files: [] as Attachment[] };
  walk(root, out);
  const h = (k: string) => (root.headers.has(k) ? decodeWords(root.headers.get(k)!) : null);
  const d = h("date");
  return {
    from: h("from"),
    subject: h("subject"),
    date: d && !Number.isNaN(Date.parse(d)) ? new Date(d).toISOString().slice(0, 10) : null,
    text: (out.plain.length ? out.plain : out.html).join("\n"),
    attachments: out.files,
  };
}

// ---------------------------------------------------------------- facts

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) => y > 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** Dates written as 2026-03-03, 03/03/2026, Mar 3, 2026 or 3 March 2026. */
export function findDates(text: string): string[] {
  const out: string[] = [];
  const add = (y: number, m: number, d: number) => validDate(y, m, d) && out.push(`${y}-${pad(m)}-${pad(d)}`);
  for (const m of text.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) add(+m[1], +m[2], +m[3]);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/g)) add(+m[3], +m[1], +m[2]);
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d\d)\b/gi)) add(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  for (const m of text.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b/gi)) add(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return [...new Set(out)];
}

const MONEY = String.raw`(?:\$|USD\s?|US\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?|(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s?(?:USD|\$)`;
const cents = (whole: string, frac?: string) => Number(whole.replace(/,/g, "")) * 100 + Number(frac ?? 0);

/** Every money amount in the text, in cents. */
export function findAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(new RegExp(MONEY, "gi"))) out.push(m[1] ? cents(m[1], m[2]) : cents(m[3], m[4]));
  return out.filter((c) => c > 0);
}

/** The amount on a total line ("Total", "Amount paid", "Amount charged"), last one wins. */
export function findTotal(text: string): number | null {
  let total: number | null = null;
  for (const line of text.split(/\n/)) {
    if (!/\b(grand total|total|amount (paid|charged|due)|you paid|charged)\b/i.test(line) || /\bsub-?total\b/i.test(line)) continue;
    const a = findAmounts(line);
    if (a.length) total = a[a.length - 1];
  }
  return total;
}

const STOP = new Set(["receipt", "receipts", "your", "order", "invoice", "payment", "the", "from", "for", "and", "with", "thank", "thanks", "you", "mail", "email", "billing", "noreply", "no", "reply", "notifications", "support", "info", "team", "com", "net", "org", "io", "co", "www", "inc", "llc", "ltd", "eml", "pdf", "png", "jpg", "jpeg"]);

/** Lowercase merchant-looking words: sender display name, sender domain, subject and file name. */
export function merchantHints(...parts: (string | null | undefined)[]): string[] {
  const words: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    // receipts@mail.asana.com gives "asana"; the last label before the TLD is the brand.
    for (const m of p.matchAll(/@([a-z0-9.-]+)\.[a-z]{2,}/gi)) words.push(m[1].split(".").pop()!.toLowerCase());
    words.push(...p.toLowerCase().replace(/<[^>]*>/g, " ").split(/[^a-z0-9]+/));
  }
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return "";
  }
}

const isImage = (name: string, type: string) => /^image\//i.test(type) || /\.(png|jpe?g|gif|webp|heic)$/i.test(name);
const isPdf = (name: string, type: string) => /pdf/i.test(type) || /\.pdf$/i.test(name);

/** Reads one file into a ReceiptDoc. Photos carry only what their file name says, since there is no OCR here. */
export async function readReceipt(name: string, bytes: Uint8Array, contentType = ""): Promise<ReceiptDoc> {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
  if (/\.eml$/i.test(name) || /message\/rfc822/i.test(contentType)) {
    const e = parseEmail(new TextDecoder().decode(bytes));
    const attachment = e.attachments.find((a) => isPdf(a.name, a.content_type)) ?? e.attachments.find((a) => isImage(a.name, a.content_type)) ?? null;
    const attText = attachment && isPdf(attachment.name, attachment.content_type) ? await pdfText(attachment.bytes) : "";
    const text = [e.text, attText].filter(Boolean).join("\n");
    const dates = [...(e.date ? [e.date] : []), ...findDates(text)];
    return { name, kind: "email", from: e.from, subject: e.subject, dates: [...new Set(dates)], amounts: findAmounts(text), total: findTotal(text), hints: merchantHints(e.from, e.subject, attachment?.name), text, attachment };
  }
  if (isPdf(name, contentType)) {
    const text = await pdfText(bytes);
    return { name, kind: "pdf", from: null, subject: null, dates: findDates(text), amounts: findAmounts(text), total: findTotal(text), hints: merchantHints(base, text.split("\n").slice(0, 3).join(" ")), text, attachment: null };
  }
  if (isImage(name, contentType)) {
    // "asana 558.00 2026-03-03.png": amounts in a file name usually lack a currency sign.
    const nums = [...base.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})(?!\d)/g)].map((m) => cents(m[1], m[2]));
    return { name, kind: "image", from: null, subject: null, dates: findDates(base), amounts: nums, total: nums[0] ?? null, hints: merchantHints(base), text: base, attachment: null };
  }
  const text = new TextDecoder().decode(bytes);
  return { name, kind: "text", from: null, subject: null, dates: findDates(text), amounts: findAmounts(text), total: findTotal(text), hints: merchantHints(base, text.split("\n").slice(0, 3).join(" ")), text, attachment: null };
}
