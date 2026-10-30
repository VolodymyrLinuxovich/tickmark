// Keyword parser. Used when no Anthropic key is set, when the model refuses or
// errors, and as the baseline the Claude parser is compared with in tests.

import type { AuditRequest, ParsedList, RequestType, Selection } from "./schema";
import { money, monthNumber, toIsoDate, type InputRow, type NormalizedInput } from "./input";

// Topics Ramp data cannot answer, even when the request mentions invoices, receipts or vendors.
const OUTSIDE_RAMP =
  /\b((?<!non-)payroll|w-[23]\b|fixed assets?|capital(ized)? assets?|pp&e|property and equipment|depreciation|bank (rec|statement|confirmation)|confirmation of (all )?bank|(all|operating) bank accounts?|covenant|revenue|customers?\b|sales invoices?|accounts receivable|receivables?|inventory|debt\b|loans?\b|notes payable|lease|equity|stock|board minutes|legal letters?|attorney|tax (returns?|filings?)|income tax|sales and use tax|accru|prepaid|insurance polic|deferred|\baging\b|\baged\b)/;

// Shorthand auditors use in terse lists.
const SHORTHAND: [RegExp, string][] = [
  [/\btxns?\b/g, "transactions"],
  [/\bpmts?\b/g, "payments"],
  [/\bdup\b/g, "duplicate"],
  [/\binvs?\b/g, "invoices"],
  [/\bw\//g, "with "],
  [/\bqtr\b/g, "quarter"],
];
/** Lowercases and expands shorthand so the keyword rules below only need full words. */
export const expandShorthand = (t: string) => SHORTHAND.reduce((s, [re, to]) => s.replace(re, to), t.toLowerCase());

/** Request type only. See classifyWithReason for the rule order. */
export function classify(text: string, hasSelections: boolean, area = ""): RequestType {
  return classifyWithReason(text, hasSelections, area).type;
}

const quote = (m: RegExpMatchArray | null) => (m ? `"${m[0].trim()}"` : "");

/** Request type plus the words that decided it, shown to the reviewer. */
export function classifyWithReason(text: string, hasSelections: boolean, area = ""): { type: RequestType; reason: string } {
  const t = expandShorthand(text);
  let m = t.match(OUTSIDE_RAMP);
  if (m) return { type: "unsupported", reason: `Mentions ${quote(m)}, which Ramp data does not cover` };
  m = area.toLowerCase().match(OUTSIDE_RAMP);
  if (m) return { type: "unsupported", reason: `Listed under ${quote(m)}, which Ramp data does not cover` };
  if ((m = t.match(/duplicate/))) return { type: "duplicate_payments", reason: `Mentions ${quote(m)}` };
  const missing = t.match(/(without|missing|no receipt|lack|not attached|n[o']t have|absent|unsupported by)/);
  if (/receipt/.test(t) && missing) return { type: "receipt_completeness", reason: `Mentions receipts and ${quote(missing)}` };
  m = t.match(/(split|their own|own (spend|purchases|transactions)|self[- ]?approv|segregation of duties|restricted|prohibited|merchant categor|\bmcc|circumvent|out[- ]of[- ]policy|policy violation|approved after|after (they were |it was )?paid|also the approver|approved by the (same (person|individual)|cardholder(?!'s))|approver is the same|approv\w*[^.]{0,40}(after|later than) the payment)/);
  if (m) return { type: "control_testing", reason: `Control test wording: ${quote(m)}` };
  m = t.match(/(vendor master|vendor list|list(ing)? of vendors|new vendors|vendors (created|added|onboarded|set up)|vendor additions)/);
  if (m) return { type: "vendor_listing", reason: `Mentions ${quote(m)}` };
  m = t.match(/(user access|administrator|admin (access|rights|roles?|permissions|privileges)|access (listing|rights|review)|users with|users and their roles|user listing|system access|list of users|users (in|of) the)/);
  if (m) return { type: "user_access", reason: `Mentions ${quote(m)}` };
  // A sample of vendor bills or disbursements with no card wording is bill support.
  m = t.match(/(\bbills?\b|vendor invoice|disbursement|accounts payable|\bap\b|checks? (?:written|issued)|check register)/);
  if (m && !/(card|amex|p-?card)/.test(t)) return { type: "bill_support", reason: `Mentions ${quote(m)} and no card spend` };
  const picked = t.match(/(selected|selection|sample|\bselect\b|following)/);
  const card = t.match(/(transaction|card|expense|charge|spend|refund|credit)/);
  if (picked && card) return { type: "transaction_support", reason: `Asks about ${quote(picked)} ${quote(card)} items` };
  m = t.match(/(\bbills?\b|invoice|vendor payment|accounts payable|disbursement|payments? to vendors)/);
  if (m) return { type: "bill_support", reason: `Mentions ${quote(m)}` };
  if (hasSelections && card) return { type: "transaction_support", reason: "Lists selected card items under the request" };
  return { type: "unsupported", reason: "No wording that matches a Ramp check" };
}

// ---------- thresholds ----------

const AMOUNT = String.raw`(?:\$|usd\s?)\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|mm|thousand|million)?\b`;
const BEFORE = new RegExp(String.raw`(?:over|above|exceed(?:ing|s)?|in excess of|greater than|more than|larger than|at least|at or above|equal to or greater than|>=?|≥)\s*` + AMOUNT, "i");
const AFTER = new RegExp(AMOUNT + String.raw`\)?\s?(?:\+|or more|and above|and over|or greater|and greater|or higher|plus)`, "i");
// "Card txns 100+": a bare number with a plus sign
const BARE_PLUS = /(?:^|\s)(\d{2,3}(?:,\d{3})*(?:\.\d+)?)\s?(k|m)?\+(?=\s|$)/i;

const scaled = (n: string, unit: string | undefined) => {
  const v = money(n);
  const u = unit?.toLowerCase();
  if (u === "k" || u === "thousand") return v * 1000;
  if (u === "m" || u === "mm" || u === "million") return v * 1_000_000;
  return v;
};

// "over ten thousand dollars"
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, "twenty-five": 25, fifty: 50, "one hundred": 100, hundred: 100 };
const IN_WORDS = new RegExp(String.raw`(?:over|above|exceed(?:ing|s)?|in excess of|greater than|more than)\s+(${Object.keys(COUNT_WORDS).join("|")})\s+(thousand|million)\s+dollars`, "i");

/**
 * Dollar amount the request filters on, e.g. "over $10K" or "$2,500 or more". A bare amount with no
 * comparison word ("the $5,000 approval limit") is a policy value, not a filter, so it is ignored.
 * When several match, the earliest one in the text wins.
 */
export function findThreshold(text: string): number | null {
  const words = text.match(IN_WORDS);
  const hits = [BEFORE, AFTER, BARE_PLUS].map((re) => text.match(re)).filter((m): m is RegExpMatchArray => !!m);
  if (words && !hits.some((h) => h.index! < words.index!)) return COUNT_WORDS[words[1].toLowerCase()] * (/thousand/i.test(words[2]) ? 1000 : 1_000_000);
  if (!hits.length) return null;
  const m = hits.sort((a, b) => a.index! - b.index!)[0];
  return Math.round(scaled(m[1], m[2]) * 100) / 100;
}

// ---------- periods ----------

export interface Period {
  from: string;
  to: string;
}

/** Month and day the fiscal year ends, e.g. { month: 6, day: 30 }. */
export interface FiscalYearEnd {
  month: number;
  day: number;
}

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const DATE = String.raw`(${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}-[a-z]{3}-\d{2,4})`;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dateOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Start of the N-month period that ends on `end` (ISO). */
function monthsBack(end: string, n: number): string {
  const [y, m, d] = end.split("-").map(Number);
  if (d !== lastDay(y, m)) {
    const s = new Date(Date.UTC(y, m - 1 - n, d + 1));
    return s.toISOString().slice(0, 10);
  }
  const s = new Date(Date.UTC(y, m - n, 1));
  return s.toISOString().slice(0, 10);
}

function wordDate(s: string): string | null {
  return toIsoDate(s.replace(/(\d)(st|nd|rd|th)/i, "$1").replace(/\s+/g, " ").replace(/^(\w+)\. /, "$1 "));
}

function fiscalYear(y: number, fye: FiscalYearEnd): Period {
  const to = dateOf(y, fye.month, Math.min(fye.day, lastDay(y, fye.month)));
  return { from: monthsBack(to, 12), to };
}

function fiscalQuarter(q: number, y: number, fye: FiscalYearEnd): Period {
  const endMonth = ((fye.month - 3 * (4 - q) - 1 + 120) % 12) + 1;
  const endYear = endMonth > fye.month ? y - 1 : y;
  const to = dateOf(endYear, endMonth, lastDay(endYear, endMonth));
  return { from: monthsBack(to, 3), to };
}

const fullYear = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

// "year ended December 31, 2025", "FYE 9/30/2025". PDF text often wraps between "year" and "ended".
const YEAR_END_DATE = new RegExp(String.raw`(?:\byear[-\s]?end(?:ed|ing)?|\bFYE)[\s:|,]*(?:on\s+)?${DATE}`, "i");

interface Rule {
  re: RegExp;
  read: (m: RegExpMatchArray, fye: FiscalYearEnd) => Period | null;
}

const PERIOD_RULES: Rule[] = [
  {
    // July 1 - December 31, 2025 / between January 1 and March 31, 2026: first date takes the second's year
    re: new RegExp(String.raw`(?:from|between|period)?\s*(${MONTH})\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:through|thru|to|until|and|-|–)\s*${DATE}`, "i"),
    read: (m) => {
      const to = wordDate(m[3]);
      const month = monthNumber(m[1].replace(".", ""));
      if (!to || !month) return null;
      let from = dateOf(Number(to.slice(0, 4)), month, Number(m[2]));
      if (from > to) from = dateOf(Number(to.slice(0, 4)) - 1, month, Number(m[2]));
      return toIsoDate(from) ? { from, to } : null;
    },
  },
  {
    // from October 1, 2024 through March 31, 2025 / between 1/1/2025 and 6/30/2025
    re: new RegExp(String.raw`(?:from|between|period)?\s*${DATE}\s*(?:through|thru|to|until|and|-|–)\s*${DATE}`, "i"),
    read: (m) => {
      const from = wordDate(m[1]);
      const to = wordDate(m[2]);
      return from && to && from < to ? { from, to } : null;
    },
  },
  {
    // April through September 2025 / Jan – Mar, 2026
    re: new RegExp(String.raw`\b(${MONTH})\s*(?:through|thru|to|until|-|–)\s*(${MONTH}),?\s+(\d{4})\b`, "i"),
    read: (m) => {
      const a = monthNumber(m[1].replace(".", ""));
      const b = monthNumber(m[2].replace(".", ""));
      const y = Number(m[3]);
      if (!a || !b) return null;
      const fromYear = a > b ? y - 1 : y;
      return { from: dateOf(fromYear, a, 1), to: dateOf(y, b, lastDay(y, b)) };
    },
  },
  {
    // six months ended June 30, 2025 / three-month period ending ...
    re: new RegExp(String.raw`\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})[- ]months?(?: period)? end(?:ed|ing)\s+${DATE}`, "i"),
    read: (m) => {
      const to = wordDate(m[2]);
      const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
      return to && n ? { from: monthsBack(to, n), to } : null;
    },
  },
  {
    re: new RegExp(String.raw`\bquarter end(?:ed|ing)\s+${DATE}`, "i"),
    read: (m) => {
      const to = wordDate(m[1]);
      return to ? { from: monthsBack(to, 3), to } : null;
    },
  },
  {
    // year ended December 31, 2025 / FYE 9/30/2025 / Year end: 12/31/2025
    re: YEAR_END_DATE,
    read: (m) => {
      const to = wordDate(m[1]);
      return to ? { from: monthsBack(to, 12), to } : null;
    },
  },
  {
    // Q4 2025, fourth quarter of fiscal 2025
    re: /\b(?:Q([1-4])|(first|second|third|fourth) quarter)(?:\s+of)?\s+(fiscal\s+(?:year\s+)?|FY\s?'?)?(\d{4}|\d{2}\b)/i,
    read: (m, fye) => {
      const q = m[1] ? Number(m[1]) : ["first", "second", "third", "fourth"].indexOf(m[2].toLowerCase()) + 1;
      const y = fullYear(m[4]);
      return fiscalQuarter(q, y, m[3] ? fye : { month: 12, day: 31 });
    },
  },
  {
    re: /\b(?:calendar(?: year)?|CY)\s?'?(\d{4}|\d{2}\b)/i,
    read: (m) => fiscalYear(fullYear(m[1]), { month: 12, day: 31 }),
  },
  {
    // FY2025, FY 25, fiscal 2025, fiscal year 2025, year ended 2025
    re: /\b(?:FY\s?'?|fiscal(?: year)?\s+|year end(?:ed|ing)?\s+)(\d{4}|\d{2}\b)/i,
    read: (m, fye) => fiscalYear(fullYear(m[1]), fye),
  },
  {
    // for September 2025, paid in December 2024, during the month of May 2025
    re: new RegExp(String.raw`\b(?:for|in|during)(?: the month of)?\s+(${MONTH})\s+(\d{4})\b`, "i"),
    read: (m) => {
      const month = monthNumber(m[1].replace(".", ""));
      const y = Number(m[2]);
      return month ? { from: dateOf(y, month, 1), to: dateOf(y, month, lastDay(y, month)) } : null;
    },
  },
];

/** Earliest period phrase in the text. `fye` sets what "FY2025" and fiscal quarters mean. */
export function findPeriod(text: string, fye: FiscalYearEnd = { month: 12, day: 31 }): Period | null {
  let best: { at: number; period: Period } | null = null;
  for (const rule of PERIOD_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    for (const m of text.matchAll(re)) {
      const at = m.index! + (m[0].length - m[0].trimStart().length);
      if (best && at >= best.at) break;
      const period = rule.read(m, fye);
      if (period) {
        best = { at, period };
        break;
      }
    }
  }
  return best?.period ?? null;
}

/**
 * The year end a document is about. A list can mention last year's ("journal entries for the year ended
 * 6/30/14") before its own, so the date stated most often wins, and the later one on a tie.
 */
export function statedYearEnd(text: string): string | null {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(new RegExp(YEAR_END_DATE.source, "gi"))) {
    const d = wordDate(m[1]);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
}

/**
 * The fiscal year that contains a date, as a period. Used to widen a balance date ("as of June 30, 2026")
 * into the year under audit, since a one day window would test almost nothing.
 */
export function fiscalYearContaining(date: string, fye: FiscalYearEnd): Period {
  const y = Number(date.slice(0, 4));
  const fy = fiscalYear(y, fye);
  return date <= fy.to ? fy : fiscalYear(y + 1, fye);
}

/** Fiscal year end stated anywhere in the document ("FYE June 30, 2025", "fiscal year ending 9/30/2025"). */
export function findFiscalYearEnd(text: string): FiscalYearEnd | null {
  const m = text.match(YEAR_END_DATE);
  const d = m ? wordDate(m[1]) : null;
  if (!d) {
    // "fiscal year end September 30", "a June 30 year end"
    const n =
      text.match(new RegExp(String.raw`\b(?:fiscal )?year[- ]end(?:s|ing)?(?: is| of| on)?\s+(${MONTH})\s+(\d{1,2})\b(?!,?\s*\d{4})`, "i")) ??
      text.match(new RegExp(String.raw`\b(${MONTH})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:fiscal\s+)?year[- ]end`, "i"));
    const month = n ? monthNumber(n[1].replace(".", "")) : null;
    return month ? { month, day: Number(n![2]) } : null;
  }
  const [, month, day] = d.split("-").map(Number);
  return { month, day };
}

// ---------- interpretation ----------

const INTERPRET: Record<RequestType, (r: { min: number | null; n: number }) => string> = {
  transaction_support: ({ n }) => `Match ${n || "the"} selected items to Ramp card transactions and pull receipt, approval and memo for each.`,
  bill_support: ({ min }) => `Pull invoice, approval history and payment for every bill${min ? ` of $${min.toLocaleString("en-US")} or more` : ""} in the period.`,
  receipt_completeness: ({ min }) => `List card transactions${min ? ` over $${min.toLocaleString("en-US")}` : ""} with no receipt attached.`,
  control_testing: () => "Test all card spend and bills for split purchases, self-approval, approval after payment and restricted merchant categories.",
  duplicate_payments: () => "Look for bills with the same vendor and invoice number, or the same vendor and amount within 7 days.",
  vendor_listing: () => "Export the vendor master and flag vendors paid within 14 days of being created.",
  user_access: () => "List Ramp users with owner, admin, bookkeeper or IT admin roles, with status and department.",
  unsupported: () => "Not answerable from Ramp data. Left for the team.",
};

/** One plain sentence on what Tickmark will pull from Ramp for this request, shown on the plan. */
export const interpret = (type: RequestType, min: number | null, n: number) => INTERPRET[type]({ min, n });

// ---------- selections typed into text ----------

const SEL_DATE = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Za-z]{3}-\d{2,4})/;
const SEL_AMOUNT = /(\(?-?\s?(?:\$|usd)?\s*-?\d[\d,]*\.\d{2}\)?|\(?-?\$\s*\d[\d,]*\)?)(?:\s+\S{1,8})?\s*$/i;
const SEL_REF = /^(?:#\s?)?([A-Z]{1,3}-?\d{1,4}|\d{1,4})[.):]?$/i;

/** One selection per line: "S-01 | 12/14/2025 | GOOGLE ADS | $4,641.49", "1  14-Dec-2025  GOOGLE ADS  $4,641.49". */
export function selectionFromLine(line: string): Selection | null {
  const t = line.trim().replace(/^[-*•]\s*/, "");
  if (!t || t.length > 160) return null;
  const amt = t.match(SEL_AMOUNT);
  const date = t.match(SEL_DATE);
  if (!amt || !date || date.index! > amt.index!) return null;
  const head = t.slice(0, date.index).replace(/[\s|,:;-]+$/, "").trim();
  const after = t.slice(date.index! + date[0].length, amt.index).replace(/^[\s|,:;-]+|[\s|,:;-]+$/g, "").trim();
  const amount = money(amt[1]);
  if (!Number.isFinite(amount) || !toIsoDate(date[1]) || SEL_DATE.test(after)) return null;
  if (!head || SEL_REF.test(head)) {
    if (!after) return null;
    return { ref: head ? head.match(SEL_REF)![1] : "", date: date[1], description: after, amount };
  }
  // "Kessler Mechanical, 07/18/2025, $48,250.00": a short description before the date
  if (after || head.length > 45 || head.split(/\s+/).length > 7) return null;
  return { ref: "", date: date[1], description: head, amount };
}

function selectionsFromText(text: string): Selection[] {
  const out: Selection[] = [];
  for (const line of text.split("\n")) {
    const s = selectionFromLine(line);
    if (s) out.push({ ...s, ref: s.ref || `S-${pad(out.length + 1)}` });
  }
  return out;
}

// ---------- free text (emails, pasted lists, PDFs) ----------

const HEADER_LINE = /^(from|sent|to|cc|bcc|subject|date|reply-to|importance):/i;
const WROTE_LINE = /^on .{6,120} wrote:\s*$/i;
const SIGN_OFF = /^(thanks|thank you|many thanks|best|best regards|regards|kind regards|cheers|sincerely|sent from my|--\s*$|__+)/i;
// Unnumbered bullets are requests unless they sit under a logistics heading or read like logistics.
const LOGISTICS_HEADING = /^(logistics|timing|timeline|schedule|next steps|reminders?|notes?|agenda|key dates|other notes)\b/i;
const LOGISTICS_BULLET = /^(fieldwork|please upload|upload|we('ll| will)|our (team|fieldwork)|let me know|feel free|the deadline|deadline|due date|call|meeting)\b/i;
const isHeading = (line: string) => line.trim().length <= 40 && !/[.,;:]$/.test(line.trim()) && !/^\s/.test(line);

interface Marker {
  ref: string | null; // null: number it in order
  bullet: boolean;
  rest: string;
  section?: string; // "1." / "(1)": may head lettered items
  sub?: boolean; // "a)" / "ii.": may sit under a numbered heading
}

function marker(line: string): Marker | null {
  let m = line.match(/^\s*(?:PBC|Request|Req\.?|Item)\s*[-#.]?\s*(\d{1,3}(?:\.\d{1,2})?[a-z]?)\b\s*[:.)-]?\s*(.*)$/i);
  if (m) return { ref: `PBC-${/^\d$/.test(m[1]) ? pad(Number(m[1])) : m[1]}`, bullet: false, rest: m[2] };
  m = line.match(/^\s*([A-Z]{1,4}-\d{1,3}(?:\.\d{1,2})?)(?:\s*[:.)-]\s*|\s+)(.*)$/);
  if (m) return { ref: m[1], bullet: false, rest: m[2] };
  m = line.match(/^\s*(\d{1,2}\.\d{1,2})[.)]?\s+(.*)$/);
  if (m) return { ref: m[1], bullet: false, rest: m[2] };
  m = line.match(/^\s*\(?(\d{1,2})[.)]\s+(.*)$/);
  if (m) return { ref: `PBC-${pad(Number(m[1]))}`, bullet: false, rest: m[2], section: String(Number(m[1])) };
  m = line.match(/^\s*\(?((?:x{0,3})(?:ix|iv|v?i{1,3}|v))[.)]\s+(.*)$/);
  if (m) return { ref: m[1], bullet: false, rest: m[2], sub: true };
  m = line.match(/^\s*\(?([a-z])\)\s+(.*)$/) ?? line.match(/^\s*([a-z])\.\s+(.*)$/);
  if (m) return { ref: m[1], bullet: false, rest: m[2], sub: true };
  m = line.match(/^\s*[-*•▪◦–]\s+(.*)$/);
  if (m) return { ref: null, bullet: true, rest: m[1] };
  return null;
}

/**
 * Splits an email, pasted list or PDF text into requests. A new request starts at a marker (PBC-01, 1., (1), a), i., AP-3, a bullet).
 * Lines without a marker continue the current request until a blank line. Quote markers (>) and email headers are stripped,
 * a sign-off ends the list, and dated amount lines become selections of the request above them. A numbered line that is only a
 * short heading ("4. Accounts Receivable:") followed by lettered items is a section: its items become 4.a, 4.b with the heading as area.
 */
export function splitFreeText(text: string): InputRow[] {
  const rows: InputRow[] = [];
  let cur: InputRow | null = null; // request still taking continuation lines
  let last: InputRow | null = null; // most recent request, for selection lines after a gap
  let gap = false;
  let heading = "";
  let section: { num: string; row: InputRow; title: string } | null = null;
  const sectionRows = new Set<InputRow>();
  const close = () => {
    cur = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/^(\s*>)+ ?/, "");
    if (HEADER_LINE.test(line.trim()) || WROTE_LINE.test(line.trim())) {
      close();
      continue;
    }
    if (!line.trim()) {
      gap = true;
      continue;
    }
    if (selectionFromLine(line)) {
      if (last) last.text += "\n" + line.trim();
      gap = false;
      continue;
    }
    if (SIGN_OFF.test(line.trim())) {
      close();
      last = null;
      gap = false;
      continue;
    }
    const mk = marker(line);
    if (mk && mk.rest.trim() && (!mk.bullet || !(LOGISTICS_HEADING.test(heading) || LOGISTICS_BULLET.test(mk.rest.trim())))) {
      const row: InputRow = { ref: mk.ref ?? `PBC-${pad(rows.length + 1)}`, area: "", text: mk.rest.trim(), period_from: null, period_to: null };
      if (mk.sub && section && section.row.text === section.title) {
        sectionRows.add(section.row);
        row.ref = `${section.num}.${mk.ref}`;
        row.area = section.title.replace(/\s*:$/, "");
      } else if (!mk.bullet && !mk.sub) {
        const title = mk.rest.trim();
        section = mk.section && title.length <= 80 && title.endsWith(":") ? { num: mk.section, row, title } : null;
      }
      rows.push(row);
      cur = row;
      last = row;
      gap = false;
      continue;
    }
    if (mk) close();
    else if (cur && !gap) cur.text += "\n" + line.trim();
    else {
      close();
      if (isHeading(line)) heading = line.trim();
    }
    gap = false;
  }
  return rows.filter((r) => !sectionRows.has(r));
}

// ---------- main ----------

const sameRef = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9.]/g, "") === b.toLowerCase().replace(/[^a-z0-9.]/g, "");

/**
 * Keyword parser. Runs on every list: it is the fallback when no model is available, and the model's
 * request count is checked against it. Period precedence: period columns, then the request text, then the
 * period stated for the whole document. Selections typed under a request stay with it; selections from a
 * separate sheet attach by their request column, or to every card request when there is none.
 */
/**
 * Table rows flattened into text, where each row carries its own ref somewhere in the line
 * ("FS/C-YE 01-General Items Y_PBC FSC-13 1 Bank reconciliations..."). A ref family (FSC, SA) counts when at
 * least five lines use it; a list can have several. Text after the ref (minus a leading item number) is the request; lines
 * up to the next ref continue it, except the leftover cells of the next row.
 */
export function splitEmbeddedRefs(text: string): InputRow[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const REF = /(?:^|\s)([A-Z]{2,6}-\d{1,3}[a-z]?)\s+(?:\d{1,3}(?:\.[a-z0-9]{1,4})?\.?\s+)?(\S.*)$/;
  const prefixes = new Map<string, number>();
  for (const l of lines) {
    const m = l.match(REF);
    if (m) prefixes.set(m[1].split("-")[0], (prefixes.get(m[1].split("-")[0]) ?? 0) + 1);
  }
  const families = new Set([...prefixes].filter(([, n]) => n >= 5).map(([p]) => p));
  if (!families.size) return [];
  const rows: InputRow[] = [];
  const cellStarts = new Set<string>(); // first words of the cells left of the ref, such as "FS/C-YE"
  let cur: InputRow | null = null;
  let junk = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(REF);
    if (m && families.has(m[1].split("-")[0])) {
      const before = line.slice(0, line.indexOf(m[1])).trim();
      if (before) cellStarts.add(before.split(/\s+/)[0]);
      cur = { ref: m[1], area: "", text: m[2].trim(), period_from: null, period_to: null };
      rows.push(cur);
      junk = false;
      continue;
    }
    // The next row's left cells can wrap onto lines of their own; skip them until its ref arrives.
    if (cellStarts.has(line.split(/\s+/)[0])) junk = true;
    if (cur && !junk) cur.text += "\n" + line;
  }
  return rows;
}

const ALL_CAPS = (line: string) => /[A-Z]{2}/.test(line) && line === line.toUpperCase() && line.length <= 60 && !/^\d+$/.test(line);

/**
 * A plain list with one item per line under ALL CAPS section headings and no numbers
 * ("ACCOUNTS PAYABLE" then "Listing - Checks (Various)"). Needs at least two headings, so an ordinary
 * email is never read this way. Lines before the first heading are the title block. A line that starts in
 * lower case continues the item above it.
 */
export function splitLineList(text: string): InputRow[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const headings = lines.filter(ALL_CAPS);
  if (headings.length < 2 || lines.length < 8) return [];
  const items = lines.filter((l) => !ALL_CAPS(l));
  // Long prose lines mean this is not a one-line-per-item list.
  if (items.filter((l) => l.length > 110).length > items.length * 0.2) return [];
  const rows: InputRow[] = [];
  let area: string | null = null;
  for (const line of lines) {
    if (ALL_CAPS(line)) {
      area = line;
      continue;
    }
    if (area === null || /^\d{1,3}$/.test(line) || /^page \d+/i.test(line)) continue;
    const prev = rows.at(-1);
    if (prev && /^[a-z(&]/.test(line)) prev.text += " " + line;
    else rows.push({ ref: `PBC-${pad(rows.length + 1)}`, area: area.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), text: line, period_from: null, period_to: null });
  }
  return rows;
}

/** How the rules parser found the requests. "lines" and "none" are the shapes a model reads better. */
export type SplitHow = "table" | "markers" | "embedded_refs" | "lines" | "none";

/** Splits normalized input into rows: the spreadsheet if there is one, else numbered items, rows with refs, or a plain line list. */
export function splitInput(input: NormalizedInput): { rows: InputRow[]; how: SplitHow } {
  if (input.rows.length) return { rows: input.rows, how: "table" };
  const marked = splitFreeText(input.text);
  // A few stray "1." lines in a table of refs should not win over the refs.
  const embedded = splitEmbeddedRefs(input.text);
  if (embedded.length > marked.length * 2) return { rows: embedded, how: "embedded_refs" };
  if (marked.length >= 2) return { rows: marked, how: "markers" };
  const listed = splitLineList(input.text);
  if (listed.length) return { rows: listed, how: "lines" };
  return { rows: marked, how: marked.length ? "markers" : "none" };
}

export function parseWithRules(input: NormalizedInput): ParsedList & { split: SplitHow } {
  const warnings: string[] = [];
  const { rows, how } = splitInput(input);
  if (!rows.length) warnings.push("No numbered requests found. Number each request (1. 2. 3.) or upload the PBC spreadsheet.");
  const fye = findFiscalYearEnd(input.text) ?? { month: 12, day: 31 };
  // A stated year end ("for the fiscal year ending June 30, 2026") is the document's period, ahead of a stray "FY25" earlier on.
  const statedTo = statedYearEnd(input.text);
  const globalPeriod = statedTo ? { from: monthsBack(statedTo, 12), to: statedTo } : findPeriod(input.text, fye);
  const linked = new Set(input.selections.filter((s) => s.request_ref && rows.some((r) => sameRef(r.ref, s.request_ref!))));
  const requests: AuditRequest[] = rows.map((row) => {
    const inline = selectionsFromText(row.text);
    const text = row.text.split("\n").filter((l) => !selectionFromLine(l)).join("\n").trim();
    const attached = input.selections
      .filter((s) => (linked.has(s) ? sameRef(s.request_ref!, row.ref) : true))
      .map(({ ref, date, description, amount }) => ({ ref, date, description, amount }));
    let { type, reason } = classifyWithReason(text, inline.length > 0, row.area);
    const ownSelections = inline.length ? inline : attached;
    // Dated amounts listed under a request are card selections, unless the topic is outside Ramp.
    const inScope = !OUTSIDE_RAMP.test(text.toLowerCase());
    if (type === "unsupported" && inScope && (inline.length || (attached.length && /transaction|card/i.test(text)))) {
      type = "transaction_support";
      reason = `Has ${(inline.length ? inline : attached).length} selected items`;
    }
    // Sheet selections go to card requests; selections typed under a bill request stay with it.
    const selections = type === "transaction_support" ? ownSelections : type === "bill_support" ? inline : [];
    const columnPeriod = row.period_text ? findPeriod(row.period_text, fye) : null;
    const period = row.period_from && row.period_to ? { from: row.period_from, to: row.period_to } : columnPeriod ?? findPeriod(text, fye) ?? globalPeriod;
    const columnMin = row.threshold ? findThreshold(row.threshold) ?? (money(row.threshold) > 0 ? money(row.threshold) : null) : null;
    const min = columnMin ?? findThreshold(text);
    return {
      ref: row.ref,
      text,
      type,
      period_from: period?.from ?? null,
      period_to: period?.to ?? null,
      min_amount: min,
      selections,
      interpretation: interpret(type, min, selections.length),
      reason,
    };
  });
  const auditor = input.text.match(/\b([A-Z][A-Za-z&]+(?: & [A-Z][a-z]+)?(?: LLP| & Co\.?| CPAs?))/)?.[1] ?? null;
  return { auditor, requests, parser: "rules", warnings, split: how };
}

export { toIsoDate };
