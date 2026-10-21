"use client";

// Animated stand-in for a product screenshot: the sample audit runs on a loop.
// Numbers and text are a real run of the sample request list on Ramp's sandbox company
// Save Time Inc (Oct 2026), including the approval nudge Tickmark actually posted to Ramp.

import { useEffect, useRef, useState } from "react";
import "./product-demo.css";

const REQUESTS: { ref: string; type: string; headline: string; status: "ok" | "ex" | "manual" }[] = [
  { ref: "PBC-01", type: "Manual", headline: "Outside Ramp data. Assigned to the team.", status: "manual" },
  { ref: "PBC-02", type: "Transaction support", headline: "10 exceptions in 12 items tested", status: "ex" },
  { ref: "PBC-03", type: "Bill support", headline: "No bills over $10,000 in the period", status: "ok" },
  { ref: "PBC-04", type: "Missing receipts", headline: "42 of 357 charges over $75 have no receipt", status: "ex" },
  { ref: "PBC-05", type: "Control testing", headline: "113 control exceptions across 1,186 records", status: "ex" },
  { ref: "PBC-06", type: "Duplicate payments", headline: "No duplicates in 6 bills", status: "ok" },
  { ref: "PBC-07", type: "Vendor listing", headline: "419 vendors, 2 paid within 14 days of setup", status: "ex" },
  { ref: "PBC-08", type: "User access", headline: "5 users with elevated access", status: "ok" },
  { ref: "PBC-09", type: "Manual", headline: "Outside Ramp data. Assigned to the team.", status: "manual" },
];

// Timeline in ms within one loop.
const START = 600;
const STEP = 420;
const DONE = START + REQUESTS.length * STEP;
const FINDING = DONE + 500;
const DRAFT = "Hi Michael, this $12,994.80 Asana charge is still waiting for your approval in Ramp. Our auditors are testing it. Could you review it this week?";
const TYPE = FINDING + 700; // the follow-up starts typing
const TYPE_MS = 1900;
const APPROVE = TYPE + TYPE_MS + 600; // button press
const SENT = APPROVE + 350; // message leaves, thread bubble lands
const LOOP = SENT + 3600;

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, inView };
}

export function ProductDemo() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [t, setT] = useState(LOOP - 1); // final frame until it is on screen
  useEffect(() => {
    if (!inView) return;
    // Reduced motion: keep the initial final frame.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setT((now - t0) % LOOP);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView]);

  const done = Math.max(0, Math.min(REQUESTS.length, Math.floor((t - START) / STEP) + 1));
  const p = Math.min(1, Math.max(0, (t - START) / (DONE - START)));
  const ease = 1 - Math.pow(1 - p, 3);
  const exceptions = Math.round(157 * ease);
  const rows = Math.round(596 * ease);
  const answered = REQUESTS.slice(0, done).filter((r) => r.status !== "manual").length;
  const typed = t < TYPE ? 0 : Math.min(DRAFT.length, Math.round(((t - TYPE) / TYPE_MS) * DRAFT.length));
  const typing = t >= TYPE && t < APPROVE;

  return (
    <div className="demo" ref={ref} aria-hidden>
      <div className="demo-bar">
        <span className="demo-dots"><i /><i /><i /></span>
        <span className="demo-url">tickmark / sample audit</span>
      </div>
      <div className="demo-body">
        <div className="demo-head">
          <div>
            <div className="demo-title">Evidence binder for Save Time Inc</div>
            <div className="demo-sub">Live from Ramp: 1,180 transactions, last 12 months</div>
          </div>
          <span className={`demo-btn ${t >= DONE ? "on" : ""}`}>Download binder</span>
        </div>
        <div className="demo-stats">
          <div><span>Answered</span><b>{answered}/9</b></div>
          <div><span>Evidence rows</span><b>{rows}</b></div>
          <div><span>Exceptions</span><b className={exceptions ? "warn" : ""}>{exceptions}</b></div>
          <div><span>Drafts sent</span><b>{t >= SENT ? 1 : 0}</b></div>
        </div>
        <div className="demo-grid">
          <ul className="demo-list">
            {REQUESTS.map((r, i) => {
              const state = i < done ? r.status : i === done && t >= START && t < DONE ? "spin" : "wait";
              return (
                <li key={r.ref} className={`demo-req ${i < done ? "in" : ""}`}>
                  <span className={`demo-st ${state}`}>{state === "ok" ? "✓" : state === "ex" ? "!" : state === "manual" ? "–" : ""}</span>
                  <span className="demo-ref">{r.ref}</span>
                  <span className="demo-type">{r.type}</span>
                  <span className="demo-hl">{i < done ? r.headline : ""}</span>
                </li>
              );
            })}
          </ul>
          <div className={`demo-finding ${t >= FINDING ? "in" : ""}`}>
            <div className="demo-ft">
              <b>Approval still pending</b>
              <span className="demo-sev">High</span>
            </div>
            <p>$12,994.80 at Asana, above the $5,000 pre-approval limit. Ramp opened an approval, but Michael Scott has not signed off.</p>
            {/* The follow-up types itself, then flies into the Ramp thread once approved. */}
            <div className="demo-slot">
              <div className={`demo-draft ${t >= SENT ? "flying" : ""}`}>
                {DRAFT.slice(0, typed)}
                {typing && <span className="demo-caret" />}
              </div>
              <div className={`demo-thread ${t >= SENT ? "in" : ""}`}>
                <span className="demo-thread-av">M</span>
                <div>
                  <div className="demo-thread-k">Ramp thread · Asana $12,994.80</div>
                  <div className="demo-thread-t">@Michael Scott Hi Michael, this $12,994.80 Asana charge…</div>
                </div>
              </div>
            </div>
            <span className={`demo-send ${t >= APPROVE && t < SENT ? "press" : ""} ${t >= SENT ? "sent" : ""}`}>
              {t >= SENT && (
                <svg className="demo-check" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                  <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {t >= SENT ? "Sent to the Ramp thread" : "Approve and send"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
