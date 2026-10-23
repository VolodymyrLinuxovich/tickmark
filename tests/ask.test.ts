import { describe, expect, it } from "vitest";
import { getFixture } from "../src/lib/fixtures/generate";
import { planWithRules } from "../src/lib/ask/plan";
import { runPlan, vocabulary } from "../src/lib/ask/run";
import { buildIndex, lastApproval } from "../src/lib/engine/run";

const snap = getFixture().snapshot;
const vocab = vocabulary(snap);
const ix = buildIndex(snap);
const ask = (q: string) => {
  const plan = planWithRules(q, vocab, new Date("2026-01-15T00:00:00Z"));
  if (!plan) throw new Error(`rules found nothing in: ${q}`);
  return runPlan(plan, snap, ix);
};
const plan = (q: string) => planWithRules(q, vocab, new Date("2026-01-15T00:00:00Z"))?.filters;
// runPlan only counts settled charges, so direct counts do the same.
const settled = snap.transactions.filter((t) => t.state === "CLEARED" || t.state === "COMPLETION");

describe("ask your books: keyword plans run on real records", () => {
  it("finds the one charge over $75 with no receipt", () => {
    const r = ask("card charges over $75 with no receipt");
    expect(r.total).toBe(1);
    expect(r.rows[0].cells[1]).toBe("The Capital Grille");
  });

  it("matches a merchant named in the question", () => {
    const r = ask("charges at BevMo! #214");
    expect(r.total).toBe(1);
    expect(r.rows[0].record.type).toBe("transaction");
  });

  it("filters weekends and amounts, and agrees with a direct count", () => {
    const r = ask("weekend charges over $500");
    const direct = snap.transactions.filter((t) => {
      const d = new Date(t.user_transaction_time).getUTCDay();
      return (d === 0 || d === 6) && t.entity_amount.value > 50000;
    }).length;
    expect(r.total).toBe(direct);
    expect(r.filters).toEqual(["amount over $500", "on a weekend"]);
  });

  it("sorts the largest first with a limit", () => {
    const r = ask("top 5 largest charges over $1,000");
    expect(r.rows).toHaveLength(5);
    const amounts = r.rows.map((x) => Number(x.cells[3].replace(/[$,]/g, "")));
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it("answers a ranking with no filter", () => {
    const r = ask("Top 10 largest charges");
    expect(r.rows).toHaveLength(10);
  });

  it("answers bill and user questions", () => {
    expect(ask("bills over $20,000").total).toBe(snap.bills.filter((b) => b.amount.amount > 2000000).length);
    expect(ask("users with admin access").total).toBe(snap.users.filter((u) => u.role.toLowerCase().includes("admin")).length);
  });

  it("returns null when it cannot find anything to filter on, so the model is asked only then", () => {
    expect(planWithRules("which purchases look suspicious to you?", vocab)).toBeNull();
  });

  it("reads 'approved by nobody' as not approved", () => {
    const q = "Charges over $5,000 approved by nobody";
    expect(plan(q)).toEqual([{ field: "amount", op: "gt", value: "5000" }, { field: "approved", op: "is_false", value: null }]);
    expect(ask(q).total).toBe(settled.filter((t) => t.entity_amount.value > 500000 && !lastApproval(ix, t.id).last).length);
  });

  it("finds unpaid bills over a threshold", () => {
    const q = "Bills over $10,000 that are unpaid";
    expect(plan(q)).toEqual([{ field: "amount", op: "gt", value: "10000" }, { field: "paid", op: "is_false", value: null }]);
    expect(ask(q).total).toBe(snap.bills.filter((b) => b.amount.amount > 1000000 && !b.paid_at).length);
  });

  it("finds vendors created in the last 90 days", () => {
    const q = "Vendors added in the last 90 days";
    expect(ask(q).entity).toBe("vendors");
    expect(plan(q)).toEqual([{ field: "created", op: "on_or_after", value: "2025-10-17" }]);
    expect(ask(q).total).toBe(snap.vendors.filter((v) => v.created_at.slice(0, 10) >= "2025-10-17").length);
  });

  it("filters a category and an amount", () => {
    const q = "Charges in the Software category over $1,000";
    expect(plan(q)).toEqual([{ field: "amount", op: "gt", value: "1000" }, { field: "category", op: "contains", value: "Software" }]);
    expect(ask(q).total).toBe(settled.filter((t) => t.sk_category_name === "Software" && t.entity_amount.value > 100000).length);
  });

  it("finds round dollar charges over a threshold", () => {
    const q = "Round dollar charges over $1,000";
    expect(plan(q)).toEqual([{ field: "amount", op: "gt", value: "1000" }, { field: "is_round", op: "is_true", value: null }]);
    expect(ask(q).total).toBe(settled.filter((t) => t.entity_amount.value > 100000 && t.entity_amount.value % 10000 === 0).length);
  });

  it("reads 'Saturday or Sunday by <name>' as weekend charges by that cardholder", () => {
    const q = "Charges on Saturday or Sunday by Luis Ortega";
    expect(plan(q)).toEqual([{ field: "is_weekend", op: "is_true", value: null }, { field: "cardholder", op: "contains", value: "Luis Ortega" }]);
    const direct = settled.filter((t) => {
      const d = new Date(t.user_transaction_time).getUTCDay();
      return (d === 0 || d === 6) && t.card_holder.first_name === "Luis" && t.card_holder.last_name === "Ortega";
    }).length;
    expect(direct).toBeGreaterThan(0);
    expect(ask(q).total).toBe(direct);
  });

  it("leaves vague questions to the model", () => {
    expect(planWithRules("anything suspicious?", vocab)).toBeNull();
  });
});

describe("ask your books: amounts with k", () => {
  it("reads $1.5k as $1,500", () => {
    expect(plan("charges over $1.5k")).toEqual([{ field: "amount", op: "gt", value: "1500" }]);
    expect(plan("charges between $2k and $2.25k")).toEqual([
      { field: "amount", op: "gte", value: "2000" },
      { field: "amount", op: "lte", value: "2250" },
    ]);
  });
});

describe("ask your books: people's names", () => {
  it("filters on the full name when only the last name is asked", () => {
    expect(plan("charges by Ortega")).toEqual([{ field: "cardholder", op: "contains", value: "Luis Ortega" }]);
  });

  it("does not fail on names with symbols", () => {
    const odd = { ...vocab, people: ["Ana (Contractor)", "C++ Bot", ...vocab.people] };
    expect(() => planWithRules("charges by Ana (Contractor)", odd)).not.toThrow();
    expect(planWithRules("charges by Ana (Contractor)", odd)?.filters).toEqual([{ field: "cardholder", op: "contains", value: "Ana (Contractor)" }]);
    expect(planWithRules("charges by C++ Bot", odd)?.filters).toEqual([{ field: "cardholder", op: "contains", value: "C++ Bot" }]);
  });
});
