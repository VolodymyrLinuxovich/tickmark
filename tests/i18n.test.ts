import { describe, expect, it } from "vitest";
import { DICTS, LOCALES } from "../src/lib/i18n";

// checks.names and checks.populations are lookup maps keyed by the English label.
// English leaves them empty and falls back to the key, so they are compared across the other languages.
const LOOKUP_MAPS = ["checks.names", "checks.populations"];

/** Every leaf path in a dictionary, e.g. "hero.h1a" or "problem.items.0.t". */
function leaves(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

const inLookupMap = (path: string) => LOOKUP_MAPS.some((m) => path.startsWith(`${m}.`));

// The English quote is the original, so it has no "Translation" label; the landing page hides it when empty.
const ALLOWED_EMPTY: Record<string, string[]> = { en: ["quote.translated"] };

/** Leaf paths with their string values. */
function entries(value: unknown, prefix = ""): [string, unknown][] {
  if (value === null || typeof value !== "object") return [[prefix, value]];
  return Object.entries(value).flatMap(([k, v]) => entries(v, prefix ? `${prefix}.${k}` : k));
}

describe("landing page translations", () => {
  const english = leaves(DICTS.en).filter((p) => !inLookupMap(p)).sort();

  for (const locale of LOCALES) {
    it(`${locale} has the same keys as English`, () => {
      expect(leaves(DICTS[locale]).filter((p) => !inLookupMap(p)).sort()).toEqual(english);
    });

    it(`${locale} has no empty strings`, () => {
      const allowed = ALLOWED_EMPTY[locale] ?? [];
      const empty = entries(DICTS[locale])
        .filter(([p, v]) => !allowed.includes(p) && (typeof v !== "string" || v.trim() === ""))
        .map(([p]) => p);
      expect(empty).toEqual([]);
    });
  }

  for (const map of LOOKUP_MAPS) {
    it(`every translated language has the same ${map} keys`, () => {
      const others = LOCALES.filter((l) => l !== "en");
      const keysOf = (l: (typeof LOCALES)[number]) => leaves(DICTS[l]).filter((p) => p.startsWith(`${map}.`)).sort();
      const all = [...new Set(others.flatMap(keysOf))].sort();
      for (const l of others) expect(keysOf(l), l).toEqual(all);
    });
  }
});
