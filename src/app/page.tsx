// Landing page at /: the problem, the four-step flow and the list of checks.
// A server component; it reads the data source only to label the sample audit link.

import Link from "next/link";
import { getSource } from "@/lib/ramp/source";
import { TopBar } from "./topbar";
import { Reveal } from "./landing/reveal";
import { ProductDemo } from "./landing/product-demo";
import { CoverageChart } from "./landing/coverage";

// Copy for the landing sections, kept as data so the JSX stays short.
const PROBLEMS = [
  {
    t: "A spreadsheet of requests",
    d: "Dozens of asks: receipts, approvals, access lists.",
  },
  {
    t: "Evidence is scattered",
    d: "Every answer is a receipt, a screenshot and a folder.",
  },
  {
    t: "Problems show up late",
    d: "The auditor finds the gaps, weeks in.",
  },
];

const STEPS = [
  { t: "Upload", d: "The auditor's list, as a file or an email." },
  { t: "Gather", d: "Receipts, approvals and bills from Ramp." },
  { t: "Test", d: "The checks auditors run, on every record." },
  { t: "Hand over", d: "Approve follow-ups. Download the binder." },
];

// One small looping animation per problem card: a sheet filling up, scattered documents, a late alert.
const ART = [
  <div key="sheet" className="pc-art pc-sheet" aria-hidden><i /><i /><i /><i /><i /></div>,
  <div key="docs" className="pc-art pc-docs" aria-hidden><i /><i /><i /></div>,
  <div key="late" className="pc-art pc-late" aria-hidden><span className="pc-track"><b /></span><em>!</em></div>,
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
            <h1 className="pop" style={{ animationDelay: "60ms" }}>
              Your auditor&rsquo;s request list, <em>answered from Ramp.</em>
            </h1>
            <p className="lede pop" style={{ animationDelay: "120ms" }}>
              Upload the request list. Get back a finished evidence binder, with every problem flagged first.
            </p>
            <div className="row pop" style={{ animationDelay: "180ms" }}>
              <Link href="/app?sample=xlsx" className="btn primary lg">Try it with a sample audit</Link>
              <Link href="/app" className="btn lg">Upload your list</Link>
            </div>
            <p className="fine pop" style={{ animationDelay: "240ms" }}>
              {info.kind === "fixture" ? "The sample audit runs on a generated company." : `Connected to ${info.label}.`}
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
              <div className="lp-card stagger seq" style={{ transitionDelay: `${150 + i * 450}ms` }} key={p.t}>
                {ART[i]}
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal className="lp-quote-band" as="div">
          <figure className="lp-pull wrap">
            <blockquote className="stagger">
              &ldquo;Preparing for an audit means gathering receipts, matching transactions, and exporting clean records.&rdquo;
            </blockquote>
            <p className="lp-pull-note stagger" style={{ transitionDelay: "160ms" }}>
              When documentation is missing, Ramp notes, it &ldquo;can take days.&rdquo;
            </p>
            <figcaption className="stagger" style={{ transitionDelay: "260ms" }}>
              <span className="lp-pull-mark" aria-hidden>R</span>
              <span>
                <b>Ramp</b>
                <a href="https://ramp.com/blog/prepare-data-for-audits-and-compliance-reviews" target="_blank" rel="noreferrer">Ramp blog, on audit preparation</a>
              </span>
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
            <ProductDemo />
          </div>
        </Reveal>

        <Reveal className="lp-section wrap">
          <p className="eyebrow">What it checks</p>
          <h2>The tests auditors run, on every record.</h2>
          <CoverageChart />
        </Reveal>

        <Reveal className="lp-cta wrap" as="div">
          <h2>See it on a sample audit.</h2>
          <p><Link href="/eval" className="lp-proof-line">8 of 8 planted problems found, 0 false alarms</Link></p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/app?sample=xlsx" className="btn primary lg">Try the sample audit</Link>
          </div>
        </Reveal>
      </main>
      <footer className="foot wrap">Tickmark. Built for the BBS x Ramp Hackathon.</footer>
    </>
  );
}
