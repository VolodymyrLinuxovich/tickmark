// Exception statuses (open, resolved, waived) and the date each call was made. No server imports, so
// the workbench can use it in the browser and the binder can print it.

/** Where the finance team stands on one exception, set in the app before download. */
export interface ExceptionStatus {
  status: "open" | "resolved" | "waived";
  note?: string;
  /** When it was marked resolved or waived (ISO time), so the auditor sees when the call was made. */
  at?: string;
}
export type ExceptionStatuses = Record<string, ExceptionStatus>;

export const STATUS_LABEL: Record<ExceptionStatus["status"], string> = { open: "Open", resolved: "Resolved", waived: "Waived" };

/**
 * Applies a status change and stamps when an exception was resolved or waived. The date stays put while
 * the note is edited, moves when the status changes, and is dropped when the exception is reopened.
 */
export function stampStatus(prev: ExceptionStatus | undefined, next: ExceptionStatus, now = new Date()): ExceptionStatus {
  if (next.status === "open") {
    return { status: "open", note: next.note };
  }
  const keep = prev?.status === next.status && prev.at;
  return { ...next, at: keep ? prev.at : now.toISOString() };
}

/** The date a status was set, as the workpapers print it: "Nov 19, 2026". */
export function statusDate(st: ExceptionStatus | undefined): string {
  if (!st?.at || st.status === "open" || Number.isNaN(Date.parse(st.at))) {
    return "";
  }
  return new Date(st.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Waived Nov 19, 2026. Below materiality" for the workpaper line. */
export function statusLine(st: ExceptionStatus | undefined): string {
  const label = STATUS_LABEL[st?.status ?? "open"];
  const when = statusDate(st);
  return `${label}${when ? ` ${when}` : ""}${st?.note ? `. ${st.note}` : ""}`;
}
