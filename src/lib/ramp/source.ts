import { getFixture } from "../fixtures/generate";
import type { CommentObjectType, PostedComment, RampSnapshot, SourceInfo } from "./types";
import { RampApiClient } from "./api-client";

export interface Period {
  from: string; // YYYY-MM-DD
  to: string;
}

export interface RampSource {
  info: SourceInfo;
  snapshot(period: Period): Promise<RampSnapshot>;
  /** Raw bytes of a receipt image or invoice, or null when only metadata is available. */
  file(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]): Promise<PostedComment>;
}

// Comments posted while running on demo data are kept here so the UI can show them.
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
  async postComment(object_type: CommentObjectType, object_id: string, message: string, mention_user_ids: string[]) {
    const c: PostedComment = { object_type, object_id, message, mention_user_ids, posted_at: new Date().toISOString(), destination: "Demo outbox (no Ramp account connected)" };
    demoOutbox.push(c);
    return c;
  }
}

class ApiSource implements RampSource {
  info: SourceInfo;
  private client: RampApiClient;
  private cache = new Map<string, Promise<RampSnapshot>>();
  constructor(kind: "sandbox" | "production") {
    const base = kind === "sandbox" ? "https://demo-api.ramp.com" : "https://api.ramp.com";
    this.client = new RampApiClient(base, process.env.RAMP_CLIENT_ID!, process.env.RAMP_CLIENT_SECRET!);
    this.info = { kind, label: kind === "sandbox" ? "Ramp sandbox" : "Ramp", base_url: base };
  }
  snapshot(period: Period) {
    const key = `${period.from}|${period.to}`;
    if (!this.cache.has(key)) {
      const p = this.client.snapshot(period, this.info);
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return this.cache.get(key)!;
  }
  file(url: string) {
    return this.client.download(url);
  }
  async postComment(objectType: CommentObjectType, objectId: string, message: string, mentionUserIds: string[]) {
    await this.client.postComment(objectType, objectId, message, mentionUserIds);
    return { object_type: objectType, object_id: objectId, message, mention_user_ids: mentionUserIds, posted_at: new Date().toISOString(), destination: this.info.label };
  }
}

let source: RampSource | null = null;

/**
 * TICKMARK_SOURCE=fixture (default) | sandbox | production.
 * Live sources need a Ramp developer app with the client credentials grant.
 */
export function getSource(): RampSource {
  if (source) return source;
  const kind = process.env.TICKMARK_SOURCE ?? "fixture";
  if ((kind === "sandbox" || kind === "production") && process.env.RAMP_CLIENT_ID && process.env.RAMP_CLIENT_SECRET) {
    source = new ApiSource(kind);
  } else {
    source = new FixtureSource();
  }
  return source;
}
