import Link from "next/link";
import type { SourceInfo } from "@/lib/ramp/types";

/**
 * Site header, the same menu on every page. When a Ramp account is connected, a pill names it.
 * `landing` makes the section links jump within the page instead of going back to it.
 */
export function TopBar({ info, landing = false }: { info: SourceInfo; landing?: boolean }) {
  return (
    <header className="top">
      <div className="wrap">
        <Link href="/" className="brand">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <rect x="1" y="1" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M5.5 10.5l3 2.8L14.5 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Tickmark
        </Link>
        <nav>
          <a href={landing ? "#problem" : "/#problem"} className="hide-sm">Problem</a>
          <a href={landing ? "#solution" : "/#solution"} className="hide-sm">Solution</a>
          <Link href="/eval">Accuracy</Link>
          {info.kind !== "fixture" && (
            <span className="pill" title={info.base_url}>
              <span className="dot live" />
              {info.label}
            </span>
          )}
          <Link href="/app" className="btn primary small">Open Tickmark</Link>
        </nav>
      </div>
    </header>
  );
}
