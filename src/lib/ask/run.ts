// Runs a query plan on a Ramp snapshot. Pure code: every row returned is a real Ramp record.

import type { RampSnapshot } from "../ramp/types";
import { buildIndex, lastApproval, usd, type Index } from "../engine/run";
import type { RecordRef } from "../engine/types";
import type { Filter, Plan, Vocab } from "./plan";

export interface AskRow {
  record: RecordRef;
  cells: string[];
}

export interface AskResult {
  title: string;
  entity: Plan["entity"];
  columns: string[];
  rows: AskRow[];
  total: number; // matches before the limit
  sum: number | null; // cents, for money entities
  filters: string[]; // the plan in plain words, shown to the user
}

type Val = string | number | boolean | null;
type Getter = (field: Filter["field"]) => Val;

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function test(get: Getter, f: Filter): boolean {
  const v = get(f.field);
  if (f.op === "is_true") return v === true;
  if (f.op === "is_false") return v === false;
  if (v === null || v === undefined || f.value === null) return false;
  if (f.field === "amount") {
    const a = Number(v) / 100;
    const b = Number(String(f.value).replace(/[$,]/g, ""));
    return f.op === "gt" ? a > b : f.op === "gte" ? a >= b : f.op === "lt" ? a < b : f.op === "lte" ? a <= b : f.op === "eq" ? Math.abs(a - b) < 0.005 : false;
  }
  if (f.op === "on_or_after") return String(v) >= f.value;
  if (f.op === "on_or_before") return String(v) <= f.value;
  if (f.op === "contains") return String(v).toLowerCase().includes(f.value.toLowerCase());
  if (f.op === "eq") return String(v).toLowerCase() === f.value.toLowerCase();
  const n = Number(v);
  const m = Number(f.value);
  return f.op === "gt" ? n > m : f.op === "gte" ? n >= m : f.op === "lt" ? n < m : f.op === "lte" ? n <= m : false;
}

const OP_WORDS: Record<Filter["op"], string> = { gt: "over", gte: "at least", lt: "under", lte: "at most", eq: "is", contains: "includes", is_true: "", is_false: "not", on_or_after: "on or after", on_or_before: "on or before" };
const FIELD_WORDS: Partial<Record<Filter["field"], string>> = { has_memo: "has a memo", has_receipt: "has a receipt", approved: "approved", is_weekend: "on a weekend", is_round: "a round amount", paid: "paid" };

export function describeFilter(f: Filter): string {
  if (f.op === "is_true") return FIELD_WORDS[f.field] ?? f.field;
  if (f.op === "is_false") return `not ${FIELD_WORDS[f.field] ?? f.field}`.replace("not has", "no").replace(" a memo", " memo").replace(" a receipt", " receipt");
  const val = f.field === "amount" ? `$${Number(f.value).toLocaleString("en-US")}` : f.value;
  return `${f.field.replace("_", " ")} ${OP_WORDS[f.op]} ${val}`;
}

export function vocabulary(snap: RampSnapshot): Vocab {
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    merchants: uniq(snap.transactions.map((t) => t.merchant_name)),
    categories: uniq(snap.transactions.map((t) => t.sk_category_name)),
    people: uniq(snap.users.map((u) => `${u.first_name} ${u.last_name}`.trim())),
    vendors: uniq(snap.vendors.map((v) => v.name).concat(snap.bills.map((b) => b.vendor.name))),
  };
}

