"use client";

// Accuracy page motion: numbers count up, and the planted-problem table "runs"
// row by row, each row flipping from checking to found. Reduced motion shows the result.

import { useCallback, useEffect, useRef, useState } from "react";

function useStartOnView<T extends Element>(onStart: () => void) {
  const ref = useRef<T>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const go = () => {
      if (started.current) return;
      started.current = true;
      onStart();
    };
    if (!("IntersectionObserver" in window)) {
      const t = setTimeout(go, 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && go(), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [onStart]);
  return ref;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts from 0 to `to` once visible. */
export function CountUp({ to, ms = 1400, format = (v: number) => Math.round(v).toLocaleString("en-US") }: { to: number; ms?: number; format?: (v: number) => string }) {
  const [v, setV] = useState(to);
  const start = useCallback(() => {
    if (reduced()) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const x = Math.min(1, (now - t0) / ms);
      setV(to * (1 - Math.pow(1 - x, 3)));
      if (x < 1) requestAnimationFrame(step);
    };
    setV(0);
    requestAnimationFrame(step);
  }, [to, ms]);
  const ref = useStartOnView<HTMLSpanElement>(start);
  return <span ref={ref}>{format(v)}</span>;
}

export const formatUsd = (v: number) => (v / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export interface PlantedRow {
  key: string;
  description: string;
  code: string;
  found: boolean;
  by: string[];
}

/** Planted-problem table that checks each row in turn. */
export function PlantedTable({ rows }: { rows: PlantedRow[] }) {
  const [done, setDone] = useState(rows.length);
  const [active, setActive] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const run = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reduced()) {
      setDone(rows.length);
      setActive(-1);
      return;
    }
    setDone(0);
    rows.forEach((_, i) => {
      timers.current.push(setTimeout(() => setActive(i), 250 + i * 520));
      timers.current.push(setTimeout(() => setDone(i + 1), 250 + i * 520 + 420));
    });
    timers.current.push(setTimeout(() => setActive(-1), 250 + rows.length * 520));
  }, [rows]);
  const ref = useStartOnView<HTMLDivElement>(run);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const found = rows.slice(0, done).filter((r) => r.found).length;

  return (
    <div ref={ref} className="card acc-table">
      <div className="acc-bar">
        <span className={`acc-dot ${done < rows.length ? "run" : "ok"}`} aria-hidden />
        <span>{done < rows.length ? `Checking planted problem ${Math.min(done + 1, rows.length)} of ${rows.length}...` : `${found} of ${rows.length} planted problems found`}</span>
        <button type="button" className="btn small" onClick={run} disabled={done < rows.length}>Run again</button>
      </div>
      <div className="acc-progress" aria-hidden><span style={{ width: `${(100 * done) / rows.length}%` }} /></div>
      <div className="table-wrap" style={{ border: "none", maxHeight: "none", borderRadius: 0 }}>
        <table>
          <thead>
            <tr><th></th><th>Planted problem</th><th>Check</th><th>Found by</th></tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const state = i < done ? (p.found ? "found" : "missed") : i === active ? "checking" : "waiting";
              return (
                <tr key={p.key} className={`acc-row ${state}`}>
                  <td className="mono">{p.key}</td>
                  <td>{p.description}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{p.code}</td>
                  <td className="acc-found">
                    {state === "found" && <span className="acc-pill ok">✓ {p.by.join(", ")}</span>}
                    {state === "missed" && <span className="acc-pill bad">Missed</span>}
                    {state === "checking" && <span className="acc-pill run"><i className="status spin" /> Checking</span>}
                    {state === "waiting" && <span className="acc-pill wait">Queued</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
