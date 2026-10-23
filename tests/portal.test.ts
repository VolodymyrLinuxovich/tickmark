import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN; // memory store
});

const req = { ref: "PBC-01", title: "Card charges over $1,000", description: "All card charges over $1,000", type: "transactions_over_threshold" } as never;

describe("auditor portal store", async () => {
  const s = await import("../src/lib/portal/store");

  it("creates a portal with a long id and an owner key stored only as a hash", async () => {
    const { portal, ownerKey } = await s.createPortal({ business: "Save Time Inc", auditor: "Jane", requests: [req] });
    expect(portal.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(portal)).not.toContain(ownerKey);
    expect(s.publicView(portal)).not.toHaveProperty("owner_key_hash");
    expect(await s.getPortal(portal.id)).not.toBeNull();
  });

  it("expires after the share window", async () => {
    const { portal } = await s.createPortal({ business: "B", auditor: null, requests: [req], days: 1 });
    expect(await s.getPortal(portal.id, new Date(Date.now() + 2 * 864e5))).toBeNull();
  });

  it("rejects unknown and malformed ids", async () => {
    expect(await s.getPortal("nope")).toBeNull();
    expect(await s.getPortal("a".repeat(43))).toBeNull();
  });

  it("takes questions only about shared requests, answers only with the owner key", async () => {
    const { portal, ownerKey } = await s.createPortal({ business: "B", auditor: null, requests: [req] });
    expect(await s.addQuestion(portal.id, { ref: "PBC-99", text: "?", name: null })).toBeNull();
    const q = await s.addQuestion(portal.id, { ref: "PBC-01", text: "Why is Asana unapproved?", name: "Jane" });
    expect(q).not.toBeNull();
    expect(await s.answerQuestion(portal.id, "wrong-key-wrong-key-wrong", q!.id, "x")).toBeNull();
    const a = await s.answerQuestion(portal.id, ownerKey, q!.id, "Approved today, see comment.");
    expect(a?.answer?.text).toBe("Approved today, see comment.");
    expect((await s.getPortal(portal.id))!.questions[0].answer).not.toBeNull();
  });
});

describe("auditor portal: writes at the same time", async () => {
  const s = await import("../src/lib/portal/store");

  it("keeps every question when several are asked at once", async () => {
    const { portal } = await s.createPortal({ business: "B", auditor: null, requests: [req] });
    await Promise.all(Array.from({ length: 5 }, (_, i) => s.addQuestion(portal.id, { ref: "PBC-01", text: `Question ${i}`, name: null })));
    expect((await s.getPortal(portal.id))!.questions).toHaveLength(5);
  });

  it("keeps a question asked while another is answered", async () => {
    const { portal, ownerKey } = await s.createPortal({ business: "B", auditor: null, requests: [req] });
    const first = await s.addQuestion(portal.id, { ref: "PBC-01", text: "First", name: null });
    await Promise.all([s.answerQuestion(portal.id, ownerKey, first!.id, "Answer"), s.addQuestion(portal.id, { ref: "PBC-01", text: "Second", name: null })]);
    const p = (await s.getPortal(portal.id))!;
    expect(p.questions.map((q) => q.text)).toEqual(["First", "Second"]);
    expect(p.questions[0].answer?.text).toBe("Answer");
  });
});

describe("auditor portal: kept in step with the app", async () => {
  const s = await import("../src/lib/portal/store");
  const req2 = { ...(req as object), ref: "PBC-02" } as never;

  it("lets only the owner update requests, statuses and Ask questions", async () => {
    const { portal, ownerKey } = await s.createPortal({ business: "B", auditor: null, requests: [req] });
    expect(await s.updateShared(portal.id, "x".repeat(43), { requests: [req, req2] })).toBeNull();
    const extras = [{ question: "top 5 largest charges", plan: { entity: "transactions" as const, filters: [], sort: "amount_desc" as const, limit: 5, title: "Top 5" } }];
    await s.updateShared(portal.id, ownerKey, { requests: [req, req2], statuses: { f1: { status: "waived", note: "Immaterial" } }, extras });
    const p = s.publicView((await s.getPortal(portal.id))!);
    expect(p.requests).toHaveLength(2);
    expect(p.statuses).toEqual({ f1: { status: "waived", note: "Immaterial" } });
    expect(p.extras).toEqual(extras);
  });
});
