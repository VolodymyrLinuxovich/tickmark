// Auditor portal storage. A portal is the request list a controller shared with their auditor, plus the
// questions the auditor asked and the answers. It holds no Ramp data and no secrets: the portal page
// recomputes results from Ramp on every visit. Stored as private JSON in Vercel Blob, or in memory
// when no Blob token is configured (local development and tests).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { get, put } from "@vercel/blob";
import type { AuditRequest } from "../parse/schema";

export interface PortalQuestion {
  id: string;
  ref: string; // request ref the question is about, e.g. PBC-04
  text: string;
  name: string | null; // who asked, as typed by the auditor
  asked_at: string;
  answer: { text: string; at: string } | null;
}

export interface Portal {
  id: string;
  created_at: string;
  expires_at: string;
  business: string;
  auditor: string | null;
  requests: AuditRequest[];
  questions: PortalQuestion[];
  owner_key_hash: string; // sha256 of the key the controller's browser keeps; needed to answer
}

export const PORTAL_DAYS = 14;
const ID = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

const memory = new Map<string, Portal>();
const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const path = (id: string) => `portals/${id}.json`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const newSecret = () => randomBytes(32).toString("base64url");
export const isPortalId = (id: string) => ID.test(id);

async function save(p: Portal) {
  if (!blobEnabled()) {
    memory.set(p.id, structuredClone(p));
    return;
  }
  await put(path(p.id), JSON.stringify(p), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
}

async function load(id: string): Promise<Portal | null> {
  if (!isPortalId(id)) return null;
  if (!blobEnabled()) return structuredClone(memory.get(id) ?? null);
  const res = await get(path(id), { access: "private", useCache: false }).catch(() => null);
  if (!res || res.statusCode !== 200) return null;
  return JSON.parse(await new Response(res.stream).text()) as Portal;
}

/** Creates a portal and returns it with the owner key. The key is shown once and stored only as a hash. */
export async function createPortal(input: { business: string; auditor: string | null; requests: AuditRequest[]; days?: number }, now = new Date()) {
  const ownerKey = newSecret();
  const portal: Portal = {
    id: newSecret(),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (input.days ?? PORTAL_DAYS) * 864e5).toISOString(),
    business: input.business,
    auditor: input.auditor,
    requests: input.requests,
    questions: [],
    owner_key_hash: sha(ownerKey),
  };
  await save(portal);
  return { portal, ownerKey };
}

/** Loads a live portal; expired or unknown ids return null. */
export async function getPortal(id: string, now = new Date()): Promise<Portal | null> {
  const p = await load(id);
  if (!p || new Date(p.expires_at) < now) return null;
  return p;
}

export function ownsPortal(p: Portal, key: string | null | undefined): boolean {
  if (!key) return false;
  const a = Buffer.from(sha(key), "hex");
  const b = Buffer.from(p.owner_key_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function addQuestion(id: string, q: { ref: string; text: string; name: string | null }, now = new Date()): Promise<PortalQuestion | null> {
  const p = await getPortal(id, now);
  if (!p || !p.requests.some((r) => r.ref === q.ref) || p.questions.length >= 200) return null;
  const question: PortalQuestion = { id: randomBytes(8).toString("hex"), ref: q.ref, text: q.text, name: q.name, asked_at: now.toISOString(), answer: null };
  p.questions.push(question);
  await save(p);
  return question;
}

export async function answerQuestion(id: string, key: string, questionId: string, text: string, now = new Date()): Promise<PortalQuestion | null> {
  const p = await getPortal(id, now);
  if (!p || !ownsPortal(p, key)) return null;
  const q = p.questions.find((x) => x.id === questionId);
  if (!q) return null;
  q.answer = { text, at: now.toISOString() };
  await save(p);
  return q;
}

/** What the public portal route may return: no owner hash. */
export function publicView(p: Portal) {
  const { owner_key_hash: _drop, ...rest } = p;
  void _drop;
  return rest;
}
