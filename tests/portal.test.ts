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
