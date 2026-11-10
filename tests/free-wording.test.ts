import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeText } from "../src/lib/parse/input";
import { classify, NO_MATCH } from "../src/lib/parse/rules";

// The model is mocked: each test sets what it answers and the calls are recorded.
const calls: string[] = [];
let answer: (text: string) => unknown = () => null;
vi.mock("openai", () => ({
  default: class {
    responses = {
      parse: async ({ input }: { input: string }) => {
        calls.push(input);
        const out = answer(input);
        if (out instanceof Error) throw out;
        return { output_parsed: out, usage: {} };
      },
    };
  },
}));

describe("free wording the keyword rules read", () => {
  const cases: [string, string][] = [
    ["All card transactions over $5,000 for the last 12 months with approval evidence", "transaction_support"],
    ["Provide a listing of all corporate card charges above $10,000 and evidence of approval", "transaction_support"],
    ["Copies of receipts for all meals and entertainment over $250", "transaction_support"],
    ["Card spend by employee for December 2026", "transaction_support"],
    ["Approval matrix and evidence approvals followed it for purchases over $5,000", "transaction_support"],
    ["Show us every Amex charge greater than $2,500 along with who signed off", "transaction_support"],
    ["All charges posted on weekends or holidays above $500", "transaction_support"],
    ["Evidence that purchases are approved by someone other than the requester", "control_testing"],
    ["List of terminated employees and date their card access was removed", "user_access"],
    ["Who has the ability to approve spend in Ramp and their limits", "user_access"],
    // Money coming in is not an expense receipt.
    ["Evidence of receipt of funds - letter/notice and check copies", "unsupported"],
    ["General ledger detail for each grant with expenses or grant receipts.", "unsupported"],
    ["Cash receipts journal for December", "unsupported"],
    ["Payroll register for the year", "unsupported"],
  ];
  it.each(cases)("%s", (text, type) => expect(classify(text, false)).toBe(type));
});

describe("requests no rule matched are read again by a model", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    calls.length = 0;
    process.env = { ...saved, OPENAI_API_KEY: "sk-test" };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.TICKMARK_PARSER;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const list = "1. Support for card charges over $2,500 in 2025.\n2. Payroll register for the year.\n3. Gift shop spending by the sales team in 2025.";
  const modelSays = (type: string) => () => ({ auditor: null, requests: [{ ref: "R1", text: "Gift shop spending", type, period_from: null, period_to: null, min_amount: null, selections: [], reason: "card spend at a merchant" }] });

  it("sends only the unmatched line, takes the model's type and keeps the rules' period", async () => {
    answer = modelSays("transaction_support");
    const { parseRequests } = await import("../src/lib/parse/claude");
    const out = await parseRequests(normalizeText(list));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("R1. Gift shop spending by the sales team in 2025.");
    expect(calls[0]).not.toContain("Payroll");
    expect(out.parser).toBe("rules");
    expect(out.requests.map((r) => r.type)).toEqual(["transaction_support", "unsupported", "transaction_support"]);
    expect(out.requests[2]).toMatchObject({ reason: "OpenAI read it: card spend at a merchant", period_from: "2025-01-01", period_to: "2025-12-31" });
  });

  it("keeps the rules reading when the model fails", async () => {
    answer = () => new Error("503 overloaded");
    const { parseRequests } = await import("../src/lib/parse/claude");
    const out = await parseRequests(normalizeText(list));
    expect(out.requests[2]).toMatchObject({ type: "unsupported", reason: NO_MATCH });
  });

  it("shows the model reason when it also finds the request outside Ramp", async () => {
    answer = modelSays("unsupported");
    const { parseRequests } = await import("../src/lib/parse/claude");
    const out = await parseRequests(normalizeText(list));
    expect(out.requests[2]).toMatchObject({ type: "unsupported", reason: "OpenAI read it: card spend at a merchant" });
  });

  it("makes no call when every request matched a rule", async () => {
    answer = modelSays("transaction_support");
    const { parseRequests } = await import("../src/lib/parse/claude");
    await parseRequests(normalizeText("1. Support for card charges over $2,500 in 2025.\n2. Payroll register for the year."));
    expect(calls).toHaveLength(0);
  });
});
