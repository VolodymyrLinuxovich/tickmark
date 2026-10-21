// Checks every Ramp field Tickmark reads and every query parameter it sends against
// Ramp's published OpenAPI spec (docs.ramp.com/openapi/developer-api.json).
//   npm run check:ramp-spec

type Schema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
};
type Op = { parameters?: { name: string; in: string }[]; responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>; requestBody?: { content?: Record<string, { schema?: Schema }> } };

const SPEC_URL = "https://docs.ramp.com/openapi/developer-api.json";

// [endpoint, method, list?, fields read, query params sent]
const CHECKS: [string, "get" | "post", boolean, string[], string[]][] = [
  ["/developer/v1/transactions", "get", true, [
    "id", "entity_amount.value", "entity_amount.currency", "merchant_name", "merchant_id", "merchant_category_code",
    "merchant_category_code_description", "sk_category_name", "user_transaction_time", "accounting_date", "state", "memo",
    "card_id", "card_holder.user_id", "card_holder.first_name", "card_holder.last_name", "card_holder.department_id",
    "card_holder.department_name", "receipts", "all_requirements_met_and_approved",
  ], ["from_date", "to_date", "page_size", "start"]],
  ["/developer/v1/receipts", "get", true, [
    "id", "transaction_id", "user_id", "created_at", "receipt_url", "ocr.line_items.item_total_price", "ocr.line_items.item_date",
    "ocr.line_items.item_name", "ocr.taxes.tax_amount",
  ], ["from_date", "to_date", "include_ocr_data", "page_size", "start"]],
  ["/developer/v1/bills", "get", true, [
    "id", "amount.amount", "amount.currency_code", "invoice_number", "issued_at", "due_at", "created_at", "paid_at", "status",
    "approval_status", "archived_at", "memo", "vendor.id", "vendor.name", "bill_owner.id", "bill_owner.first_name",
    "bill_owner.last_name", "attachments.id", "attachments.attachment_type", "attachments.url", "payment.payment_method",
    "payment.payment_date",
  ], ["from_issued_date", "to_issued_date", "page_size", "start"]],
  ["/developer/v1/vendors", "get", true, ["id", "name", "created_at", "is_active", "sk_category_name", "net_payment_terms", "vendor_owner_id"], ["page_size", "start"]],
  ["/developer/v1/users", "get", true, ["id", "first_name", "last_name", "email", "role", "status", "department_id", "manager_id", "is_manager"], ["page_size", "start"]],
  ["/developer/v1/departments", "get", true, ["id", "name"], ["page_size", "start"]],
  ["/developer/v1/approvals", "get", true, [
    "entity_id", "entity_type", "status", "approval_history.action_at", "approval_history.step_status",
    "approval_history.user_email", "approval_history.user_id", "next_approvers",
  ], ["entity_type", "entity_ids", "page_size", "start"]],
  ["/developer/v1/business", "get", false, ["business_name_legal", "business_name_on_card"], []],
  ["/developer/v1/audit-logs/events", "get", true, ["actor_id", "event_time", "event_details.references.url", "event_details.references.label"], ["from_date", "to_date", "event_types", "page_size", "start"]],
];

let spec: { paths: Record<string, Record<string, Op>>; components: { schemas: Record<string, Schema> } };

function resolve(s: Schema | undefined): Schema | undefined {
  let cur = s;
  for (let i = 0; cur?.$ref && i < 20; i++) cur = spec.components.schemas[cur.$ref.split("/").pop()!];
  return cur;
}

/** All concrete schemas a value could have (follows refs and unions, steps into arrays). */
function variants(s: Schema | undefined): Schema[] {
  const r = resolve(s);
  if (!r) return [];
  const out: Schema[] = [r];
  for (const k of ["allOf", "anyOf", "oneOf"] as const) for (const sub of r[k] ?? []) out.push(...variants(sub));
  if (r.items) out.push(...variants(r.items));
  return out;
}

function hasPath(s: Schema | undefined, parts: string[]): boolean {
  if (!parts.length) return true;
  const [head, ...rest] = parts;
  return variants(s).some((v) => v.properties && head in v.properties && hasPath(v.properties[head], rest));
}

async function main() {
  spec = await (await fetch(SPEC_URL)).json();
  let failures = 0;
  for (const [path, method, isList, fields, params] of CHECKS) {
    const op = spec.paths[path]?.[method];
    if (!op) {
      console.log(`MISSING ENDPOINT ${method.toUpperCase()} ${path}`);
      failures++;
      continue;
    }
    const body = resolve(op.responses?.["200"]?.content?.["application/json"]?.schema);
    const item = isList ? body?.properties?.data : body;
    const badFields = fields.filter((f) => !hasPath(item, f.split(".")));
    const known = new Set((op.parameters ?? []).map((p) => p.name));
    const badParams = params.filter((p) => !known.has(p));
    if (isList && !hasPath(body, ["page", "next"])) badFields.push("page.next");
    const ok = !badFields.length && !badParams.length;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${method.toUpperCase()} ${path}${badFields.length ? `  fields not in spec: ${badFields.join(", ")}` : ""}${badParams.length ? `  params not in spec: ${badParams.join(", ")}` : ""}`);
  }
  console.log(failures ? `\n${failures} endpoint(s) disagree with Ramp's spec.` : "\nEvery field and parameter Tickmark uses is in Ramp's published spec.");
  process.exit(failures ? 1 : 0);
}

main();
