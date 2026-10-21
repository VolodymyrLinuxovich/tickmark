"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import type { AuditRequest, ParsedList, RequestType } from "@/lib/parse/schema";
import { REQUEST_TYPE_INFO, REQUEST_TYPES } from "@/lib/parse/schema";
import type { Finding, RecordRef, RequestResult } from "@/lib/engine/types";
import { TICKMARKS } from "@/lib/engine/types";
import type { SourceInfo } from "@/lib/ramp/types";

type Stage = "intake" | "plan" | "run" | "results";
type Parsed = ParsedList & { input_name?: string };
type RunState = { status: "wait" | "spin" | "done" | "error"; result?: RequestResult; error?: string };

const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;

export default function Workbench({ source, claude, scopes }: { source: SourceInfo; claude: boolean; scopes: string }) {
  const [stage, setStage] = useState<Stage>("intake");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [requests, setRequests] = useState<AuditRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunState[]>([]);
  const [meta, setMeta] = useState<{ ms: number; counts: Record<string, number>; business: string; warnings: string[] } | null>(null);
  const [record, setRecord] = useState<RecordRef | null>(null);
  const closeRecord = useCallback(() => setRecord(null), []);
  const search = useSearchParams();
  const autoSample = search.get("sample");
  const started = useRef(false);
  useEffect(() => {
    // /app?sample=xlsx or ?sample=email opens straight on the sample list.
    if (started.current || (autoSample !== "xlsx" && autoSample !== "email")) return;
    const t = setTimeout(() => {
      started.current = true;
      void parse({ sample: autoSample }, autoSample);
    }, 0);
    return () => clearTimeout(t);
  }, [autoSample]);

  async function parse(body: FormData | { text?: string; sample?: string }, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch("/api/parse", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not read the list");
      setParsed(json);
      setRequests(json.requests);
      setStage("plan");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setStage("run");
    setError(null);
    const states: RunState[] = requests.map(() => ({ status: "wait" }));
    setRuns([...states]);
    const t0 = performance.now();
    let last: { counts: Record<string, number>; business: string; warnings: string[] } | null = null;
    for (let i = 0; i < requests.length; i++) {
      states[i] = { status: "spin" };
      setRuns([...states]);
      try {
        const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: [requests[i]] }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        states[i] = { status: "done", result: json.results[0] };
        last = { counts: json.counts, business: json.business, warnings: json.warnings ?? [] };
      } catch (e) {
        states[i] = { status: "error", error: String((e as Error).message) };
      }
      setRuns([...states]);
    }
    setMeta({ ms: performance.now() - t0, counts: last?.counts ?? {}, business: last?.business ?? "", warnings: last?.warnings ?? [] });
    setTimeout(() => setStage("results"), 450);
  }

  return (
    <main>
      {stage === "intake" && <Intake busy={busy} error={error} onParse={parse} claude={claude} source={source} scopes={scopes} />}
      {stage !== "intake" && (
        <div className="wrap">
          <div className="steps">
            <button className="btn link" onClick={() => setStage("intake")}>Request list</button>
            <span className="sep">/</span>
            {stage === "plan" ? <b>Plan</b> : <button className="btn link" onClick={() => setStage("plan")} disabled={stage === "run"}>Plan</button>}
            <span className="sep">/</span>
            {stage === "run" || stage === "results" ? <b>Evidence</b> : <span>Evidence</span>}
          </div>
          {stage === "plan" && parsed && <Plan parsed={parsed} requests={requests} setRequests={setRequests} onRun={run} source={source} />}
          {stage === "run" && <Running requests={requests} runs={runs} source={source} />}
          {stage === "results" && meta && (
            <Results
              requests={requests}
              runs={runs}
              meta={meta}
              auditor={parsed?.auditor ?? null}
              source={source}
              openRecord={setRecord}
            />
          )}
        </div>
      )}
      {record && <RecordDrawer key={record.type + record.id} refd={record} onClose={closeRecord} />}
    </main>
  );
}

