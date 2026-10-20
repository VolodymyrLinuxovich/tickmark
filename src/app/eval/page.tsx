import { readFile } from "node:fs/promises";
import { Suspense } from "react";
import { connection } from "next/server";
import path from "node:path";
import { getSource } from "@/lib/ramp/source";
import { getFixture } from "@/lib/fixtures/generate";
import { normalizeFile } from "@/lib/parse/input";
import { parseWithRules } from "@/lib/parse/rules";
import { runAll, POLICY, usd } from "@/lib/engine/run";
import { scoreAgainstPlanted } from "@/lib/engine/eval";
import { TopBar } from "../topbar";
import ClaudeEval from "./claude-eval";

export const metadata = { title: "Tickmark accuracy" };

async function evaluate() {
  const name = "hartwell-pbc-fy2025.xlsx";
  const input = await normalizeFile(name, new Uint8Array(await readFile(path.join(process.cwd(), "public/samples", name))));
  const parsed = parseWithRules(input);
  const { snapshot } = getFixture();
  const t0 = performance.now();
  const results = runAll(parsed.requests, snapshot);
  const ms = performance.now() - t0;
  return { parsed, snapshot, ms, report: scoreAgainstPlanted(results) };
}

export default function EvalPage() {
  return (
    <>
      <TopBar info={getSource().info} />
      <Suspense fallback={<main className="wrap" style={{ paddingTop: 28 }}><p className="muted">Running the checks...</p></main>}>
        <EvalBody />
      </Suspense>
    </>
  );
}

async function EvalBody() {
  await connection();
  const { parsed, snapshot, ms, report } = await evaluate();
  return (
    <>
      <main className="wrap" style={{ paddingTop: 28, paddingBottom: 48 }}>
        <div className="section-head">
          <div>
            <h2>Accuracy on the demo company</h2>
            <p>
              Acme Robotics has {snapshot.transactions.length} card transactions, {snapshot.receipts.length} receipts and {snapshot.bills.length} bills for FY2025, all clean except eight planted problems. This page runs the sample request list end to end and scores what Tickmark finds.
            </p>
          </div>
        </div>
        <div className="card stats">
          <div className="stat"><div className="k">Planted problems found</div><div className="v" style={{ color: "var(--tick)" }}>{report.planted.filter((p) => p.found).length}/{report.planted.length}</div><div className="s">recall {(report.recall * 100).toFixed(0)}%</div></div>
          <div className="stat"><div className="k">False alarms</div><div className="v">{report.extra.length}</div><div className="s">precision {(report.precision * 100).toFixed(0)}%</div></div>
          <div className="stat"><div className="k">Checks run in</div><div className="v">{ms.toFixed(0)} ms</div><div className="s">{parsed.requests.length} requests, rules parser</div></div>
          <div className="stat"><div className="k">Card approval limit</div><div className="v">{usd(POLICY.cardApprovalLimit)}</div><div className="s">receipts required at {usd(POLICY.receiptThreshold)}</div></div>
        </div>
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="table-wrap" style={{ border: "none", maxHeight: "none" }}>
            <table>
              <thead>
                <tr><th></th><th>Planted problem</th><th>Check</th><th>Found by</th></tr>
              </thead>
              <tbody>
                {report.planted.map((p) => (
                  <tr key={p.key}>
                    <td className="mono">{p.key}</td>
                    <td>{p.description}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{p.code}</td>
                    <td>{p.found ? <span style={{ color: "var(--tick)" }}>{p.by.join(", ")}</span> : <span style={{ color: "var(--bad)" }}>Missed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {report.extra.length > 0 && (
          <>
            <div className="label">False alarms</div>
            {report.extra.map((f) => <div className="finding" key={f.id}><b>{f.title}</b><div className="fd">{f.detail}</div></div>)}
          </>
        )}
        <div className="label" style={{ marginTop: 28 }}>Request reading with Claude</div>
        <ClaudeEval />
        <div className="label" style={{ marginTop: 28 }}>Limits</div>
        <ul className="procedure">
          <li>The demo company is generated, so a perfect score shows the checks work as designed. It is not a measure of accuracy on real books.</li>
          <li>Thresholds (card approval limit, receipt threshold, restricted merchant categories) are set in code. A real deployment reads them from the company&rsquo;s Ramp policy.</li>
          <li>Receipt checks compare the OCR total Ramp stores with the charge. Tickmark does not re-read receipt images.</li>
        </ul>
      </main>
    </>
  );
}
