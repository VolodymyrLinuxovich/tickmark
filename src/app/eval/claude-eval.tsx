"use client";

// Button on /eval that runs the sample list through the model parser via /api/eval?parser=claude.
// It is opt in because it makes a paid model call; the rest of the page uses the rules parser.

import { useState } from "react";

/** Subset of the /api/eval response that this component shows. */
interface Out {
  parser: string;
  warnings: string[];
  request_types: { ref: string; type: string; selections: number }[];
  report: { recall: number; precision: number; planted: { key: string; found: boolean }[] };
  timing: { parse_ms: number };
}

// The correct type for each request in the sample list, used to score the model's reading.
const EXPECTED: Record<string, string> = {
  "PBC-01": "unsupported", "PBC-02": "transaction_support", "PBC-03": "bill_support", "PBC-04": "receipt_completeness", "PBC-05": "control_testing",
  "PBC-06": "duplicate_payments", "PBC-07": "vendor_listing", "PBC-08": "user_access", "PBC-09": "unsupported",
};

export default function ClaudeEval() {
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      setOut(await (await fetch("/api/eval?parser=claude")).json());
    } finally {
      setBusy(false);
    }
  }
  if (!out)
    return (
      <div className="row">
        <button className="btn" onClick={go} disabled={busy}>{busy ? "Reading with the model..." : "Run the same list through the model parser"}</button>
        <span className="muted">One model call. Compares each request type with the expected answer, then reruns the checks.</span>
      </div>
    );
  const right = out.request_types.filter((r) => EXPECTED[r.ref] === r.type).length;
  return (
    <div className="card" style={{ padding: 16 }}>
      <p style={{ marginTop: 0 }}>
        Parsed by <b>{out.parser}</b> in {(out.timing.parse_ms / 1000).toFixed(1)} s. Request types correct: <b>{right}/{out.request_types.length}</b>. Planted problems found after parsing: <b>{out.report.planted.filter((p) => p.found).length}/{out.report.planted.length}</b>, precision {(out.report.precision * 100).toFixed(0)}%.
      </p>
      {out.warnings.map((w) => <div className="note" key={w}>{w}</div>)}
      <div className="row" style={{ gap: 6 }}>
        {out.request_types.map((r) => (
          <span key={r.ref} className="tag mono" style={{ color: EXPECTED[r.ref] === r.type ? "var(--tick)" : "var(--bad)" }}>{r.ref} {r.type}{r.selections ? ` (${r.selections})` : ""}</span>
        ))}
      </div>
    </div>
  );
}
