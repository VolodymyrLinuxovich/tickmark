"use client";

// Closes the loop with Ramp. After a follow-up is sent or a receipt attached, the finding is
// watched: every few seconds /api/recheck asks Ramp what it shows now. Replies on the thread
// appear under the card, and when Ramp shows the fix the finding is marked resolved by itself.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RecheckItem, RecheckResult } from "@/lib/ramp/types";
import { AUTO_RESOLVABLE } from "@/lib/engine/recheck";

const POLL_MS = 4_000;
const WATCH_FOR_MS = 30 * 60_000; // stop asking after half an hour

interface Watched {
  item: RecheckItem;
  result: RecheckResult | null;
  started: number;
  error: boolean;
}

interface WatchApi {
  watch: (item: RecheckItem) => void;
  get: (id: string) => Watched | undefined;
  watching: number;
  resolved: number;
}

const WatchContext = createContext<WatchApi>({ watch: () => {}, get: () => undefined, watching: 0, resolved: 0 });
export const useWatch = () => useContext(WatchContext);

/** Holds the watch list for one results view and polls Ramp while anything is unresolved. */
export function WatchProvider({ children, onResolved }: { children: React.ReactNode; onResolved: (findingId: string, how: string) => void }) {
  const [map, setMap] = useState<Record<string, Watched>>({});
  const mapRef = useRef(map);
  const resolvedRef = useRef(onResolved);
  const busy = useRef(false);
  useEffect(() => {
    mapRef.current = map;
    resolvedRef.current = onResolved;
  });

  const watch = useCallback((item: RecheckItem) => {
    setMap((m) => ({ ...m, [item.finding_id]: { item: { ...m[item.finding_id]?.item, ...item }, result: m[item.finding_id]?.result?.resolved ? m[item.finding_id].result : null, started: Date.now(), error: false } }));
  }, []);

  // Polling runs while anything is unresolved; each tick skips items watched for too long.
  const pending = Object.values(map).filter((w) => !w.result?.resolved).length;
  useEffect(() => {
    if (!pending) return;
    const tick = async () => {
      if (busy.current || document.hidden) return;
      const due = Object.values(mapRef.current).filter((w) => !w.result?.resolved && Date.now() - w.started < WATCH_FOR_MS).slice(0, 60);
      if (!due.length) return;
      busy.current = true;
      try {
        const res = await fetch("/api/recheck", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: due.map((w) => w.item) }) });
        const json = (await res.json()) as { results?: RecheckResult[] };
        if (!res.ok || !json.results) throw new Error();
        const fresh = json.results;
        setMap((m) => {
          const next = { ...m };
          for (const r of fresh) if (next[r.finding_id]) next[r.finding_id] = { ...next[r.finding_id], result: r, error: false };
          return next;
        });
        for (const r of fresh) if (r.resolved && !mapRef.current[r.finding_id]?.result?.resolved) resolvedRef.current(r.finding_id, r.how ?? "Fixed in Ramp");
      } catch {
        setMap((m) => Object.fromEntries(Object.entries(m).map(([k, w]) => [k, due.some((d) => d.item.finding_id === k) ? { ...w, error: true } : w])));
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [pending]);

  const api = useMemo<WatchApi>(
    () => ({
      watch,
      get: (id) => map[id],
      watching: Object.values(map).filter((w) => !w.result?.resolved).length,
      resolved: Object.values(map).filter((w) => w.result?.resolved).length,
    }),
    [map, watch],
  );
  return <WatchContext.Provider value={api}>{children}</WatchContext.Provider>;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Seconds since a time, re-rendered every second while shown. */
function useAgo(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
}

/** Under a finding card: the thread replies and whether Ramp shows the fix yet. */
export function LiveThread({ id }: { id: string }) {
  const w = useWatch().get(id);
  const ago = useAgo(w?.result?.checked_at);
  if (!w) return null;
  const r = w.result;
  const where = r?.simulated ? "the sample company" : "Ramp";
  // Missing receipts and approvals resolve on their own. Other problems need the auditor's judgement on the reply.
  const auto = AUTO_RESOLVABLE.has(w.item.code);
  const replies = r?.replies.length ?? 0;
  const checked = ago != null ? `, checked ${ago}s ago` : "";
  const waiting = w.error
    ? "Could not reach Ramp. Trying again."
    : auto
      ? `Watching ${where} for the fix${checked}.`
      : replies
        ? "Reply received. Set the status below once you are satisfied."
        : `Watching the ${where} thread for a reply${checked}.`;
  return (
    <div className={`live ${r?.resolved ? "done" : ""}`} aria-live="polite">
      {r?.replies.map((x) => (
        <div className="live-reply" key={x.id}>
          <span className="live-avatar" aria-hidden>{x.author.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>
          <div>
            <div className="live-who">{x.author} <time>{clock(x.created_at)}</time></div>
            <div>{x.message}</div>
          </div>
        </div>
      ))}
      {r?.resolved ? (
        <div className="live-status ok">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {r.how} at {clock(r.checked_at)}. Marked resolved.{r.simulated ? " Simulated on sample data." : ""}
        </div>
      ) : (
        <div className="live-status">
          <span className="live-dot" aria-hidden />
          {waiting}
        </div>
      )}
    </div>
  );
}
