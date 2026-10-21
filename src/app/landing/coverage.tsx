// Landing chart: how many records each check covers on the sample company, next to
// a manual sample of 25. Counts come from the generated sample data, so the chart
// changes if the data does. Server component; plain HTML bars, no chart library.

import { getFixture } from "@/lib/fixtures/generate";
import { POLICY } from "@/lib/engine/run";

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
  const data = rows();
  const snap = getFixture().snapshot;
  const max = Math.max(...data.map((r) => r.n));
  const pct = (v: number) => `${(100 * v) / max}%`;
  const total = data.reduce((a, r) => a + r.n, 0);
  const manualTotal = data.reduce((a, r) => a + Math.min(MANUAL_SAMPLE, r.n), 0);
  return (
    <figure className="cov">
      <div className="cov-head">
        <div className="cov-legend" aria-hidden>
          <span><i className="cov-key tick" /> Tickmark checks every record</span>
          <span><i className="cov-key manual" /> Manual sample of {MANUAL_SAMPLE}</span>
        </div>
        <div className="cov-total">
          <b>{total.toLocaleString("en-US")}</b> record checks instead of <b>{manualTotal}</b>
        </div>
      </div>
      <div className="cov-rows" role="img" aria-label={`Records checked per test on the sample company. ${data.map((r) => `${r.check}: ${r.n} by Tickmark, ${Math.min(MANUAL_SAMPLE, r.n)} by hand`).join(". ")}.`}>
        {data.map((r, i) => {
          const manual = Math.min(MANUAL_SAMPLE, r.n);
          return (
            <div className="cov-row stagger" style={{ transitionDelay: `${i * 60}ms` }} key={r.check} tabIndex={0}>
              <span className="cov-label">{r.check}</span>
              <span className="cov-track">
                <span className="cov-bar tick" style={{ width: pct(r.n) }} />
                <span className="cov-bar manual" style={{ width: pct(manual) }} />
                <span className="cov-tip">
                  {r.n.toLocaleString("en-US")} {r.population} checked. A manual test would look at {manual}.
                </span>
              </span>
              <span className="cov-val">{r.n.toLocaleString("en-US")}</span>
            </div>
          );
        })}
      </div>
      <figcaption>
        Records each check covers on the sample company ({snap.transactions.length} card charges, {snap.bills.length} bills, {snap.vendors.length} vendors).
        Hover a bar for details.
      </figcaption>
      {/* Same numbers as a table for screen readers. */}
      <table className="sr-only">
        <thead>
          <tr><th>Check</th><th>Records checked by Tickmark</th><th>Manual sample</th></tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.check}><td>{r.check}</td><td>{r.n}</td><td>{Math.min(MANUAL_SAMPLE, r.n)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
