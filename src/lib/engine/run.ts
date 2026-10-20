// Answers one audit request from a Ramp snapshot. Every verdict here is plain
// code over Ramp records; the language model is only used upstream to parse
// the request list.

import type { AuditRequest } from "../parse/schema";
import { toIsoDate } from "../parse/input";
import type { RampApproval, RampBill, RampReceipt, RampSnapshot, RampTransaction, RampUser, RampVendor } from "../ramp/types";
import { monetaryUnitSample } from "./sampling";
import { findingId, type EvidenceRow, type Finding, type RecordRef, type RequestResult, type Tickmark } from "./types";

function centsFromEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : fallback;
}

export const POLICY = {
  // cents; card purchases above this need pre-approval
  cardApprovalLimit: centsFromEnv("TICKMARK_CARD_APPROVAL_LIMIT", 500000),
  // cents; receipts required at this amount and above
  receiptThreshold: centsFromEnv("TICKMARK_RECEIPT_THRESHOLD", 7500),
  receiptTolerance: (cents: number) => Math.max(100, Math.round(cents * 0.01)),
  splitWindowHours: 48,
  duplicateWindowDays: 7,
  fastPaymentDays: 14,
  restrictedMcc: {
    "5921": "Package stores, beer, wine and liquor",
    "5813": "Bars and nightclubs",
    "7995": "Betting and gambling",
    "5993": "Cigar stores",
    "5933": "Pawn shops",
    "7273": "Dating services",
  } as Record<string, string>,
};

export interface Index {
  snap: RampSnapshot;
  user: Map<string, RampUser>;
  receiptsByTxn: Map<string, RampReceipt[]>;
  approval: Map<string, RampApproval>;
  vendor: Map<string, RampVendor>;
}

export function buildIndex(snap: RampSnapshot): Index {
  const receiptsByTxn = new Map<string, RampReceipt[]>();
  for (const r of snap.receipts) {
    if (!r.transaction_id) continue;
    receiptsByTxn.set(r.transaction_id, [...(receiptsByTxn.get(r.transaction_id) ?? []), r]);
  }
  return {
    snap,
    user: new Map(snap.users.map((u) => [u.id, u])),
    receiptsByTxn,
    approval: new Map(snap.approvals.map((a) => [a.entity_id, a])),
    vendor: new Map(snap.vendors.map((v) => [v.id, v])),
  };
}

// ---------- formatting ----------
export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const name = (u?: { first_name?: string; last_name?: string } | null) => (u ? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() : "Unknown");
const txnRef = (t: RampTransaction): RecordRef => ({ type: "transaction", id: t.id, label: `${t.merchant_name} ${usd(t.entity_amount.value)} on ${shortDate(t.user_transaction_time)}` });
const billRef = (b: RampBill): RecordRef => ({ type: "bill", id: b.id, label: `${b.vendor.name} ${b.invoice_number ?? ""} ${usd(b.amount.amount)}`.replace(/\s+/g, " ") });

function inPeriod(iso: string | null | undefined, req: AuditRequest) {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return (!req.period_from || d >= req.period_from) && (!req.period_to || d <= req.period_to);
}

const APPROVED_STEP = /approv/i;
const NOT_APPROVED_STEP = /(unapprov|not.?approv|reject|declin|cancel|terminat|pending)/i;

/**
 * Latest completed approval step. Ramp's step_status is a free string, so match loosely.
 * Steps with no user are policy auto-approvals: they count as approved but trace to no person.
 */
export function lastApproval(ix: Index, id: string) {
  const a = ix.approval.get(id);
  const steps = (a?.approval_history ?? [])
    .filter((h) => APPROVED_STEP.test(h.step_status) && !NOT_APPROVED_STEP.test(h.step_status))
    .sort((x, y) => x.action_at.localeCompare(y.action_at));
  return { record: a, steps, last: steps.at(-1) };
}

const approverName = (ix: Index, step: { user_id: string | null; user_email: string | null }) =>
  step.user_id ? (ix.user.has(step.user_id) ? name(ix.user.get(step.user_id)) : step.user_email ?? "Unknown user") : "Auto-approved by policy";

function receiptTotal(r: RampReceipt): number | null {
  const items = r.ocr?.line_items ?? [];
  if (!items.length) return null;
  const sum = items.reduce((s, i) => s + (i.item_total_price ?? 0), 0) + (r.ocr?.taxes ?? []).reduce((s, t) => s + (t.tax_amount ?? 0), 0);
  return Math.round(sum * 100);
}

