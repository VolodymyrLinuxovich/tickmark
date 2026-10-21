// Accuracy scoring for the /eval page. The demo company is generated with known
// control problems planted in it; this compares engine findings to that ground truth.
// Recall = share of planted problems found. Precision = share of findings that
// match a planted problem.

import { getFixture, type PlantedException } from "../fixtures/generate";
import { findingId, type Finding, type RequestResult } from "./types";
import { uniqueFindings } from "./run";

export interface EvalReport {
  planted: (PlantedException & { found: boolean; by: string[] })[];
  extra: Finding[];
  recall: number;
  precision: number;
}

/** Scores a run on the demo company against its planted ground truth. */
export function scoreAgainstPlanted(results: RequestResult[]): EvalReport {
  const { planted } = getFixture();
  const all = uniqueFindings(results);
  const plantedIds = new Set(planted.map((p) => findingId(p.code, p.record_ids)));
  // A planted problem is found when a finding has the same code and exactly the same
  // transaction or bill records (supporting refs like receipts and vendors are ignored).
  const key = (ids: string[]) => [...ids].sort().join("+");
  const covers = (f: Finding, p: PlantedException) =>
    f.code === p.code && key(f.records.filter((r) => r.type === "transaction" || r.type === "bill").map((r) => r.id)) === key(p.record_ids);
  const rows = planted.map((p) => {
    const by = results.filter((r) => r.findings.some((f) => covers(f, p))).map((r) => r.request.ref);
    return { ...p, found: by.length > 0, by };
  });
  const extra = all.filter((f) => !plantedIds.has(f.id) && !planted.some((p) => covers(f, p)));
  const matched = all.length - extra.length;
  return {
    planted: rows,
    extra,
    recall: rows.filter((r) => r.found).length / rows.length,
    precision: all.length ? matched / all.length : 1,
  };
}
