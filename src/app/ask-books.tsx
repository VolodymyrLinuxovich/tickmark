"use client";

// "Ask your books": a question box on the results screen. The free keyword reader answers first;
// the model is only called after the user agrees, and every answer says which one read the question.

import { useState } from "react";
import type { Plan } from "@/lib/ask/plan";
import type { AskResult } from "@/lib/ask/run";
import type { RecordRef } from "@/lib/engine/types";

export interface BinderExtra {
  question: string;
  plan: Plan;
  title: string;
  total: number;
  period?: { from: string; to: string };
}

const EXAMPLES = [
  "Charges over $75 with no receipt",
  "Weekend charges over $500",
  "Charges in the Software category over $1,000",
  "Bills over $20,000",
  "Users with admin access",
];

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function AskBooks({ periodFrom, periodTo, openRecord, extras, onAdd }: { periodFrom: string | null; periodTo: string | null; openRecord: (r: RecordRef) => void; extras: BinderExtra[]; onAdd: (x: BinderExtra) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsModel, setNeedsModel] = useState(false);
  const [answer, setAnswer] = useState<{ question: string; by: string; plan: Plan; result: AskResult } | null>(null);

  async function ask(question: string, allowModel = false) {
    if (question.trim().length < 3) return;
    setBusy(true);
    setErr(null);
    setNeedsModel(false);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, period_from: periodFrom, period_to: periodTo, allow_model: allowModel }) });
      const json = await res.json();
      if (json.needs_model) {
        setNeedsModel(true);
        setAnswer(null);
      } else if (!res.ok || json.error) {
        setErr(json.error ?? "Something went wrong.");
      } else {
        setAnswer({ question, by: json.by, plan: json.plan, result: json.result });
      }
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const added = answer && extras.some((x) => x.question === answer.question);
  return (
    <section className="card ask" aria-labelledby="ask-h">
      <div className="ask-head">
        <div>
          <h3 id="ask-h">Ask your books</h3>
          <p>Ask about any spend in Ramp. Tickmark turns the question into a filter and runs it on every record.</p>
        </div>
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <label htmlFor="ask-q" className="sr-only">Question about your Ramp data</label>
        <input id="ask-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Card charges over $1,000 with no memo" autoComplete="off" />
        <button type="submit" className="btn primary" disabled={busy || q.trim().length < 3}>{busy ? "Searching..." : "Ask"}</button>
      </form>
      <div className="ask-examples">
        {EXAMPLES.map((e) => (
          <button
            type="button"
            key={e}
            className="chip"
            disabled={busy}
            onClick={() => {
              setQ(e);
              void ask(e);
            }}
          >
            {e}
          </button>
        ))}
      </div>

      {needsModel && (
        <div className="note ask-model">
          The keyword reader could not find an amount, merchant, person or date in that question.
          <button type="button" className="btn small" onClick={() => void ask(q, true)} disabled={busy}>Read it with AI</button>
        </div>
      )}
      {err && <div className="error" role="alert">{err}</div>}

      {answer && (
        <div className="ask-answer" aria-live="polite">
          <div className="ask-sum">
            <b>{answer.result.total.toLocaleString("en-US")}</b> {answer.result.entity}
            {answer.result.sum != null && <> · <b>{usd(answer.result.sum)}</b></>}
            <span className="ask-by">Read by {answer.by}</span>
            <button type="button" className="btn small" disabled={!!added || answer.result.total === 0} onClick={() => onAdd({ question: answer.question, plan: answer.plan, title: answer.result.title, total: answer.result.total, period: answer.result.period })}>
              {added ? "Added to binder" : "Add to binder"}
            </button>
          </div>
          <div className="ask-filters">{answer.result.filters.map((f) => <span className="tag" key={f}>{f}</span>)}</div>
          {answer.result.rows.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr>{answer.result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {answer.result.rows.map((r) => (
                    <tr key={r.record.id}>
                      {r.cells.map((c, i) => (
                        <td key={i} className={/^\$/.test(c) ? "num" : c.length <= 14 ? "nw" : ""}>
                          {i === (answer.result.entity === "transactions" || answer.result.entity === "bills" ? 1 : 0) ? <button type="button" className="rec" onClick={() => openRecord(r.record)}>{c}</button> : c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No records match.</p>
          )}
          {answer.result.total > answer.result.rows.length && (
            <p className="muted ask-more">
              Showing {answer.result.rows.length} of {answer.result.total}.{" "}
              {answer.plan.limit != null ? `The binder keeps the top ${answer.plan.limit}.` : "The binder includes all of them."}
            </p>
          )}
        </div>
      )}
      {extras.length > 0 && <p className="ask-added">In the binder: {extras.map((x) => x.title).join(" · ")}</p>}
    </section>
  );
}
