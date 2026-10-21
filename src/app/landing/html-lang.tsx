"use client";

import { useEffect } from "react";

/** Sets <html lang> for translated pages; the root layout renders lang="en". */
export function HtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return null;
}
