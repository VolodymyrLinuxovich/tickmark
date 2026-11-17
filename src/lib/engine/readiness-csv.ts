// The readiness "Fix now" list as a CSV, so it can go to a spreadsheet or a ticket tracker.
// Kept apart from readiness.ts so the client view can build it without pulling in the audit engine.

import type { Finding } from "./types";

export const FIX_NOW_CSV_HEADER = ["Record", "Owner", "Issue", "Age (days)", "Drafted follow-up"] as const;

/**
 * One cell, quoted when it holds a comma, quote or line break. A cell that starts with = + - @ or a
 * tab is prefixed with ' so a spreadsheet shows it as text instead of running it as a formula,
 * since merchant names and memos come from outside the company.
 */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Record, owner, issue, age in days and drafted follow-up for each item, one row each, CRLF line ends. */
export function fixNowCsv(items: (Finding & { age_days: number })[]): string {
  const rows = items.map((f) => [f.records.map((r) => r.label).join("; "), f.owner?.name ?? "", f.title, f.age_days, f.comment?.message ?? ""]);
  return [FIX_NOW_CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
