// Auditor portal storage. A portal is the request list a controller shared with their auditor, plus the
// questions the auditor asked and the answers. It holds no Ramp data and no secrets: the portal page
// recomputes results from Ramp on every visit. Stored as private JSON in Vercel Blob, or in memory
// when no Blob token is configured (local development and tests).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import type { AuditRequest } from "../parse/schema";
import type { BinderExtraInput } from "../binder/options";
import type { ExceptionStatuses } from "../binder/build";

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
  // Kept in step with the controller's app so the auditor's binder matches theirs.
  statuses?: ExceptionStatuses;
  extras?: BinderExtraInput[];
  owner_key_hash: string; // sha256 of the key the controller's browser keeps; needed to answer
}

export const PORTAL_DAYS = 14;
const ID = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

// The memory store keeps a version per portal, like the Blob ETag, so both stores refuse stale writes.
const memory = new Map<string, { portal: Portal; etag: string }>();
const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const path = (id: string) => `portals/${id}.json`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const newSecret = () => randomBytes(32).toString("base64url");
export const isPortalId = (id: string) => ID.test(id);

/** Someone else saved the portal between our load and save. */
class StaleWrite extends Error {}

/** Saves a portal. With `ifMatch`, only if nobody saved it since it was loaded with that version. */
async function save(p: Portal, ifMatch?: string) {
  if (!blobEnabled()) {
    if (ifMatch !== undefined && memory.get(p.id)?.etag !== ifMatch) throw new StaleWrite();
    memory.set(p.id, { portal: structuredClone(p), etag: randomBytes(8).toString("hex") });
    return;
  }
  try {
    await put(path(p.id), JSON.stringify(p), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, ...(ifMatch ? { ifMatch } : {}) });
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) throw new StaleWrite();
    throw err;
  }
}

async function load(id: string): Promise<{ portal: Portal; etag: string } | null> {
  if (!isPortalId(id)) return null;
  if (!blobEnabled()) {
    const m = memory.get(id);
    return m ? { portal: structuredClone(m.portal), etag: m.etag } : null;
  }
  const res = await get(path(id), { access: "private", useCache: false }).catch(() => null);
  if (!res || res.statusCode !== 200) return null;
  return { portal: JSON.parse(await new Response(res.stream).text()) as Portal, etag: res.blob.etag };
}

/**
 * Load, change, save, and start over if someone saved in between, so two people writing at once
 * (the auditor asking while the controller answers) never wipe each other's change.
 * `change` edits the portal in place and returns a result, or null to stop without saving.
 */
async function update<T>(id: string, now: Date, change: (p: Portal) => T | null): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const loaded = await load(id);
    if (!loaded || new Date(loaded.portal.expires_at) < now) return null;
    const out = change(loaded.portal);
    if (out === null) return null;
    try {
      await save(loaded.portal, loaded.etag);
      return out;
    } catch (err) {
      if (!(err instanceof StaleWrite)) throw err;
    }
  }
  throw new Error("The portal is busy. Try again.");
}

/** Creates a portal and returns it with the owner key. The key is shown once and stored only as a hash. */
export async function createPortal(input: { business: string; auditor: string | null; requests: AuditRequest[]; statuses?: ExceptionStatuses; extras?: BinderExtraInput[]; days?: number }, now = new Date()) {
  const ownerKey = newSecret();
  const portal: Portal = {
    id: newSecret(),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (input.days ?? PORTAL_DAYS) * 864e5).toISOString(),
    business: input.business,
    auditor: input.auditor,
    requests: input.requests,
    questions: [],
    statuses: input.statuses ?? {},
    extras: input.extras ?? [],
    owner_key_hash: sha(ownerKey),
  };
  await save(portal);
  return { portal, ownerKey };
}

/** Loads a live portal; expired or unknown ids return null. */
export async function getPortal(id: string, now = new Date()): Promise<Portal | null> {
  const loaded = await load(id);
  if (!loaded || new Date(loaded.portal.expires_at) < now) return null;
  return loaded.portal;
}

export function ownsPortal(p: Portal, key: string | null | undefined): boolean {
  if (!key) return false;
  const a = Buffer.from(sha(key), "hex");
  const b = Buffer.from(p.owner_key_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function addQuestion(id: string, q: { ref: string; text: string; name: string | null }, now = new Date()): Promise<PortalQuestion | null> {
  const question: PortalQuestion = { id: randomBytes(8).toString("hex"), ref: q.ref, text: q.text, name: q.name, asked_at: now.toISOString(), answer: null };
  return update(id, now, (p) => {
    if (!p.requests.some((r) => r.ref === q.ref) || p.questions.length >= 200) return null;
    p.questions.push(question);
    return question;
  });
}

export async function answerQuestion(id: string, key: string, questionId: string, text: string, now = new Date()): Promise<PortalQuestion | null> {
  return update(id, now, (p) => {
    if (!ownsPortal(p, key)) return null;
    const q = p.questions.find((x) => x.id === questionId);
    if (!q) return null;
    q.answer = { text, at: now.toISOString() };
    return q;
  });
}

/** The controller keeps the portal in step with their app: request list, exception statuses, Ask questions. */
export async function updateShared(id: string, key: string, patch: { requests?: AuditRequest[]; statuses?: ExceptionStatuses; extras?: BinderExtraInput[] }, now = new Date()): Promise<Portal | null> {
  return update(id, now, (p) => {
    if (!ownsPortal(p, key)) return null;
    if (patch.requests) p.requests = patch.requests;
    if (patch.statuses) p.statuses = patch.statuses;
    if (patch.extras) p.extras = patch.extras;
    return p;
  });
}

/** What the public portal route may return: no owner hash. */
export function publicView(p: Portal) {
  const { owner_key_hash: _drop, ...rest } = p;
  void _drop;
  return rest;
}
