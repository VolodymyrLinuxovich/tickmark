// Deterministic demo company shaped exactly like Ramp Developer API objects.
// Background data is clean by construction; the only control problems are the
// eight planted ones returned in `planted`, which the eval page scores against.
// It is seeded rather than random so every run, test and demo sees the same records and ids, and the
// eval score is reproducible. All amounts are in cents, as in the Ramp API.

import type {
  RampApproval,
  RampBill,
  RampDepartment,
  RampReceipt,
  RampSnapshot,
  RampTransaction,
  RampUser,
  RampVendor,
} from "../ramp/types";

/** Audit period of the demo company (calendar year 2025). */
export const FISCAL_YEAR = { start: "2025-01-01", end: "2025-12-31" };
export const CARD_APPROVAL_LIMIT = 500000; // $5,000.00 in cents

/** Small seeded PRNG. Math.random is never used, so the fixture is identical on every build. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded helpers for ints, picks and v4-shaped UUIDs, so ids look like real Ramp ids. */
class Gen {
  rand: () => number;
  constructor(seed: number) {
    this.rand = mulberry32(seed);
  }
  int(min: number, max: number) {
    return Math.floor(this.rand() * (max - min + 1)) + min;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)];
  }
  uuid() {
    const h = () => Math.floor(this.rand() * 16).toString(16);
    const s = (n: number) => Array.from({ length: n }, h).join("");
    return `${s(8)}-${s(4)}-4${s(3)}-${"89ab"[this.int(0, 3)]}${s(3)}-${s(12)}`;
  }
}

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const day = (s: string, hour = 12, minute = 0) => new Date(`${s}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** A card merchant with its MCC (merchant category code), price range in dollars, and the departments that buy there. */
interface Merchant {
  name: string;
  mcc: string;
  mccDesc: string;
  category: string;
  min: number; // dollars
  max: number;
  depts: string[];
}

// Ordinary merchants only. The restricted liquor store MCC is added solely by planted problem P8.
const MERCHANTS: Merchant[] = [
  { name: "Amazon Web Services", mcc: "5734", mccDesc: "Computer Software Stores", category: "Software", min: 180, max: 4200, depts: ["Engineering"] },
  { name: "GitHub", mcc: "5734", mccDesc: "Computer Software Stores", category: "Software", min: 40, max: 900, depts: ["Engineering"] },
  { name: "Figma", mcc: "5734", mccDesc: "Computer Software Stores", category: "Software", min: 45, max: 1440, depts: ["Engineering", "Marketing"] },
  { name: "Notion", mcc: "5734", mccDesc: "Computer Software Stores", category: "Software", min: 20, max: 600, depts: ["Operations", "People"] },
  { name: "Zoom", mcc: "4814", mccDesc: "Telecommunication Services", category: "Software", min: 15, max: 450, depts: ["Sales", "People"] },
  { name: "Delta Air Lines", mcc: "3058", mccDesc: "Delta", category: "Airlines", min: 220, max: 1450, depts: ["Sales", "Engineering", "Marketing"] },
  { name: "United Airlines", mcc: "3000", mccDesc: "United Airlines", category: "Airlines", min: 190, max: 1380, depts: ["Sales", "Operations"] },
  { name: "Marriott", mcc: "3509", mccDesc: "Marriott", category: "Lodging", min: 180, max: 1100, depts: ["Sales", "Engineering"] },
  { name: "Hilton", mcc: "3504", mccDesc: "Hilton", category: "Lodging", min: 160, max: 980, depts: ["Sales", "Marketing"] },
  { name: "Uber", mcc: "4121", mccDesc: "Taxicabs/Limousines", category: "Ground Transportation", min: 9, max: 85, depts: ["Sales", "Engineering", "Marketing", "Operations"] },
  { name: "Lyft", mcc: "4121", mccDesc: "Taxicabs/Limousines", category: "Ground Transportation", min: 8, max: 70, depts: ["Sales", "Operations"] },
  { name: "Sweetgreen", mcc: "5814", mccDesc: "Fast Food Restaurants", category: "Meals", min: 12, max: 160, depts: ["Engineering", "People", "Finance"] },
  { name: "Blue Bottle Coffee", mcc: "5814", mccDesc: "Fast Food Restaurants", category: "Meals", min: 6, max: 48, depts: ["Engineering", "Sales", "Marketing"] },
  { name: "The Capital Grille", mcc: "5812", mccDesc: "Eating Places, Restaurants", category: "Meals", min: 140, max: 980, depts: ["Sales"] },
  { name: "McMaster-Carr", mcc: "5085", mccDesc: "Industrial Supplies", category: "Supplies", min: 60, max: 3600, depts: ["Engineering", "Operations"] },
  { name: "Digi-Key Electronics", mcc: "5065", mccDesc: "Electrical Parts and Equipment", category: "Supplies", min: 80, max: 3900, depts: ["Engineering"] },
  { name: "Staples", mcc: "5111", mccDesc: "Stationery, Office Supplies", category: "Office", min: 15, max: 420, depts: ["Operations", "Finance", "People"] },
  { name: "LinkedIn", mcc: "7311", mccDesc: "Advertising Services", category: "Advertising", min: 250, max: 4600, depts: ["Marketing", "People"] },
  { name: "Google Ads", mcc: "7311", mccDesc: "Advertising Services", category: "Advertising", min: 300, max: 4800, depts: ["Marketing"] },
  { name: "FedEx", mcc: "4215", mccDesc: "Courier Services", category: "Shipping", min: 18, max: 640, depts: ["Operations", "Engineering"] },
];

const FIRST = ["Avery", "Jordan", "Riley", "Morgan", "Casey", "Taylor", "Jamie", "Quinn", "Reese", "Skyler", "Rowan", "Emerson", "Hayden", "Kendall", "Parker", "Sasha", "Devon", "Logan", "Elliot", "Noa", "Mika", "Arjun", "Lena", "Tomas", "Ines", "Kai", "Mateo", "Yuki", "Zara", "Owen"];
const LAST = ["Ellis", "Navarro", "Okafor", "Lindqvist", "Patel", "Brennan", "Kowalski", "Tanaka", "Moreau", "Haddad", "Fischer", "Osei", "Reyes", "Sato", "Delgado", "Murphy", "Novak", "Achebe", "Larsen", "Romero", "Cho", "Adeyemi", "Kaur", "Volkov", "Silva", "Byrne", "Nakamura", "Duarte", "Weiss", "Mensah"];

/** A bill vendor with its price range in dollars, bills per year and payment terms in days. */
interface VendorSpec {
  name: string;
  category: string;
  min: number;
  max: number;
  billsPerYear: number;
  terms: number;
}

const VENDORS: VendorSpec[] = [
  { name: "Crestline Contract Manufacturing", category: "Contract Manufacturing", min: 9000, max: 48000, billsPerYear: 6, terms: 30 },
  { name: "Apex Facility Services", category: "Facilities", min: 2400, max: 7800, billsPerYear: 8, terms: 30 },
  { name: "Lumen Legal LLP", category: "Legal", min: 3500, max: 26000, billsPerYear: 4, terms: 30 },
  { name: "Harbor Point Properties", category: "Rent", min: 21500, max: 21500, billsPerYear: 12, terms: 15 },
  { name: "Brightwave Recruiting", category: "Recruiting", min: 6000, max: 24000, billsPerYear: 4, terms: 30 },
  { name: "Summit Payroll Partners", category: "Professional Services", min: 1800, max: 3200, billsPerYear: 6, terms: 15 },
  { name: "Ironclad Insurance Brokers", category: "Insurance", min: 14800, max: 31000, billsPerYear: 2, terms: 30 },
  { name: "Vector Precision Machining", category: "Contract Manufacturing", min: 4200, max: 19800, billsPerYear: 6, terms: 45 },
  { name: "Clearwater IT Solutions", category: "IT Services", min: 1600, max: 9400, billsPerYear: 6, terms: 30 },
  { name: "Northline Freight", category: "Logistics", min: 900, max: 6400, billsPerYear: 6, terms: 30 },
  { name: "Sable & Finch CPAs", category: "Accounting", min: 4500, max: 16500, billsPerYear: 3, terms: 30 },
  { name: "Orbit Creative Studio", category: "Marketing Agency", min: 3800, max: 14200, billsPerYear: 4, terms: 30 },
];

/** One planted control problem: the ground truth the eval page checks the engine against. */
export interface PlantedException {
  key: string;
  code: string;
  description: string;
  record_ids: string[];
}

/** One row of the auditor's sample for transaction testing, written the way an auditor's GL extract shows it. */
export interface AuditorSelection {
  ref: string;
  date: string; // MM/DD/YYYY as the auditor wrote it (GL posting date)
  description: string;
  amount: number; // dollars
}

/** The demo company snapshot plus the answer key (planted) and the auditor's sample (selections). */
export interface Fixture {
  snapshot: RampSnapshot;
  planted: PlantedException[];
  selections: AuditorSelection[];
}

let cached: Fixture | null = null;

/** The demo company, built once per process from a fixed seed. */
export function getFixture(): Fixture {
  if (!cached) cached = buildFixture(20251231);
  return cached;
}

/** Builds the demo company from a seed. Same seed, same company, down to every id. */
export function buildFixture(seed: number): Fixture {
  const g = new Gen(seed);
  const departments: RampDepartment[] = ["Engineering", "Sales", "Marketing", "Operations", "Finance", "People"].map((name) => ({ id: g.uuid(), name }));
  const deptId = (name: string) => departments.find((d) => d.name === name)!.id;
  const users: RampUser[] = [];

  const mkUser = (first: string, last: string, dept: string, role: string, managerId: string | null, isManager = false, status = "USER_ACTIVE"): RampUser => {
    const u: RampUser = {
      id: g.uuid(),
      first_name: first,
      last_name: last,
      email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@acmerobotics.example",
      role,
      status,
      department_id: deptId(dept),
      manager_id: managerId,
      is_manager: isManager,
    };
    users.push(u);
    return u;
  };

  const ceo = mkUser("Dana", "Whitfield", "Operations", "BUSINESS_OWNER", null, true);
  const cfo = mkUser("Marcus", "Chen", "Finance", "BUSINESS_ADMIN", ceo.id, true);
  const controller = mkUser("Priya", "Raman", "Finance", "BUSINESS_BOOKKEEPER", cfo.id, true);
  const heads: Record<string, RampUser> = {
    Engineering: mkUser("Elena", "Varga", "Engineering", "BUSINESS_USER", ceo.id, true),
    Sales: mkUser("Theo", "Marshall", "Sales", "BUSINESS_USER", ceo.id, true),
    Marketing: mkUser("Imani", "Brooks", "Marketing", "BUSINESS_USER", ceo.id, true),
    Operations: mkUser("Luis", "Ortega", "Operations", "BUSINESS_ADMIN", ceo.id, true),
    People: mkUser("Hannah", "Kim", "People", "BUSINESS_USER", ceo.id, true),
    Finance: controller,
  };
  mkUser("Sam", "Okoro", "Operations", "IT_ADMIN", heads.Operations.id);
  // An inactive admin and an auditor login give the user access request something to report.
  mkUser("Grace", "Holloway", "Finance", "BUSINESS_ADMIN", cfo.id, false, "USER_INACTIVE");
  mkUser("Hartwell", "Audit", "Finance", "AUDITOR", null);

  const staffDepts = ["Engineering", "Engineering", "Engineering", "Engineering", "Engineering", "Engineering", "Engineering", "Sales", "Sales", "Sales", "Sales", "Sales", "Marketing", "Marketing", "Marketing", "Operations", "Operations", "Operations", "Finance", "People", "People", "Engineering", "Sales", "Marketing"];
  const usedNames = new Set(users.map((u) => u.first_name + u.last_name));
  const staff: RampUser[] = [];
  staffDepts.forEach((dept, i) => {
    let first = FIRST[i % FIRST.length];
    let last = LAST[(i * 7) % LAST.length];
    while (usedNames.has(first + last)) {
      first = g.pick(FIRST);
      last = g.pick(LAST);
    }
    usedNames.add(first + last);
    staff.push(mkUser(first, last, dept, "BUSINESS_USER", heads[dept].id));
  });

  const userById = new Map(users.map((u) => [u.id, u]));
  const deptName = (u: RampUser) => departments.find((d) => d.id === u.department_id)!.name;
  // Card spend is approved by the cardholder's manager, so background charges are never self-approved.
  const approverFor = (u: RampUser) => {
    if (u.manager_id) return userById.get(u.manager_id)!;
    return cfo; // the CEO's card spend is reviewed by the CFO
  };

  const transactions: RampTransaction[] = [];
  const receipts: RampReceipt[] = [];
  const approvals: RampApproval[] = [];
  const occupied = new Set<string>(); // user|merchant|date, keeps background free of split patterns

  // Adds a card charge with a matching receipt and a manager approval unless the options say otherwise.
  // receipt: { ocrCents } creates a receipt whose OCR total differs from the charge.
  const addTxn = (opts: {
    user: RampUser;
    merchant: Merchant;
    when: Date;
    cents: number;
    memo?: string | null;
    receipt?: "match" | "none" | { ocrCents: number };
    approve?: boolean;
  }) => {
    const id = g.uuid();
    const t: RampTransaction = {
      id,
      entity_amount: { value: opts.cents, currency: "USD" },
      merchant_name: opts.merchant.name,
      merchant_id: g.uuid(),
      merchant_category_code: opts.merchant.mcc,
      merchant_category_code_description: opts.merchant.mccDesc,
      sk_category_name: opts.merchant.category,
      user_transaction_time: iso(opts.when),
      // GL posting date: the next day (Monday for a Friday charge). Auditor selections use it, not the swipe date.
      accounting_date: iso(addDays(opts.when, opts.when.getUTCDay() === 5 ? 3 : 1)),
      state: "CLEARED",
      memo: opts.memo === undefined ? memoFor(opts.merchant, g) : opts.memo,
      card_id: g.uuid(),
      card_holder: {
        user_id: opts.user.id,
        first_name: opts.user.first_name,
        last_name: opts.user.last_name,
        department_id: opts.user.department_id ?? undefined,
        department_name: deptName(opts.user),
      },
      receipts: [],
      all_requirements_met_and_approved: true,
    };
    const rc = opts.receipt ?? "match";
    if (rc !== "none") {
      const rid = g.uuid();
      const ocrCents = rc === "match" ? opts.cents : rc.ocrCents;
      receipts.push({
        id: rid,
        transaction_id: id,
        user_id: opts.user.id,
        created_at: iso(addDays(opts.when, g.int(0, 2))),
        receipt_url: `fixture://receipts/${rid}`,
        ocr: {
          currency_code: "USD",
          line_items: [{ item_date: ymd(opts.when), item_name: itemName(opts.merchant), item_quantity: 1, item_total_price: ocrCents / 100, item_unit_price: ocrCents / 100 }],
          taxes: [],
        },
      });
      t.receipts.push(rid);
    } else {
      t.all_requirements_met_and_approved = false;
    }
    if (opts.approve !== false) {
      const approver = approverFor(opts.user);
      approvals.push({
        entity_id: id,
        entity_type: "transaction",
        status: "APPROVED",
        approval_history: [
          { action_at: iso(addDays(opts.when, g.int(1, 4))), step_status: "APPROVED", user_email: approver.email, user_id: approver.id },
        ],
        next_approvers: [],
      });
    }
    transactions.push(t);
    occupied.add(`${opts.user.id}|${opts.merchant.name}|${ymd(opts.when)}`);
    return t;
  };

  // Background card spend: clean by construction.
  // Each charge avoids the same user and merchant within two days of another one, so the split purchase
  // test has no accidental hits. Receipts are always attached at $75 and up, so only P2 is missing one above that line.
  const cardholders = [...staff, ...Object.values(heads).filter((h) => h !== controller), ceo, cfo, controller];
  const start = day(FISCAL_YEAR.start);
  for (const u of cardholders) {
    const dept = deptName(u);
    const options = MERCHANTS.filter((m) => m.depts.includes(dept));
    const pool = options.length ? options : MERCHANTS.filter((m) => m.category === "Meals");
    const n = g.int(14, 30);
    for (let i = 0; i < n; i++) {
      const m = g.pick(pool);
      let when: Date;
      let key: string;
      let tries = 0;
      do {
        when = addDays(start, g.int(0, 363));
        when = day(ymd(when), g.int(8, 20), g.int(0, 59));
        key = `${u.id}|${m.name}`;
        tries++;
      } while (
        tries < 20 &&
        [-2, -1, 0, 1, 2].some((k) => occupied.has(`${key}|${ymd(addDays(when, k))}`))
      );
      if (tries >= 20) continue;
      const cents = Math.round((m.min + g.rand() * (m.max - m.min)) * 100);
      const receipt = cents >= 7500 || g.rand() < 0.6 ? "match" : "none";
      addTxn({ user: u, merchant: m, when, cents, receipt: receipt as "match" | "none" });
    }
  }

  // Vendors and bills.
  const vendors: RampVendor[] = [];
  const bills: RampBill[] = [];
  const invoiceSeq = new Map<string, number>();
  const mkVendor = (name: string, category: string, created: Date, terms: number): RampVendor => {
    const v: RampVendor = { id: g.uuid(), name, created_at: iso(created), is_active: true, sk_category_name: category, net_payment_terms: terms, vendor_owner_id: heads.Operations.id };
    vendors.push(v);
    return v;
  };
  const billOwners = [heads.Operations, heads.Engineering, heads.Marketing, heads.People, controller];
  // Adds a vendor bill with an invoice and an approval, paid by its due date if that falls in the year. Defaults keep it clean:
  // bills of $10,000 or more go to the CFO and the controller never approves a bill they own.
  const addBill = (opts: {
    vendor: RampVendor;
    issued: Date;
    cents: number;
    owner: RampUser;
    invoice?: string;
    approver?: RampUser | null;
    approvedAt?: Date;
    paidAt?: Date | null;
    memo?: string;
  }) => {
    const id = g.uuid();
    const seq = (invoiceSeq.get(opts.vendor.id) ?? g.int(1000, 9000)) + g.int(1, 40);
    invoiceSeq.set(opts.vendor.id, seq);
    const created = addDays(opts.issued, g.int(0, 2));
    const due = addDays(opts.issued, opts.vendor.net_payment_terms ?? 30);
    const approver = opts.approver === undefined ? (opts.cents >= 1000000 ? cfo : controller === opts.owner ? cfo : controller) : opts.approver;
    const approvedAt = opts.approvedAt ?? addDays(created, g.int(1, 3));
    const paidAt = opts.paidAt === undefined ? (due.getTime() < day("2025-12-31").getTime() ? addDays(due, -g.int(0, 3)) : null) : opts.paidAt;
    const b: RampBill = {
      id,
      amount: { amount: opts.cents, currency_code: "USD", minor_unit_conversion_rate: 100 },
      invoice_number: opts.invoice ?? `INV-${seq}`,
      issued_at: iso(opts.issued),
      due_at: iso(due),
      created_at: iso(created),
      paid_at: paidAt ? iso(paidAt) : null,
      status: paidAt ? "PAID" : "OPEN",
      approval_status: approver ? "APPROVED" : "PENDING",
      memo: opts.memo ?? `${opts.vendor.sk_category_name} services`,
      vendor: { id: opts.vendor.id, name: opts.vendor.name },
      bill_owner: { id: opts.owner.id, first_name: opts.owner.first_name, last_name: opts.owner.last_name },
      attachments: [{ id: g.uuid(), attachment_type: "INVOICE", url: `fixture://bills/${id}/invoice` }],
      payment: paidAt ? { payment_method: g.pick(["ACH", "ACH", "ACH", "DOMESTIC_WIRE", "CHECK"]), payment_date: iso(paidAt), amount: { amount: opts.cents, currency_code: "USD" } } : null,
    };
    bills.push(b);
    if (approver) {
      approvals.push({
        entity_id: id,
        entity_type: "bill",
        status: "APPROVED",
        approval_history: [{ action_at: iso(approvedAt), step_status: "APPROVED", user_email: approver.email, user_id: approver.id }],
        next_approvers: [],
      });
    }
    return b;
  };

  for (const spec of VENDORS) {
    const created = addDays(day("2022-03-01"), g.int(0, 900));
    const v = mkVendor(spec.name, spec.category, created, spec.terms);
    for (let i = 0; i < spec.billsPerYear; i++) {
      const monthSpan = 12 / spec.billsPerYear;
      const issued = addDays(start, Math.floor(i * monthSpan * 30.4) + g.int(0, 10));
      const cents = Math.round((spec.min + g.rand() * (spec.max - spec.min)) * 100);
      addBill({ vendor: v, issued, cents, owner: g.pick(billOwners) });
    }
  }
  // Clean new vendors in the period: onboarded well before the first payment.
  for (const [name, cat, created] of [
    ["Kestrel Test Labs", "Testing Services", "2025-02-10"],
    ["Meridian Cloud Security", "IT Services", "2025-05-19"],
    ["Pinecrest Event Co.", "Events", "2025-08-04"],
  ] as const) {
    const v = mkVendor(name, cat, day(created, 15), 30);
    addBill({ vendor: v, issued: addDays(day(created), 41), cents: g.int(380000, 1450000), owner: g.pick(billOwners) });
  }

  // ---- Planted exceptions (ground truth for the eval) ----
  // Each one targets a single check in the engine. Record ids are kept so the eval can match findings exactly.
  const planted: PlantedException[] = [];
  const eng = staff.find((s) => deptName(s) === "Engineering")!;
  const sales = staff.filter((s) => deptName(s) === "Sales");
  const digikey = MERCHANTS.find((m) => m.name === "Digi-Key Electronics")!;
  // Keep background charges away from the planted split so it stays exactly two records.
  const clash = (t: RampTransaction) =>
    t.card_holder.user_id === eng.id && t.merchant_name === digikey.name && Math.abs(new Date(t.user_transaction_time).getTime() - day("2025-08-19").getTime()) < 5 * 864e5;
  for (const t of transactions.filter(clash)) {
    transactions.splice(transactions.indexOf(t), 1);
    for (const rid of t.receipts) receipts.splice(receipts.findIndex((r) => r.id === rid), 1);
    approvals.splice(approvals.findIndex((a) => a.entity_id === t.id), 1);
  }
  const s1 = addTxn({ user: eng, merchant: digikey, when: day("2025-08-19", 10, 14), cents: 486000, memo: "Motor controller boards, rev C build" });
  const s2 = addTxn({ user: eng, merchant: digikey, when: day("2025-08-19", 10, 31), cents: 472550, memo: "Motor controller boards, rev C build" });
  // P1 tests split purchase detection: same cardholder and merchant, same day, each charge under the limit, total over it.
  planted.push({ key: "P1", code: "SPLIT_PURCHASE", description: "Two Digi-Key charges 17 minutes apart, each under the $5,000 card approval limit, $9,585.50 together", record_ids: [s1.id, s2.id] });

  const grille = MERCHANTS.find((m) => m.name === "The Capital Grille")!;
  const p2 = addTxn({ user: sales[0], merchant: grille, when: day("2025-04-17", 20, 5), cents: 124000, memo: "Client dinner, Brightline Logistics", receipt: "none" });
  // P2 tests receipt completeness: a charge well above the $75 receipt threshold with no receipt.
  planted.push({ key: "P2", code: "MISSING_RECEIPT", description: "$1,240.00 client dinner with no receipt attached", record_ids: [p2.id] });

  const marriott = MERCHANTS.find((m) => m.name === "Marriott")!;
  const p3 = addTxn({ user: sales[1], merchant: marriott, when: day("2025-09-23", 22, 40), cents: 83900, memo: "Hotel, Chicago customer visit", receipt: { ocrCents: 38900 } });
  // P3 tests receipt matching: the receipt exists, but its OCR total does not match the charge.
  planted.push({ key: "P3", code: "RECEIPT_MISMATCH", description: "Receipt shows $389.00 but the card was charged $839.00", record_ids: [p3.id] });

  const lumen = vendors.find((v) => v.name === "Lumen Legal LLP")!;
  const p4 = addBill({ vendor: lumen, issued: day("2025-07-08"), cents: 1275000, owner: controller, approver: controller, memo: "Contract review, Q2 supplier agreements" });
  // P4 tests segregation of duties: the bill owner is also its only approver.
  planted.push({ key: "P4", code: "SELF_APPROVAL", description: "Bill owner approved their own $12,750.00 bill", record_ids: [p4.id] });

  const crestline = vendors.find((v) => v.name === "Crestline Contract Manufacturing")!;
  const p5 = addBill({ vendor: crestline, issued: day("2025-05-12"), cents: 2230000, owner: heads.Operations, approver: cfo, approvedAt: day("2025-06-09", 16), paidAt: day("2025-06-02", 14), memo: "Pilot run, 200 units" });
  // P5 tests approval timing: the bill was paid a week before anyone approved it.
  planted.push({ key: "P5", code: "APPROVAL_AFTER_PAYMENT", description: "$22,300.00 bill paid on Jun 2, approved on Jun 9", record_ids: [p5.id] });

  const apex = vendors.find((v) => v.name === "Apex Facility Services")!;
  const d1 = addBill({ vendor: apex, issued: day("2025-02-20"), cents: 648000, owner: heads.Operations, invoice: "INV-20417", paidAt: day("2025-03-07", 15), memo: "February janitorial and HVAC service" });
  const d2 = addBill({ vendor: apex, issued: day("2025-02-20"), cents: 648000, owner: heads.Operations, invoice: "INV-20417", approvedAt: day("2025-03-19", 11), paidAt: day("2025-03-21", 15), memo: "Facility services Feb" });
  // P6 tests duplicate payments: same vendor, invoice number and amount, entered twice with different memos and both paid.
  planted.push({ key: "P6", code: "DUPLICATE_INVOICE", description: "Apex invoice INV-20417 for $6,480.00 paid twice (Mar 7 and Mar 21)", record_ids: [d1.id, d2.id].sort() });

  const northgate = mkVendor("Northgate Supply LLC", "Industrial Supplies", day("2025-11-03", 9), 30);
  const p7 = addBill({ vendor: northgate, issued: day("2025-11-03"), cents: 1840000, owner: heads.Operations, approver: cfo, approvedAt: day("2025-11-04", 10), paidAt: day("2025-11-05", 13), memo: "Expedited bearings order" });
  // P7 tests new vendor risk: a vendor paid two days after it was created, with no time for due diligence.
  planted.push({ key: "P7", code: "NEW_VENDOR_FAST_PAYMENT", description: "Vendor created Nov 3 and paid $18,400.00 two days later", record_ids: [p7.id] });

  const bevmo: Merchant = { name: "BevMo! #214", mcc: "5921", mccDesc: "Package Stores, Beer, Wine, Liquor", category: "Alcohol", min: 0, max: 0, depts: [] };
  const p8 = addTxn({ user: sales[2], merchant: bevmo, when: day("2025-12-12", 18, 22), cents: 61240, memo: null });
  // P8 tests restricted merchant categories: MCC 5921 (liquor store) with no memo explaining the business purpose.
  planted.push({ key: "P8", code: "RESTRICTED_MCC", description: "$612.40 at a liquor store with no business purpose", record_ids: [p8.id] });

  // Auditor's selection for transaction testing: the two planted card issues plus ten large clean items.
  // The spread of ranks mimics a sample drawn across the population, not just the largest items.
  const clean = transactions
    .filter((t) => ![s1.id, s2.id, p2.id, p3.id, p8.id].includes(t.id))
    .sort((a, b) => b.entity_amount.value - a.entity_amount.value);
  const picks = [clean[0], clean[3], clean[7], clean[12], clean[20], clean[31], clean[45], clean[60], clean[88], clean[130]];
  const selected = [picks[0], picks[1], p2, picks[2], picks[3], picks[4], p3, picks[5], picks[6], picks[7], picks[8], picks[9]];
  const glName = (t: RampTransaction) => {
    const n = t.merchant_name.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
    return n.length > 14 ? n.slice(0, 14) : n;
  };
  const selections: AuditorSelection[] = selected.map((t, i) => {
    const d = new Date(t.accounting_date ?? t.user_transaction_time);
    return {
      ref: `S-${String(i + 1).padStart(2, "0")}`,
      date: `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`,
      description: `${glName(t)} ${t.card_holder.last_name.toUpperCase()}`,
      amount: t.entity_amount.value / 100,
    };
  });

  transactions.sort((a, b) => a.user_transaction_time.localeCompare(b.user_transaction_time));
  bills.sort((a, b) => a.issued_at.localeCompare(b.issued_at));

  return {
    snapshot: {
      business_name: "Acme Robotics, Inc.",
      source: { kind: "fixture", label: "Demo company (Ramp API schema)" },
      users,
      departments,
      transactions,
      receipts,
      bills,
      vendors,
      approvals,
    },
    planted,
    selections,
  };
}

