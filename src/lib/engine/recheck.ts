// Decides whether a watched exception is fixed, from the record as Ramp shows it now.
// Only problems a person can fix in Ramp resolve on their own: a missing receipt, a missing
// or pending approval, and a missing invoice. The rest stay open for the auditor to judge,
// with any replies on the thread shown next to them.

import type { RampApproval, RampBill, RampTransaction } from "../ramp/types";

export interface Fresh {
  txn?: RampTransaction | null;
  bill?: RampBill | null;
  approval?: RampApproval | null;
  /** Display name for a user id. */
  name: (userId: string | null | undefined) => string;
}

/** Codes that can resolve on their own once Ramp shows the fix. */
export const AUTO_RESOLVABLE = new Set(["MISSING_RECEIPT", "NOT_APPROVED", "NO_APPROVAL", "MISSING_INVOICE"]);

const approvedBy = (a: RampApproval | null | undefined, name: Fresh["name"]) => {
  if (!a || a.status !== "APPROVED") return null;
  const last = [...(a.approval_history ?? [])].sort((x, y) => x.action_at.localeCompare(y.action_at)).at(-1);
  return last?.user_id ? name(last.user_id) : "policy";
};

export function resolution(code: string, f: Fresh): { resolved: boolean; how: string | null } {
  switch (code) {
    case "MISSING_RECEIPT":
      if ((f.txn?.receipts?.length ?? 0) > 0) return { resolved: true, how: "Receipt attached in Ramp" };
      if (f.txn?.all_requirements_met_and_approved === true) return { resolved: true, how: "Ramp now shows the receipt requirement as met" };
      break;
    case "NOT_APPROVED":
    case "NO_APPROVAL": {
      const by = approvedBy(f.approval, f.name);
      if (by) return { resolved: true, how: by === "policy" ? "Approved in Ramp by policy" : `Approved in Ramp by ${by}` };
      break;
    }
    case "MISSING_INVOICE":
      if ((f.bill?.attachments?.length ?? 0) > 0) return { resolved: true, how: "Invoice attached in Ramp" };
      break;
  }
  return { resolved: false, how: null };
}
