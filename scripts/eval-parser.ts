// Scores the request parsers against public/samples/corpus.
// Run: npm run eval:parser   (add -- --verbose to list every miss, -- --dir <path> for another corpus)
// The Claude parser is scored only when ANTHROPIC_API_KEY is set and a first call succeeds.

import { readdirSync, readFileSync } from "node:fs";
import { normalizeFile, normalizeText, type NormalizedInput } from "../src/lib/parse/input";
import { parseWithRules } from "../src/lib/parse/rules";
import { MODEL, parseRequests } from "../src/lib/parse/claude";
import type { ParsedList } from "../src/lib/parse/schema";
import type { Expected } from "./make-corpus";

const dirArg = process.argv.indexOf("--dir");
const ROOT = dirArg > 0 ? process.argv[dirArg + 1] : "public/samples/corpus";
const FIELDS = ["found", "ref", "type", "period_from", "period_to", "min_amount", "selections"] as const;
type Field = (typeof FIELDS)[number];

async function load(name: string): Promise<{ expected: Expected; input: NormalizedInput }> {
  const expected = JSON.parse(readFileSync(`${ROOT}/${name}/expected.json`, "utf8")) as Expected;
  const bytes = new Uint8Array(readFileSync(`${ROOT}/${name}/${expected.input}`));
  const input = /\.txt$/i.test(expected.input) ? normalizeText(new TextDecoder().decode(bytes)) : await normalizeFile(expected.input, bytes);
  return { expected, input };
}

interface Score {
  hit: Record<Field, number>;
  total: number;
  extra: number;
  misses: string[];
}

function score(name: string, expected: Expected, parsed: ParsedList, s: Score) {
  const byRef = new Map(parsed.requests.map((r) => [r.ref, r]));
  s.extra += Math.max(0, parsed.requests.filter((r) => !expected.requests.some((e) => e.ref === r.ref)).length);
  // Match by ref; when refs differ but the count is right, match by position.
  const sameCount = parsed.requests.length === expected.requests.length;
  expected.requests.forEach((e, i) => {
    s.total++;
    const got = byRef.get(e.ref) ?? (sameCount ? parsed.requests[i] : undefined);
    if (!got) {
      s.misses.push(`${name} ${e.ref}: not found (got refs ${parsed.requests.map((r) => r.ref).join(", ") || "none"})`);
      return;
    }
    s.hit.found++;
    const actual: Record<Exclude<Field, "found">, unknown> = {
      ref: got.ref,
      type: got.type,
      period_from: got.period_from,
      period_to: got.period_to,
      min_amount: got.min_amount,
      selections: got.selections.length,
    };
    for (const f of FIELDS) {
      if (f === "found") continue;
      if (actual[f] === e[f]) s.hit[f]++;
      else s.misses.push(`${name} ${e.ref} ${f}: expected ${JSON.stringify(e[f])}, got ${JSON.stringify(actual[f])}`);
    }
  });
}

const empty = (): Score => ({ hit: { found: 0, ref: 0, type: 0, period_from: 0, period_to: 0, min_amount: 0, selections: 0 }, total: 0, extra: 0, misses: [] });
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");

function table(scores: Record<string, Score>) {
  const names = Object.keys(scores);
  const w = 12;
  console.log(["field".padEnd(w), ...names.map((n) => n.padStart(18))].join(""));
  for (const f of FIELDS) console.log([f.padEnd(w), ...names.map((n) => `${pct(scores[n].hit[f], scores[n].total)} (${scores[n].hit[f]}/${scores[n].total})`.padStart(18))].join(""));
  console.log(["extra refs".padEnd(w), ...names.map((n) => String(scores[n].extra).padStart(18))].join(""));
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const cases = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const scores: Record<string, Score> = { rules: empty() };
  let claude = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.TICKMARK_PARSER !== "rules";
  if (!claude) console.log("ANTHROPIC_API_KEY not set: scoring the rules parser only.\n");

  for (const name of cases) {
    const { expected, input } = await load(name);
    score(name, expected, parseWithRules(input), scores.rules);
    if (!claude) continue;
    const parsed = await parseRequests(input);
    if (parsed.parser !== MODEL) {
      // parseRequests falls back to rules on any error; report it once and stop calling the API.
      const why = parsed.warnings.find((w) => /Claude|model/.test(w)) ?? "unknown error";
      console.log(`Claude parser unavailable, scoring the rules parser only.\n  ${why}\n`);
      claude = false;
      delete scores[MODEL];
      continue;
    }
    scores[MODEL] ??= empty();
    score(name, expected, parsed, scores[MODEL]);
  }

  console.log(`Corpus: ${cases.length} cases, ${scores.rules.total} requests\n`);
  table(scores);
  for (const [parser, s] of Object.entries(scores)) {
    if (!s.misses.length) continue;
    console.log(`\n${parser}: ${s.misses.length} field misses`);
    for (const m of verbose ? s.misses : s.misses.slice(0, 15)) console.log(`  ${m}`);
    if (!verbose && s.misses.length > 15) console.log(`  ... ${s.misses.length - 15} more (use --verbose)`);
  }
}

main();
