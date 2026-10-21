import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiSource } from "../src/lib/ramp/source";
import { runAll, uniqueFindings } from "../src/lib/engine/run";
import { buildBinder } from "../src/lib/binder/build";
import { normalizeFile } from "../src/lib/parse/input";
import { parseWithRules } from "../src/lib/parse/rules";
import { getFixture } from "../src/lib/fixtures/generate";
import { APP, CLI_TOKEN, startMockRamp, type MockRamp } from "./mock-ramp";

let ramp: MockRamp;
const period = { from: "2025-01-01", to: "2025-12-31" };

async function requests() {
  const f = "public/samples/hartwell-pbc-fy2025.xlsx";
  return parseWithRules(await normalizeFile(f, new Uint8Array(readFileSync(f)))).requests;
}
const expectedIds = () => uniqueFindings(runAll(parseWithRulesSync(), getFixture().snapshot)).map((f) => f.id).sort();
let parsedCache: Awaited<ReturnType<typeof requests>>;
const parseWithRulesSync = () => parsedCache;

beforeAll(async () => {
  ramp = await startMockRamp();
  parsedCache = await requests();
});
afterAll(() => ramp.close());

describe("live Ramp client against a spec-shaped mock", () => {
  it("developer app: reads every page and gives the same findings as the sample run", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const snap = await src.snapshot(period);
    expect(snap.transactions).toHaveLength(ramp.snap.transactions.length);
    expect(snap.receipts).toHaveLength(ramp.snap.receipts.length);
    expect(snap.bills).toHaveLength(ramp.snap.bills.length);
    expect(snap.notes.approvals).toBe("approvals_api");
    expect(ramp.maxEntityIds).toBeGreaterThan(1); // entity_ids sent as repeated params, not collapsed
    const ids = uniqueFindings(runAll(parsedCache, snap)).map((f) => f.id).sort();
    expect(expectedIds()).toHaveLength(8);
    expect(ids).toEqual(expectedIds());
  });

  it("follows page.next and retries after a 429", () => {
    const pages = ramp.log.filter((l) => l.path === "/developer/v1/transactions");
    expect(pages.length).toBeGreaterThan(3);
    expect(ramp.log.filter((l) => l.path === "/developer/v1/users").length).toBeGreaterThanOrEqual(2);
  });

  it("Ramp CLI token without approvals:read: rebuilds approvals and finds the same problems", async () => {
    const src = new ApiSource("sandbox", { kind: "token", token: CLI_TOKEN, origin: "Ramp CLI login" }, ramp.url);
    const snap = await src.snapshot(period);
    expect(snap.notes.approvals).toBe("fallback");
    expect(snap.approvals.filter((a) => a.entity_type === "bill")).toHaveLength(ramp.snap.bills.length);
    expect(snap.approvals.filter((a) => a.entity_type === "transaction").length).toBe(ramp.snap.approvals.filter((a) => a.entity_type === "transaction").length);
    expect(snap.notes.warnings.join(" ")).toMatch(/rebuilt from bill history and audit logs/);
    const ids = uniqueFindings(runAll(parsedCache, snap)).map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds());
  });

  it("downloads real receipt and invoice files into the binder", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const snap = await src.snapshot(period);
    const results = runAll(parsedCache, snap);
    const zip = await JSZip.loadAsync(await buildBinder(results, snap, src, "Hartwell & Co."));
    const names = Object.keys(zip.files);
    expect(names.filter((n) => n.includes("PBC-02") && n.endsWith(".png"))).toHaveLength(11);
    expect(names.some((n) => n.includes("PBC-03") && n.endsWith(".png"))).toBe(true);
    expect(names.some((n) => n.includes("demo"))).toBe(false);
  });

  it("posts an approved comment to the Ramp thread with a write-scoped token", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const t = ramp.snap.transactions[0];
    const out = await src.postComment("transactions", t.id, "Please attach the receipt.", [t.card_holder.user_id]);
    expect(out.destination).toMatch(/Ramp sandbox/);
    expect(ramp.comments).toEqual([{ type: "transactions", id: t.id, body: { message: "Please attach the receipt.", message_format: "PLAIN_TEXT", mention_user_ids: [t.card_holder.user_id] } }]);
    const tokenReq = ramp.log.filter((l) => l.path === "/developer/v1/token");
    expect(tokenReq.length).toBeGreaterThan(0);
  });

  it("looks up a record from the last snapshot, then directly", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    await src.snapshot(period);
    const bill = ramp.snap.bills[0];
    const rec = (await src.record("bill", bill.id)) as { bill: { id: string }; approval: unknown };
    expect(rec.bill.id).toBe(bill.id);
    expect(rec.approval).not.toBeNull();
    const fresh = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const direct = (await fresh.record("vendor", ramp.snap.vendors[0].id)) as { id: string };
    expect(direct.id).toBe(ramp.snap.vendors[0].id);
  });

  it("rejects bad client credentials with a clear error", async () => {
    const src = new ApiSource("sandbox", { kind: "client_credentials", clientId: "x", clientSecret: "y" }, ramp.url);
    await expect(src.snapshot({ from: "2024-01-01", to: "2024-12-31" })).rejects.toThrow(/Ramp API 401 on \/developer\/v1\/token/);
  });
});
