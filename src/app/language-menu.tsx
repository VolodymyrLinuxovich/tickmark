"use client";

import { useEffect, useRef } from "react";
import { LOCALES, LOCALE_BADGE, LOCALE_NAMES, homeHref, type Locale } from "@/lib/i18n";

/** Globe button with a list of languages. Uses <details> so it works with keyboard and without JS. */
export function LanguageMenu({ lang, label }: { lang: Locale; label: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="lang" ref={ref}>
      <summary aria-label={`${label}: ${LOCALE_NAMES[lang]}`}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" />
        </svg>
        <span className="lang-code">{LOCALE_BADGE[lang]}</span>
      </summary>
      <ul role="list">
        {LOCALES.map((l) => (
          <li key={l}>
            <a href={homeHref(l)} hrefLang={l} lang={l} aria-current={l === lang ? "true" : undefined}>
              {LOCALE_NAMES[l]}
              {l === lang && <span aria-hidden> ✓</span>}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
