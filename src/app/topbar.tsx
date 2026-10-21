import Link from "next/link";
import type { SourceInfo } from "@/lib/ramp/types";

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
          {landing && <a href="#problem" className="hide-sm">Problem</a>}
          {landing && <a href="#solution" className="hide-sm">Solution</a>}
          <Link href="/eval">Accuracy</Link>
          <span className="pill" title={info.base_url ?? "Deterministic demo company shaped like Ramp API responses"}>
            <span className={`dot ${info.kind === "fixture" ? "" : "live"}`} />
            <span className="pill-long">{info.kind === "fixture" ? "Demo company: Acme Robotics" : info.label}</span><span className="pill-short">{info.kind === "fixture" ? "Demo data" : info.label}</span>
          </span>
          {landing && <Link href="/app" className="btn primary small">Open Tickmark</Link>}
        </nav>
      </div>
    </header>
  );
}
