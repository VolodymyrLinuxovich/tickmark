import { describe, expect, it } from "vitest";
import { stampStatus, statusDate, statusLine } from "../src/lib/binder/status";
import { StatusSchema } from "../src/lib/binder/options";

const nov19 = new Date("2026-11-19T18:30:00Z");
const nov20 = new Date("2026-11-20T09:00:00Z");

describe("exception status dates", () => {
  it("stamps the day an exception is waived and keeps it while the note is edited", () => {
    const waived = stampStatus(undefined, { status: "waived" }, nov19);
    expect(waived.at).toBe(nov19.toISOString());
    const edited = stampStatus(waived, { ...waived, note: "Below materiality" }, nov20);
    expect(edited.at).toBe(nov19.toISOString());
    expect(statusLine(edited)).toBe("Waived Nov 19, 2026. Below materiality");
  });

  it("moves the date when the status changes and drops it when reopened", () => {
    const waived = stampStatus(undefined, { status: "waived" }, nov19);
    const resolved = stampStatus(waived, { status: "resolved", note: "PO attached" }, nov20);
    expect(statusDate(resolved)).toBe("Nov 20, 2026");
    const open = stampStatus(resolved, { status: "open", note: "PO attached", at: resolved.at });
    expect(open.at).toBeUndefined();
    expect(statusLine(open)).toBe("Open. PO attached");
  });

  it("prints statuses saved before dates existed without a date", () => {
    expect(statusLine({ status: "waived", note: "Below materiality" })).toBe("Waived. Below materiality");
    expect(statusDate({ status: "waived", at: "not a date" })).toBe("");
  });

  it("accepts the date from the browser when building a binder", () => {
    expect(StatusSchema.safeParse({ status: "waived", note: "x", at: nov19.toISOString() }).success).toBe(true);
  });
});
