import Link from "next/link";
import { Logo } from "./logo";
import { LanguageMenu } from "./language-menu";
import { DICTS, homeHref, type Locale } from "@/lib/i18n";
import type { SourceInfo } from "@/lib/ramp/types";

/**
 * Site header, the same menu on every page. When a Ramp account is connected, a pill names it.
 * `landing` makes the section links jump within the page instead of going back to it.
 * `lang` (landing pages only) translates the menu and shows the language picker.
 */
export function TopBar({ info, landing = false, lang }: { info: SourceInfo; landing?: boolean; lang?: Locale }) {
  const n = DICTS[lang ?? "en"].nav;
  const home = homeHref(lang ?? "en");
  return (
    <header className="top">
      <div className="wrap">
        <Link href={home} className="brand">
          <Logo />
          Tickmark
        </Link>
        <nav>
          <a href={landing ? "#problem" : "/#problem"} className="hide-sm">{n.problem}</a>
          <a href={landing ? "#solution" : "/#solution"} className="hide-sm">{n.solution}</a>
          <Link href="/eval" className="hide-xs">{n.accuracy}</Link>
          {info.kind !== "fixture" && (
            <span className="pill" title={info.base_url}>
              <span className="dot live" />
              {info.label}
            </span>
          )}
          {lang && <LanguageMenu lang={lang} label={n.language} />}
          <Link href="/app" className="btn primary small">{n.open}</Link>
        </nav>
      </div>
    </header>
  );
}