// ---------- per-record checks ----------
function checkTransaction(ix: Index, t: RampTransaction, opts: { approvals: boolean }): { findings: Finding[]; ticks: Tickmark[]; files: string[] } {
  const findings: Finding[] = [];
  const ticks: Tickmark[] = [];
  const holder = ix.user.get(t.card_holder.user_id);
  const owner = { user_id: t.card_holder.user_id, name: name(t.card_holder) };
  const cents = t.entity_amount.value;
  const receipts = ix.receiptsByTxn.get(t.id) ?? [];
  const files = receipts.map((r) => r.receipt_url);
  // The transaction lists receipt ids even when the receipt objects were not loaded.
  const hasReceipt = receipts.length > 0 || (t.receipts?.length ?? 0) > 0;

  if (!hasReceipt) {
    if (cents >= POLICY.receiptThreshold) {
      findings.push({
        id: findingId("MISSING_RECEIPT", [t.id]),
        code: "MISSING_RECEIPT",
        severity: "medium",
        title: `No receipt for ${usd(cents)} at ${t.merchant_name}`,
        detail: `Charged ${shortDate(t.user_transaction_time)} by ${owner.name}. Policy requires a receipt at ${usd(POLICY.receiptThreshold)} and above.`,
        records: [txnRef(t)],
        owner,
        comment: {
          object_type: "transactions",
          object_id: t.id,
          message: `Hi ${t.card_holder.first_name}, our auditors are testing this ${usd(cents)} charge at ${t.merchant_name} on ${shortDate(t.user_transaction_time)}. Ramp has no receipt for it. Could you upload the receipt to this transaction this week? If it is lost, please add a short note explaining the purchase. Thank you.`,
          mention_user_ids: [t.card_holder.user_id],
        },
      });
    }
  } else if (receipts.length) {
    const ocr = receipts.map(receiptTotal).filter((x): x is number => x != null);
    const matched = ocr.some((v) => Math.abs(v - cents) <= POLICY.receiptTolerance(cents));
    if (ocr.length && !matched) {
      findings.push({
        id: findingId("RECEIPT_MISMATCH", [t.id]),
        code: "RECEIPT_MISMATCH",
        severity: "high",
        title: `Receipt shows ${usd(ocr[0])}, card charged ${usd(cents)}`,
        detail: `${t.merchant_name} on ${shortDate(t.user_transaction_time)}, ${owner.name}. Difference of ${usd(Math.abs(cents - ocr[0]))}.`,
        records: [txnRef(t), { type: "receipt", id: receipts[0].id, label: "Receipt" }],
        owner,
        comment: {
          object_type: "transactions",
          object_id: t.id,
          message: `Hi ${t.card_holder.first_name}, the receipt on this ${t.merchant_name} charge shows ${usd(ocr[0])}, but the card was charged ${usd(cents)}. Could you attach the final folio or itemized receipt, or explain the difference? Our auditors asked about this one. Thank you.`,
          mention_user_ids: [t.card_holder.user_id],
        },
      });
    } else if (ocr.length) ticks.push("R");
  }

  if (opts.approvals) {
    const { last } = lastApproval(ix, t.id);
    if (!last) {
      findings.push({
        id: findingId("NOT_APPROVED", [t.id]),
        code: "NOT_APPROVED",
        severity: "high",
        title: `No approval recorded for ${usd(cents)} at ${t.merchant_name}`,
        detail: `Ramp has no completed approval step for this transaction.`,
        records: [txnRef(t)],
        owner,
      });
    } else if (last.user_id && last.user_id === t.card_holder.user_id) {
      findings.push({
        id: findingId("SELF_APPROVAL", [t.id]),
        code: "SELF_APPROVAL",
        severity: "high",
        title: `${owner.name} approved their own ${usd(cents)} charge`,
        detail: `${t.merchant_name} on ${shortDate(t.user_transaction_time)}.`,
        records: [txnRef(t)],
        owner,
      });
    } else ticks.push("A");
  }
  if (t.memo && t.memo.trim()) ticks.push("M");

  const mcc = t.merchant_category_code ?? "";
  if (POLICY.restrictedMcc[mcc]) {
    findings.push({
      id: findingId("RESTRICTED_MCC", [t.id]),
      code: "RESTRICTED_MCC",
      severity: "medium",
      title: `${usd(cents)} at ${t.merchant_name} (${POLICY.restrictedMcc[mcc].toLowerCase()})`,
      detail: `Merchant category ${mcc}. ${t.memo ? `Memo: "${t.memo}".` : "No business purpose given."} Charged by ${owner.name}${holder ? `, ${t.card_holder.department_name ?? ""}` : ""}.`,
      records: [txnRef(t)],
      owner,
      comment: {
        object_type: "transactions",
        object_id: t.id,
        message: `Hi ${t.card_holder.first_name}, this ${usd(cents)} purchase at ${t.merchant_name} on ${shortDate(t.user_transaction_time)} is in a restricted merchant category. Could you add the business purpose and attendees, or let us know if it was personal so we can arrange repayment? Thank you.`,
        mention_user_ids: [t.card_holder.user_id],
      },
    });
  }
  return { findings, ticks: findings.length ? [...ticks, "X"] : ticks, files };
}

