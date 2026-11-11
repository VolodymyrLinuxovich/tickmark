import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedInput, RawSelection } from "../src/lib/parse/input";
import { findPeriod, findThreshold, NO_MATCH, parseWithRules } from "../src/lib/parse/rules";

// Both models are mocked. Each test sets what they answer, and the calls are recorded.
const calls: { who: string; input: string; aborted?: boolean }[] = [];
let openaiAnswer: (text: string) => unknown = () => null;
let claudeHangs = false;
vi.mock("openai", () => ({
  default: class {
    responses = {
      parse: async ({ input }: { input: string }) => {
        calls.push({ who: "openai", input });
        const out = openaiAnswer(input);
        if (out instanceof Error) throw out;
        return { output_parsed: out, usage: {} };
      },
    };
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      parse: (body: { messages: { content: string }[] }, opts: { signal?: AbortSignal }) => {
        const call: { who: string; input: string; aborted?: boolean } = { who: "claude", input: body.messages[0].content };
        calls.push(call);
        if (!claudeHangs) return Promise.reject(new Error("503 overloaded"));
        return new Promise((_, reject) => opts.signal?.addEventListener("abort", () => ((call.aborted = true), reject(opts.signal!.reason))));
      },
    };
  },
}));

describe("a count with a plus sign is not a dollar amount (#45)", () => {
  it.each([
    ["Provide support for a sample of 25+ card transactions", null],
    ["Pull 50+ items for testing", null],
    ["Top 40+ vendors by spend", null],
    ["Card txns 100+", 100],
    ["Bills of $10k+", 10000],
    ["Expenses 500+ need a receipt", 500],
  ])("%s", (text, want) => expect(findThreshold(text)).toBe(want));
});

describe("a period ending on a day the start month lacks (#46)", () => {
  it("six months ended August 30 starts March 1", () => {
    expect(findPeriod("card charges for the six months ended August 30, 2025")).toEqual({ from: "2025-03-01", to: "2025-08-30" });
  });
  it("twelve months ended March 15 starts the next day a year back", () => {
    expect(findPeriod("card charges for the twelve months ended March 15, 2026")).toEqual({ from: "2025-03-16", to: "2026-03-15" });
  });
  it("a month end still starts on the first", () => {
    expect(findPeriod("card charges for the three months ended June 30, 2025")).toEqual({ from: "2025-04-01", to: "2025-06-30" });
  });
});

const sel = (request_ref: string | null, ref: string): RawSelection => ({ request_ref, ref, date: "2025-03-01", description: "ACME", amount: 100 });
const table = (rows: [string, string][], selections: RawSelection[]): NormalizedInput => ({
  rows: rows.map(([ref, text]) => ({ ref, area: "", text, period_from: "2025-01-01", period_to: "2025-12-31" })),
  selections,
  text: rows.map((r) => r.join(" ")).join("\n"),
});

describe("sheet selections go to the request they name (#48)", () => {
  const rows: [string, string][] = [
    ["PBC-01", "Receipts and approval for the card transactions selected"],
    ["PBC-02", "Receipts for card transactions over $500"],
  ];
  it("drops selections for a ref the list lacks and keeps ones with no ref", () => {
    const out = parseWithRules(table(rows, [sel("PBC-01", "S-1"), sel("TS-9", "S-2"), sel(null, "S-3")]));
    expect(out.requests[0].selections.map((s) => s.ref)).toEqual(["S-1", "S-3"]);
    expect(out.requests[1].selections.map((s) => s.ref)).toEqual(["S-3"]);
  });
  it("keeps every selection when the sheet numbers requests its own way", () => {
    const out = parseWithRules(table(rows, [sel("A", "S-1"), sel("B", "S-2")]));
    expect(out.requests[0].selections.map((s) => s.ref)).toEqual(["S-1", "S-2"]);
  });
});

describe("the model reread of unmatched requests", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    calls.length = 0;
    claudeHangs = false;
    process.env = { ...saved, OPENAI_API_KEY: "sk-test" };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.TICKMARK_PARSER;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.useRealTimers();
  });

  const says = (type: string, ref = "R1") => () => ({ auditor: null, requests: [{ ref, text: "x", type, period_from: null, period_to: null, min_amount: null, selections: [], reason: "card spend" }] });
  const input = table([["PBC-07", "Gift shop spending by the sales team"], ["PBC-08", "Payroll register for the year"]], [sel("PBC-07", "S-1"), sel("PBC-08", "S-2")]);

  it("gives a request the model turns into a card request its sheet selections back (#47)", async () => {
    expect(parseWithRules(input).requests[0]).toMatchObject({ type: "unsupported", reason: NO_MATCH, selections: [] });
    openaiAnswer = says("transaction_support");
    const { parseRequests } = await import("../src/lib/parse/claude");
    const out = await parseRequests(input);
    expect(out.requests[0].type).toBe("transaction_support");
    expect(out.requests[0].selections.map((s) => s.ref)).toEqual(["S-1"]);
  });

  it("cancels a provider that runs out of time and tries the next one (#49)", async () => {
    vi.useFakeTimers();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    claudeHangs = true;
    openaiAnswer = says("transaction_support");
    const { parseRequests } = await import("../src/lib/parse/claude");
    const pending = parseRequests(input);
    await vi.advanceTimersByTimeAsync(15_000);
    const out = await pending;
    expect(calls.map((c) => c.who)).toEqual(["claude", "openai"]);
    expect(calls[0].aborted).toBe(true);
    expect(out.requests[0].type).toBe("transaction_support");
  });

  it("does not send a line again when the model left it out (#50)", async () => {
    openaiAnswer = says("transaction_support", "R9");
    const { parseRequests } = await import("../src/lib/parse/claude");
    const first = await parseRequests(input);
    await parseRequests(input);
    expect(calls).toHaveLength(1);
    expect(first.requests[0]).toMatchObject({ type: "unsupported", reason: NO_MATCH });
  });
});
