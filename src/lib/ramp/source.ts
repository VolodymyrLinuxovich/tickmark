import { getFixture } from "../fixtures/generate";
import type { CommentObjectType, PostedComment, RampSnapshot, SourceInfo } from "./types";
import { RampApiClient, tokenFromRampCli, type RampAuth, type SnapshotNotes } from "./api-client";

export interface Period {
  from: string; // YYYY-MM-DD
  to: string;
}

export interface RampSource {
  info: SourceInfo;
  snapshot(period: Period): Promise<RampSnapshot & { notes?: SnapshotNotes }>;
  /** Raw bytes of a receipt image or invoice, or null when only metadata is available. */
  file(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]): Promise<PostedComment>;
  /** One record with its receipts and approval history, for the record viewer. */
  record(type: RecordKind, id: string): Promise<unknown | null>;
}

export type RecordKind = "transaction" | "bill" | "vendor" | "user" | "receipt";

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
export const getDemoOutbox = () => demoOutbox.slice();

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

const SNAPSHOT_TTL_MS = 5 * 60_000;

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

export interface Connection {
  source: RampSource;
  connected: boolean;
  reason: string; // why this source was chosen, shown in the UI
}

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
  else {
    const cli = tokenFromRampCli(env);
    if (cli) auth = { kind: "token", token: cli, origin: "Ramp CLI login" };
  }
  if (auth) {
    cached = { source: new ApiSource(env, auth, process.env.RAMP_API_BASE_URL), connected: true, reason: "" };
  } else {
    cached = { source: new FixtureSource(), connected: false, reason: "No Ramp credentials are configured, so sample data is used." };
  }
  return cached;
}

export const getSource = (): RampSource => getConnection().source;

/** Test hook: forget the chosen source so env changes take effect. */
export function resetSource() {
  cached = null;
}
