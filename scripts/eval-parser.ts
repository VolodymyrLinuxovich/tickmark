// Scores the request parsers against public/samples/corpus.
// Run: npm run eval:parser   (add -- --verbose to list every miss, -- --dir <path> for another corpus, e.g. public/samples/corpus/real)
// The model parser (Claude, then OpenAI) is scored only when a key is set and a first call succeeds.
// Keys are read from .env.local when present.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { normalizeFile, normalizeText, type NormalizedInput } from "../src/lib/parse/input";
import { parseWithRules } from "../src/lib/parse/rules";
import { availableProviders, parseRequests } from "../src/lib/parse/claude";
import type { ParsedList } from "../src/lib/parse/schema";
import type { Expected } from "./make-corpus";

const dirArg = process.argv.indexOf("--dir");
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local
}

const ROOT = dirArg > 0 ? process.argv[dirArg + 1] : "public/samples/corpus";
const FIELDS = ["found", "ref", "type", "period_from", "period_to", "min_amount", "selections"] as const;
type Field = (typeof FIELDS)[number];

/** Case folders: generated ones at the top level, hand-written ones one level down (blind/). Public lists in real/ are scored on their own (--dir). */
function listCases(root: string): string[] {
  const out: string[] = [];
  for (const d of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "real")) {
    if (existsSync(`${root}/${d.name}/expected.json`)) out.push(d.name);
    else for (const sub of readdirSync(`${root}/${d.name}`, { withFileTypes: true })) if (sub.isDirectory()) out.push(`${d.name}/${sub.name}`);
  }
  return out.sort();
}

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
  const cases = listCases(ROOT);
  const scores: Record<string, Score> = { rules: empty() };
  let useModel = availableProviders().length > 0;
  if (!useModel) console.log("No model key set (ANTHROPIC_API_KEY or OPENAI_API_KEY): scoring the rules parser only.\n");

  const loaded = await Promise.all(cases.map(async (name) => ({ name, ...(await load(name)) })));
  for (const { name, expected, input } of loaded) score(name, expected, parseWithRules(input), scores.rules);

  if (useModel) {
    // One probe call first, so a dead key fails once instead of once per case.
    const first = await parseRequests(loaded[0].input);
    if (first.parser === "rules") {
      console.log(`Model parser unavailable, scoring the rules parser only.\n  ${first.warnings.at(-1) ?? "unknown error"}\n`);
      useModel = false;
    } else {
      const results = [first];
      for (let i = 1; i < loaded.length; i += 6) results.push(...(await Promise.all(loaded.slice(i, i + 6).map((c) => parseRequests(c.input)))));
      results.forEach((parsed, i) => {
        const key = parsed.parser === "rules" ? "model fell back" : parsed.parser;
        scores[key] ??= empty();
        score(loaded[i].name, loaded[i].expected, parsed, scores[key]);
      });
    }
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
