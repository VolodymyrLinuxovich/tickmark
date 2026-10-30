"use client";

// The Tickmark workbench at /app. One client component walks the user through four stages:
// intake (upload or paste the PBC list), plan (review how each request was read), run (pull
// evidence one request at a time) and results (exceptions, drafted comments, binder download).
// All parsing, evidence gathering and checks happen in the API routes; this file only holds UI
// state. Drafted comments are posted only when the user presses "Approve and send" on a finding.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuditRequest } from "@/lib/parse/schema";
import type { RecordRef } from "@/lib/engine/types";
import type { SourceInfo } from "@/lib/ramp/types";
import { Intake } from "./intake";
import { Plan } from "./plan";
import { RecordDrawer } from "./record-drawer";
import { Results } from "./results";
import { Running } from "./running";
import { type Stage, type Parsed, type RunState } from "./shared";

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
  // Start reading Ramp in the background while the user picks a list. Only useful on live data.
  useEffect(() => {
    if (source.kind !== "fixture") void fetch("/api/warm", { method: "POST" }).catch(() => {});
  }, [source.kind]);
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
