// POST /api/comment: the only route that writes to Ramp. getSource is stubbed so each case controls the source.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RampSource } from "../src/lib/ramp/source";
import { ApiSource } from "../src/lib/ramp/source";
import { APP, startMockRamp, type MockRamp } from "./mock-ramp";

const state = vi.hoisted(() => ({ source: null as unknown }));
vi.mock("@/lib/ramp/source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/ramp/source")>()),
  getSource: () => state.source,
}));

const { POST } = await import("../src/app/api/comment/route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/comment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

let ramp: MockRamp;
beforeAll(async () => {
  ramp = await startMockRamp();
});
afterAll(() => ramp.close());

describe("POST /api/comment", () => {
  it("returns the posted comment for a good body", async () => {
    const posted = { object_type: "transactions", object_id: "t1", message: "Please attach the receipt.", mention_user_ids: ["u1"], posted_at: "2026-11-16T00:00:00.000Z", destination: "Ramp sandbox" };
    const postComment = vi.fn().mockResolvedValue(posted);
    state.source = { postComment } as unknown as RampSource;
    const res = await post({ object_type: "transactions", object_id: "t1", message: "Please attach the receipt.", mention_user_ids: ["u1"], owner_user_id: "u1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(posted);
    expect(postComment).toHaveBeenCalledWith("transactions", "t1", "Please attach the receipt.", ["u1"], "u1");
  });

  it("returns 400 for a bad body and never calls Ramp", async () => {
    const postComment = vi.fn();
    state.source = { postComment } as unknown as RampSource;
    for (const body of [{ object_type: "vendors", object_id: "v1", message: "hi" }, { object_type: "bills", object_id: "", message: "hi" }, { object_type: "bills", object_id: "b1", message: "" }, { object_type: "bills", object_id: "b1", message: "x".repeat(4001) }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid comment" });
    }
    expect(postComment).not.toHaveBeenCalled();
  });

  it("returns 200 with an email, not 502, when Ramp has no comment thread on the record", async () => {
    // A real ApiSource on the mock Ramp: the client throws NoCommentThreadError on the 404, and the source turns it into an email.
    state.source = new ApiSource("sandbox", { kind: "client_credentials", ...APP }, ramp.url);
    const t = ramp.snap.transactions[5];
    const u = ramp.snap.users.find((x) => x.id === t.card_holder.user_id)!;
    ramp.noThread.add(t.id);
    const res = await post({ object_type: "transactions", object_id: t.id, message: "Please attach the receipt.", owner_user_id: u.id });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.email).toMatchObject({ to: u.email, subject: expect.stringMatching(/Audit follow-up/) });
    expect(json.email.body).toContain("Please attach the receipt.");
    expect(json.destination).toMatch(/^email to /);
  });

  it("still returns 502 for other Ramp failures", async () => {
    state.source = { postComment: vi.fn().mockRejectedValue(new Error("socket hang up")) } as unknown as RampSource;
    const res = await post({ object_type: "bills", object_id: "b1", message: "Please attach the invoice." });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/socket hang up/);
  });
});