function checkBill(ix: Index, b: RampBill): { findings: Finding[]; ticks: Tickmark[]; files: string[] } {
  const findings: Finding[] = [];
  const ticks: Tickmark[] = [];
  const files = b.attachments.filter((a) => a.attachment_type === "INVOICE" || a.attachment_type === "FILE").map((a) => a.url);
  const ownerName = name(b.bill_owner);
  const owner = { user_id: b.bill_owner.id, name: ownerName };
  if (files.length) ticks.push("I");
  else
    findings.push({
      id: findingId("MISSING_INVOICE", [b.id]),
      code: "MISSING_INVOICE",
      severity: "medium",
      title: `No invoice attached to ${b.vendor.name} bill for ${usd(b.amount.amount)}`,
      detail: `Bill ${b.invoice_number ?? "without invoice number"}, issued ${shortDate(b.issued_at)}.`,
      records: [billRef(b)],
      owner,
    });

  const { last } = lastApproval(ix, b.id);
  if (!last) {
    findings.push({
      id: findingId("NO_APPROVAL", [b.id]),
      code: "NO_APPROVAL",
      severity: "high",
      title: `${b.vendor.name} bill for ${usd(b.amount.amount)} has no approval`,
      detail: b.paid_at ? `Paid ${shortDate(b.paid_at)} with no completed approval step.` : "No completed approval step.",
      records: [billRef(b)],
      owner,
    });
  } else {
    if (last.user_id && last.user_id === b.bill_owner.id) {
      findings.push({
        id: findingId("SELF_APPROVAL", [b.id]),
        code: "SELF_APPROVAL",
        severity: "high",
        title: `${ownerName} approved their own ${usd(b.amount.amount)} bill`,
        detail: `${b.vendor.name} ${b.invoice_number ?? ""}. The bill owner was the only approver on ${shortDate(last.action_at)}.`,
        records: [billRef(b)],
        owner,
        comment: {
          object_type: "bills",
          object_id: b.id,
          message: `This ${usd(b.amount.amount)} ${b.vendor.name} bill was approved by its owner, ${ownerName}. Our auditors will ask for an independent review. Could a second approver review the invoice and record approval in Ramp? Thank you.`,
          mention_user_ids: [],
        },
      });
    } else ticks.push("A");
    if (b.paid_at && new Date(last.action_at) > new Date(b.paid_at)) {
      findings.push({
        id: findingId("APPROVAL_AFTER_PAYMENT", [b.id]),
        code: "APPROVAL_AFTER_PAYMENT",
        severity: "high",
        title: `${b.vendor.name} bill paid ${shortDate(b.paid_at)}, approved ${shortDate(last.action_at)}`,
        detail: `${usd(b.amount.amount)} left the account before ${approverName(ix, last)} approved it.`,
        records: [billRef(b)],
        owner,
        comment: {
          object_type: "bills",
          object_id: b.id,
          message: `This ${usd(b.amount.amount)} ${b.vendor.name} bill was paid on ${shortDate(b.paid_at)} but approved on ${shortDate(last.action_at)}. Could you add a note explaining why payment was released before approval? Our auditors will ask. Thank you.`,
          mention_user_ids: [],
        },
      });
    }
  }
  if (b.paid_at) ticks.push("P");
  return { findings, ticks: findings.length ? [...ticks, "X"] : ticks, files };
}

