"use client";

// Intake screen: upload, paste or pick a sample PBC list, plus connection details and the loading view.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SourceInfo } from "@/lib/ramp/types";
import { Tick } from "./shared";

// ---------------------------------------------------------------- intake
/** The "how it works" strip shown under the upload box. */
export const STEPS = [
  { t: "Upload the request list", d: "The auditor's PBC list, as Excel, CSV, PDF or text." },
  { t: "Review the requests", d: "See how each request was read and fix any type. Nothing runs until you start it." },
  { t: "Gather and test evidence", d: "Tickmark pulls receipts, approvals and bills from Ramp and runs the checks auditors run." },
  { t: "Resolve and export", d: "Review exceptions, send the follow-ups you approve, and download the binder." },
];

/**
 * Intake screen. Accepts the PBC list by drag and drop, file picker, pasted email text or one of
 * the two bundled samples, and hands it to `onParse`. Nothing is sent to Ramp from here.
 */
export function Intake({ busy, error, onParse, models, source, scopes }: { busy: string | null; error: string | null; onParse: (b: FormData | { text?: string; sample?: string }, label: string) => void; models: string[]; source: SourceInfo; scopes: string }) {
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
export function Advanced({ models, source, scopes }: { models: string[]; source: SourceInfo; scopes: string }) {
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

/**
 * Shown while a list is being read. On a live Ramp source the first read pages through
 * every transaction, which takes about half a minute, so say what is happening.
 */
export function LoadProgress({ live, sample }: { live: boolean; sample: boolean }) {
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
