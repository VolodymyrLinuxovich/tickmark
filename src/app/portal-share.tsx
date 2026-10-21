"use client";

// Controller side of the auditor portal: create a share link, then see and answer the auditor's questions.
// The owner key lives only in this browser (localStorage); without it nobody can answer.

import { useCallback, useEffect, useState } from "react";
import type { AuditRequest } from "@/lib/parse/schema";
import type { PortalQuestion } from "@/lib/portal/store";

interface Shared {
  id: string;
  owner_key: string;
  expires_at: string;
  business: string;
}

const KEY = "tickmark.portals";
const loadShared = (): Shared[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Shared[];
  } catch {
    return [];
  }
};
const saveShared = (xs: Shared[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(xs.slice(-10)));
  } catch {
    // private window: the link still works, answering needs this tab
  }
};

export function PortalShare({ requests, business, auditor }: { requests: AuditRequest[]; business: string; auditor: string | null }) {
  const [shared, setShared] = useState<Shared | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [questions, setQuestions] = useState<PortalQuestion[]>([]);

  // Reuse the latest portal shared for this business from this browser.
  useEffect(() => {
    const mine = loadShared().filter((s) => s.business === business && new Date(s.expires_at) > new Date());
    const t = setTimeout(() => setShared(mine.at(-1) ?? null), 0);
    return () => clearTimeout(t);
  }, [business]);

  const refresh = useCallback(async () => {
    if (!shared) return;
    const r = await fetch(`/api/portal/${shared.id}/questions`).catch(() => null);
    if (r?.ok) setQuestions((await r.json()).questions);
  }, [shared]);
  useEffect(() => {
    if (!shared) return;
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 10000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [shared, refresh]);

  async function share() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests, business, auditor }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const s: Shared = { id: j.id, owner_key: j.owner_key, expires_at: j.expires_at, business };
      saveShared([...loadShared(), s]);
      setShared(s);
      setQuestions([]);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const url = shared ? `${typeof window !== "undefined" ? window.location.origin : ""}/portal/${shared.id}` : "";
  const open = questions.filter((q) => !q.answer).length;
  return (
    <section className="card share" aria-labelledby="share-h">
      <div className="share-head">
        <div>
          <h3 id="share-h">Share with your auditor</h3>
          <p>A read-only link: the auditor sees each request, its evidence and exceptions, downloads the binder, and asks questions here instead of over email.</p>
        </div>
        {!shared && <button className="btn primary" onClick={share} disabled={busy}>{busy ? "Creating link..." : "Create auditor link"}</button>}
      </div>
      {err && <div className="error">{err}</div>}
      {shared && (
        <>
          <div className="share-link">
            <code>{url}</code>
            <button
              className="btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <a className="btn small" href={url} target="_blank" rel="noreferrer">Open</a>
            <button className="btn link" onClick={share} disabled={busy}>New link</button>
          </div>
          <p className="muted share-fine">Expires {new Date(shared.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Anyone with the link can view; only this browser can answer questions.</p>
          <div className="label">Auditor questions {open > 0 && <span className="sev medium">{open} open</span>}</div>
          {questions.length === 0 ? <p className="muted">No questions yet. They appear here as soon as the auditor asks.</p> : questions.map((q) => <Answer key={q.id} q={q} shared={shared} onDone={refresh} />)}
        </>
      )}
    </section>
  );
}

function Answer({ q, shared, onDone }: { q: PortalQuestion; shared: Shared; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const r = await fetch(`/api/portal/${shared.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner_key: shared.owner_key, question_id: q.id, text }) });
      if (r.ok) {
        setText("");
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pq">
      <div className="pq-ask"><span className="tag mono">{q.ref}</span> <b>{q.name ?? "Auditor"}</b><p>{q.text}</p></div>
      {q.answer ? (
        <div className="pq-ans"><b>You</b><p>{q.answer.text}</p></div>
      ) : (
        <div className="pq-form row">
          <label className="sr-only" htmlFor={`a-${q.id}`}>Answer</label>
          <input id={`a-${q.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer the auditor" />
          <button className="btn primary small" onClick={send} disabled={busy || !text.trim()}>{busy ? "Sending..." : "Answer"}</button>
        </div>
      )}
    </div>
  );
}
