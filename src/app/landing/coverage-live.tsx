"use client";

// Animated coverage chart. Bars grow and counts tick up when the chart scrolls into
// view, then a scan line keeps sweeping each Tickmark bar to show checks running.

import { useEffect, useRef, useState } from "react";

export interface CoverageRow {
  check: string;
  population: string;
  n: number;
  manual: number;
}

export interface CoverageLabels {
  all: string;
  manual: string; // {m}
  instead: string;
  tip: string; // {n} {pop} {m}
}

const DEFAULT_LABELS: CoverageLabels = {
  all: "Tickmark checks every record",
  manual: "Manual sample of {m}",
  instead: "record checks instead of",
  tip: "{n} {pop} checked. A manual test would look at {m}.",
};

const fillIn = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

export function CoverageLive({ data, manualSample, labels = DEFAULT_LABELS }: { data: CoverageRow[]; manualSample: number; labels?: CoverageLabels }) {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const run = () => {
      if (reduce) {
        setP(1);
        setLive(false);
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const x = Math.min(1, (now - t0) / 2200);
        setP(1 - Math.pow(1 - x, 3));
        if (x < 1) raf = requestAnimationFrame(step);
        else setLive(true);
      };
      cancelAnimationFrame(raf);
      setLive(false);
      raf = requestAnimationFrame(step);
    };
    if (!("IntersectionObserver" in window)) {
      run();
      return;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && run(), { threshold: 0.3 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const max = Math.max(...data.map((r) => r.n));
  const total = data.reduce((a, r) => a + r.n, 0);
  const manualTotal = data.reduce((a, r) => a + r.manual, 0);
  const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

  return (
    <div ref={ref} className={`cov-live ${live ? "live" : ""}`}>
      <div className="cov-head">
        <div className="cov-legend" aria-hidden>
          <span><i className="cov-key tick" /> {labels.all}</span>
          <span><i className="cov-key manual" /> {fillIn(labels.manual, { m: manualSample })}</span>
        </div>
        <div className="cov-total">
          <span className={`cov-pulse ${live ? "on" : ""}`} aria-hidden />
          <b>{fmt(total * p)}</b> {labels.instead} <b>{fmt(manualTotal * Math.min(1, p * 3))}</b>
        </div>
      </div>
      <div className="cov-rows" role="img" aria-label={`Records checked per test. ${data.map((r) => `${r.check}: ${r.n} by Tickmark, ${r.manual} by hand`).join(". ")}.`}>
        {data.map((r, i) => (
          <div className="cov-row" key={r.check} tabIndex={0}>
            <span className="cov-label">{r.check}</span>
            <span className="cov-track">
              <span className="cov-bar tick" style={{ width: `${(100 * r.n * p) / max}%`, ["--scan-delay" as string]: `${i * 0.35}s` }} />
              <span className="cov-bar manual" style={{ width: `${(100 * r.manual * Math.min(1, p * 3)) / max}%` }} />
              <span className="cov-tip">
                {fillIn(labels.tip, { n: r.n.toLocaleString("en-US"), pop: r.population, m: r.manual })}
              </span>
            </span>
            <span className="cov-val">{fmt(r.n * p)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
