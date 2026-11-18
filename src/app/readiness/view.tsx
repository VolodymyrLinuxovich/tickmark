"use client";

// Readiness view: the score, the week-by-week trend, who has open items, and the fresh exceptions
// with their drafted follow-ups. Sending reuses the workbench cards, so nothing goes out without approval.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Readiness } from "@/lib/engine/readiness";
import { readinessDays } from "@/lib/engine/readiness-days";
import type { RecordRef } from "@/lib/engine/types";
import type { SourceInfo } from "@/lib/ramp/types";
import { fixNowCsv } from "@/lib/engine/readiness-csv";
import { WatchProvider } from "../loop";
import { ExceptionList, GROUP_LABEL, StatusContext, useStatuses, type SentMap } from "../workbench/exceptions";
import { RecordDrawer } from "../workbench/record-drawer";

type Data = Readiness & { source: SourceInfo; ms: number };

/** Saves the Fix now list as a CSV named for the window, built in the browser from what is on screen. */
function downloadCsv(data: Data) {
  const blob = new Blob([fixNowCsv(data.fix_now)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tickmark-fix-now-${data.from}-to-${data.to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const short = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function ReadinessView({ source }: { source: SourceInfo }) {
  // /readiness?days=30 opens on the 30 day window, so the link can be shared.
  const search = useSearchParams();
  const [days, setDays] = useState(() => readinessDays(search.get("days")));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<RecordRef | null>(null);

  /**
   * Switches the window and clears the old result, so the loading line shows while the new one runs.
   * The URL follows, so the address bar is a link to the window on screen.
   */
  function pick(d: number) {
    if (d !== days) {
      setData(null);
      setError(null);
      setDays(d);
      const url = new URL(window.location.href);
      url.searchParams.set("days", String(d));
      window.history.replaceState(window.history.state, "", url);
    }
  }

  useEffect(() => {
    let live = true;
    fetch(`/api/readiness?days=${days}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) {
          return;
        }
        if (j.error) {
          setError(j.error);
        } else {
          setData(j);
        }
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <main className="wrap" style={{ paddingTop: 28, paddingBottom: 48 }}>
      <div className="section-head">
        <div>
          <h1 className="page-title">Audit readiness</h1>
          <p>
            The year-end checks, run on the last {days} days. Fix problems while the charge is days old, not when the auditor&rsquo;s list arrives months later.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[30, 90, 180].map((d) => (
            <button key={d} className={`btn small${d === days ? " primary" : ""}`} onClick={() => pick(d)}>{d} days</button>
          ))}
        </div>
      </div>
      {error && <div className="card" style={{ padding: 16, color: "var(--warn)" }}>{error}</div>}
      {!data && !error && <p className="muted">Running the checks on recent Ramp data...</p>}
      {data && <Body data={data} source={source} openRecord={setRecord} />}
      {record && <RecordDrawer key={record.type + record.id} refd={record} onClose={() => setRecord(null)} />}
    </main>
  );
}

function Body({ data, source, openRecord }: { data: Data; source: SourceInfo; openRecord: (r: RecordRef) => void }) {
  const [sent, setSent] = useState<SentMap>({});
  const statusApi = useStatuses();
  const setStatus = statusApi.set;
  const onResolved = useCallback((id: string, how: string) => setStatus(id, { status: "resolved", note: how }), [setStatus]);
  const maxWeek = Math.max(1, ...data.weeks.map((w) => w.records));
  const sample = source.kind === "fixture";

  return (
    <StatusContext.Provider value={statusApi}>
      <WatchProvider onResolved={onResolved}>
        <div className="card stats">
          <div className="stat">
            <div className="k">Audit ready</div>
            <div className="v" style={{ color: data.score >= 90 ? "var(--tick)" : "var(--warn)" }}>{data.score}%</div>
            <div className="s">{data.clean} of {data.records} records clean</div>
          </div>
          <div className="stat">
            <div className="k">Open exceptions</div>
            <div className="v">{data.open}</div>
            <div className="s">{data.high} high severity</div>
          </div>
          <div className="stat">
            <div className="k">Fresh, easy to fix</div>
            <div className="v" style={{ color: "var(--tick)" }}>{data.fresh}</div>
            <div className="s">on records under 30 days old</div>
          </div>
          <div className="stat">
            <div className="k">Median age of a problem</div>
            <div className="v">{data.median_age_days ?? 0} days</div>
            <div className="s">{short(data.from)} to {short(data.to)}{sample ? ", sample company" : ""}</div>
          </div>
        </div>

        <div className="label">Week by week</div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }} role="img" aria-label="Records per week, clean and with open exceptions">
            {data.weeks.map((w) => {
              const h = (w.records / maxWeek) * 100;
              const ok = w.records ? (w.clean / w.records) * 100 : 0;
              return (
                <div key={w.start} title={`Week of ${short(w.start)}: ${w.clean} of ${w.records} clean`} style={{ flex: 1, height: `${h}%`, minHeight: w.records ? 4 : 0, display: "flex", flexDirection: "column-reverse", borderRadius: 4, overflow: "hidden", background: "var(--warn-bg)" }}>
                  <div style={{ height: `${ok}%`, background: "var(--tick)" }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {data.weeks.map((w, i) => (
              <div key={w.start} className="muted" style={{ flex: 1, fontSize: 11, textAlign: "center" }}>{i % 2 === 0 ? short(w.start) : ""}</div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <span style={{ color: "var(--tick)" }}>■</span> clean&nbsp;&nbsp; <span style={{ color: "var(--warn)" }}>■</span> open exception
          </div>
        </div>

        {data.by_code.length > 0 && (
          <>
            <div className="label">What is open</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {data.by_code.map((c) => (
                <span key={c.code} className="tag">{GROUP_LABEL[c.code]}: {c.n}</span>
              ))}
            </div>
          </>
        )}

        {data.owners.length > 0 && (
          <>
            <div className="label">Who to nudge this week</div>
            <div className="card">
              {data.owners.map((o) => (
                <div key={o.name} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--line)" }}>
                  <span><b>{o.name}</b> <span className="muted">· oldest {o.oldest_days} days</span></span>
                  <span>{o.fresh > 0 && <span style={{ color: "var(--tick)" }}>{o.fresh} fresh · </span>}{o.open} open</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div className="label">Fix now: drafted follow-ups for the last 30 days</div>
          {data.fix_now.length > 0 && (
            <button className="btn small" onClick={() => downloadCsv(data)}>Download CSV</button>
          )}
        </div>
        {data.fix_now.length ? (
          <ExceptionList items={data.fix_now.map((f) => ({ f }))} openRecord={openRecord} sent={sent} setSent={setSent} source={source} />
        ) : (
          <p className="muted">Nothing from the last 30 days needs a follow-up.</p>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
          Same checks and policy as the year-end run, on {data.records} card transactions and bills. Read in {(data.ms / 1000).toFixed(1)} s. Nothing is sent until you approve it.
        </p>
      </WatchProvider>
    </StatusContext.Provider>
  );
}
