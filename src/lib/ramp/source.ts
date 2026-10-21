// Chooses where Ramp data comes from: the generated demo company or the live Ramp Developer API.
// Both sides implement RampSource, so the engine, binder and UI never know which one they are using.

import { getFixture } from "../fixtures/generate";
import type { CommentObjectType, PostedComment, RampSnapshot, SourceInfo } from "./types";
import { RampApiClient, loginFromRampCli, type RampAuth, type SnapshotNotes } from "./api-client";

/** Audit period, inclusive on both ends. */
export interface Period {
  from: string; // YYYY-MM-DD
  to: string;
}

/** The one interface the rest of the app reads Ramp data through. */
export interface RampSource {
  info: SourceInfo;
  snapshot(period: Period): Promise<RampSnapshot & { notes?: SnapshotNotes }>;
  /** Raw bytes of a receipt image or invoice, or null when only metadata is available. */
  file(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]): Promise<PostedComment>;
  /** One record with its receipts and approval history, for the record viewer. */
  record(type: RecordKind, id: string): Promise<unknown | null>;
}

/** Record types the record viewer can open by id. */
export type RecordKind = "transaction" | "bill" | "vendor" | "user" | "receipt";

/** Looks up one record in a snapshot and attaches its receipts and approval, for the record viewer. */
export function recordFromSnapshot(snap: RampSnapshot, type: RecordKind, id: string): unknown | null {
  if (type === "transaction") {
    const t = snap.transactions.find((x) => x.id === id);
    return t ? { transaction: t, receipts: snap.receipts.filter((r) => r.transaction_id === id), approval: snap.approvals.find((a) => a.entity_id === id) ?? null } : null;
  }
  if (type === "bill") {
    const b = snap.bills.find((x) => x.id === id);
    return b ? { bill: b, approval: snap.approvals.find((a) => a.entity_id === id) ?? null } : null;
  }
  if (type === "vendor") return snap.vendors.find((x) => x.id === id) ?? null;
  if (type === "user") return snap.users.find((x) => x.id === id) ?? null;
  return snap.receipts.find((x) => x.id === id) ?? null;
}

// Comments approved while on sample data are kept here so the UI can show them.
const demoOutbox: PostedComment[] = [];
/** Copy of the comments "sent" on sample data, for the UI. */
export const getDemoOutbox = () => demoOutbox.slice();

/** Serves the seeded Acme Robotics demo company. Comments go to an in-memory outbox instead of Ramp. */
class FixtureSource implements RampSource {
  info = getFixture().snapshot.source;
  async snapshot() {
    return getFixture().snapshot;
  }
  async file() {
    return null; // binder renders a document from the record instead
  }
  async record(type: RecordKind, id: string) {
    return recordFromSnapshot(getFixture().snapshot, type, id);
  }
  async postComment(object_type: CommentObjectType, object_id: string, message: string, mention_user_ids: string[]) {
    const c: PostedComment = { object_type, object_id, message, mention_user_ids, posted_at: new Date().toISOString(), destination: "Sample data outbox (no Ramp account connected)" };
    demoOutbox.push(c);
    return c;
  }
}

// A full snapshot is many paginated calls, so it is reused for a few minutes across requests in the same process.
const SNAPSHOT_TTL_MS = 5 * 60_000;

