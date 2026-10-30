"use client";

// Side drawer showing the Ramp record behind an evidence row or finding.

import { useEffect, useState } from "react";
import type { RecordRef } from "@/lib/engine/types";
import type { SourceInfo } from "@/lib/ramp/types";

// ---------------------------------------------------------------- record drawer
/**
 * Side drawer that shows the Ramp record behind an evidence row or exception: a short summary
 * and the raw API response, so a reviewer can trace any line back to its source. The parent keys
 * it by record, so opening another record remounts it with fresh state.
 */
export function RecordDrawer({ refd, onClose }: { refd: RecordRef; onClose: () => void }) {
  const [data, setData] = useState<{ record: unknown; source: SourceInfo } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    // `live` drops a late response if the drawer closed before the fetch finished.
    let live = true;
    fetch(`/api/record/${refd.type}/${refd.id}`)
      .then((r) => r.json())
      .then((j) => live && (j.error ? setErr(j.error) : setData(j)))
      .catch((e) => live && setErr(String(e)));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      live = false;
      window.removeEventListener("keydown", esc);
    };
  }, [refd.type, refd.id, onClose]);
  const summary = data ? summarize(refd.type, data.record) : [];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Ramp record">
        <header>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Ramp {refd.type}</div>
            <b>{refd.label}</b>
          </div>
          <button className="btn small" onClick={onClose}>Close</button>
        </header>
        <div className="body">
          {err && <div className="error">{err}</div>}
          {!data && !err && <p className="muted">Loading...</p>}
          {data && (
            <>
              <dl className="kv">
                {summary.map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              <div className="label">Raw API response ({data.source.kind === "fixture" ? "sample data" : "Ramp"})</div>
              <pre>{JSON.stringify(data.record, null, 2)}</pre>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * Picks the fields an auditor cares about from a raw record returned by /api/record.
 * Field names follow the Ramp API. Amounts arrive in cents and times are shown in UTC.
 */
export function summarize(type: string, rec: unknown): [string, string][] {
  const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const d = (s?: string | null) => (s ? new Date(s).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "None");
  const r = rec as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (type === "transaction") {
    const t = r.transaction;
    // The last approval step is the final sign-off.
    const ap = r.approval?.approval_history?.at(-1);
    // OCR totals are in dollars, unlike the cent amounts elsewhere, hence the * 100 below.
    const ocr = r.receipts?.[0]?.ocr?.line_items?.[0]?.item_total_price;
    return [
      ["Merchant", `${t.merchant_name} (MCC ${t.merchant_category_code})`],
      ["Amount", money(t.entity_amount.value)],
      ["Cardholder", `${t.card_holder.first_name} ${t.card_holder.last_name}, ${t.card_holder.department_name ?? ""}`],
      ["Transaction time", d(t.user_transaction_time)],
      ["Memo", t.memo ?? "None"],
      ["Receipt", r.receipts?.length ? `${r.receipts.length} attached${ocr != null ? `, OCR total ${money(Math.round(ocr * 100))}` : ""}` : "None"],
      ["Approved", ap ? `${ap.user_email}, ${d(ap.action_at)}` : "No approval"],
    ];
  }
  if (type === "bill") {
    const b = r.bill;
    const ap = r.approval?.approval_history?.at(-1);
    return [
      ["Vendor", b.vendor.name],
      ["Invoice", b.invoice_number ?? "None"],
      ["Amount", money(b.amount.amount)],
      ["Owner", `${b.bill_owner.first_name} ${b.bill_owner.last_name}`],
      ["Issued", d(b.issued_at)],
      ["Approved", ap ? `${ap.user_email}, ${d(ap.action_at)}` : "No approval"],
      ["Paid", b.paid_at ? `${d(b.paid_at)}, ${b.payment?.payment_method ?? ""}` : "Open"],
    ];
  }
  if (type === "vendor") return [["Vendor", r.name], ["Created", d(r.created_at)], ["Category", r.sk_category_name ?? ""], ["Terms", `Net ${r.net_payment_terms ?? "?"}`]];
  if (type === "user") return [["Name", `${r.first_name} ${r.last_name}`], ["Email", r.email], ["Role", r.role], ["Status", r.status]];
  return [];
}
