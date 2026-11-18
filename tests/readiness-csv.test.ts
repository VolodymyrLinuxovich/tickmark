// The readiness "Fix now" CSV: the columns, escaping, and the sample company's real list.
import { describe, expect, it } from "vitest";
import { getFixture } from "../src/lib/fixtures/generate";
import { asOfDate, computeReadiness } from "../src/lib/engine/readiness";
import { csvCell, FIX_NOW_CSV_HEADER, fixNowCsv } from "../src/lib/engine/readiness-csv";
import type { Finding } from "../src/lib/engine/types";

/** A minimal CSV reader for the test: quoted cells, doubled quotes, CRLF rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += c;
    }
  }
  return rows;
}

const item = (over: Partial<Finding & { age_days: number }> = {}): Finding & { age_days: number } => ({
  id: "MISSING_RECEIPT:t1",
  code: "MISSING_RECEIPT",
  severity: "medium",
  title: "No receipt for $412.00 at Delta, Nov 2",
  detail: "",
  records: [{ type: "transaction", id: "t1", label: "Delta $412.00" }],
  owner: { user_id: "u1", name: "Dana Lee" },
  comment: { object_type: "transactions", object_id: "t1", message: "Hi Dana, please attach the receipt.", mention_user_ids: ["u1"] },
  age_days: 4,
  ...over,
});

describe("fix now CSV", () => {
  it("has the record, owner, issue, age and drafted follow-up for each item", () => {
    const rows = parseCsv(fixNowCsv([item(), item({ id: "x", records: [{ type: "bill", id: "b1", label: "Bill 101" }, { type: "bill", id: "b2", label: "Bill 102" }], owner: undefined, comment: undefined, age_days: 12, title: "Duplicate invoice" })]));
    expect(rows[0]).toEqual([...FIX_NOW_CSV_HEADER]);
    expect(rows[1]).toEqual(["Delta $412.00", "Dana Lee", "No receipt for $412.00 at Delta, Nov 2", "4", "Hi Dana, please attach the receipt."]);
    expect(rows[2]).toEqual(["Bill 101; Bill 102", "", "Duplicate invoice", "12", ""]);
    expect(rows).toHaveLength(3);
  });

  it("quotes commas, quotes and line breaks so each item stays one row", () => {
    const csv = fixNowCsv([item({ comment: { object_type: "transactions", object_id: "t1", message: 'Hi Dana,\nthe "Delta" charge needs a receipt.', mention_user_ids: [] } })]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1][4]).toBe('Hi Dana,\nthe "Delta" charge needs a receipt.');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("keeps a spreadsheet from running a cell as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("Delta")).toBe("Delta");
  });

  it("has one row per fix now item for the sample company", () => {
    const s = getFixture().snapshot;
    const r = computeReadiness(s, asOfDate(s, false), 180);
    expect(r.fix_now.length).toBeGreaterThan(0);
    const rows = parseCsv(fixNowCsv(r.fix_now));
    expect(rows).toHaveLength(r.fix_now.length + 1);
    rows.slice(1).forEach((row, i) => {
      expect(row).toHaveLength(5);
      expect(row[3]).toBe(String(r.fix_now[i].age_days));
      expect(row[4]).toBe(r.fix_now[i].comment!.message.replace(/^([=+\-@\t\r])/, "'$1"));
    });
  });
});
