import type { CommentObjectType } from "../ramp/types";
import type { AuditRequest } from "../parse/schema";

export type RecordType = "transaction" | "bill" | "vendor" | "user" | "receipt";

export interface RecordRef {
  type: RecordType;
  id: string;
  label: string;
}

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

export interface Finding {
  id: string; // stable: code + sorted record ids
  code: FindingCode;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  records: RecordRef[];
  owner?: { user_id: string; name: string };
  comment?: { object_type: CommentObjectType; object_id: string; message: string; mention_user_ids: string[] };
}

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

export interface EvidenceRow {
  record: RecordRef;
  cells: string[];
  tickmarks: Tickmark[];
  finding_ids: string[];
  files: string[]; // urls of receipts or invoices for the binder
}

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

export const findingId = (code: string, ids: string[]) => `${code}:${[...ids].sort().join("+")}`;
