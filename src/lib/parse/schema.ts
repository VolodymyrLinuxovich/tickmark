import { z } from "zod";

export const REQUEST_TYPES = [
  "transaction_support",
  "bill_support",
  "receipt_completeness",
  "control_testing",
  "duplicate_payments",
  "vendor_listing",
  "user_access",
  "unsupported",
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_TYPE_INFO: Record<RequestType, { label: string; what: string }> = {
  transaction_support: { label: "Transaction support", what: "Receipt, approval and business purpose for selected card transactions" },
  bill_support: { label: "Bill support", what: "Invoice, approval and proof of payment for vendor bills" },
  receipt_completeness: { label: "Missing receipts", what: "Card transactions above a threshold with no receipt" },
  control_testing: { label: "Control testing", what: "Split purchases, self-approval and restricted merchant categories" },
  duplicate_payments: { label: "Duplicate payments", what: "Bills paid twice for the same vendor invoice" },
  vendor_listing: { label: "Vendor listing", what: "Vendor master file and vendors added in the period" },
  user_access: { label: "User access", what: "People with admin or bookkeeper access to spend" },
  unsupported: { label: "Manual", what: "Outside Ramp data; left for the team" },
};

export const SelectionSchema = z.object({
  ref: z.string().describe("Auditor's selection reference, e.g. S-01. Make one up in order if none is given."),
  date: z.string().describe("Date as written by the auditor"),
  description: z.string().describe("Description as written by the auditor"),
  amount: z.number().describe("Amount in dollars"),
});

export const AuditRequestSchema = z.object({
  ref: z.string().describe("PBC reference as given, e.g. PBC-03"),
  text: z.string().describe("The request text exactly as the auditor wrote it"),
  type: z.enum(REQUEST_TYPES),
  period_from: z.string().nullable().describe("YYYY-MM-DD start of the period the request covers, or null"),
  period_to: z.string().nullable().describe("YYYY-MM-DD end of the period, or null"),
  min_amount: z.number().nullable().describe("Dollar threshold the request mentions, or null"),
  selections: z.array(SelectionSchema).describe("Specific items the auditor selected for this request, if any"),
  interpretation: z.string().describe("One short sentence: what Tickmark will pull from Ramp to answer this"),
});

export const ParsedListSchema = z.object({
  auditor: z.string().nullable().describe("Audit firm name if stated"),
  requests: z.array(AuditRequestSchema),
});

export type Selection = z.infer<typeof SelectionSchema>;
export type AuditRequest = z.infer<typeof AuditRequestSchema>;
export type ParsedList = z.infer<typeof ParsedListSchema> & { parser: string; warnings: string[] };
