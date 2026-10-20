import { readFile } from "node:fs/promises";
import path from "node:path";
import { getFixture } from "@/lib/fixtures/generate";
import { normalizeFile } from "@/lib/parse/input";
import { parseRequests } from "@/lib/parse/claude";
import { parseWithRules } from "@/lib/parse/rules";
import { runAll } from "@/lib/engine/run";
import { scoreAgainstPlanted } from "@/lib/engine/eval";

export const maxDuration = 120;

/** Scores the full pipeline on the demo company. ?parser=claude runs the model parser too. */
export async function GET(req: Request) {
  const useClaude = new URL(req.url).searchParams.get("parser") === "claude";
  const name = "hartwell-pbc-fy2025.xlsx";
  const input = await normalizeFile(name, new Uint8Array(await readFile(path.join(process.cwd(), "public/samples", name))));
  const t0 = Date.now();
  const parsed = useClaude ? await parseRequests(input) : parseWithRules(input);
  const parseMs = Date.now() - t0;
  const snap = getFixture().snapshot;
  const t1 = Date.now();
  const results = runAll(parsed.requests, snap);
  const runMs = Date.now() - t1;
  const report = scoreAgainstPlanted(results);
  return Response.json({
    parser: parsed.parser,
    warnings: parsed.warnings,
    request_types: parsed.requests.map((r) => ({ ref: r.ref, type: r.type, selections: r.selections.length })),
    report,
    timing: { parse_ms: parseMs, run_ms: runMs },
    population: { transactions: snap.transactions.length, bills: snap.bills.length, receipts: snap.receipts.length, vendors: snap.vendors.length, users: snap.users.length },
  });
}
