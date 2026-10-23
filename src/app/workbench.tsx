"use client";

// The Tickmark workbench at /app. One client component walks the user through four stages:
// intake (upload or paste the PBC list), plan (review how each request was read), run (pull
// evidence one request at a time) and results (exceptions, drafted comments, binder download).
// All parsing, evidence gathering and checks happen in the API routes; this file only holds UI
// state. Drafted comments are posted only when the user presses "Approve and send" on a finding.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ExceptionStatus, ExceptionStatuses } from "@/lib/binder/build";
import { useSearchParams } from "next/navigation";
import type { AuditRequest, ParsedList, RequestType } from "@/lib/parse/schema";
import { REQUEST_TYPE_INFO, REQUEST_TYPES } from "@/lib/parse/schema";
import type { Finding, FindingCode, RecordRef, RequestResult } from "@/lib/engine/types";
import { TICKMARKS } from "@/lib/engine/types";
import { LiveThread, WatchProvider, useWatch } from "./loop";
import { ReceiptHunter } from "./receipt-hunter";
import { AskBooks, type BinderExtra } from "./ask-books";
import { PortalShare } from "./portal-share";
import type { SourceInfo } from "@/lib/ramp/types";

/** The four screens of the flow, in order. */
type Stage = "intake" | "plan" | "run" | "results";
/** What /api/parse returns: the typed request list plus the file or sample name it came from. */
type Parsed = ParsedList & { input_name?: string };
/** Progress of one request during the run. Kept per request so a single failure does not sink the others. */
type RunState = { status: "wait" | "spin" | "done" | "error"; result?: RequestResult; error?: string };

/** Sort key so high severity exceptions are listed first. */
const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Top level of the flow. Owns all cross-stage state: the parsed list, the editable `requests`
 * (the user can retype them on the plan screen), one `RunState` per request, run totals in
 * `meta`, and the Ramp record open in the side drawer. Props come from the server page so the
 * client knows the data source, configured parser models and Ramp scopes without its own fetch.
 */
export default function Workbench({ source, models, scopes }: { source: SourceInfo; models: string[]; scopes: string }) {
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
  // Guards against parsing the sample twice when effects run twice in development.
  const started = useRef(false);
  useEffect(() => {
    // /app?sample=xlsx or ?sample=email opens straight on the sample list.
    // The parse is deferred with setTimeout so no state is set synchronously inside the effect.
    if (started.current || (autoSample !== "xlsx" && autoSample !== "email")) return;
    const t = setTimeout(() => {
      started.current = true;
      void parse({ sample: autoSample }, autoSample);
    }, 0);
    return () => clearTimeout(t);
  }, [autoSample]);

  /**
   * Intake step. Sends a file (multipart), pasted text or a sample name to /api/parse and moves
   * to the plan screen. `label` records which button started it so only that button shows "Reading...".
   */
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

  /**
   * Run step. Calls /api/run once per request, in sequence, rather than once for the whole list.
   * That gives live per-request progress and keeps each server call well inside its time limit.
   * Repeat calls stay cheap because the server caches the Ramp snapshot for the period.
   * `states` is a local copy that is cloned into React state after every change.
   */
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
        // Population counts and warnings describe the whole snapshot, so the latest response is enough.
        last = { counts: json.counts, business: json.business, warnings: json.warnings ?? [] };
      } catch (e) {
        states[i] = { status: "error", error: String((e as Error).message) };
      }
      setRuns([...states]);
    }
    setMeta({ ms: performance.now() - t0, counts: last?.counts ?? {}, business: last?.business ?? "", warnings: last?.warnings ?? [] });
    // Short pause so the last status icon is visible before the results screen replaces it.
    setTimeout(() => setStage("results"), 450);
  }

  return (
    <main>
      {stage === "intake" && <Intake busy={busy} error={error} onParse={parse} models={models} source={source} scopes={scopes} />}
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
/** The "how it works" strip shown under the upload box. */
const STEPS = [
  { t: "Upload the request list", d: "The auditor's PBC list, as Excel, CSV, PDF or text." },
  { t: "Review the requests", d: "See how each request was read and fix any type. Nothing runs until you start it." },
  { t: "Gather and test evidence", d: "Tickmark pulls receipts, approvals and bills from Ramp and runs the checks auditors run." },
  { t: "Resolve and export", d: "Review exceptions, send the follow-ups you approve, and download the binder." },
];

/**
 * Intake screen. Accepts the PBC list by drag and drop, file picker, pasted email text or one of
 * the two bundled samples, and hands it to `onParse`. Nothing is sent to Ramp from here.
 */
function Intake({ busy, error, onParse, models, source, scopes }: { busy: string | null; error: string | null; onParse: (b: FormData | { text?: string; sample?: string }, label: string) => void; models: string[]; source: SourceInfo; scopes: string }) {
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
            // Ignore leave events fired when the pointer moves onto a child element.
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
        {busy && <LoadProgress live={source.kind !== "fixture"} sample={busy === "xlsx" || busy === "email"} />}
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

      <Advanced models={models} source={source} scopes={scopes} />
    </div>
  );
}