/** `cap` keeps the on-screen answer small; the binder passes Infinity so it lists every match. */
export function runPlan(plan: Plan, snap: RampSnapshot, ix: Index = buildIndex(snap), opts: { cap?: number } = {}): AskResult {
  const dept = (id?: string | null) => snap.departments.find((d) => d.id === id)?.name ?? null;
  let rows: { sortAmount: number; sortDate: string; row: AskRow; cents: number | null }[] = [];

  if (plan.entity === "transactions") {
    for (const t of snap.transactions) {
      if (t.state !== "CLEARED" && t.state !== "COMPLETION") continue;
      const cents = t.entity_amount?.value ?? 0;
      const when = new Date(t.user_transaction_time);
      const approved = !!lastApproval(ix, t.id).last;
      const hasReceipt = (ix.receiptsByTxn.get(t.id)?.length ?? 0) > 0 || (t.receipts?.length ?? 0) > 0;
      const get: Getter = (f) =>
        ({
          amount: cents,
          merchant: t.merchant_name,
          category: t.sk_category_name ?? null,
          cardholder: `${t.card_holder.first_name} ${t.card_holder.last_name}`,
          department: t.card_holder.department_name ?? null,
          date: day(t.user_transaction_time),
          memo: t.memo ?? null,
          has_memo: !!t.memo?.trim(),
          has_receipt: hasReceipt,
          approved,
          is_weekend: when.getUTCDay() === 0 || when.getUTCDay() === 6,
          is_round: cents >= 10000 && cents % 10000 === 0,
        })[f as string] ?? null;
      if (!plan.filters.every((f) => test(get, f))) continue;
      rows.push({
        sortAmount: cents,
        sortDate: t.user_transaction_time,
        cents,
        row: {
          record: { type: "transaction", id: t.id, label: `${t.merchant_name} ${usd(cents)} on ${shortDate(t.user_transaction_time)}` },
          cells: [shortDate(t.user_transaction_time), t.merchant_name, `${t.card_holder.first_name} ${t.card_holder.last_name}`, usd(cents), hasReceipt ? "Yes" : "No", approved ? "Yes" : "No", t.memo ?? ""],
        },
      });
    }
  } else if (plan.entity === "bills") {
    for (const b of snap.bills) {
      const cents = b.amount.amount;
      const approved = !!lastApproval(ix, b.id).last;
      const get: Getter = (f) =>
        ({
          amount: cents,
          vendor: b.vendor.name,
          invoice: b.invoice_number ?? null,
          date: day(b.issued_at),
          paid: !!b.paid_at,
          paid_date: day(b.paid_at),
          approved,
          owner: `${b.bill_owner.first_name ?? ""} ${b.bill_owner.last_name ?? ""}`.trim(),
        })[f as string] ?? null;
      if (!plan.filters.every((f) => test(get, f))) continue;
      rows.push({
        sortAmount: cents,
        sortDate: b.issued_at,
        cents,
        row: {
          record: { type: "bill", id: b.id, label: `${b.vendor.name} ${b.invoice_number ?? ""} ${usd(cents)}`.replace(/\s+/g, " ") },
          cells: [shortDate(b.issued_at), b.vendor.name, b.invoice_number ?? "", usd(cents), b.paid_at ? shortDate(b.paid_at) : "Open", approved ? "Yes" : "No"],
        },
      });
    }
  } else if (plan.entity === "vendors") {
    for (const v of snap.vendors) {
      const get: Getter = (f) => ({ name: v.name, created: day(v.created_at), category: v.sk_category_name ?? null })[f as string] ?? null;
      if (!plan.filters.every((f) => test(get, f))) continue;
      rows.push({ sortAmount: 0, sortDate: v.created_at, cents: null, row: { record: { type: "vendor", id: v.id, label: v.name }, cells: [v.name, v.sk_category_name ?? "", shortDate(v.created_at)] } });
    }
  } else {
    for (const u of snap.users) {
      const nm = `${u.first_name} ${u.last_name}`.trim();
      const get: Getter = (f) => ({ name: nm, role: u.role.toLowerCase(), status: u.status.toLowerCase(), department: dept(u.department_id) })[f as string] ?? null;
      if (!plan.filters.every((f) => test(get, f))) continue;
      rows.push({ sortAmount: 0, sortDate: "", cents: null, row: { record: { type: "user", id: u.id, label: nm }, cells: [nm, u.email, u.role.replaceAll("_", " ").toLowerCase(), u.status.replace("USER_", "").toLowerCase(), dept(u.department_id) ?? ""] } });
    }
  }

  const s = plan.sort;
  if (s === "amount_desc") rows.sort((a, b) => b.sortAmount - a.sortAmount);
  else if (s === "amount_asc") rows.sort((a, b) => a.sortAmount - b.sortAmount);
  else if (s === "date_asc") rows.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  else if (s === "date_desc") rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  const total = rows.length;
  const sum = plan.entity === "transactions" || plan.entity === "bills" ? rows.reduce((a, r) => a + (r.cents ?? 0), 0) : null;
  const cap = opts.cap ?? 200;
  const limit = Math.min(plan.limit ?? cap, cap);
  rows = rows.slice(0, limit);

  const columns =
    plan.entity === "transactions" ? ["Date", "Merchant", "Cardholder", "Amount", "Receipt", "Approved", "Memo"]
    : plan.entity === "bills" ? ["Issued", "Vendor", "Invoice", "Amount", "Paid", "Approved"]
    : plan.entity === "vendors" ? ["Vendor", "Category", "Created"]
    : ["Name", "Email", "Role", "Status", "Department"];
  return { title: plan.title, entity: plan.entity, columns, rows: rows.map((r) => r.row), total, sum, filters: plan.filters.map(describeFilter) };
}
