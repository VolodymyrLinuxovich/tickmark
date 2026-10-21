"use client";

// The auditor's view of a shared audit: request status, evidence, questions and the binder.
// Read only: nothing here can post to Ramp.

import { useCallback, useEffect, useState } from "react";
import { Logo } from "../../logo";
import { REQUEST_TYPE_INFO } from "@/lib/parse/schema";
import type { RequestResult } from "@/lib/engine/types";
import type { PortalQuestion } from "@/lib/portal/store";
import type { AuditRequest } from "@/lib/parse/schema";

interface View {
  portal: { id: string; business: string; auditor: string | null; requests: AuditRequest[]; questions: PortalQuestion[]; expires_at: string; created_at: string };
  business?: string;
  results?: RequestResult[];
  error?: string;
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const STATUS = { complete: { label: "Ready", cls: "ok" }, exceptions: { label: "Ready, with exceptions", cls: "ex" }, manual: { label: "Prepared by the team", cls: "manual" } } as const;

export function PortalView({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let live = true;
    const t0 = Date.now();
    const tick = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    fetch(`/api/portal/${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!live) return;
        if (!r.ok && !j.portal) setLoadError(j.error ?? "This link is invalid or has expired.");
        else setView(j);
      })
      .catch((e) => live && setLoadError(String(e)))
      .finally(() => clearInterval(tick));
    return () => {
      live = false;
      clearInterval(tick);
    };
  }, [id]);

  // Keep questions fresh so answers show up without a reload.
  const refreshQuestions = useCallback(async () => {
    const r = await fetch(`/api/portal/${id}/questions`).catch(() => null);
    if (!r?.ok) return;
    const { questions } = await r.json();
    setView((v) => (v ? { ...v, portal: { ...v.portal, questions } } : v));
  }, [id]);
  useEffect(() => {
    const t = setInterval(refreshQuestions, 10000);
    return () => clearInterval(t);
  }, [refreshQuestions]);

  async function download() {
    if (!view) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/binder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: view.portal.requests, auditor: view.portal.auditor }) });
      if (!res.ok) throw new Error("Binder failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "audit-binder.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  }

  if (loadError) {
    return (
      <PortalShell>
        <div className="portal-empty">
          <h1>This link is not available.</h1>
          <p>{loadError} Ask the finance team for a new link.</p>
        </div>
      </PortalShell>
    );
  }
  if (!view) {
    return (
      <PortalShell>
        <div className="portal-empty">
          <span className="status spin" aria-hidden />
          <p>Loading the audit from Ramp... {secs} s</p>
        </div>
      </PortalShell>
    );
  }

  const results = view.results ?? [];
  const qs = view.portal.questions;
  return (
    <PortalShell business={view.business ?? view.portal.business}>
      <div className="portal-head">
        <div>
          <p className="eyebrow">Shared audit</p>
          <h1>{view.business ?? view.portal.business}</h1>
          <p className="muted">
            {view.portal.auditor ? `Prepared for ${view.portal.auditor}. ` : ""}Read only. Results are recomputed from Ramp each time you open this page. Link expires {date(view.portal.expires_at)}.
          </p>
        </div>
        <button className="btn primary" onClick={download} disabled={downloading}>{downloading ? "Building binder..." : "Download binder (.zip)"}</button>
      </div>
      {view.error && <div className="note">{view.error}</div>}
      <ul className="portal-list">
        {view.portal.requests.map((req) => {
          const r = results.find((x) => x.request.ref === req.ref);
          const st = r ? STATUS[r.status] : STATUS.manual;
          const mine = qs.filter((q) => q.ref === req.ref);
          const isOpen = open === req.ref;
          return (
            <li key={req.ref} className="card portal-item">
              <button type="button" className="portal-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : req.ref)}>
                <span className="mono portal-ref">{req.ref}</span>
                <span className="portal-main">
                  <b>{req.type === "unsupported" ? req.text.replace(/\.$/, "") : REQUEST_TYPE_INFO[req.type].label}</b>
                  <span className="muted">{req.type === "unsupported" ? "Outside Ramp data. The finance team provides this one." : (r?.headline ?? req.text)}</span>
                </span>
                <span className={`portal-st ${st.cls}`}>{st.label}</span>
                {mine.length > 0 && <span className="tag">{mine.length} question{mine.length > 1 ? "s" : ""}</span>}
              </button>
              {isOpen && (
                <div className="portal-detail">
                  <div className="quote">{req.text}</div>
                  {r && r.procedure.length > 0 && (
                    <>
                      <div className="label">Procedure performed</div>
                      <ul className="procedure">{r.procedure.map((p) => <li key={p}>{p}</li>)}</ul>
                    </>
                  )}
                  {r && r.findings.length > 0 && (
                    <>
                      <div className="label">Exceptions ({r.findings.length})</div>
                      <ul className="portal-findings">{r.findings.slice(0, 25).map((f) => <li key={f.id}><b>{f.title}</b> <span className="muted">{f.detail}</span></li>)}</ul>
                      {r.findings.length > 25 && <p className="muted">{r.findings.length - 25} more in the binder.</p>}
                    </>
                  )}
                  {r && r.rows.length > 0 && (
                    <>
                      <div className="label">Evidence ({r.rows.length})</div>
                      <div className="table-wrap">
                        <table>
                          <thead><tr>{r.columns.map((c) => <th key={c}>{c}</th>)}<th>Ticks</th></tr></thead>
                          <tbody>{r.rows.slice(0, 50).map((row, i) => <tr key={row.record.id + i}>{row.cells.map((c, k) => <td key={k}>{c}</td>)}<td className="ticks">{row.tickmarks.join(" ")}</td></tr>)}</tbody>
                        </table>
                      </div>
                      {r.rows.length > 50 && <p className="muted">Showing 50 of {r.rows.length}. The binder has every row.</p>}
                    </>
                  )}
                  <Questions id={id} reqRef={req.ref} questions={mine} onAsked={refreshQuestions} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </PortalShell>
  );
}

function Questions({ id, reqRef, questions, onAsked }: { id: string; reqRef: string; questions: PortalQuestion[]; onAsked: () => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function ask() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/portal/${id}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: reqRef, text, name: name || null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setText("");
      onAsked();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="portal-q">
      <div className="label">Questions</div>
      {questions.length === 0 && <p className="muted">No questions yet.</p>}
      {questions.map((q) => (
        <div className="pq" key={q.id}>
          <div className="pq-ask"><b>{q.name ?? "Auditor"}</b> <span className="muted">{date(q.asked_at)}</span><p>{q.text}</p></div>
          {q.answer ? <div className="pq-ans"><b>Finance team</b> <span className="muted">{date(q.answer.at)}</span><p>{q.answer.text}</p></div> : <div className="muted pq-wait">Waiting for an answer</div>}
        </div>
      ))}
      <div className="pq-form">
        <label className="sr-only" htmlFor={`q-${reqRef}`}>Your question about {reqRef}</label>
        <textarea id={`q-${reqRef}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask the finance team about ${reqRef}`} />
        <div className="row">
          <label className="sr-only" htmlFor={`n-${reqRef}`}>Your name</label>
          <input id={`n-${reqRef}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" />
          <button type="button" className="btn primary" onClick={ask} disabled={busy || text.trim().length < 2}>{busy ? "Sending..." : "Ask"}</button>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
    </div>
  );
}

function PortalShell({ children, business }: { children: React.ReactNode; business?: string }) {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <span className="brand"><Logo /> Tickmark</span>
          <nav><span className="muted">{business ? `Shared audit · ${business}` : "Shared audit"}</span></nav>
        </div>
      </header>
      <main className="wrap portal">{children}</main>
    </>
  );
}