// ---------------------------------------------------------------- intake
const STEPS = [
  { t: "Upload the request list", d: "The auditor's PBC list, as Excel, CSV, PDF or text." },
  { t: "Review the requests", d: "See how each request was read and fix any type. Nothing runs until you start it." },
  { t: "Gather and test evidence", d: "Tickmark pulls receipts, approvals and bills from Ramp and runs the checks auditors run." },
  { t: "Resolve and export", d: "Review exceptions, send the follow-ups you approve, and download the binder." },
];

function Intake({ busy, error, onParse, claude, source, scopes }: { busy: string | null; error: string | null; onParse: (b: FormData | { text?: string; sample?: string }, label: string) => void; claude: boolean; source: SourceInfo; scopes: string }) {
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pasteBox = useRef<HTMLTextAreaElement>(null);
  const send = (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    onParse(fd, "file");
  };
  useEffect(() => {
    if (paste) pasteBox.current?.focus();
  }, [paste]);
  const status = busy === "file" ? "Reading your request list..." : busy === "text" ? "Reading the pasted requests..." : busy ? "Reading the sample list..." : "";
  return (
    <div className="wrap">
      <section className="hero">
        <h1>
          Answer your auditor&rsquo;s requests <em>in minutes.</em>
        </h1>
        <p>Upload the request list. Tickmark gathers the evidence from Ramp, flags what needs attention, and builds the binder.</p>
      </section>

      <div className="card intake">
        <button
          type="button"
          className={`drop ${over ? "over" : ""} ${busy === "file" ? "busy" : ""}`}
          onClick={() => input.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) send(f);
          }}
          disabled={!!busy}
          aria-describedby="drop-hint"
        >
          <span className="drop-icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5" />
              <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
          </span>
          <strong>{busy === "file" ? "Reading your list..." : over ? "Drop to upload" : "Upload the request list"}</strong>
          <span id="drop-hint">{over ? "Release to read the file" : "Drag a file here or click to choose. Excel, CSV, PDF or text."}</span>
        </button>
        <input ref={input} type="file" accept=".xlsx,.csv,.pdf,.txt,.eml" hidden onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />

        <div className="intake-alt">
          <span>
            No list yet?{" "}
            <button type="button" className="btn link" disabled={!!busy} onClick={() => onParse({ sample: "xlsx" }, "xlsx")}>
              {busy === "xlsx" ? "Reading..." : "Try the sample list"}
            </button>
            <span className="muted"> or </span>
            <a className="btn link" href="/samples/hartwell-pbc-fy2025.xlsx" download>download it</a>
          </span>
          <button
            type="button"
            className="btn link"
            aria-expanded={paste}
            aria-controls="paste-panel"
            onClick={() => {
              setPaste(!paste);
            }}
          >
            {paste ? "Hide paste box" : "Paste an email instead"}
          </button>
        </div>

        {paste && (
          <div id="paste-panel" className="paste">
            <label htmlFor="paste-text" className="sr-only">Request list text</label>
            <textarea
              id="paste-text"
              ref={pasteBox}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"PBC-01: Provide the invoice, approval and proof of payment for all bills over $10,000 paid in FY2025.\nPBC-02: ..."}
            />
            <div className="row end">
              <button type="button" className="btn link" disabled={!!busy} onClick={() => onParse({ sample: "email" }, "email")}>
                {busy === "email" ? "Reading..." : "Use the sample email"}
              </button>
              <button type="button" className="btn primary" disabled={!text.trim() || !!busy} onClick={() => onParse({ text }, "text")}>
                {busy === "text" ? "Reading..." : "Read requests"}
              </button>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{status}</div>
        {error && <div className="error" role="alert">{error}</div>}
      </div>

      <ol className="flow" aria-label="How Tickmark works">
        {STEPS.map((s, i) => (
          <li key={s.t} style={{ animationDelay: `${120 + i * 70}ms` }}>
            <span className="flow-n" aria-hidden>{i + 1}</span>
            <b>{s.t}</b>
            <p>{s.d}</p>
          </li>
        ))}
      </ol>

      <Advanced claude={claude} source={source} scopes={scopes} />
    </div>
  );
}

