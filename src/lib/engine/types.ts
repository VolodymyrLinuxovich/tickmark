// Shared engine types: what a request result looks like after testing. The UI,
// the binder and the comment sender all read these shapes.

import type { CommentObjectType } from "../ramp/types";
import type { AuditRequest } from "../parse/schema";

export type RecordType = "transaction" | "bill" | "vendor" | "user" | "receipt";

/** Pointer to the Ramp record behind a finding or evidence row, so every line traces back to its source. */
export interface RecordRef {
  type: RecordType;
  id: string;
  label: string;
}

/** One code per check. A finding is an "exception" in audit terms: an item that failed a test. */
export type FindingCode =
  | "SPLIT_PURCHASE"
  | "MISSING_RECEIPT"
  | "RECEIPT_MISMATCH"
  | "NOT_APPROVED"
  | "SELF_APPROVAL"
  | "APPROVAL_AFTER_PAYMENT"
  | "NO_APPROVAL"
  | "MISSING_INVOICE"
  | "DUPLICATE_INVOICE"
  | "NEW_VENDOR_FAST_PAYMENT"
  | "RESTRICTED_MCC"
  | "SELECTION_NOT_FOUND";

/**
 * One exception, with the records behind it, the person who should fix it and an optional
 * drafted Ramp comment that is sent only after the user approves it.
 */
export interface Finding {
  id: string; // stable: code + sorted record ids
  code: FindingCode;
    // high: a control failed or money is at risk (self-approval, duplicate payment).
    // medium: documentation is missing or needs follow-up (no receipt, new vendor paid fast).
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  records: RecordRef[];
  owner?: { user_id: string; name: string };
  comment?: { object_type: CommentObjectType; object_id: string; message: string; mention_user_ids: string[] };
}

// A tickmark is the short symbol an auditor writes next to an item to record which
// check was done on it and that it passed. The letters here are this app's legend.
/** Tickmarks follow audit workpaper convention; the legend is printed in every binder. */
export const TICKMARKS = {
  R: "Agreed to receipt",
  A: "Approval traced to approver and date",
  P: "Payment traced",
  I: "Invoice obtained",
  M: "Business purpose documented",
  X: "Exception, see findings",
} as const;
export type Tickmark = keyof typeof TICKMARKS;

/** One tested item in a workpaper's evidence table. */
export interface EvidenceRow {
  record: RecordRef;
  cells: string[];
  tickmarks: Tickmark[];
  finding_ids: string[];
  files: string[]; // urls of receipts or invoices for the binder
}

/**
 * The answer to one request. status "manual" means Ramp lacks the data and a person must answer it.
 * population: items in scope. tested: items actually checked (a sample can be smaller than the population).
 */
export interface RequestResult {
  request: AuditRequest;
  status: "complete" | "exceptions" | "manual";
  headline: string;
  procedure: string[];
  columns: string[];
  rows: EvidenceRow[];
  findings: Finding[];
  population: number;
  tested: number;
}

/** Stable finding id from the check code and sorted record ids, so the same problem found twice dedupes. */
export const findingId = (code: string, ids: string[]) => `${code}:${[...ids].sort().join("+")}`;
