/**
 * Daily refresh of the FANZA sale shown under the work title (2026-11-27 user decision).
 *
 * The DMM ItemList `campaign` field ([{title, date_begin, date_end}]) is read per published post and
 * stored as post meta otonaselect_campaign; the theme shows the sales running now. A few posts per
 * scheduler tick, so one pass over the site spreads across a few minutes once a JST day.
 * Any failure skips that post until the next day; nothing else depends on this.
 */
import { requireDmmCredentials, type AppConfig } from "@ai-affiliate/config";
import type { Logger } from "@ai-affiliate/shared";
import { DmmApiClient } from "../providers/fanza/dmm-api-client.js";
import { jstDayStart } from "../daily-ops/demand-collector.js";
import { WP_SEO_META_KEYS } from "./wordpress-seo-attach.js";

export const WP_CAMPAIGN_META_KEY = "otonaselect_campaign";
const POSTS_PER_TICK = 25;

export type StoredCampaign = { title: string; begin: string | null; end: string };

type QueuedPost = { id: number; cid: string | null; current: string; hasCidMeta: boolean };

export type CampaignSyncState = { day: string | null; queue: QueuedPost[] };

export function createCampaignSyncState(): CampaignSyncState {
  return { day: null, queue: [] };
}

/** DMM dates are JST without an offset ("2026-11-27 09:59:59"). */
function jstIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  return m ? `${m[1]}T${m[2]}+09:00` : null;
}

export function campaignsFromDmmItem(item: { campaign?: unknown } | null | undefined): StoredCampaign[] {
  const list = Array.isArray(item?.campaign) ? item.campaign : [];
  const out: StoredCampaign[] = [];
  for (const c of list) {
    const row = c as { title?: unknown; date_begin?: unknown; date_end?: unknown };
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const end = jstIso(row.date_end);
    if (!title || !end) continue;
    out.push({ title, begin: jstIso(row.date_begin), end });
  }
  return out;
}

/** Stored value: "" when there is no sale, so an ended sale is cleared too. */
export function campaignMetaValue(campaigns: StoredCampaign[], now: Date): string {
  const live = campaigns.filter((c) => Date.parse(c.end) > now.getTime());
  return live.length > 0 ? JSON.stringify(live) : "";
}

/** Older posts carry the content id only in the work-title link (…%3Fid%3Djuq00821…). */
export function cidFromPostContent(raw: string): string | null {
  const m = raw.match(/(?:%3Fid%3D|[?&]id=)([a-z0-9_]+)/i);
  return m ? m[1]!.toLowerCase() : null;
}

function wpAuth(config: AppConfig): { base: string; headers: Record<string, string> } | null {
  const base = config.wordpressBaseUrl?.replace(/\/$/, "");
  if (!base || !config.wordpressUsername || !config.wordpressApplicationPassword) return null;
  const token = Buffer.from(`${config.wordpressUsername}:${config.wordpressApplicationPassword}`).toString("base64");
  return { base, headers: { Authorization: `Basic ${token}`, "Content-Type": "application/json" } };
}

async function loadPublishedPosts(base: string, headers: Record<string, string>): Promise<QueuedPost[]> {
  const posts: QueuedPost[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(
      `${base}/wp-json/wp/v2/posts?status=publish&per_page=100&page=${page}&context=edit&_fields=id,meta`,
      { headers },
    );
    if (!res.ok) break;
    const rows = (await res.json()) as Array<{ id: number; meta?: Record<string, unknown> }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const cid = String(row.meta?.[WP_SEO_META_KEYS.productCid] ?? "").trim().toLowerCase().replace(/^[a-z]+:/, "");
      posts.push({ id: row.id, cid: cid || null, current: String(row.meta?.[WP_CAMPAIGN_META_KEY] ?? ""), hasCidMeta: Boolean(cid) });
    }
    if (rows.length < 100) break;
  }
  return posts;
}

export async function runCampaignMetaSync(deps: {
  config: AppConfig;
  logger: Logger;
  state: CampaignSyncState;
  now?: Date;
  client?: DmmApiClient;
}): Promise<{ checked: number; updated: number; remaining: number; skipped?: string }> {
  const now = deps.now ?? new Date();
  const wp = wpAuth(deps.config);
  if (!wp) return { checked: 0, updated: 0, remaining: 0, skipped: "wordpress_not_configured" };
  let credentials: { apiId: string; affiliateId: string };
  try {
    credentials = requireDmmCredentials(deps.config);
  } catch {
    return { checked: 0, updated: 0, remaining: 0, skipped: "dmm_not_configured" };
  }

  const day = jstDayStart(now).toISOString();
  if (deps.state.day !== day) {
    deps.state.queue = await loadPublishedPosts(wp.base, wp.headers);
    deps.state.day = day;
  }
  if (deps.state.queue.length === 0) return { checked: 0, updated: 0, remaining: 0 };

  const client =
    deps.client ??
    new DmmApiClient({
      apiId: credentials.apiId,
      affiliateId: credentials.affiliateId,
      baseUrl: deps.config.dmmApiBaseUrl,
      requestIntervalMs: deps.config.fanzaRequestIntervalMs,
      timeoutMs: deps.config.fanzaRequestTimeoutMs,
      maxRetries: deps.config.fanzaMaxRetries,
      logger: deps.logger,
    });

  let checked = 0;
  let updated = 0;
  for (const post of deps.state.queue.splice(0, POSTS_PER_TICK)) {
    try {
      let cid = post.cid;
      if (!cid) {
        const res = await fetch(`${wp.base}/wp-json/wp/v2/posts/${post.id}?context=edit&_fields=content`, { headers: wp.headers });
        const body = res.ok ? ((await res.json()) as { content?: { raw?: string } }) : null;
        cid = cidFromPostContent(body?.content?.raw ?? "");
      }
      if (!cid) continue;
      const result = await client.getItemList({ cid, hits: 1 });
      const item = result.result?.items?.find((i) => String(i.content_id ?? "").toLowerCase() === cid) ?? null;
      checked += 1;
      if (!item) continue;
      const value = campaignMetaValue(campaignsFromDmmItem(item), now);
      if (value === post.current && post.hasCidMeta) continue;
      const meta: Record<string, string> = { [WP_CAMPAIGN_META_KEY]: value };
      if (!post.hasCidMeta) meta[WP_SEO_META_KEYS.productCid] = cid;
      const res = await fetch(`${wp.base}/wp-json/wp/v2/posts/${post.id}`, {
        method: "POST",
        headers: wp.headers,
        body: JSON.stringify({ meta }),
      });
      if (res.ok) updated += 1;
    } catch (error) {
      deps.logger.warn(`campaign sync post ${post.id} failed: ${String(error).replace(/(api_id|affiliate_id)=[^&\s]+/gi, "$1=[redacted]").slice(0, 200)}`);
    }
  }
  return { checked, updated, remaining: deps.state.queue.length };
}