function Advanced({ claude, source, scopes }: { claude: boolean; source: SourceInfo; scopes: string }) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "http://localhost:3000",
  );
  const cmd = `claude mcp add --transport http tickmark ${origin}/api/mcp`;
  const [copied, setCopied] = useState(false);
  return (
    <details className="advanced">
      <summary>
        <span>For AI agents and advanced setup</span>
        <span className="muted">MCP server, data source, Ramp permissions</span>
      </summary>
      <div className="advanced-body">
        <section>
          <h3>Connect an agent (MCP)</h3>
          <p>
            Tickmark is also an MCP server. Its three tools only read: <code>read_request_list</code>, <code>answer_audit_requests</code> and <code>get_ramp_record</code>. Follow-up comments come back as drafts; none are posted through MCP.
          </p>
          <div className="cmd">
            <code>{cmd}</code>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                navigator.clipboard?.writeText(cmd).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>
        <section>
          <h3>Data source</h3>
          <p>
            {source.kind === "fixture"
              ? "No Ramp account is connected, so this runs on Acme Robotics, a generated sample company whose records use Ramp's API field names."
              : `Connected to ${source.label}${source.base_url ? ` (${source.base_url})` : ""}.`}{" "}
            Requests are read by {claude ? "Claude, falling back to a keyword parser if the call fails" : "a keyword parser, since no Anthropic key is set"}. Pass or fail is always decided by code, not the model.
          </p>
        </section>
        <section>
          <h3>Ramp permissions</h3>
          <p>With a Ramp account connected, Tickmark reads data with these scopes:</p>
          <p className="scopes">{scopes.split(" ").map((s) => <code key={s}>{s}</code>)}</p>
          <p>
            It writes in one case: when you approve a drafted follow-up, it posts that comment to the Ramp transaction or bill, which needs <code>transactions:write</code> or <code>bills:write</code>.
            {source.kind === "fixture" ? " On sample data, approved comments go to a sample outbox instead." : ""}
          </p>
        </section>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- plan
const parserName = (p: string) => (p === "rules" ? "keyword rules" : /claude/i.test(p) ? `Claude (${p})` : p);

function Plan({ parsed, requests, setRequests, onRun, source }: { parsed: Parsed; requests: AuditRequest[]; setRequests: (r: AuditRequest[]) => void; onRun: () => void; source: SourceInfo }) {
  const auto = requests.filter((r) => r.type !== "unsupported").length;
  const setType = (i: number, type: RequestType) => setRequests(requests.map((r, k) => (k === i ? { ...r, type, reason: "Changed by you" } : r)));
  return (
    <>
      <div className="section-head">
        <div>
          <h2>{requests.length} requests{parsed.auditor ? ` from ${parsed.auditor}` : ""}</h2>
          <p>
            {auto} can be answered from Ramp. Read from {parsed.input_name ?? "input"} by {parserName(parsed.parser)}. Change a type if it looks wrong.
          </p>
        </div>
        <button className="btn primary" onClick={onRun} disabled={!requests.length}>
          Pull evidence from {source.kind === "fixture" ? "sample data" : source.label}
        </button>
      </div>
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
                {r.period_from && <span className="tag">{r.period_from} to {r.period_to}</span>}
                {r.min_amount != null && <span className="tag">over ${r.min_amount.toLocaleString("en-US")}</span>}
                {r.selections.length > 0 && <span className="tag">{r.selections.length} selections</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- running
function StatusIcon({ s }: { s: "wait" | "spin" | "ok" | "ex" | "manual" | "error" }) {
  if (s === "ok") return <span className="status ok" aria-label="No exceptions"><Tick /></span>;
  if (s === "ex" || s === "error") return <span className="status ex" aria-label="Exceptions">!</span>;
  if (s === "manual") return <span className="status manual" aria-label="Manual">&ndash;</span>;
  return <span className={`status ${s}`} />;
}

const iconFor = (st: RunState): "wait" | "spin" | "ok" | "ex" | "manual" | "error" => {
  if (st.status !== "done") return st.status;
  if (!st.result) return "error";
  return st.result.status === "complete" ? "ok" : st.result.status === "manual" ? "manual" : "ex";
};

function Running({ requests, runs, source }: { requests: AuditRequest[]; runs: RunState[]; source: SourceInfo }) {
  const done = runs.filter((r) => r.status === "done" || r.status === "error").length;
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Pulling evidence</h2>
          <p>{done} of {requests.length} done, reading from {source.label}.</p>
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

// ---------------------------------------------------------------- results
function Results({ requests, runs, meta, auditor, source, openRecord }: { requests: AuditRequest[]; runs: RunState[]; meta: { ms: number; counts: Record<string, number>; business: string; warnings: string[] }; auditor: string | null; source: SourceInfo; openRecord: (r: RecordRef) => void }) {
  const results = runs.map((r) => r.result).filter((r): r is RequestResult => !!r);
  const allFindings = useMemo(() => {
    const m = new Map<string, { f: Finding; refs: string[] }>();
    for (const r of results) for (const f of r.findings) m.set(f.id, { f, refs: [...(m.get(f.id)?.refs ?? []), r.request.ref] });
    return [...m.values()].sort((a, b) => SEV_ORDER[a.f.severity] - SEV_ORDER[b.f.severity]);
  }, [results]);
  const [sel, setSel] = useState<number | "all">("all");
  const [downloading, setDownloading] = useState(false);
  const [sent, setSent] = useState<Record<string, string>>({});
  const auto = results.filter((r) => r.status !== "manual");
  const tested = results.reduce((s, r) => s + r.rows.length, 0);
  const high = allFindings.filter((x) => x.f.severity === "high").length;

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch("/api/binder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests, auditor }) });
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

  const current = sel === "all" ? null : results[sel];
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Evidence binder{meta.business ? ` for ${meta.business}` : ""}</h2>
          <p>
            Answered {auto.length} of {results.length} requests in {(meta.ms / 1000).toFixed(1)} s from {meta.counts.transactions?.toLocaleString("en-US")} transactions, {meta.counts.receipts?.toLocaleString("en-US")} receipts and {meta.counts.bills} bills.
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
        <div className="stat"><div className="k">Drafts sent</div><div className="v">{Object.keys(sent).length}</div><div className="s">of {allFindings.filter((x) => x.f.comment).length} ready to send</div></div>
      </div>
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
              <div className="headline muted">Sorted by severity. Each one lists the Ramp records behind it and the request that surfaced it.</div>
              <div className="label">Exceptions ({allFindings.length})</div>
              {allFindings.map(({ f, refs }) => (
                <FindingCard key={f.id} f={f} refs={refs} openRecord={openRecord} sent={sent} setSent={setSent} source={source} />
              ))}
              {!allFindings.length && <p className="muted">No exceptions found.</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function RequestDetail({ r, openRecord, sent, setSent, source }: { r: RequestResult; openRecord: (x: RecordRef) => void; sent: Record<string, string>; setSent: (s: Record<string, string>) => void; source: SourceInfo }) {
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
            r.findings.map((f) => <FindingCard key={f.id} f={f} openRecord={openRecord} sent={sent} setSent={setSent} source={source} />)
          ) : (
            <p className="muted">No exceptions. Every item passed.</p>
          )}
        </>
      )}
    </>
  );
}

function FindingCard({ f, refs, openRecord, sent, setSent, source }: { f: Finding; refs?: string[]; openRecord: (x: RecordRef) => void; sent: Record<string, string>; setSent: (s: Record<string, string>) => void; source: SourceInfo }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(f.comment?.message ?? "");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function post() {
    if (!f.comment) return;
    setPosting(true);
    setErr(null);
    try {
      const res = await fetch("/api/comment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f.comment, message: msg }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSent({ ...sent, [f.id]: json.destination });
      setOpen(false);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setPosting(false);
    }
  }
  return (
    <div className="finding">
      <div className="ft">
        <b>{f.title}</b>
        <span className="row" style={{ gap: 6 }}>
          {refs?.map((r) => <span className="tag mono" key={r}>{r}</span>)}
          <span className={`sev ${f.severity}`}>{f.severity}</span>
        </span>
      </div>
      <div className="fd">{f.detail}</div>
      <div className="recs">
        {f.records.filter((x) => x.id).map((x) => (
          <button key={x.id} className="tag rec" onClick={() => openRecord(x)} title={`Ramp ${x.type} ${x.id}`}>{x.type}: {x.label}</button>
        ))}
      </div>
      {f.comment && (
        <div className="row" style={{ marginTop: 10 }}>
          {sent[f.id] ? (
            <span className="sent">Sent as a comment on the Ramp {f.comment.object_type === "bills" ? "bill" : "transaction"} ({sent[f.id]})</span>
          ) : (
            <button className="btn small" onClick={() => setOpen(!open)}>{open ? "Hide draft" : `Draft comment to ${f.owner?.name ?? "owner"}`}</button>
          )}
        </div>
      )}
      {open && f.comment && (
        <div className="draft">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Comment draft" />
          <div className="row end" style={{ marginTop: 8 }}>
            <span className="muted" style={{ marginRight: "auto", fontSize: 12 }}>
              Posts to the {f.comment.object_type === "bills" ? "bill" : "transaction"} thread{source.kind === "fixture" ? " (sample outbox, no Ramp account connected)" : ` in ${source.label}`}.
            </span>
            <button className="btn primary small" onClick={post} disabled={posting || !msg.trim()}>{posting ? "Sending..." : "Approve and send"}</button>
          </div>
          {err && <div className="error">{err}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- record drawer
function RecordDrawer({ refd, onClose }: { refd: RecordRef; onClose: () => void }) {
  const [data, setData] = useState<{ record: unknown; source: SourceInfo } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/record/${refd.type}/${refd.id}`)
      .then((r) => r.json())
      .then((j) => live && (j.error ? setErr(j.error) : setData(j)))
      .catch((e) => live && setErr(String(e)));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      live = false;
      window.removeEventListener("keydown", esc);
    };
  }, [refd.type, refd.id, onClose]);
  const summary = data ? summarize(refd.type, data.record) : [];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Ramp record">
        <header>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Ramp {refd.type}</div>
            <b>{refd.label}</b>
          </div>
          <button className="btn small" onClick={onClose}>Close</button>
        </header>
        <div className="body">
          {err && <div className="error">{err}</div>}
          {!data && !err && <p className="muted">Loading...</p>}
          {data && (
            <>
              <dl className="kv">
                {summary.map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              <div className="label">Raw API response ({data.source.label})</div>
              <pre>{JSON.stringify(data.record, null, 2)}</pre>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function summarize(type: string, rec: unknown): [string, string][] {
  const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const d = (s?: string | null) => (s ? new Date(s).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "None");
  const r = rec as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (type === "transaction") {
    const t = r.transaction;
    const ap = r.approval?.approval_history?.at(-1);
    const ocr = r.receipts?.[0]?.ocr?.line_items?.[0]?.item_total_price;
    return [
      ["Merchant", `${t.merchant_name} (MCC ${t.merchant_category_code})`],
      ["Amount", money(t.entity_amount.value)],
      ["Cardholder", `${t.card_holder.first_name} ${t.card_holder.last_name}, ${t.card_holder.department_name ?? ""}`],
      ["Transaction time", d(t.user_transaction_time)],
      ["Memo", t.memo ?? "None"],
      ["Receipt", r.receipts?.length ? `${r.receipts.length} attached${ocr != null ? `, OCR total ${money(Math.round(ocr * 100))}` : ""}` : "None"],
      ["Approved", ap ? `${ap.user_email}, ${d(ap.action_at)}` : "No approval"],
    ];
  }
  if (type === "bill") {
    const b = r.bill;
    const ap = r.approval?.approval_history?.at(-1);
    return [
      ["Vendor", b.vendor.name],
      ["Invoice", b.invoice_number ?? "None"],
      ["Amount", money(b.amount.amount)],
      ["Owner", `${b.bill_owner.first_name} ${b.bill_owner.last_name}`],
      ["Issued", d(b.issued_at)],
      ["Approved", ap ? `${ap.user_email}, ${d(ap.action_at)}` : "No approval"],
      ["Paid", b.paid_at ? `${d(b.paid_at)}, ${b.payment?.payment_method ?? ""}` : "Open"],
    ];
  }
  if (type === "vendor") return [["Vendor", r.name], ["Created", d(r.created_at)], ["Category", r.sk_category_name ?? ""], ["Terms", `Net ${r.net_payment_terms ?? "?"}`]];
  if (type === "user") return [["Name", `${r.first_name} ${r.last_name}`], ["Email", r.email], ["Role", r.role], ["Status", r.status]];
  return [];
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

