// Landing page at /: the problem, the four-step flow and the list of checks.
// A server component; it reads the data source only to label the sample audit link.

import Link from "next/link";
import { getSource } from "@/lib/ramp/source";
import { TopBar } from "./topbar";
import { Reveal } from "./landing/reveal";

// Copy for the landing sections, kept as data so the JSX stays short.
const PROBLEMS = [
  {
    t: "A spreadsheet of requests",
    d: "Every audit starts with a list of asks: support for sampled card charges, approvals for large bills, a list of who has admin access.",
  },
  {
    t: "Evidence is scattered",
    d: "Each answer means finding a receipt, screenshotting an approval and matching a payment, then filing it in the right folder.",
  },
  {
    t: "Problems show up late",
    d: "A split purchase or a self-approved bill gets found by the auditor, weeks in, instead of by the finance team.",
  },
];

const STEPS = [
  { t: "Upload the request list", d: "Excel, CSV, PDF or the auditor's email. Tickmark reads each request into a plan you can check and edit." },
  { t: "Gather the evidence", d: "Receipts, approvals, bills and vendors come straight from Ramp, matched to the exact items the auditor picked." },
  { t: "Test the controls", d: "The checks auditors run, written as code: receipts, approvals, split purchases, duplicates, new vendors." },
  { t: "Fix and hand over", d: "Send the follow-ups you approve, then download a binder with an index, workpapers and every document." },
];

const CHECKS = [
  ["Missing receipts", "Card charges above the receipt threshold with nothing attached."],
  ["Receipt mismatches", "The receipt total does not match what the card was charged."],
  ["Split purchases", "Charges just under the approval limit that add up to more than it."],
  ["Self-approval", "The person who spent or owns the bill also approved it."],
  ["Approval after payment", "Money left the account before anyone approved it."],
  ["Duplicate invoices", "The same vendor invoice entered and paid twice."],
  ["Fast-paid new vendors", "A vendor paid within days of being set up."],
  ["Restricted merchants", "Spend at liquor stores, gambling sites and similar categories."],
];

