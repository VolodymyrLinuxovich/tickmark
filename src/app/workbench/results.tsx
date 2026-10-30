"use client";

// Results screen: plain summary, per request workpapers and the tools that act on them.

import { useCallback, useMemo, useState } from "react";
import type { AuditRequest } from "@/lib/parse/schema";
import { REQUEST_TYPE_INFO } from "@/lib/parse/schema";
import type { Finding, FindingCode, RecordRef, RequestResult } from "@/lib/engine/types";
import { TICKMARKS, compareFindings } from "@/lib/engine/types";
import { WatchProvider, useWatch } from "../loop";
import { ReceiptHunter } from "../receipt-hunter";
import { AskBooks, type BinderExtra } from "../ask-books";
import { PortalShare } from "../portal-share";
import type { SourceInfo } from "@/lib/ramp/types";
import { GROUP_LABEL, ONE_LABEL, ExceptionList, StatusContext, useStatuses } from "./exceptions";
import { type RunState, StatusIcon, iconFor } from "./shared";

// ---------------------------------------------------------------- results
/**
 * Results screen. Summary stats, a sidebar of requests, and a detail pane that shows either all
 * exceptions or one request. `sent` maps finding id to where its comment was posted, and lives
 * here so the "Drafts sent" count and every FindingCard agree.
 */
