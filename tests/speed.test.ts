import { describe, expect, it } from "vitest";
import { RampApiClient } from "../src/lib/ramp/api-client";

/** Records the date slices asked for and answers from a fixed list filtered by date. */
class FakeClient extends RampApiClient {
  calls: { from_date: string; to_date: string }[] = [];
  constructor(private rows: { id: string; at: string }[]) {
    super("https://example.test", { kind: "token", token: "t" } as never);
  }
  override async list<T>(_p: string, params: URLSearchParams | Record<string, string> = {}): Promise<T[]> {
    const r = params as { from_date: string; to_date: string };
    this.calls.push(r);
    // Both ends inclusive, the way Ramp filters, so a row on a boundary could come back twice.
    return this.rows.filter((x) => x.at >= r.from_date && x.at <= r.to_date) as T[];
  }
}

describe("reading a long period in parallel slices", () => {
  const range = { from_date: "2025-11-16T00:00:00Z", to_date: "2026-11-16T23:59:59Z" };

  it("covers the whole range without gaps or overlaps", async () => {
    const c = new FakeClient([]);
    await c.listByDateChunks("/developer/v1/transactions", range, 6);
    expect(c.calls).toHaveLength(6);
    expect(c.calls[0].from_date).toBe(range.from_date);
    expect(c.calls.at(-1)!.to_date).toBe(range.to_date);
    for (let i = 1; i < c.calls.length; i++) {
      expect(Date.parse(c.calls[i].from_date) - Date.parse(c.calls[i - 1].to_date)).toBe(1000);
    }
  });

  it("returns every row once, including rows on a slice boundary", async () => {
    const probe = new FakeClient([]);
    await probe.listByDateChunks("/x", range, 6);
    const boundary = probe.calls[1].from_date;
    const rows = [
      { id: "a", at: "2025-11-16T00:00:00Z" },
      { id: "b", at: boundary },
      { id: "c", at: "2026-05-01T12:00:00Z" },
      { id: "d", at: "2026-11-16T23:59:59Z" },
    ];
    const c = new FakeClient(rows);
    const out = await c.listByDateChunks<{ id: string; at: string }>("/x", range, 6);
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to one read for a single slice or an empty range", async () => {
    const c = new FakeClient([{ id: "a", at: "2026-01-01T00:00:00Z" }]);
    await c.listByDateChunks("/x", range, 1);
    await c.listByDateChunks("/x", { from_date: range.to_date, to_date: range.from_date }, 6);
    expect(c.calls).toHaveLength(2);
  });
});