/** A plausible business purpose memo for background charges, so only P8 lacks one. */
function memoFor(m: Merchant, g: Gen): string {
  const by: Record<string, string[]> = {
    Software: ["Team subscription", "Seat expansion", "Monthly usage"],
    Airlines: ["Customer visit", "Conference travel", "Supplier site visit"],
    Lodging: ["Hotel, customer visit", "Hotel, trade show"],
    "Ground Transportation": ["Airport transfer", "Customer meeting"],
    Meals: ["Team lunch", "Working session", "Candidate interview lunch"],
    Supplies: ["Prototype parts", "Lab consumables", "Fixtures for test rig"],
    Office: ["Office supplies"],
    Advertising: ["Q campaign spend", "Job postings"],
    Shipping: ["Prototype shipment to customer", "Return to supplier"],
  };
  return g.pick(by[m.category] ?? ["Business expense"]);
}

/** Receipt line item label for a merchant category. */
function itemName(m: Merchant): string {
  const by: Record<string, string> = {
    Software: "Subscription",
    Airlines: "Airfare",
    Lodging: "Room and tax",
    "Ground Transportation": "Ride",
    Meals: "Food and beverage",
    Supplies: "Parts",
    Office: "Supplies",
    Advertising: "Ad credits",
    Shipping: "Shipping",
  };
  return by[m.category] ?? "Purchase";
}
