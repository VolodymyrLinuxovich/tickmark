import { describe, expect, it } from "vitest";
import { getFixture } from "../src/lib/fixtures/generate";
import { planWithRules } from "../src/lib/ask/plan";
import { runPlan, vocabulary } from "../src/lib/ask/run";
import { buildIndex } from "../src/lib/engine/run";

const snap = getFixture().snapshot;
const vocab = vocabulary(snap);
const ix = buildIndex(snap);
const ask = (q: string) => {
  const plan = planWithRules(q, vocab, new Date("2026-01-15T00:00:00Z"));
  if (!plan) throw new Error(`rules found nothing in: ${q}`);
  return runPlan(plan, snap, ix);
};

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
});
