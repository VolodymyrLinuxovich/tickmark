"use client";

// Small pieces shared by the workbench screens: flow state types and status icons.

import type { ParsedList } from "@/lib/parse/schema";
import type { RequestResult } from "@/lib/engine/types";

/** The four screens of the flow, in order. */
export type Stage = "intake" | "plan" | "run" | "results";

/** What /api/parse returns: the typed request list plus the file or sample name it came from. */
export type Parsed = ParsedList & { input_name?: string };

/** Progress of one request during the run. Kept per request so a single failure does not sink the others. */
export type RunState = { status: "wait" | "spin" | "done" | "error"; result?: RequestResult; error?: string };

// ---------------------------------------------------------------- running
/** Status dot used in the run list and the results sidebar: waiting, spinning, clean, exceptions or manual. */
export function StatusIcon({ s }: { s: "wait" | "spin" | "ok" | "ex" | "manual" | "error" }) {
  if (s === "ok") return <span className="status ok" aria-label="No exceptions"><Tick /></span>;
  if (s === "ex" || s === "error") return <span className="status ex" aria-label="Exceptions">!</span>;
  if (s === "manual") return <span className="status manual" aria-label="Manual">&ndash;</span>;
  return <span className={`status ${s}`} />;
}

/** Maps a run state and its result status to a StatusIcon. "manual" means Ramp cannot answer the request. */
export const iconFor = (st: RunState): "wait" | "spin" | "ok" | "ex" | "manual" | "error" => {
  if (st.status !== "done") return st.status;
  if (!st.result) return "error";
  return st.result.status === "complete" ? "ok" : st.result.status === "manual" ? "manual" : "ex";
};

/** Check mark icon for clean requests. */
export function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
