// Landing chart: how many records each check covers on the sample company, next to
// a manual sample of 25. Counts come from the generated sample data, so the chart
// changes if the data does. Server component; plain HTML bars, no chart library.

import { getFixture } from "@/lib/fixtures/generate";
import { POLICY } from "@/lib/engine/run";
import { CoverageLive } from "./coverage-live";

/** Items a person typically pulls when testing a control by hand. Also the app's default sample size. */
const MANUAL_SAMPLE = 25;

interface Row {
  check: string;
  population: string; // what the check runs over
  n: number;
}

/** One row per check, counted from the sample company's records. */
function rows(): Row[] {
  const { transactions: txns, bills, vendors, receipts } = getFixture().snapshot;
  const withReceipt = new Set(receipts.map((r) => r.transaction_id).filter(Boolean)).size;
  return [
    { check: "Missing receipts", population: "card charges at or above the receipt threshold", n: txns.filter((t) => t.entity_amount.value >= POLICY.receiptThreshold).length },
    { check: "Receipt mismatches", population: "card charges with a receipt", n: withReceipt },
    { check: "Split purchases", population: "card charges", n: txns.length },
    { check: "Self-approval", population: "card charges and bills", n: txns.length + bills.length },
    { check: "Approval after payment", population: "paid bills", n: bills.filter((b) => b.paid_at).length },
    { check: "Duplicate invoices", population: "bills", n: bills.length },
    { check: "Fast-paid new vendors", population: "vendors", n: vendors.length },
    { check: "Restricted merchants", population: "card charges", n: txns.length },
  ];
}

export function CoverageChart() {
  const data = rows().map((r) => ({ ...r, manual: Math.min(MANUAL_SAMPLE, r.n) }));
  return (
    <figure className="cov">
      <CoverageLive data={data} manualSample={MANUAL_SAMPLE} />
      {/* Same numbers as a table for screen readers. */}
      <div className="sr-only"><table>
        <thead>
          <tr><th>Check</th><th>Records checked by Tickmark</th><th>Manual sample</th></tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.check}><td>{r.check}</td><td>{r.n}</td><td>{Math.min(MANUAL_SAMPLE, r.n)}</td></tr>
          ))}
        </tbody>
      </table></div>
    </figure>
  );
}
