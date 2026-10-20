// Writes the sample auditor request list used in the demo.
// Run: npx tsx scripts/make-samples.ts

import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";
import { getFixture } from "../src/lib/fixtures/generate";

export const SAMPLE_REQUESTS = [
  ["PBC-01", "Cash", "Bank reconciliations for all operating accounts as of December 31, 2025."],
  ["PBC-02", "Expenses", "For the card transactions selected on the Selections tab, provide the receipt, evidence of approval and the business purpose."],
  ["PBC-03", "Accounts payable", "Provide the invoice, evidence of approval and proof of payment for all vendor bills over $10,000 paid during FY2025."],
  ["PBC-04", "Expenses", "Provide a listing of card transactions over $75 without an attached receipt for the year ended December 31, 2025."],
  ["PBC-05", "Controls", "Provide evidence that purchases were not split to avoid approval limits and that no employee approved their own spend."],
  ["PBC-06", "Accounts payable", "Provide your analysis of duplicate vendor payments for FY2025."],
  ["PBC-07", "Accounts payable", "Provide the vendor master listing, identifying new vendors added during the year."],
  ["PBC-08", "IT general controls", "Provide a listing of users with administrator access to the spend management system."],
  ["PBC-09", "Fixed assets", "Provide the fixed asset roll-forward and support for additions over $5,000."],
];

async function main() {
  const { selections } = getFixture();
  mkdirSync("public/samples", { recursive: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Hartwell & Co. LLP";
  const ws = wb.addWorksheet("PBC List");
  ws.columns = [
    { header: "Ref", width: 9 },
    { header: "Area", width: 20 },
    { header: "Request", width: 90 },
    { header: "Period start", width: 13 },
    { header: "Period end", width: 13 },
    { header: "Due", width: 12 },
    { header: "Status", width: 12 },
  ];
  for (const [ref, area, text] of SAMPLE_REQUESTS) ws.addRow([ref, area, text, "01/01/2025", "12/31/2025", "02/06/2026", "Open"]);
  ws.getRow(1).font = { bold: true };
  const sel = wb.addWorksheet("Selections");
  sel.columns = [
    { header: "PBC Ref", width: 9 },
    { header: "Selection", width: 10 },
    { header: "GL Date", width: 12 },
    { header: "Description", width: 34 },
    { header: "Amount", width: 12 },
  ];
  for (const s of selections) sel.addRow(["PBC-02", s.ref, s.date, s.description, s.amount]);
  sel.getRow(1).font = { bold: true };
  sel.getColumn(5).numFmt = "#,##0.00";
  await wb.xlsx.writeFile("public/samples/hartwell-pbc-fy2025.xlsx");

  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  writeFileSync(
    "public/samples/hartwell-pbc-fy2025.csv",
    ["Ref,Area,Request,Period start,Period end,Due", ...SAMPLE_REQUESTS.map(([r, a, t]) => [r, a, t, "01/01/2025", "12/31/2025", "02/06/2026"].map(q).join(","))].join("\n") + "\n",
  );

  const email = [
    "Hi Priya,",
    "",
    "As discussed at planning, please provide the items below for the FY2025 audit of Acme Robotics by February 6.",
    "",
    ...SAMPLE_REQUESTS.map(([ref, , text]) => {
      const line = `${ref}: ${text.replace("selected on the Selections tab", "selected below")}`;
      if (ref !== "PBC-02") return line;
      return [line, ...selections.map((s) => `  ${s.ref} | ${s.date} | ${s.description} | $${s.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)].join("\n");
    }),
    "",
    "Thanks,",
    "Jordan Reyes, Senior Associate",
    "Hartwell & Co. LLP",
  ].join("\n");
  writeFileSync("public/samples/hartwell-request-email.txt", email + "\n");
  console.log(`Wrote samples with ${selections.length} selections`);
}

main();
