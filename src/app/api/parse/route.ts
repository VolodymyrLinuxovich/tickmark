// POST /api/parse
// Body: multipart with `file` (Excel, CSV, PDF, text or .eml, up to 5 MB), or JSON
// { text } for pasted text, or { sample: "xlsx" | "email" } for a bundled sample.
// Response: ParsedList ({ requests, auditor, parser, warnings }) plus `input_name`, or { error } with 400.
// Only reads the list; nothing is fetched from or sent to Ramp except when fitting a sample to live data.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeFile, normalizeText } from "@/lib/parse/input";
import { parseRequests } from "@/lib/parse/claude";
import { getConnection } from "@/lib/ramp/source";
import { fitSampleToLiveData } from "@/lib/engine/live-sample";

// Parsing may call a model, which can take well over the default limit on a long list.
export const maxDuration = 120;

// Allowlist of sample files, so the request body cannot name an arbitrary path.
const SAMPLES: Record<string, string> = {
  xlsx: "hartwell-pbc-fy2025.xlsx",
  email: "hartwell-request-email.txt",
};

export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
      if (file.size > 5_000_000) return Response.json({ error: "File is larger than 5 MB" }, { status: 413 });
      const input = await normalizeFile(file.name, new Uint8Array(await file.arrayBuffer()));
      return Response.json({ ...(await parseRequests(input)), input_name: file.name });
    }
    const body = (await req.json()) as { text?: string; sample?: string };
    if (body.sample && SAMPLES[body.sample]) {
      const name = SAMPLES[body.sample];
      const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public/samples", name)));
      const input = await normalizeFile(name, bytes);
      const parsed = await parseRequests(input);
      const conn = getConnection();
      // On a real Ramp business, the FY2025 sample would find nothing; fit it to the live data.
      const fitted = conn.connected ? await fitSampleToLiveData(parsed, conn.source) : parsed;
      return Response.json({ ...fitted, input_name: name });
    }
    if (body.text?.trim()) return Response.json({ ...(await parseRequests(normalizeText(body.text))), input_name: "Pasted text" });
    return Response.json({ error: "Paste a request list or upload a file" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: `Could not read the request list: ${String(err).slice(0, 200)}` }, { status: 400 });
  }
}
