"use client";

// Receipt hunter. For charges with no receipt, the user drops the receipt emails, PDFs or photos
// they have (or tries a generated demo inbox). Tickmark matches each file to a charge by amount,
// merchant and date, shows why, and attaches it to the Ramp transaction on approval. The
// attached charges are then watched, so they flip to resolved when Ramp shows the receipt.

import { useState } from "react";
import type { Finding } from "@/lib/engine/types";
import type { SourceInfo } from "@/lib/ramp/types";
import type { ReceiptMatch, ReceiptTarget } from "@/lib/receipts/match";
import { useWatch } from "./loop";

interface DocSummary {
  index: number;
  name: string;
  kind: string;
  from: string | null;
  subject: string | null;
  total: number | null;
  date: string | null;
  content?: string; // demo inbox only
}
interface MatchResponse {
  targets: ReceiptTarget[];
  docs: DocSummary[];
  matches: ReceiptMatch[];
  demo?: boolean;
  error?: string;
}

const ROWS = 6;
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const sender = (from: string | null) => from?.replace(/\s*<[^>]*>/, "").replace(/"/g, "") ?? null;

export function ReceiptHunter({ findings, source }: { findings: Finding[]; source: SourceInfo }) {
  const { watch, get } = useWatch();
  const [phase, setPhase] = useState<"idle" | "reading" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MatchResponse | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [att, setAtt] = useState<Record<string, "busy" | "done" | string>>({});
  const [over, setOver] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const targets = findings
    .map((f) => ({ finding_id: f.id, transaction_id: f.records.find((r) => r.type === "transaction")?.id ?? "" }))
    .filter((t) => t.transaction_id);

  async function match(body: FormData | { demo: true }, count: number) {
    setPhase("reading");
    setError(null);
    setAtt({});
    try {
      const init: RequestInit =
        body instanceof FormData
          ? (body.append("targets", JSON.stringify(targets)), { method: "POST", body })
          : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true, targets }) };
      const res = await fetch("/api/receipts/match", init);
      const json = (await res.json()) as MatchResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not read the files");
      setData(json);
      setPhase("ready");
    } catch (e) {
      setError(`${(e as Error).message}${count ? ` (${count} files)` : ""}`);
      setPhase("idle");
    }
  }

  function pick(list: FileList | null) {
    const arr = [...(list ?? [])].slice(0, 200);
    if (!arr.length) return;
    setFiles(arr);
    const fd = new FormData();
    for (const f of arr) fd.append("files", f);
    match(fd, arr.length);
  }

  /** Attaches one match. Returns false when Ramp refused permission, so "Attach all" stops instead of failing every row. */
  async function attach(m: ReceiptMatch): Promise<boolean> {
    if (!data) return true;
    const t = data.targets.find((x) => x.transaction_id === m.transaction_id);
    const doc = data.docs[m.doc];
    const file = data.demo ? new File([doc.content ?? ""], doc.name, { type: "message/rfc822" }) : files[m.doc];
    if (!t || !file) return true;
    setError(null);
    setAtt((a) => ({ ...a, [m.finding_id]: "busy" }));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("transaction_id", t.transaction_id);
    fd.append("user_id", t.user_id);
    try {
      const res = await fetch("/api/receipts/attach", { method: "POST", body: fd });
      const json = await res.json();
      if (res.status === 403) {
        setError(json.error);
        setAtt((a) => ({ ...a, [m.finding_id]: "" }));
        return false;
      }
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setAtt((a) => ({ ...a, [m.finding_id]: "done" }));
      watch({ finding_id: m.finding_id, code: "MISSING_RECEIPT", object_type: "transactions", object_id: t.transaction_id, since: new Date().toISOString(), owner: t.owner, attached: true });
    } catch (e) {
      setAtt((a) => ({ ...a, [m.finding_id]: (e as Error).message }));
    }
    return true;
  }

  async function attachAll() {
    setError(null);
    for (const m of data?.matches ?? []) if (att[m.finding_id] !== "busy" && att[m.finding_id] !== "done" && !(await attach(m))) break;
  }

  const matched = data?.matches.length ?? 0;
  const left = (data?.matches ?? []).filter((m) => att[m.finding_id] !== "done").length;
  const confirmed = (data?.matches ?? []).filter((m) => get(m.finding_id)?.result?.resolved).length;
  const where = source.kind === "fixture" ? "the sample company" : "Ramp";

  return (
    <section className="card hunt" aria-label="Receipt hunter">
      <div className="hunt-head">
        <div>
          <h3>Receipt hunter</h3>
          <p className="muted">
            {targets.length} {targets.length === 1 ? "charge is" : "charges are"} missing a receipt. Drop the receipt emails, PDFs or photos you have. Tickmark matches each one to its charge by amount, merchant and date, and attaches it in {where} when you approve.
          </p>
        </div>
        {phase === "ready" && (
          <button className="ex-more" onClick={() => { setPhase("idle"); setData(null); }}>Start over</button>
        )}
      </div>

      {phase !== "ready" && (
        <label
          className={`hunt-drop ${over ? "over" : ""} ${phase === "reading" ? "busy" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
        >
          <input type="file" multiple accept=".eml,.pdf,.png,.jpg,.jpeg,.webp,.txt,message/rfc822,application/pdf,image/*" onChange={(e) => pick(e.target.files)} disabled={phase === "reading"} />
          {phase === "reading" ? (
            <span><span className="live-dot" aria-hidden /> Reading receipts and matching them to charges...</span>
          ) : (
            <span><b>Drop receipts here</b> or choose files. Emails (.eml), PDFs and photos.</span>
          )}
        </label>
      )}
      {phase === "idle" && (
        <div className="hunt-or">
          <button className="btn small" onClick={() => match({ demo: true }, 0)}>Try a demo inbox</button>
          <span className="muted">Receipt emails generated from this audit&apos;s missing receipts, so you can see the flow.</span>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {phase === "ready" && data && (
        <>
          <div className="hunt-sum">
            <div>
              <b>Matched {matched} of {data.targets.length}</b> charges from {data.docs.length} {data.docs.length === 1 ? "file" : "files"}{data.demo ? " in the demo inbox" : ""}.{" "}
              {data.targets.length - matched > 0 && <>{data.targets.length - matched} still need a person, so send their follow-ups below. </>}
              {confirmed > 0 && <span className="hunt-ok">{confirmed} confirmed in {where}.</span>}
            </div>
            {left > 0 && <button className="btn primary small" onClick={attachAll}>Attach {left === matched ? "all " : ""}{left} in {where}</button>}
          </div>
          <div className="hunt-list">
            {data.matches.slice(0, showAll ? undefined : ROWS).map((m) => {
              const t = data.targets.find((x) => x.transaction_id === m.transaction_id)!;
              const d = data.docs[m.doc];
              const st = att[m.finding_id];
              const ok = get(m.finding_id)?.result?.resolved;
              return (
                <div className={`hunt-row ${ok ? "ok" : ""}`} key={m.finding_id}>
                  <div className="hunt-charge">
                    <b>{t.merchant}</b> <span className="mono">{usd(t.amount)}</span>
                    <div className="muted">{day(t.date)}, {t.owner}</div>
                  </div>
                  <div className="hunt-file">
                    <div className="hunt-subj">{d.subject ?? d.name}</div>
                    <div className="muted">{[sender(d.from), d.name].filter(Boolean).join(" · ")}</div>
                    <div className="hunt-why">
                      <span className={`hunt-conf ${m.confidence}`}>{m.confidence === "strong" ? "Strong match" : "Likely match"}</span>
                      {m.reasons.map((r) => <span className="tag" key={r}>{r}</span>)}
                    </div>
                  </div>
                  <div className="hunt-act">
                    {ok ? (
                      <span className="hunt-ok">Receipt in {where}</span>
                    ) : st === "done" ? (
                      <span className="muted"><span className="live-dot" aria-hidden /> Attached. Checking...</span>
                    ) : st === "busy" ? (
                      <span className="muted">Attaching...</span>
                    ) : (
                      <button className="btn small" onClick={() => attach(m)}>Attach</button>
                    )}
                    {st && st !== "busy" && st !== "done" && <div className="error">{st}</div>}
                  </div>
                </div>
              );
            })}
            {data.matches.length > ROWS && (
              <button className="ex-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${data.matches.length} matches`}</button>
            )}
            {!data.matches.length && <p className="muted">None of these files matched a charge with no receipt.</p>}
          </div>
        </>
      )}
    </section>
  );
}
