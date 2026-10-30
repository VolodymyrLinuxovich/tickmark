import { afterEach, describe, expect, it } from "vitest";
import { normalizeText } from "../src/lib/parse/input";
import { parseRequests } from "../src/lib/parse/claude";
import { splitEmbeddedRefs, splitLineList } from "../src/lib/parse/rules";

describe("lists the keyword rules can now read", () => {
  it("reads rows that carry their own ref mid-line, across ref families, without the next row's cells", () => {
    const rows = Array.from({ length: 6 }, (_, i) => `FS/C-YE 01-General Items Y_PBC FSC-${String(i + 1).padStart(2, "0")} ${i + 1} Request number ${i + 1}`);
    const sa = Array.from({ length: 5 }, (_, i) => `SA-YE Single Audit Y_PBC SA-0${i + 1} ${i + 1} Single audit item ${i + 1}`);
    const text = [...rows.slice(0, 3), "continued on a second line", "FS/C-YE 02-Cash and", "Cash Equivalents", ...rows.slice(3), ...sa].join("\n");
    const out = splitEmbeddedRefs(text);
    expect(out.map((r) => r.ref)).toEqual([...rows.map((_, i) => `FSC-0${i + 1}`), ...sa.map((_, i) => `SA-0${i + 1}`)]);
    expect(out[2].text).toBe("Request number 3\ncontinued on a second line");
  });

  it("reads a plain list under ALL CAPS headings, and leaves prose alone", () => {
    const list = ["Exhibit B", "Sample PBC List", "ACCOUNTS PAYABLE", "Listing - Checks (Various)", "Open Payables - Reconciliations", "and Listings", "CASH", "Bank reconciliations", "Bank statements", "11", "Investment schedule", "Cash confirmations"].join("\n");
    const rows = splitLineList(list);
    expect(rows.map((r) => r.text)).toEqual(["Listing - Checks (Various)", "Open Payables - Reconciliations and Listings", "Bank reconciliations", "Bank statements", "Investment schedule", "Cash confirmations"]);
    expect(rows[0].area).toBe("Accounts Payable");
    expect(splitLineList("Hi team,\nThanks for the call today.\nPlease send what you can by Friday.\nBest,\nSam")).toEqual([]);
  });
});

describe("rules go first", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses the keyword reading without calling a model when the rules find the requests", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-used";
    const out = await parseRequests(normalizeText("1. Support for card charges over $2,500 in 2025.\n2. List of admin users."));
    expect(out.parser).toBe("rules");
    expect(out.requests).toHaveLength(2);
    expect("split" in out).toBe(false);
  });
});

describe("the document's year end", () => {
  it("prefers the year end stated most often over an earlier prior-year mention", async () => {
    const { statedYearEnd } = await import("../src/lib/parse/rules");
    expect(statedYearEnd("Journal entries for the year ended 6/30/14.\nBudget for the year ended 6/30/15.\nInvoices for the year ended 6/30/15.")).toBe("2015-06-30");
    expect(statedYearEnd("Comparatives for the year ended 12/31/2024 and the year ended 12/31/2025.")).toBe("2025-12-31");
  });
});

describe("review cases", () => {
  it("does not read an email with capitalized lines as a line list", () => {
    const email = ["RE: FY2025 PBC REQUEST", "ACME CPAS LLP", "Hi team,", "Please send the bank statements.", "Also the vendor list.", "And the user access report.", "Thanks so much", "Sam", "CONFIDENTIAL"].join("\n");
    expect(splitLineList(email)).toEqual([]);
  });

  it("takes a row whose ref ends its line, with the request on the next line", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `FS/C-YE 01-General Y_PBC FSC-0${i + 1} ${i + 1} Item ${i + 1}`);
    const out = splitEmbeddedRefs([...rows, "FS/C-YE 02-Cash Y_PBC FSC-06", "Bank reconciliations at year end"].join("\n"));
    expect(out.at(-1)).toMatchObject({ ref: "FSC-06", text: "Bank reconciliations at year end" });
  });

  it("does not trust a single numbered line in prose", async () => {
    const { splitInput } = await import("../src/lib/parse/rules");
    const out = splitInput(normalizeText("Hi team, we need the bank statements and the vendor list.\n1. Also the card charges over $5,000.\nThanks"));
    expect(out.how).toBe("none");
  });

  it("keeps the fiscal year end in step with the stated year end", async () => {
    const { findFiscalYearEnd } = await import("../src/lib/parse/rules");
    expect(findFiscalYearEnd("JEs for the year ended 6/30/14. Audit of the year ended December 31, 2015. Budget for the year ended December 31, 2015.")).toEqual({ month: 12, day: 31 });
  });
});