export default function Landing() {
  const info = getSource().info;
  return (
    <>
      <TopBar info={info} landing />
      <main className="lp">
        {/* Intro */}
        <section className="lp-hero wrap">
          <div className="lp-hero-copy">
            <p className="eyebrow pop" style={{ animationDelay: "0ms" }}>Audit prep for Ramp customers</p>
            <h1 className="pop" style={{ animationDelay: "60ms" }}>
              Your auditor&rsquo;s request list, <em>answered from Ramp.</em>
            </h1>
            <p className="lede pop" style={{ animationDelay: "120ms" }}>
              Tickmark turns the year-end request list into a finished evidence binder, and flags control problems before the auditor finds them.
            </p>
            <div className="row pop" style={{ animationDelay: "180ms" }}>
              <Link href="/app?sample=xlsx" className="btn primary lg">Try it with a sample audit</Link>
              <Link href="/app" className="btn lg">Upload your list</Link>
            </div>
            <p className="fine pop" style={{ animationDelay: "240ms" }}>
              {info.kind === "fixture" ? "No Ramp account connected here yet, so the sample audit uses a generated company." : `Connected to ${info.label}.`}
            </p>
          </div>

          <div className="lp-stack" aria-hidden>
            <div className="mini pop-card" style={{ animationDelay: "300ms" }}>
              <div className="mini-k">Request from Hartwell &amp; Co.</div>
              <div className="mini-t"><span className="mono">PBC-03</span> Invoice, approval and proof of payment for all bills over $10,000.</div>
            </div>
            <div className="mini ok pop-card" style={{ animationDelay: "650ms" }}>
              <span className="mini-icon">
                <svg width="12" height="12" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div>
                <div className="mini-t">31 bills tested</div>
                <div className="mini-k">Invoices attached, approvals traced, payments matched</div>
              </div>
            </div>
            <div className="mini ex pop-card" style={{ animationDelay: "1000ms" }}>
              <span className="mini-icon">!</span>
              <div>
                <div className="mini-t">Paid Jun 2, approved Jun 9</div>
                <div className="mini-k">Crestline Contract Manufacturing, $22,300.00</div>
                <div className="mini-chip">Follow-up drafted for the bill owner</div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem */}
        <Reveal className="lp-section wrap" id="problem">
          <p className="eyebrow">The problem</p>
          <h2>Audit season still runs on email and screenshots.</h2>
          <div className="lp-grid3">
            {PROBLEMS.map((p, i) => (
              <div className="lp-card stagger" style={{ transitionDelay: `${i * 80}ms` }} key={p.t}>
                <span className="lp-num">{String(i + 1).padStart(2, "0")}</span>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </div>
            ))}
          </div>
          <figure className="lp-quote stagger" style={{ transitionDelay: "240ms" }}>
            <blockquote>&ldquo;Preparing for an audit means gathering receipts, matching transactions, and exporting clean records.&rdquo; It &ldquo;can take days.&rdquo;</blockquote>
            <figcaption>
              <a href="https://ramp.com/blog/prepare-data-for-audits-and-compliance-reviews" target="_blank" rel="noreferrer">Ramp blog, on audit prep</a>
            </figcaption>
          </figure>
        </Reveal>

        {/* Solution */}
        <Reveal className="lp-section wrap" id="solution">
          <p className="eyebrow">Our solution</p>
          <h2>Tickmark answers the list from data Ramp already has.</h2>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li className="stagger" style={{ transitionDelay: `${i * 80}ms` }} key={s.t}>
                <span className="flow-n">{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="lp-shot stagger" style={{ transitionDelay: "320ms" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/results.png" alt="Tickmark results: 7 of 9 requests answered from Ramp, 73 evidence rows, 8 exceptions listed by severity" width={1360} height={850} />
          </div>
        </Reveal>

        <Reveal className="lp-section wrap">
          <p className="eyebrow">What it checks</p>
          <h2>The tests auditors run, on every record.</h2>
          <div className="lp-checks">
            {CHECKS.map(([t, d], i) => (
              <div className="lp-check stagger" style={{ transitionDelay: `${i * 40}ms` }} key={t}>
                <b>{t}</b>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal className="lp-section wrap">
          <div className="lp-trust">
            <div className="stagger">
              <h3>The model reads. Code decides.</h3>
              <p>AI turns messy request lists into a plan you review. Every pass or fail is plain code on Ramp records, so results are repeatable.</p>
            </div>
            <div className="stagger" style={{ transitionDelay: "80ms" }}>
              <h3>Every line traces to Ramp</h3>
              <p>Each evidence row and exception links to the Ramp transaction, bill or vendor behind it.</p>
            </div>
            <div className="stagger" style={{ transitionDelay: "160ms" }}>
              <h3>Nothing sent without you</h3>
              <p>Follow-ups are drafts until you approve them. Tickmark only writes those approved comments.</p>
            </div>
          </div>
          <Link href="/eval" className="lp-proof stagger" style={{ transitionDelay: "240ms" }}>
            <span className="lp-proof-v">8 of 8</span>
            <span>planted problems found in the sample company, with 0 false alarms.</span>
            <span className="lp-proof-a">See the accuracy check</span>
          </Link>
        </Reveal>

        <Reveal className="lp-cta wrap" as="div">
          <h2>See it on a sample audit.</h2>
          <p>Nine requests from a sample auditor. Seven are answered from Ramp in seconds, and two are flagged for your team.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/app?sample=xlsx" className="btn primary lg">Try the sample audit</Link>
            <Link href="/app" className="btn lg">Upload your list</Link>
          </div>
        </Reveal>
      </main>
      <footer className="foot wrap">Tickmark. Built for the BBS x Ramp Hackathon.</footer>
    </>
  );
}