export function Results({ requests, runs, meta, auditor, source, openRecord }: { requests: AuditRequest[]; runs: RunState[]; meta: { ms: number; counts: Record<string, number>; business: string; warnings: string[] }; auditor: string | null; source: SourceInfo; openRecord: (r: RecordRef) => void }) {
  const results = runs.map((r) => r.result).filter((r): r is RequestResult => !!r);
  // The same exception can surface under several requests.
  // Dedupe by finding id and remember every request ref that raised it.
  const allFindings = useMemo(() => {
    const m = new Map<string, { f: Finding; refs: string[] }>();
    for (const r of results) for (const f of r.findings) m.set(f.id, { f, refs: [...(m.get(f.id)?.refs ?? []), r.request.ref] });
    return [...m.values()].sort((a, b) => compareFindings(a.f, b.f));
  }, [results]);
  const [sel, setSel] = useState<number | "all">("all");
  const [downloading, setDownloading] = useState(false);
  const [sent, setSent] = useState<Record<string, string>>({});
  const statusApi = useStatuses();
  const [extras, setExtras] = useState<BinderExtra[]>([]);
  const [tool, setTool] = useState<null | "receipts" | "share" | "ask">(null);
  const periodFrom = requests.map((r) => r.period_from).filter(Boolean).sort()[0] ?? null;
  const periodTo = requests.map((r) => r.period_to).filter(Boolean).sort().at(-1) ?? null;
  const auto = results.filter((r) => r.status !== "manual");
  const tested = results.reduce((s, r) => s + r.rows.length, 0);
  const high = allFindings.filter((x) => x.f.severity === "high").length;

  /**
   * Downloads the binder ZIP. Only the requests are sent, not the results; the server reruns the
   * checks itself so the binder cannot contain numbers edited in the browser.
   */
  async function download() {
    setDownloading(true);
    try {
      const res = await fetch("/api/binder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests, auditor, statuses: statusApi.statuses, extras: extras.map((x) => ({ question: x.question, plan: x.plan, period: x.period })) }) });
      if (!res.ok) throw new Error("Binder failed");
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "audit-binder.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  }

  // `sel` is "all" for the combined exception list, or an index into `results`.
  const current = sel === "all" ? null : results[sel];
  const missingReceipts = allFindings.filter(({ f }) => f.code === "MISSING_RECEIPT").map(({ f }) => f);
  const setStatus = statusApi.set;
  // When Ramp shows the fix, the finding is marked resolved with how it was fixed as the note.
  const onResolved = useCallback((id: string, how: string) => setStatus(id, { status: "resolved", note: how }), [setStatus]);
  return (
    <StatusContext.Provider value={statusApi}>
    <WatchProvider onResolved={onResolved}>
      <div className="section-head">
        <div>
          <h2>Evidence binder{meta.business ? ` for ${meta.business}` : ""}</h2>
          <p className="lead">{summaryLine(auto.length, results.length, allFindings.map((x) => x.f.code))}</p>
          <p className="muted small">
            Checked {meta.counts.transactions?.toLocaleString("en-US")} transactions, {meta.counts.receipts?.toLocaleString("en-US")} receipts and {meta.counts.bills} bills in {(meta.ms / 1000).toFixed(1)} s.
          </p>
        </div>
        <button className="btn primary" onClick={download} disabled={downloading}>{downloading ? "Building binder..." : "Download binder (.zip)"}</button>
      </div>
      {meta.warnings.map((w) => (
        <div className="note" key={w}>{w}</div>
      ))}
      <div className="card stats">
        <div className="stat"><div className="k">Answered from Ramp</div><div className="v">{auto.length}/{results.length}</div><div className="s">{results.length - auto.length} left for the team</div></div>
        <div className="stat"><div className="k">Evidence rows</div><div className="v">{tested.toLocaleString("en-US")}</div><div className="s">each tied to a Ramp record</div></div>
        <div className="stat"><div className="k">Exceptions</div><div className="v" style={{ color: allFindings.length ? "var(--warn)" : "var(--tick)" }}>{allFindings.length}</div><div className="s">{high} high severity</div></div>
        <LoopStat sent={Object.keys(sent).length} ready={allFindings.filter((x) => x.f.comment).length} live={source.kind !== "fixture"} />
      </div>
      <div className="tools" role="group" aria-label="Next steps">
        {missingReceipts.length > 0 && (
          <button type="button" className={`tool ${tool === "receipts" ? "on" : ""}`} aria-expanded={tool === "receipts"} onClick={() => setTool(tool === "receipts" ? null : "receipts")}>
            <b>Find missing receipts</b>
            <span>{missingReceipts.length} charges have none</span>
          </button>
        )}
        <button type="button" className={`tool ${tool === "share" ? "on" : ""}`} aria-expanded={tool === "share"} onClick={() => setTool(tool === "share" ? null : "share")}>
          <b>Share with your auditor</b>
          <span>Read-only link, questions in one place</span>
        </button>
        <button type="button" className={`tool ${tool === "ask" ? "on" : ""}`} aria-expanded={tool === "ask"} onClick={() => setTool(tool === "ask" ? null : "ask")}>
          <b>Ask your books</b>
          <span>{extras.length ? `${extras.length} added to the binder` : "Any question about spend"}</span>
        </button>
      </div>
      {/* Tools stay mounted while hidden so a half-finished upload or answer is not lost. */}
      {missingReceipts.length > 0 && <div hidden={tool !== "receipts"}><ReceiptHunter findings={missingReceipts} source={source} /></div>}
      <div hidden={tool !== "share"}><PortalShare requests={requests} business={meta.business} auditor={auditor} statuses={statusApi.statuses} extras={extras.map((x) => ({ question: x.question, plan: x.plan, period: x.period }))} /></div>
      <div hidden={tool !== "ask"}><AskBooks periodFrom={periodFrom} periodTo={periodTo} openRecord={openRecord} extras={extras} onAdd={(x) => setExtras((xs) => [...xs, x])} /></div>
      <div className="results">
        <div className="card req-list">
          <button className={`req-item ${sel === "all" ? "on" : ""}`} onClick={() => setSel("all")}>
            <StatusIcon s={allFindings.length ? "ex" : "ok"} />
            <div>
              <div className="t">All exceptions</div>
              <div className="h">{allFindings.length} across {results.filter((r) => r.findings.length).length} requests</div>
            </div>
          </button>
          {results.map((r, i) => (
            <button key={r.request.ref + i} className={`req-item ${sel === i ? "on" : ""}`} onClick={() => setSel(i)}>
              <StatusIcon s={iconFor(runs[i])} />
              <div>
                <div className="r">{r.request.ref}</div>
                <div className="t">{REQUEST_TYPE_INFO[r.request.type].label}</div>
                <div className="h">{r.headline}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="card detail">
          {current ? (
            <RequestDetail r={current} openRecord={openRecord} sent={sent} setSent={setSent} source={source} />
          ) : (
            <>
              <h3>All exceptions</h3>
              <div className="headline muted">
                {allFindings.length > 0 && `${allFindings.filter(({ f }) => (statusApi.statuses[f.id]?.status ?? "open") === "open").length} open, most serious first. Click any record to see it in Ramp.`}
              </div>
              {allFindings.length ? (
                <ExceptionList items={allFindings} openRecord={openRecord} sent={sent} setSent={setSent} source={source} />
              ) : (
                <p className="muted">No exceptions found.</p>
              )}
            </>
          )}
        </div>
      </div>
    </WatchProvider>
    </StatusContext.Provider>
  );
}

/** One plain sentence for the top of the results: what was answered and what needs a look. */
export function summaryLine(answered: number, total: number, codes: FindingCode[]): string {
  const head = `Tickmark answered ${answered} of ${total} requests from Ramp.`;
  if (!codes.length) return `${head} Nothing needs a follow-up.`;
  const counts = new Map<FindingCode, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const words = top.map(([c, n]) => `${n.toLocaleString("en-US")} ${(n === 1 ? ONE_LABEL[c] : GROUP_LABEL[c]).toLowerCase()}`);
  return `${head} ${codes.length.toLocaleString("en-US")} items need a look, mostly ${words.join(" and ")}.`;
}

/** Fourth stat: findings Ramp now shows as fixed, and follow-ups still being watched. */
export function LoopStat({ sent, ready, live }: { sent: number; ready: number; live: boolean }) {
  const { resolved, watching } = useWatch();
  // Before any follow-up goes out, "0 resolved" is noise, so the stat appears only once there is progress.
  if (!sent && !resolved && !watching) return null;
  return (
    <div className="stat">
      <div className="k">{live ? "Resolved in Ramp" : "Resolved"}</div>
      <div className="v" style={{ color: resolved ? "var(--tick)" : undefined }}>{resolved}</div>
      <div className="s">{watching ? `${watching} being watched, ` : ""}{sent} of {ready} follow-ups sent</div>
    </div>
  );
}

/**
 * One request's workpaper: the request text, the procedure performed, an evidence table with
 * tickmarks per row, and its exceptions. Opens on the exceptions tab when there are any.
 * Manual requests show only the procedure, since Ramp holds no evidence for them.
 */
export function RequestDetail({ r, openRecord, sent, setSent, source }: { r: RequestResult; openRecord: (x: RecordRef) => void; sent: Record<string, string>; setSent: (s: Record<string, string>) => void; source: SourceInfo }) {
  const [tab, setTab] = useState<"evidence" | "exceptions">(r.findings.length ? "exceptions" : "evidence");
  const flagged = new Set(r.findings.map((f) => f.id));
  return (
    <>
      <div className="mono muted" style={{ fontSize: 12 }}>{r.request.ref}</div>
      <h3>{REQUEST_TYPE_INFO[r.request.type].label}</h3>
      <div className={`headline ${r.status === "exceptions" ? "ex" : r.status === "complete" ? "ok" : "muted"}`}>{r.headline}</div>
      <div className="quote">{r.request.text}</div>
      <div className="label">Procedure performed</div>
      <ul className="procedure">{r.procedure.map((p) => <li key={p}>{p}</li>)}</ul>
      {r.status !== "manual" && (
        <>
          <div className="tabs" style={{ margin: "18px -22px 14px" }}>
            <button className={tab === "exceptions" ? "on" : ""} onClick={() => setTab("exceptions")}>Exceptions ({r.findings.length})</button>
            <button className={tab === "evidence" ? "on" : ""} onClick={() => setTab("evidence")}>Evidence ({r.rows.length})</button>
          </div>
          {tab === "evidence" ? (
            r.rows.length ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>{r.columns.map((c) => <th key={c}>{c}</th>)}<th>Ticks</th></tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row, i) => (
                        <tr key={row.record.id + i} className={row.finding_ids.some((id) => flagged.has(id)) ? "flag" : ""}>
                          {/* The first cell opens the row's Ramp record. Control testing rows lead with the test name, so the link goes on the exception cell instead. */}
                          {row.cells.map((c, k) => (
                            <td key={k} className={/^\$|^-\$/.test(c) ? "num" : c.length <= 14 ? "nw" : ""}>
                              {k === (r.request.type === "control_testing" ? 1 : 0) && row.record.id ? <button className="rec" onClick={() => openRecord(row.record)}>{c}</button> : c}
                            </td>
                          ))}
                          <td className="ticks">{row.tickmarks.map((t) => <span key={t} className={t === "X" ? "x" : "ok"}>{t}</span>)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="legend">{Object.entries(TICKMARKS).map(([k, v]) => <span key={k} style={{ marginRight: 12 }}><code>{k}</code> {v}</span>)}</div>
              </>
            ) : (
              <p className="muted">No rows: nothing in the population met the criteria.</p>
            )
          ) : r.findings.length ? (
            <ExceptionList items={r.findings.map((f) => ({ f }))} openRecord={openRecord} sent={sent} setSent={setSent} source={source} />
          ) : (
            <p className="muted">No exceptions. Every item passed.</p>
          )}
        </>
      )}
    </>
  );
}