// ---------- population-wide checks ----------
export function splitPurchases(ix: Index, txns: RampTransaction[]): Finding[] {
  const out: Finding[] = [];
  const groups = new Map<string, RampTransaction[]>();
  for (const t of txns) {
    if (t.entity_amount.value <= 0 || t.entity_amount.value > POLICY.cardApprovalLimit) continue;
    const k = `${t.card_holder.user_id}|${t.merchant_name.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const seen = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.user_transaction_time.localeCompare(b.user_transaction_time));
    for (let i = 0; i < g.length; i++) {
      const cluster = [g[i]];
      for (let j = i + 1; j < g.length; j++) {
        const hours = (new Date(g[j].user_transaction_time).getTime() - new Date(g[i].user_transaction_time).getTime()) / 3.6e6;
        if (hours <= POLICY.splitWindowHours) cluster.push(g[j]);
      }
      const total = cluster.reduce((s, t) => s + t.entity_amount.value, 0);
      if (cluster.length < 2 || total <= POLICY.cardApprovalLimit) continue;
      const ids = cluster.map((t) => t.id);
      const id = findingId("SPLIT_PURCHASE", ids);
      if (seen.has(id) || ids.some((x) => [...seen].some((s) => s.includes(x)))) continue;
      seen.add(id);
      const t0 = cluster[0];
      out.push({
        id,
        code: "SPLIT_PURCHASE",
        severity: "high",
        title: `Possible split purchase: ${cluster.length} charges at ${t0.merchant_name} totaling ${usd(total)}`,
        detail: `${name(t0.card_holder)} made ${cluster.map((t) => usd(t.entity_amount.value)).join(" and ")} within ${POLICY.splitWindowHours} hours. Each is under the ${usd(POLICY.cardApprovalLimit)} card approval limit; together they exceed it.`,
        records: cluster.map(txnRef),
        owner: { user_id: t0.card_holder.user_id, name: name(t0.card_holder) },
        comment: {
          object_type: "transactions",
          object_id: t0.id,
          message: `Hi ${t0.card_holder.first_name}, these ${t0.merchant_name} charges on ${shortDate(t0.user_transaction_time)} (${cluster.map((t) => usd(t.entity_amount.value)).join(", ")}) add up to ${usd(total)}, above the ${usd(POLICY.cardApprovalLimit)} limit that needs pre-approval. Was this one order? If so, please submit a spend request so the purchase is approved on record. Thank you.`,
          mention_user_ids: [t0.card_holder.user_id],
        },
      });
    }
  }
  return out;
}

export function duplicateBills(all: RampBill[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const byVendor = new Map<string, RampBill[]>();
  for (const b of all) if (!b.archived_at) byVendor.set(b.vendor.id, [...(byVendor.get(b.vendor.id) ?? []), b]);
  for (const bills of byVendor.values())
  for (let i = 0; i < bills.length; i++) {
    for (let j = i + 1; j < bills.length; j++) {
      const a = bills[i];
      const b = bills[j];
      const sameInvoice = !!a.invoice_number && a.invoice_number === b.invoice_number;
      const days = Math.abs(new Date(a.issued_at).getTime() - new Date(b.issued_at).getTime()) / 864e5;
      const sameAmountNear = a.amount.amount === b.amount.amount && days <= POLICY.duplicateWindowDays;
      if (!sameInvoice && !sameAmountNear) continue;
      const id = findingId("DUPLICATE_INVOICE", [a.id, b.id]);
      if (seen.has(id)) continue;
      seen.add(id);
      const paid = [a, b].filter((x) => x.paid_at);
      out.push({
        id,
        code: "DUPLICATE_INVOICE",
        severity: "high",
        title: `${a.vendor.name} ${sameInvoice ? `invoice ${a.invoice_number}` : `${usd(a.amount.amount)} bill`} entered twice`,
        detail: `${sameInvoice ? "Same vendor and invoice number" : "Same vendor and amount within a week"}. ${paid.length === 2 ? `Paid twice: ${shortDate(paid[0].paid_at!)} and ${shortDate(paid[1].paid_at!)}, ${usd(a.amount.amount + b.amount.amount)} in total.` : `${paid.length} of 2 paid.`}`,
        records: [billRef(a), billRef(b)],
        owner: { user_id: b.bill_owner.id, name: name(b.bill_owner) },
        comment: {
          object_type: "bills",
          object_id: b.id,
          message: `This bill looks like a duplicate of ${a.vendor.name} ${a.invoice_number ?? ""} (${usd(a.amount.amount)}), ${paid.length === 2 ? "and both were paid" : "entered twice"}. Could you confirm with the vendor and request a credit or refund if it was paid twice? Thank you.`.replace(/\s+/g, " "),
          mention_user_ids: [],
        },
      });
    }
  }
  return out;
}

export function fastPaidNewVendors(ix: Index, bills: RampBill[], req: AuditRequest): Finding[] {
  const out: Finding[] = [];
  for (const v of ix.snap.vendors) {
    if (!inPeriod(v.created_at, req)) continue;
    const paid = bills.filter((b) => b.vendor.id === v.id && b.paid_at).sort((a, b) => a.paid_at!.localeCompare(b.paid_at!));
    if (!paid.length) continue;
    const days = (new Date(paid[0].paid_at!).getTime() - new Date(v.created_at).getTime()) / 864e5;
    if (days > POLICY.fastPaymentDays) continue;
    const b = paid[0];
    out.push({
      id: findingId("NEW_VENDOR_FAST_PAYMENT", [b.id]),
      code: "NEW_VENDOR_FAST_PAYMENT",
      severity: "medium",
      title: `New vendor ${v.name} paid ${usd(b.amount.amount)} ${Math.max(0, Math.round(days))} days after setup`,
      detail: `Vendor created ${shortDate(v.created_at)}, first payment ${shortDate(b.paid_at!)}. Auditors look for vendor due diligence (W-9, bank verification) before a fast first payment.`,
      records: [billRef(b), { type: "vendor", id: v.id, label: v.name }],
      owner: { user_id: b.bill_owner.id, name: name(b.bill_owner) },
      comment: {
        object_type: "bills",
        object_id: b.id,
        message: `${v.name} was set up on ${shortDate(v.created_at)} and paid ${usd(b.amount.amount)} on ${shortDate(b.paid_at!)}. Could you attach the W-9 and the bank account verification for this vendor? Our auditors will ask for both. Thank you.`,
        mention_user_ids: [],
      },
    });
  }
  return out;
}

// ---------- selection matching ----------
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);

export function matchSelection(ix: Index, sel: { date: string; description: string; amount: number }): { txn: RampTransaction; score: number } | null {
  const cents = Math.round(sel.amount * 100);
  const d = toIsoDate(sel.date);
  const want = tokens(sel.description);
  let best: { txn: RampTransaction; score: number } | null = null;
  for (const t of ix.snap.transactions) {
    if (t.entity_amount.value !== cents) continue;
    const dates = [t.user_transaction_time, t.accounting_date].filter(Boolean).map((x) => x!.slice(0, 10));
    const dayGap = d ? Math.min(...dates.map((x) => Math.abs(new Date(x).getTime() - new Date(d).getTime()) / 864e5)) : 0;
    if (dayGap > 5) continue;
    const have = new Set(tokens(`${t.merchant_name} ${t.card_holder.first_name} ${t.card_holder.last_name}`));
    const overlap = want.filter((w) => [...have].some((h) => h.startsWith(w) || w.startsWith(h))).length;
    const score = 10 - dayGap + overlap * 3;
    if (!best || score > best.score) best = { txn: t, score };
  }
  return best;
}

// ---------- request handlers ----------
const dedupe = (fs: Finding[]) => [...new Map(fs.map((f) => [f.id, f])).values()];

function result(request: AuditRequest, r: Omit<RequestResult, "request" | "status" | "headline"> & { headline?: string }): RequestResult {
  const findings = dedupe(r.findings);
  return {
    request,
    status: findings.length ? "exceptions" : "complete",
    headline: r.headline ?? (findings.length ? `${findings.length} exception${findings.length > 1 ? "s" : ""} in ${r.tested} items tested` : `${r.tested} items tested, no exceptions`),
    ...r,
    findings,
  };
}

const txnCells = (t: RampTransaction, ix: Index) => {
  const { last } = lastApproval(ix, t.id);
  return [
    shortDate(t.user_transaction_time),
    t.merchant_name,
    name(t.card_holder),
    usd(t.entity_amount.value),
    (ix.receiptsByTxn.get(t.id)?.length ?? 0) > 0 || t.receipts?.length ? "Attached" : "None",
    last ? `${approverName(ix, last)}, ${shortDate(last.action_at)}` : "None",
    t.memo ?? "",
  ];
};
const TXN_COLS = ["Date", "Merchant", "Cardholder", "Amount", "Receipt", "Approved by", "Business purpose"];

const billCells = (b: RampBill, ix: Index) => {
  const { last } = lastApproval(ix, b.id);
  return [
    b.vendor.name,
    b.invoice_number ?? "",
    shortDate(b.issued_at),
    usd(b.amount.amount),
    last ? `${approverName(ix, last)}, ${shortDate(last.action_at)}` : "None",
    b.paid_at ? `${shortDate(b.paid_at)} ${b.payment?.payment_method ?? ""}`.trim() : "Open",
  ];
};
const BILL_COLS = ["Vendor", "Invoice", "Issued", "Amount", "Approved by", "Paid"];

export function runRequest(req: AuditRequest, ix: Index): RequestResult {
  const snap = ix.snap;
  const txns = snap.transactions.filter((t) => (t.state === "CLEARED" || t.state === "COMPLETION") && inPeriod(t.user_transaction_time, req));
  const bills = snap.bills.filter((b) => inPeriod(b.issued_at, req) || inPeriod(b.paid_at, req));
  const minCents = req.min_amount != null ? Math.round(req.min_amount * 100) : null;

  switch (req.type) {
    case "transaction_support": {
      const rows: EvidenceRow[] = [];
      const findings: Finding[] = [];
      let picked: RampTransaction[] = [];
      const procedure: string[] = [];
      if (req.selections.length) {
        procedure.push(`Matched ${req.selections.length} auditor selections to Ramp card transactions by amount, date (within 5 days of transaction or posting date) and description.`);
        for (const sel of req.selections) {
          const m = matchSelection(ix, sel);
          if (!m) {
            const f: Finding = {
              id: findingId("SELECTION_NOT_FOUND", [sel.ref]),
              code: "SELECTION_NOT_FOUND",
              severity: "medium",
              title: `${sel.ref}: no Ramp transaction for ${usd(Math.round(sel.amount * 100))} on ${sel.date}`,
              detail: `"${sel.description}" may be a bank or ERP entry outside Ramp. Pull support from the source system.`,
              records: [],
            };
            findings.push(f);
            rows.push({ record: { type: "transaction", id: "", label: sel.ref }, cells: [sel.ref, sel.date, sel.description, "", usd(Math.round(sel.amount * 100)), "", "", "Not found in Ramp"], tickmarks: ["X"], finding_ids: [f.id], files: [] });
            continue;
          }
          picked.push(m.txn);
          const c = checkTransaction(ix, m.txn, { approvals: true });
          findings.push(...c.findings);
          rows.push({ record: { ...txnRef(m.txn), label: `${sel.ref} ${txnRef(m.txn).label}` }, cells: [sel.ref, ...txnCells(m.txn, ix)], tickmarks: c.ticks, finding_ids: c.findings.map((f) => f.id), files: c.files });
        }
      } else {
        const n = Number(req.text.match(/(?:sample of|select|pull)\s+(\d+)/i)?.[1] ?? 25);
        const pop = txns.filter((t) => minCents == null || t.entity_amount.value >= minCents);
        const s = monetaryUnitSample(pop.map((t) => ({ id: t.id, amount: t.entity_amount.value })), n, 2025);
        picked = pop.filter((t) => s.selected.includes(t.id));
        procedure.push(`Drew a monetary unit sample of ${picked.length} from ${pop.length} card transactions (${usd(pop.reduce((a, t) => a + t.entity_amount.value, 0))}). Interval ${usd(Math.round(s.interval))}, seeded random start ${usd(Math.round(s.start))}, ${s.topStratum.length} items above the interval selected in full.`);
        for (const t of picked) {
          const c = checkTransaction(ix, t, { approvals: true });
          findings.push(...c.findings);
          rows.push({ record: txnRef(t), cells: txnCells(t, ix), tickmarks: c.ticks, finding_ids: c.findings.map((f) => f.id), files: c.files });
        }
      }
      procedure.push(`Agreed each item to its receipt (OCR total within ${usd(100)} or 1%), traced the approval step to the approver and date, and checked the business purpose memo.`);
      return result(req, { procedure, columns: req.selections.length ? ["Ref", ...TXN_COLS] : TXN_COLS, rows, findings, population: txns.length, tested: rows.length });
    }

    case "bill_support": {
      const sel = bills.filter((b) => (minCents == null || b.amount.amount >= minCents) && (b.paid_at ? inPeriod(b.paid_at, req) : true));
      const rows: EvidenceRow[] = [];
      const findings: Finding[] = [];
      for (const b of sel) {
        const c = checkBill(ix, b);
        findings.push(...c.findings);
        rows.push({ record: billRef(b), cells: billCells(b, ix), tickmarks: c.ticks, finding_ids: c.findings.map((f) => f.id), files: c.files });
      }
      return result(req, {
        procedure: [
          `Selected all ${sel.length} bills${minCents ? ` of ${usd(minCents)} or more` : ""} issued or paid in the period.`,
          "Obtained the invoice attachment, traced the approval to the approver and date, confirmed approval came before payment and that the approver was not the bill owner, and traced the payment.",
        ],
        columns: BILL_COLS,
        rows,
        findings,
        population: bills.length,
        tested: rows.length,
      });
    }

    case "receipt_completeness": {
      const threshold = minCents ?? POLICY.receiptThreshold;
      const missing = txns.filter((t) => t.entity_amount.value >= threshold && !(ix.receiptsByTxn.get(t.id)?.length) && !t.receipts?.length);
      const findings = missing.flatMap((t) => checkTransaction(ix, t, { approvals: false }).findings.filter((f) => f.code === "MISSING_RECEIPT"));
      return result(req, {
        headline: missing.length ? `${missing.length} of ${txns.filter((t) => t.entity_amount.value >= threshold).length} card transactions over ${usd(threshold)} have no receipt` : `Every card transaction over ${usd(threshold)} has a receipt`,
        procedure: [`Tested all ${txns.length} cleared card transactions in the period for an attached receipt at ${usd(threshold)} and above.`],
        columns: TXN_COLS,
        rows: missing.map((t) => ({ record: txnRef(t), cells: txnCells(t, ix), tickmarks: ["X"], finding_ids: [findingId("MISSING_RECEIPT", [t.id])], files: [] })),
        findings,
        population: txns.length,
        tested: txns.length,
      });
    }

    case "control_testing": {
      const findings: Finding[] = [...splitPurchases(ix, txns)];
      for (const t of txns) {
        const c = checkTransaction(ix, t, { approvals: true });
        findings.push(...c.findings.filter((f) => f.code === "SELF_APPROVAL" || f.code === "RESTRICTED_MCC" || f.code === "NOT_APPROVED"));
      }
      for (const b of bills) {
        const c = checkBill(ix, b);
        findings.push(...c.findings.filter((f) => f.code === "SELF_APPROVAL" || f.code === "APPROVAL_AFTER_PAYMENT" || f.code === "NO_APPROVAL"));
      }
      const fs = dedupe(findings);
      return result(req, {
        headline: fs.length ? `${fs.length} control exceptions across ${txns.length + bills.length} card transactions and bills` : `No control exceptions across ${txns.length + bills.length} records`,
        procedure: [
          `Split purchases: grouped ${txns.length} card transactions by cardholder and merchant and flagged charges within ${POLICY.splitWindowHours} hours that are each under the ${usd(POLICY.cardApprovalLimit)} approval limit but exceed it together.`,
          "Segregation of duties: compared the final approver with the cardholder on every transaction and with the bill owner on every bill.",
          `Approval timing: compared approval time with payment time on ${bills.filter((b) => b.paid_at).length} paid bills.`,
          `Restricted merchants: screened merchant category codes against ${Object.keys(POLICY.restrictedMcc).join(", ")}.`,
        ],
        columns: ["Test", "Exception", "Records", "Owner"],
        rows: fs.map((f) => ({ record: f.records[0], cells: [f.code.replaceAll("_", " ").toLowerCase(), f.title, f.records.map((r) => r.label).join("; "), f.owner?.name ?? ""], tickmarks: ["X"], finding_ids: [f.id], files: [] })),
        findings: fs,
        population: txns.length + bills.length,
        tested: txns.length + bills.length,
      });
    }

    case "duplicate_payments": {
      const findings = duplicateBills(bills);
      return result(req, {
        headline: findings.length ? `${findings.length} likely duplicate bill${findings.length > 1 ? "s" : ""} in ${bills.length}` : `No duplicates in ${bills.length} bills`,
        procedure: [`Compared all ${bills.length} bills in the period pairwise for the same vendor and invoice number, or the same vendor and amount issued within ${POLICY.duplicateWindowDays} days.`],
        columns: BILL_COLS,
        rows: findings.flatMap((f) => f.records.map((r) => snap.bills.find((b) => b.id === r.id)!).map((b) => ({ record: billRef(b), cells: billCells(b, ix), tickmarks: ["X"] as Tickmark[], finding_ids: [f.id], files: b.attachments.map((a) => a.url) }))),
        findings,
        population: bills.length,
        tested: bills.length,
      });
    }

    case "vendor_listing": {
      const vendors = [...snap.vendors].sort((a, b) => a.name.localeCompare(b.name));
      const findings = fastPaidNewVendors(ix, snap.bills, req);
      const spend = (v: RampVendor) => snap.bills.filter((b) => b.vendor.id === v.id && b.paid_at && inPeriod(b.paid_at, req)).reduce((s, b) => s + b.amount.amount, 0);
      const added = vendors.filter((v) => inPeriod(v.created_at, req));
      return result(req, {
        headline: `${vendors.length} vendors, ${added.length} added in the period${findings.length ? `, ${findings.length} paid within ${POLICY.fastPaymentDays} days of setup` : ""}`,
        procedure: [
          "Exported the full vendor master from Ramp with creation date, category and payments in the period.",
          `Flagged vendors created in the period whose first payment came within ${POLICY.fastPaymentDays} days.`,
        ],
        columns: ["Vendor", "Category", "Created", "Added in period", "Paid in period"],
        rows: vendors.map((v) => {
          const f = findings.find((x) => x.records.some((r) => r.id === v.id));
          return { record: { type: "vendor", id: v.id, label: v.name }, cells: [v.name, v.sk_category_name ?? "", shortDate(v.created_at), inPeriod(v.created_at, req) ? "Yes" : "", usd(spend(v))], tickmarks: f ? ["X"] : [], finding_ids: f ? [f.id] : [], files: [] };
        }),
        findings,
        population: vendors.length,
        tested: vendors.length,
      });
    }

    case "user_access": {
      const privileged = ["BUSINESS_OWNER", "BUSINESS_ADMIN", "BUSINESS_BOOKKEEPER", "IT_ADMIN", "AUDITOR"];
      const users = snap.users.filter((u) => privileged.includes(u.role)).sort((a, b) => privileged.indexOf(a.role) - privileged.indexOf(b.role));
      const dept = (id: string | null) => snap.departments.find((d) => d.id === id)?.name ?? "";
      const inactive = users.filter((u) => u.status !== "USER_ACTIVE");
      return result(req, {
        headline: `${users.length} users with elevated access${inactive.length ? `, ${inactive.length} no longer active` : ""}`,
        procedure: ["Listed every Ramp user with the owner, admin, bookkeeper, IT admin or auditor role, with status and department, as of the date of this binder."],
        columns: ["Name", "Email", "Role", "Status", "Department"],
        rows: users.map((u) => ({ record: { type: "user", id: u.id, label: name(u) }, cells: [name(u), u.email, u.role.replaceAll("_", " ").toLowerCase(), u.status.replace("USER_", "").toLowerCase(), dept(u.department_id)], tickmarks: [], finding_ids: [], files: [] })),
        findings: [],
        population: snap.users.length,
        tested: users.length,
      });
    }

    case "unsupported":
    default:
      return {
        request: req,
        status: "manual",
        headline: "Outside Ramp data. Assigned to the finance team.",
        procedure: ["Ramp holds card, bill, vendor and user data. This request needs another system."],
        columns: [],
        rows: [],
        findings: [],
        population: 0,
        tested: 0,
      };
  }
}

export function runAll(reqs: AuditRequest[], snap: RampSnapshot): RequestResult[] {
  const ix = buildIndex(snap);
  return reqs.map((r) => runRequest(r, ix));
}

export function uniqueFindings(results: RequestResult[]): Finding[] {
  return dedupe(results.flatMap((r) => r.findings));
}
