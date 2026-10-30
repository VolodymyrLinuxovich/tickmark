"use client";

// Plan screen: how each request was read, with type, period and amount chips the user can change before running.

import { useState } from "react";
import type { AuditRequest, RequestType } from "@/lib/parse/schema";
import { REQUEST_TYPE_INFO, REQUEST_TYPES } from "@/lib/parse/schema";
import type { SourceInfo } from "@/lib/ramp/types";
import { type Parsed } from "./shared";

// ---------------------------------------------------------------- plan
/** Turns the parser id from /api/parse into a readable name for the plan header. */
export const parserName = (p: string) => (p === "rules" ? "keyword rules" : /claude/i.test(p) ? `Claude (${p})` : /^(gpt|o\d)/i.test(p) ? `OpenAI (${p})` : p);

/**
 * Plan review screen. Lists every request with its type, interpretation, period, threshold and
 * selections, and lets the user correct the type before anything runs. Evidence is pulled only
 * when the user presses the run button.
 */
export function Plan({ parsed, requests, setRequests, onRun, source, onReadWithModel, reading, error }: { parsed: Parsed; requests: AuditRequest[]; setRequests: (r: AuditRequest[]) => void; onRun: () => void; source: SourceInfo; onReadWithModel?: () => void; reading?: boolean; error?: string | null }) {
  const auto = requests.filter((r) => r.type !== "unsupported").length;
  // A manual override replaces the parser's reason, so the plan shows the type came from the user.
  const setType = (i: number, type: RequestType) => setRequests(requests.map((r, k) => (k === i ? { ...r, type, reason: "Changed by you" } : r)));
  return (
    <>
      <div className="section-head">
        <div>
          <h2>{requests.length} requests{parsed.auditor ? ` from ${parsed.auditor}` : ""}</h2>
          <p>
            {auto} can be answered from Ramp. Read from {parsed.input_name ?? "input"} by {parserName(parsed.parser)}. Change a type if it looks wrong.
            {onReadWithModel && (
              <>
                {" "}
                <button className="ex-more" onClick={onReadWithModel} disabled={reading}>{reading ? "Reading with AI…" : "Read with AI instead"}</button>
              </>
            )}
          </p>
        </div>
        <button className="btn primary" onClick={onRun} disabled={!requests.length}>
          Pull evidence from {source.kind === "fixture" ? "sample data" : "Ramp"}
        </button>
      </div>
      {error && <div className="note">{error}</div>}
      {parsed.warnings.map((w) => (
        <div className="note" key={w}>{w}</div>
      ))}
      <div className="card plan">
        {requests.map((r, i) => (
          <div className="plan-row" key={r.ref + i}>
            <div className="ref">{r.ref}</div>
            <div>
              <select value={r.type} onChange={(e) => setType(i, e.target.value as RequestType)} aria-label={`Type for ${r.ref}`}>
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>{REQUEST_TYPE_INFO[t].label}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="req">{r.text}</div>
              <div className="interp">{r.type === "unsupported" ? REQUEST_TYPE_INFO.unsupported.what : r.interpretation}</div>
              {r.reason && <div className="why"><b>Why:</b> {r.reason}</div>}
              <div className="meta">
                <PeriodChip r={r} onChange={(from, to) => setRequests(requests.map((x, k) => (k === i ? { ...x, period_from: from, period_to: to } : x)))} />
                <AmountChip r={r} onChange={(min) => setRequests(requests.map((x, k) => (k === i ? { ...x, min_amount: min } : x)))} />
                {r.selections.length > 0 && <span className="tag">{r.selections.length} selections</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- plan chips
export const fmtDay = (iso: string, withYear: boolean) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** "Jan 1 – Dec 31, 2025", or both years when the period crosses one. */
export function fmtPeriod(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmtDay(from, !sameYear)} – ${fmtDay(to, true)}`;
}

/** The request's period in plain English; click to change the dates. */
export function PeriodChip({ r, onChange }: { r: AuditRequest; onChange: (from: string | null, to: string | null) => void }) {
  const [edit, setEdit] = useState(false);
  const [from, setFrom] = useState(r.period_from ?? "");
  const [to, setTo] = useState(r.period_to ?? "");
  if (edit)
    return (
      <span className="tag chip-edit">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Period start" />
        <span>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Period end" />
        <button className="chip-ok" onClick={() => { onChange(from || null, to || null); setEdit(false); }} disabled={!!from && !!to && from > to}>Done</button>
      </span>
    );
  return (
    <button className="tag chip" onClick={() => setEdit(true)} title="Change the period">
      {r.period_from && r.period_to ? fmtPeriod(r.period_from, r.period_to) : "Add a period"}
    </button>
  );
}

/** The dollar threshold; click to change or clear it. */
export function AmountChip({ r, onChange }: { r: AuditRequest; onChange: (min: number | null) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(r.min_amount?.toString() ?? "");
  const relevant = r.type === "bill_support" || r.type === "receipt_completeness" || r.min_amount != null;
  if (!relevant) return null;
  const save = () => {
    const n = Number(v.replace(/[$,\s]/g, ""));
    onChange(v.trim() && Number.isFinite(n) && n > 0 ? n : null);
    setEdit(false);
  };
  if (edit)
    return (
      <span className="tag chip-edit">
        <span>over $</span>
        <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="Dollar threshold" autoFocus />
        <button className="chip-ok" onClick={save}>Done</button>
      </span>
    );
  return (
    <button className="tag chip" onClick={() => setEdit(true)} title="Change the dollar threshold">
      {r.min_amount != null ? `over $${r.min_amount.toLocaleString("en-US")}` : "Add a threshold"}
    </button>
  );
}
