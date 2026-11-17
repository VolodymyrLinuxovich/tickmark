// GET /api/readiness: the days window is clamped, the sample source scores, and a failing source is a 502.
// getSource is stubbed so each case controls the source.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RampSource } from "../src/lib/ramp/source";

const state = vi.hoisted(() => ({ source: null as unknown }));
vi.mock("@/lib/ramp/source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/ramp/source")>()),
  getSource: () => state.source,
}));

const { GET } = await import("../src/app/api/readiness/route");
const real = await vi.importActual<typeof import("../src/lib/ramp/source")>("../src/lib/ramp/source");

const get = (query: string) => GET(new Request(`http://localhost/api/readiness${query}`));

/** Days covered by the response, counting both ends, as the route passes them to computeReadiness. */
const span = (j: { from: string; to: string }) => Math.round((Date.parse(j.to) - Date.parse(j.from)) / 864e5) + 1;

let before: string | undefined;
beforeAll(() => {
  // The sample company, whatever credentials the machine running the tests has.
  before = process.env.TICKMARK_SOURCE;
  process.env.TICKMARK_SOURCE = "sample";
  real.resetSource();
  state.source = real.getSource();
});
afterAll(() => {
  if (before === undefined) {
    delete process.env.TICKMARK_SOURCE;
  } else {
    process.env.TICKMARK_SOURCE = before;
  }
  real.resetSource();
});

describe("GET /api/readiness", () => {
  it("clamps days to 30 to 180 and falls back to 90 for a bad value", async () => {
    const cases: [string, number][] = [
      ["?days=10", 30],
      ["?days=999", 180],
      ["?days=abc", 90],
      ["", 90],
      ["?days=30", 30],
    ];
    for (const [query, days] of cases) {
      const res = await get(query);
      expect(res.status).toBe(200);
      expect(span(await res.json())).toBe(days);
    }
  });

  it("returns a score and weeks from the sample source", async () => {
    const res = await get("?days=90");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.source.kind).toBe("fixture");
    expect(j.score).toBeGreaterThanOrEqual(0);
    expect(j.score).toBeLessThanOrEqual(100);
    expect(j.records).toBeGreaterThan(0);
    expect(j.weeks.length).toBeGreaterThan(0);
    for (const w of j.weeks) {
      expect(w).toEqual({ start: expect.any(String), records: expect.any(Number), clean: expect.any(Number) });
    }
    expect(typeof j.ms).toBe("number");
  });

  it("returns 502 when the source throws", async () => {
    const saved = state.source;
    state.source = { info: { kind: "sandbox" }, snapshot: vi.fn().mockRejectedValue(new Error("Ramp is down")) } as unknown as RampSource;
    try {
      const res = await get("?days=90");
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/Ramp is down/);
    } finally {
      state.source = saved;
    }
  });
});