/**
 * Collapsed "advanced" panel on the intake screen: the MCP install command, which data source and
 * parser are active, and which Ramp scopes are read or written.
 */
function Advanced({ models, source, scopes }: { models: string[]; source: SourceInfo; scopes: string }) {
  // useSyncExternalStore gives the server render a fixed origin and the client the real one,
  // so the MCP command can show the deployed URL without a hydration mismatch.
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
              : "Connected to Ramp."}{" "}
            Requests are read by {models.length ? `${models.join(", then ")}, falling back to keyword rules if the call fails` : "keyword rules, since no model key is set"}. Pass or fail is always decided by code, not the model.
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
/** Turns the parser id from /api/parse into a readable name for the plan header. */
const parserName = (p: string) => (p === "rules" ? "keyword rules" : /claude/i.test(p) ? `Claude (${p})` : /^(gpt|o\d)/i.test(p) ? `OpenAI (${p})` : p);

/**
 * Plan review screen. Lists every request with its type, interpretation, period, threshold and
 * selections, and lets the user correct the type before anything runs. Evidence is pulled only
 * when the user presses the run button.
 */
function Plan({ parsed, requests, setRequests, onRun, source }: { parsed: Parsed; requests: AuditRequest[]; setRequests: (r: AuditRequest[]) => void; onRun: () => void; source: SourceInfo }) {
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
          </p>
        </div>
        <button className="btn primary" onClick={onRun} disabled={!requests.length}>
          Pull evidence from {source.kind === "fixture" ? "sample data" : "Ramp"}
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

// ---------------------------------------------------------------- running
/** Status dot used in the run list and the results sidebar: waiting, spinning, clean, exceptions or manual. */
function StatusIcon({ s }: { s: "wait" | "spin" | "ok" | "ex" | "manual" | "error" }) {
  if (s === "ok") return <span className="status ok" aria-label="No exceptions"><Tick /></span>;
  if (s === "ex" || s === "error") return <span className="status ex" aria-label="Exceptions">!</span>;
  if (s === "manual") return <span className="status manual" aria-label="Manual">&ndash;</span>;
  return <span className={`status ${s}`} />;
}

/** Maps a run state and its result status to a StatusIcon. "manual" means Ramp cannot answer the request. */
const iconFor = (st: RunState): "wait" | "spin" | "ok" | "ex" | "manual" | "error" => {
  if (st.status !== "done") return st.status;
  if (!st.result) return "error";
  return st.result.status === "complete" ? "ok" : st.result.status === "manual" ? "manual" : "ex";
};

/** Run screen. Shows each request's progress and its headline as soon as its result arrives. */
function Running({ requests, runs, source }: { requests: AuditRequest[]; runs: RunState[]; source: SourceInfo }) {
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

// ---------------------------------------------------------------- results
/**
 * Results screen. Summary stats, a sidebar of requests, and a detail pane that shows either all
 * exceptions or one request. `sent` maps finding id to where its comment was posted, and lives
 * here so the "Drafts sent" count and every FindingCard agree.
 */
function Results({ requests, runs, meta, auditor, source, openRecord }: { requests: AuditRequest[]; runs: RunState[]; meta: { ms: number; counts: Record<string, number>; business: string; warnings: string[] }; auditor: string | null; source: SourceInfo; openRecord: (r: RecordRef) => void }) {
  const results = runs.map((r) => r.result).filter((r): r is RequestResult => !!r);
  // The same exception can surface under several requests.
  // Dedupe by finding id and remember every request ref that raised it.
  const allFindings = useMemo(() => {
    const m = new Map<string, { f: Finding; refs: string[] }>();
    for (const r of results) for (const f of r.findings) m.set(f.id, { f, refs: [...(m.get(f.id)?.refs ?? []), r.request.ref] });
    return [...m.values()].sort((a, b) => SEV_ORDER[a.f.severity] - SEV_ORDER[b.f.severity]);
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
      <div hidden={tool !== "share"}><PortalShare requests={requests} business={meta.business} auditor={auditor} /></div>
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
function summaryLine(answered: number, total: number, codes: FindingCode[]): string {
  const head = `Tickmark answered ${answered} of ${total} requests from Ramp.`;
  if (!codes.length) return `${head} Nothing needs a follow-up.`;
  const counts = new Map<FindingCode, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const words = top.map(([c, n]) => `${n.toLocaleString("en-US")} ${(n === 1 ? ONE_LABEL[c] : GROUP_LABEL[c]).toLowerCase()}`);
  return `${head} ${codes.length.toLocaleString("en-US")} items need a look, mostly ${words.join(" and ")}.`;
}

/** Fourth stat: findings Ramp now shows as fixed, and follow-ups still being watched. */
function LoopStat({ sent, ready, live }: { sent: number; ready: number; live: boolean }) {
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

/** Plural names for exception types, used in the summary and filters. */
const GROUP_LABEL: Record<FindingCode, string> = {
  MISSING_RECEIPT: "Missing receipts",
  RECEIPT_MISMATCH: "Receipt does not match",
  NOT_APPROVED: "Approvals missing or pending",
  SELF_APPROVAL: "Self-approvals",
  APPROVAL_AFTER_PAYMENT: "Approved after payment",
  NO_APPROVAL: "Bills not approved",
  MISSING_INVOICE: "Missing invoices",
  DUPLICATE_INVOICE: "Possible duplicate payments",
  NEW_VENDOR_FAST_PAYMENT: "New vendors paid fast",
  RESTRICTED_MCC: "Restricted merchants",
  SPLIT_PURCHASE: "Split purchases",
  SELECTION_NOT_FOUND: "Selections not found",
};
/** Singular names, for counts of one. */
const ONE_LABEL: Record<FindingCode, string> = {
  MISSING_RECEIPT: "Missing receipt",
  RECEIPT_MISMATCH: "Receipt does not match",
  NOT_APPROVED: "Approval missing or pending",
  SELF_APPROVAL: "Self-approval",
  APPROVAL_AFTER_PAYMENT: "Approved after payment",
  NO_APPROVAL: "Bill not approved",
  MISSING_INVOICE: "Missing invoice",
  DUPLICATE_INVOICE: "Possible duplicate payment",
  NEW_VENDOR_FAST_PAYMENT: "New vendor paid fast",
  RESTRICTED_MCC: "Restricted merchant",
  SPLIT_PURCHASE: "Split purchase",
  SELECTION_NOT_FOUND: "Selection not found",
};
const countLabel = (c: FindingCode, n: number) => `${n} ${(n === 1 ? ONE_LABEL : GROUP_LABEL)[c].toLowerCase()}`;
const NO_OWNER = "No owner";
const PAGE = 10;
const TOP_PEOPLE = 5;

/**
 * Exception list that reads like an auditor's summary: who to follow up with and for what,
 * the count per exception type, and the cards themselves ten at a time. Clicking a person or
 * a type filters the cards. Short lists skip the summary.
 */
function ExceptionList({ items, openRecord, sent, setSent, source }: { items: { f: Finding; refs?: string[] }[]; openRecord: (x: RecordRef) => void; sent: Record<string, string>; setSent: (s: Record<string, string>) => void; source: SourceInfo }) {
  const [person, setPerson] = useState<string | null>(null);
  const [code, setCode] = useState<FindingCode | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [allPeople, setAllPeople] = useState(false);

  const { people, types } = useMemo(() => {
    const p = new Map<string, { n: number; high: number; codes: Map<FindingCode, number> }>();
    const t = new Map<FindingCode, number>();
    for (const { f } of items) {
      const who = f.owner?.name ?? NO_OWNER;
      const e = p.get(who) ?? { n: 0, high: 0, codes: new Map() };
      e.n++;
      if (f.severity === "high") e.high++;
      e.codes.set(f.code, (e.codes.get(f.code) ?? 0) + 1);
      p.set(who, e);
      t.set(f.code, (t.get(f.code) ?? 0) + 1);
    }
    return {
      people: [...p.entries()].sort((a, b) => b[1].n - a[1].n || b[1].high - a[1].high),
      types: [...t.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [items]);

  const filtered = items.filter(({ f }) => (!person || (f.owner?.name ?? NO_OWNER) === person) && (!code || f.code === code));
  const pick = (next: () => void) => {
    next();
    setShown(PAGE);
  };
  const summary = items.length > 5;
  const top = people.slice(0, TOP_PEOPLE).reduce((s, [, e]) => s + e.n, 0);
  const listedPeople = allPeople ? people : people.slice(0, TOP_PEOPLE);

  return (
    <>
      {summary && (
        <div className="ex-summary">
          <p className="ex-lede">
            {people.length === 1
              ? `All ${items.length} exceptions belong to ${people[0][0]}.`
              : `${items.length} exceptions across ${people.length} people. The top ${Math.min(TOP_PEOPLE, people.length)} account for ${Math.round((top / items.length) * 100)}%.`}
          </p>
          <div className="label">Who to follow up with</div>
          <div className="ex-people">
            {listedPeople.map(([who, e]) => (
              <button key={who} className={`ex-person ${person === who ? "on" : ""}`} aria-pressed={person === who} onClick={() => pick(() => setPerson(person === who ? null : who))}>
                <span className="ex-name">{who}</span>
                <span className="ex-why">
                  {[...e.codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, n]) => countLabel(c, n)).join(", ")}
                </span>
                <span className="ex-n">{e.n}</span>
              </button>
            ))}
          </div>
          {people.length > TOP_PEOPLE && (
            <button className="ex-more" onClick={() => setAllPeople(!allPeople)}>{allPeople ? "Show top people only" : `Show all ${people.length} people`}</button>
          )}
          {types.length > 1 && (
            <>
              <div className="label">By type</div>
              <div className="ex-types">
                {types.map(([c, n]) => (
                  <button key={c} className={`tag chip ${code === c ? "on" : ""}`} aria-pressed={code === c} onClick={() => pick(() => setCode(code === c ? null : c))}>
                    {GROUP_LABEL[c]} <b>{n}</b>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {(person || code) && (
        <div className="ex-filter">
          Showing {filtered.length} {code ? GROUP_LABEL[code].toLowerCase() : "exceptions"}{person ? ` for ${person}` : ""}.
          <button className="ex-more" onClick={() => pick(() => { setPerson(null); setCode(null); })}>Clear filter</button>
        </div>
      )}
      {filtered.slice(0, shown).map(({ f, refs }) => (
        <FindingCard key={f.id} f={f} refs={refs} openRecord={openRecord} sent={sent} setSent={setSent} source={source} />
      ))}
      {filtered.length > shown && (
        <button className="btn ex-page" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, filtered.length - shown)} more of {filtered.length - shown} left
        </button>
      )}
    </>
  );
}

/**
 * One exception: title, severity, detail, the Ramp records behind it, and its drafted follow-up.
 * The draft is editable and is posted only when the user presses "Approve and send". On sample
 * data the server writes it to a demo outbox instead of Ramp.
 */
function FindingCard({ f, refs, openRecord, sent, setSent, source }: { f: Finding; refs?: string[]; openRecord: (x: RecordRef) => void; sent: Record<string, string>; setSent: (s: Record<string, string>) => void; source: SourceInfo }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(f.comment?.message ?? "");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { watch } = useWatch();
  /** Posts the edited draft to /api/comment, records where it went, and starts watching Ramp for the fix. */
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
      watch({ finding_id: f.id, code: f.code, object_type: f.comment.object_type, object_id: f.comment.object_id, posted_message: msg, since: new Date().toISOString(), owner: f.owner?.name });
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
      <LiveThread id={f.id} />
      <StatusControl id={f.id} />
      {open && f.comment && (
        <div className="draft">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Comment draft" />
          <div className="row end" style={{ marginTop: 8 }}>
            <span className="muted" style={{ marginRight: "auto", fontSize: 12 }}>
              Posts to the {f.comment.object_type === "bills" ? "bill" : "transaction"} thread{source.kind === "fixture" ? " (sample outbox, no Ramp account connected)" : " in Ramp"}.
            </span>
            <button className="btn primary small" onClick={post} disabled={posting || !msg.trim()}>{posting ? "Sending..." : "Approve and send"}</button>
          </div>
          {err && <div className="error">{err}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- exception status
/** Shared exception statuses for the results view, kept in this browser so a refresh does not lose them. */
const StatusContext = createContext<{ statuses: ExceptionStatuses; set: (id: string, s: ExceptionStatus) => void }>({ statuses: {}, set: () => {} });
const STATUS_KEY = "tickmark-exception-statuses";

function useStatuses() {
  // The results view only renders in the browser after a run, so reading storage here is safe.
  const [statuses, setStatuses] = useState<ExceptionStatuses>(() => {
    try {
      return JSON.parse(localStorage.getItem(STATUS_KEY) ?? "{}");
    } catch {
      return {}; // Storage can be blocked; statuses then last for this page view only.
    }
  });
  const set = useCallback((id: string, s: ExceptionStatus) => {
    setStatuses((prev) => {
      const next = { ...prev, [id]: s };
      try {
        localStorage.setItem(STATUS_KEY, JSON.stringify(next));
      } catch {
        // see above
      }
      return next;
    });
  }, []);
  return { statuses, set };
}

/** Open, resolved or waived, with a short note. Both go into the binder's workpapers and index. */
function StatusControl({ id }: { id: string }) {
  const { statuses, set } = useContext(StatusContext);
  const cur = statuses[id] ?? { status: "open" as const };
  return (
    <div className="status-row">
      <div className="seg" role="radiogroup" aria-label="Exception status">
        {(["open", "resolved", "waived"] as const).map((k) => (
          <button key={k} role="radio" aria-checked={cur.status === k} className={`seg-b ${k} ${cur.status === k ? "on" : ""}`} onClick={() => set(id, { ...cur, status: k })}>
            {k === "open" ? "Open" : k === "resolved" ? "Resolved" : "Waived"}
          </button>
        ))}
      </div>
      {cur.status !== "open" && (
        <input
          className="status-note"
          placeholder={cur.status === "resolved" ? "How it was resolved, e.g. PO attached" : "Why it is waived, e.g. below materiality"}
          value={cur.note ?? ""}
          maxLength={500}
          onChange={(e) => set(id, { ...cur, note: e.target.value })}
          aria-label="Status note"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- plan chips
const fmtDay = (iso: string, withYear: boolean) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** "Jan 1 – Dec 31, 2025", or both years when the period crosses one. */
export function fmtPeriod(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmtDay(from, !sameYear)} – ${fmtDay(to, true)}`;
}

/** The request's period in plain English; click to change the dates. */
function PeriodChip({ r, onChange }: { r: AuditRequest; onChange: (from: string | null, to: string | null) => void }) {
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
function AmountChip({ r, onChange }: { r: AuditRequest; onChange: (min: number | null) => void }) {
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

// ---------------------------------------------------------------- record drawer
/**
 * Side drawer that shows the Ramp record behind an evidence row or exception: a short summary
 * and the raw API response, so a reviewer can trace any line back to its source. The parent keys
 * it by record, so opening another record remounts it with fresh state.
 */
function RecordDrawer({ refd, onClose }: { refd: RecordRef; onClose: () => void }) {
  const [data, setData] = useState<{ record: unknown; source: SourceInfo } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    // `live` drops a late response if the drawer closed before the fetch finished.
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
              <div className="label">Raw API response ({data.source.kind === "fixture" ? "sample data" : "Ramp"})</div>
              <pre>{JSON.stringify(data.record, null, 2)}</pre>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * Picks the fields an auditor cares about from a raw record returned by /api/record.
 * Field names follow the Ramp API. Amounts arrive in cents and times are shown in UTC.
 */
function summarize(type: string, rec: unknown): [string, string][] {
  const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const d = (s?: string | null) => (s ? new Date(s).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "None");
  const r = rec as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (type === "transaction") {
    const t = r.transaction;
    // The last approval step is the final sign-off.
    const ap = r.approval?.approval_history?.at(-1);
    // OCR totals are in dollars, unlike the cent amounts elsewhere, hence the * 100 below.
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

/** Check mark icon for clean requests. */
function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


/**
 * Shown while a list is being read. On a live Ramp source the first read pages through
 * every transaction, which takes about half a minute, so say what is happening.
 */
function LoadProgress({ live, sample }: { live: boolean; sample: boolean }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, []);
  const steps = [
    "Reading the request list",
    ...(live && sample ? ["Pulling transactions, receipts and approvals from Ramp", "Fitting the sample list to your company"] : []),
  ];
  // Rough timing: the list takes a few seconds; the Ramp read takes the rest.
  const active = !live || !sample ? 0 : secs < 4 ? 0 : secs < 28 ? 1 : 2;
  return (
    <div className="load" aria-hidden>
      <ol>
        {steps.map((s, i) => (
          <li key={s} className={i < active ? "done" : i === active ? "now" : ""}>
            <span className={`status ${i < active ? "ok" : i === active ? "spin" : "wait"}`}>{i < active ? <Tick /> : null}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="load-foot">
        <span>{secs} s</span>
        {live && sample && <span>The first read from Ramp takes about 30 seconds. After that it is instant.</span>}
      </div>
    </div>
  );
}
