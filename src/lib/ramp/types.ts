// Subsets of Ramp Developer API response objects (docs.ramp.com/developer-api/v1).
// Field names match the OpenAPI spec so the fixture and live sources are interchangeable.
// The engine, binder and fixture generator all read these types; nothing downstream sees raw API JSON.

/** Ramp user roles. The user access check lists every role other than BUSINESS_USER and GUEST_USER as privileged. */
export type RampRole =
  | "AUDITOR"
  | "BUSINESS_ADMIN"
  | "BUSINESS_BOOKKEEPER"
  | "BUSINESS_OWNER"
  | "BUSINESS_USER"
  | "GUEST_USER"
  | "IT_ADMIN";

/** A Ramp user. manager_id is the reporting line; in the demo company it is also the card spend approver. */
export interface RampUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: RampRole | string;
  status: string; // USER_ACTIVE, USER_INACTIVE, ...
  department_id: string | null;
  manager_id: string | null;
  is_manager?: boolean;
}

export interface RampDepartment {
  id: string;
  name: string;
}

/** Ramp ApiSignedAmount: integer in minor units (cents for USD). */
export interface SignedAmount {
  value: number;
  currency: string;
}

/** Ramp CurrencyAmount: integer in minor units. */
export interface CurrencyAmount {
  amount: number;
  currency_code: string;
  minor_unit_conversion_rate?: number | null;
}

/**
 * A card charge. entity_amount is in cents. receipts holds receipt ids; the receipt objects are fetched
 * separately and linked back by transaction_id.
 */
export interface RampTransaction {
  id: string;
  entity_amount: SignedAmount;
  merchant_name: string;
  merchant_id?: string;
  merchant_category_code?: string;
  merchant_category_code_description?: string;
  sk_category_name?: string;
  user_transaction_time: string;
  accounting_date?: string | null;
  state: string;
  memo?: string | null;
  card_id?: string;
  card_holder: {
    user_id: string;
    first_name: string;
    last_name: string;
    department_id?: string;
    department_name?: string;
  };
  receipts: string[];
  all_requirements_met_and_approved?: boolean;
}

/** A receipt image with Ramp's OCR. OCR prices are in dollars, unlike the cent amounts elsewhere. */
export interface RampReceipt {
  id: string;
  transaction_id?: string;
  user_id?: string;
  created_at: string;
  receipt_url: string;
  ocr?: {
    currency_code?: string | null;
    line_items?: {
      item_date?: string | null;
      item_name?: string | null;
      item_quantity?: number | null;
      item_total_price?: number | null;
      item_unit_price?: number | null;
    }[];
    taxes?: { tax_amount?: number | null; tax_name?: string | null; tax_rate?: number | null }[];
  } | null;
}

/** A vendor bill (accounts payable). amount is in cents; paid_at and payment are null until it is paid. */
export interface RampBill {
  id: string;
  amount: CurrencyAmount;
  invoice_number: string | null;
  issued_at: string;
  due_at: string;
  created_at: string;
  paid_at: string | null;
  status: "OPEN" | "PAID" | string;
  archived_at?: string | null;
  approval_status: "APPROVED" | "INITIALIZED" | "PENDING" | "REJECTED" | "TERMINATED" | null;
  memo?: string | null;
  vendor: { id: string; name: string };
  bill_owner: { id: string; first_name?: string; last_name?: string };
  attachments: { id: string; attachment_type: "EMAIL" | "FILE" | "INVOICE" | "VENDOR_CREDIT"; url: string }[];
  payment?: { payment_method: string | null; payment_date?: string | null; amount?: CurrencyAmount } | null;
}

/** A vendor master record. created_at is used to spot vendors paid soon after they were added. */
export interface RampVendor {
  id: string;
  name: string;
  created_at: string;
  is_active: boolean;
  sk_category_name?: string | null;
  net_payment_terms?: number | null;
  vendor_owner_id?: string | null;
  total_spend_ytd?: CurrencyAmount | null;
}

/** Approval chain for one bill or transaction. approval_history lists who approved each step and when. */
export interface RampApproval {
  entity_id: string;
  entity_type: "bill" | "reimbursement" | "transaction";
  status: "APPROVED" | "INITIALIZED" | "PENDING" | "REJECTED" | "TERMINATED";
  approval_history: { action_at: string; step_status: string; user_email: string | null; user_id: string | null }[];
  next_approvers: { user_email: string; user_id: string }[];
}

/** Path segment for POST /developer/v1/comments/{object_type}/{id}. */
export type CommentObjectType = "bills" | "transactions";

/** A follow-up comment after it was sent, with where it went (Ramp or the sample outbox). */
export interface PostedComment {
  object_type: CommentObjectType;
  object_id: string;
  message: string;
  mention_user_ids: string[];
  posted_at: string;
  destination: string;
}

/** Everything Tickmark needs from one Ramp business for an audit period. */
export interface RampSnapshot {
  business_name: string;
  source: SourceInfo;
  users: RampUser[];
  departments: RampDepartment[];
  transactions: RampTransaction[];
  receipts: RampReceipt[];
  bills: RampBill[];
  vendors: RampVendor[];
  approvals: RampApproval[];
}

/** Which data source produced a snapshot, shown in the UI and the binder. */
export interface SourceInfo {
  kind: "fixture" | "sandbox" | "production";
  label: string;
  base_url?: string;
}

/** Dollars from a Ramp minor-unit integer. */
export const dollars = (minor: number) => minor / 100;
