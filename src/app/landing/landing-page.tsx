// The landing page in any supported language (see lib/i18n). Rendered at / for English and /es, /de,
// /fr and /uk for the others. A server component; it reads the data source only to label the sample link.

import Link from "next/link";
import { getSource } from "@/lib/ramp/source";
import { TopBar } from "../topbar";
import { Reveal } from "./reveal";
import { ProductDemo } from "./product-demo";
import { CoverageChart } from "./coverage";
import { HtmlLang } from "./html-lang";
import { DICTS, type Locale } from "@/lib/i18n";

// One small looping animation per problem card: a sheet filling up, scattered documents, a late alert.
const ART = [
  <div key="sheet" className="pc-art pc-sheet" aria-hidden><i /><i /><i /><i /><i /></div>,
  <div key="docs" className="pc-art pc-docs" aria-hidden><i /><i /><i /></div>,
  <div key="late" className="pc-art pc-late" aria-hidden><span className="pc-track"><b /></span><em>!</em></div>,
];

export function LandingPage({ lang }: { lang: Locale }) {
  const info = getSource().info;
  const t = DICTS[lang];
  return (
    <>
      <TopBar info={info} landing lang={lang} />
      <HtmlLang lang={lang} />
      <main className="lp">
        {/* Intro */}
        <section className="lp-hero wrap">
          <div className="lp-hero-copy">
            <h1 className="pop" style={{ animationDelay: "60ms" }}>
              {t.hero.h1a} <em>{t.hero.h1b}</em>
            </h1>
            <p className="lede pop" style={{ animationDelay: "120ms" }}>
              {t.hero.lede}
            </p>
            <div className="row pop" style={{ animationDelay: "180ms" }}>
              <Link href="/app?sample=xlsx" className="btn primary lg">{t.hero.try}</Link>
              <Link href="/app" className="btn lg">{t.hero.upload}</Link>
            </div>
            {info.kind === "fixture" && (
              <p className="fine pop" style={{ animationDelay: "240ms" }}>
                {t.hero.sample}
              </p>
            )}
          </div>

          <ol className="lp-stack lp-flow" aria-label={t.flow.aria}>
            {[
              { k: t.flow.k1, tone: "ask", icon: <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13 M6.5 8.5h4 M6.5 11h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>, title: t.flow.t1, desc: t.flow.ask, chip: t.flow.from },
              { k: t.flow.k2, tone: "ok", icon: <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>, title: t.flow.t2, desc: t.flow.d2, chip: t.flow.c2 },
              { k: t.flow.k3, tone: "ex", icon: <span aria-hidden>!</span>, title: t.flow.t3, desc: t.flow.d3, chip: t.flow.chip },
            ].map((c, i) => (
              <li className="pop-card" style={{ animationDelay: `${300 + i * 400}ms` }} key={c.k}>
                <span className="flow-k">{c.k}</span>
                <div className={`mini flow-card ${c.tone}`}>
                  <span className="mini-icon">{c.icon}</span>
                  <div className="flow-body">
                    <div className="mini-t">{c.title}</div>
                    <div className="mini-k">{c.desc}</div>
                    <div className="mini-chip">{c.chip}</div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Problem */}
        <Reveal className="lp-section wrap" id="problem">
          <p className="eyebrow">{t.problem.eyebrow}</p>
          <h2>{t.problem.h2}</h2>
          <div className="lp-grid3">
            {t.problem.items.map((p, i) => (
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
              {t.quote.text}
            </blockquote>
            <p className="lp-pull-note stagger" style={{ transitionDelay: "160ms" }}>
              {t.quote.note}
            </p>
            <figcaption className="stagger" style={{ transitionDelay: "260ms" }}>
              <span className="lp-pull-mark" aria-hidden>R</span>
              <span>
                <b>Ramp</b>
                <a href="https://ramp.com/blog/prepare-data-for-audits-and-compliance-reviews" target="_blank" rel="noreferrer">{t.quote.source}{t.quote.translated ? ` · ${t.quote.translated}` : ""}</a>
              </span>
            </figcaption>
          </figure>
        </Reveal>

        {/* Solution */}
        <Reveal className="lp-section wrap" id="solution">
          <p className="eyebrow">{t.solution.eyebrow}</p>
          <h2>{t.solution.h2}</h2>
          <ol className="lp-steps">
            {t.solution.steps.map((s, i) => (
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
          <p className="eyebrow">{t.checks.eyebrow}</p>
          <h2>{t.checks.h2}</h2>
          <CoverageChart lang={lang} />
        </Reveal>

        <Reveal className="lp-cta wrap" as="div">
          <h2>{t.cta.h2}</h2>
          <p><Link href="/eval" className="lp-proof-line">{t.cta.proof}</Link></p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link href="/app?sample=xlsx" className="btn primary lg">{t.cta.button}</Link>
          </div>
        </Reveal>
      </main>
      <footer className="foot wrap">{t.footer}</footer>
    </>
  );
}
