"use client";

// Exceptions: grouped list, one card per finding with its drafted Ramp comment, and open/resolved/waived statuses.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ExceptionStatus, ExceptionStatuses } from "@/lib/binder/build";
import type { Finding, FindingCode, RecordRef } from "@/lib/engine/types";
import { LiveThread, useWatch } from "../loop";
import type { SourceInfo } from "@/lib/ramp/types";

/** Plural names for exception types, used in the summary and filters. */
export const GROUP_LABEL: Record<FindingCode, string> = {
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
export const ONE_LABEL: Record<FindingCode, string> = {
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

export const countLabel = (c: FindingCode, n: number) => `${n} ${(n === 1 ? ONE_LABEL : GROUP_LABEL)[c].toLowerCase()}`;

export const NO_OWNER = "No owner";

export const PAGE = 10;

export const TOP_PEOPLE = 5;

/**
 * Exception list that reads like an auditor's summary: who to follow up with and for what,
 * the count per exception type, and the cards themselves ten at a time. Clicking a person or
 * a type filters the cards. Short lists skip the summary.
 */
export function ExceptionList({ items, openRecord, sent, setSent, source }: { items: { f: Finding; refs?: string[] }[]; openRecord: (x: RecordRef) => void; sent: Record<string, string>; setSent: (s: Record<string, string>) => void; source: SourceInfo }) {
  const [person, setPerson] = useState<string | null>(null);
  const [code, setCode] = useState<FindingCode | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [allPeople, setAllPeople] = useState(false);
  const [showLow, setShowLow] = useState(false);

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

  const matching = items.filter(({ f }) => (!person || (f.owner?.name ?? NO_OWNER) === person) && (!code || f.code === code));
  // Low items are small and real, but listing them first buries what an auditor will ask about.
  const lowCount = matching.filter(({ f }) => f.severity === "low").length;
  const filtered = showLow ? matching : matching.filter(({ f }) => f.severity !== "low");
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
      {lowCount > 0 && filtered.length <= shown && (
        <button className="ex-more" onClick={() => setShowLow(!showLow)}>
          {showLow ? "Hide low severity items" : `Show ${lowCount} low severity item${lowCount > 1 ? "s" : ""}`}
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
export function FindingCard({ f, refs, openRecord, sent, setSent, source }: { f: Finding; refs?: string[]; openRecord: (x: RecordRef) => void; sent: Record<string, string>; setSent: (s: Record<string, string>) => void; source: SourceInfo }) {
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
export const StatusContext = createContext<{ statuses: ExceptionStatuses; set: (id: string, s: ExceptionStatus) => void }>({ statuses: {}, set: () => {} });

export const STATUS_KEY = "tickmark-exception-statuses";

export function useStatuses() {
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
export function StatusControl({ id }: { id: string }) {
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
