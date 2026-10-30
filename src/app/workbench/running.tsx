"use client";

// Run screen: progress for each request while evidence is pulled from Ramp.

import type { AuditRequest } from "@/lib/parse/schema";
import { REQUEST_TYPE_INFO } from "@/lib/parse/schema";
import type { SourceInfo } from "@/lib/ramp/types";
import { type RunState, StatusIcon, iconFor } from "./shared";

/** Run screen. Shows each request's progress and its headline as soon as its result arrives. */
export function Running({ requests, runs, source }: { requests: AuditRequest[]; runs: RunState[]; source: SourceInfo }) {
  const done = runs.filter((r) => r.status === "done" || r.status === "error").length;
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Pulling evidence</h2>
          <p>{done} of {requests.length} done, reading from {source.kind === "fixture" ? "sample data" : "Ramp"}.</p>
        </div>
      </div>
      <div className="card plan">
        {requests.map((r, i) => (
          <div className="plan-row" key={r.ref + i} style={{ gridTemplateColumns: "28px 76px 1fr" }}>
            <StatusIcon s={iconFor(runs[i] ?? { status: "wait" })} />
            <div className="ref">{r.ref}</div>
            <div>
              <div className="req">{REQUEST_TYPE_INFO[r.type].label}</div>
              <div className="interp">{runs[i]?.result?.headline ?? runs[i]?.error ?? r.interpretation}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