/** Live Ramp source. Sandbox uses demo-api.ramp.com and production uses api.ramp.com unless RAMP_API_BASE_URL overrides it. */
export class ApiSource implements RampSource {
  info: SourceInfo;
  private client: RampApiClient;
  private cache = new Map<string, { at: number; p: Promise<RampSnapshot & { notes: SnapshotNotes }> }>();
  constructor(kind: "sandbox" | "production", auth: RampAuth, baseOverride?: string) {
    const base = baseOverride ?? (kind === "sandbox" ? "https://demo-api.ramp.com" : "https://api.ramp.com");
    this.client = new RampApiClient(base, auth);
    const how = auth.kind === "client_credentials" ? "developer app" : auth.origin;
    this.info = { kind, label: `${kind === "sandbox" ? "Ramp sandbox" : "Ramp"} (${how})`, base_url: base };
  }
  snapshot(period: Period) {
    const key = `${period.from}|${period.to}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.p;
    // The promise itself is cached so concurrent callers share one read. A failed read is evicted so the next call retries.
    const p = this.client.snapshot(period, this.info);
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, { at: Date.now(), p });
    return p;
  }
  file(url: string) {
    return this.client.download(url);
  }
  async record(type: RecordKind, id: string) {
    // Prefer the snapshot the user just ran on, so receipts and approvals come along.
    const recent = [...this.cache.values()].sort((a, b) => b.at - a.at);
    for (const c of recent) {
      const snap = await c.p.catch(() => null);
      const hit = snap && recordFromSnapshot(snap, type, id);
      if (hit) return hit;
    }
    const path = { transaction: "transactions", bill: "bills", vendor: "vendors", user: "users", receipt: "receipts" }[type];
    return this.client.get(`/developer/v1/${path}/${encodeURIComponent(id)}`).catch(() => null);
  }
  async postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]) {
    await this.client.postComment(objectType, objectId, message, mentionUserIds);
    return { object_type: objectType, object_id: objectId, message, mention_user_ids: mentionUserIds, posted_at: new Date().toISOString(), destination: this.info.label };
  }
}

/** The chosen source plus whether it is a real Ramp account, for the connection badge in the UI. */
export interface Connection {
  source: RampSource;
  connected: boolean;
  reason: string; // why this source was chosen, shown in the UI
}

// Chosen once per process; env vars do not change while the server runs.
let cached: Connection | null = null;

/**
 * Picks the data source.
 * TICKMARK_SOURCE: auto (default) | sandbox | production | sample.
 * Auth, in order: RAMP_CLIENT_ID + RAMP_CLIENT_SECRET, RAMP_ACCESS_TOKEN, then a `ramp auth login` token.
 * auto uses Ramp when any credential is found and sample data otherwise.
 */
export function getConnection(): Connection {
  if (cached) return cached;
  const mode = (process.env.TICKMARK_SOURCE ?? "auto").toLowerCase();
  const env: "sandbox" | "production" = mode === "production" || process.env.RAMP_ENV === "production" ? "production" : "sandbox";
  if (mode === "sample" || mode === "fixture") {
    cached = { source: new FixtureSource(), connected: false, reason: "Sample data was chosen with TICKMARK_SOURCE." };
    return cached;
  }
  let auth: RampAuth | null = null;
  if (process.env.RAMP_CLIENT_ID && process.env.RAMP_CLIENT_SECRET) auth = { kind: "client_credentials", clientId: process.env.RAMP_CLIENT_ID, clientSecret: process.env.RAMP_CLIENT_SECRET };
  else if (process.env.RAMP_ACCESS_TOKEN) auth = { kind: "token", token: process.env.RAMP_ACCESS_TOKEN, origin: "access token" };
  let reason = "No Ramp credentials are configured, so sample data is used.";
  if (!auth) {
    const cli = loginFromRampCli(env);
    // A CLI login made during signup only has application scopes; it can't read spend yet.
    if (cli && cli.scopes.length && !cli.scopes.includes("transactions:read")) {
      reason = `The Ramp CLI is logged in to the ${env} but cannot read transactions yet (granted: ${cli.scopes.join(", ")}). Finish the Ramp application, then run \`ramp auth login\` again.`;
    } else if (cli) auth = { kind: "token", token: cli.token, origin: "Ramp CLI login" };
  }
  if (auth) {
    cached = { source: new ApiSource(env, auth, process.env.RAMP_API_BASE_URL), connected: true, reason: "" };
  } else {
    cached = { source: new FixtureSource(), connected: false, reason };
  }
  return cached;
}

/** Shortcut for the chosen source. */
export const getSource = (): RampSource => getConnection().source;

/** Test hook: forget the chosen source so env changes take effect. */
export function resetSource() {
  cached = null;
}
