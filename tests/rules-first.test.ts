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
