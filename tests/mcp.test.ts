import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/mcp/route";

process.env.TICKMARK_PARSER = "rules"; // no network in tests

async function rpc(method: string, params: unknown = {}) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const body = await res.text();
  const data = body.match(/^data: (.*)$/m)?.[1] ?? body;
  return JSON.parse(data);
}

describe("MCP server", () => {
  it("lists three read-only tools", async () => {
    const out = await rpc("tools/list");
    const tools = out.result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["answer_audit_requests", "get_ramp_record", "read_request_list"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("answers the sample request email end to end", async () => {
    const text = readFileSync("public/samples/hartwell-request-email.txt", "utf8");
    const out = await rpc("tools/call", { name: "answer_audit_requests", arguments: { text } });
    const result = JSON.parse(out.result.content[0].text);
    expect(result.requests).toHaveLength(9);
    expect(result.exceptions).toHaveLength(8);
    expect(result.exceptions_total).toBe(8);
    expect(result.exceptions.every((e: { amount_usd: number }) => e.amount_usd > 0)).toBe(true);
    expect(result.exceptions.every((e: { draft_comment: unknown }) => e.draft_comment)).toBe(true);
    const id = result.exceptions[0].ramp_records[0].id;
    const rec = await rpc("tools/call", { name: "get_ramp_record", arguments: { type: result.exceptions[0].ramp_records[0].type, id } });
    expect(rec.result.content[0].text).toContain(id);
  });
});
