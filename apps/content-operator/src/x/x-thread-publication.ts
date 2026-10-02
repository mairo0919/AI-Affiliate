/**
 * X Thread Publication Strategy — presentation / navigation layer (not Writer).
 *
 * CURRENT (default): WP_TRAFFIC_EMBED
 *   PARENT (Writer copy + media, no URLs)
 *     ↓ optional reply
 *   WP ARTICLE REPLY (navigation only)
 *     ↓ optional reply
 *   RELATED X REPLY (published post URL only)
 *
 * WP traffic ≠ URL must sit on parent. Reply-based WP links still count as WP_TRAFFIC.
 *
 * FUTURE (X_AFFILIATE_THREAD_MODE=true): AFFILIATE_THREAD
 *   PARENT → FANZA AFFILIATE REPLY → WP / related
 *
 * Navigation copy is publication responsibility — never Social Writer.
 * Publication never rewrites work introduction copy.
 */

import { textContainsWordPressUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import {
  hasClearAdDisclosure,
  normalizeDisclosureLabel,
  stripLegacyHashPr,
} from "./ops/pre-publish-guard.js";

export type XPublicationStrategy = "WP_TRAFFIC_EMBED" | "AFFILIATE_THREAD" | "FANZA_DIRECT";

export type XThreadPostRole =
  | "PARENT"
  | "AFFILIATE_REPLY"
  | "WP_REPLY"
  | "RELATED_REPLY";

export type XThreadReplyOrder =
  | "parent_only"
  | "wp_only"
  | "related_only"
  | "wp_then_related"
  | "related_then_wp";

/** Planner publication intent — not a fixed thread template. */
export type XPublicationIntent = {
  needsArticleReply: boolean;
  relatedPostUseful: boolean;
  /** Soft preference; Publication resolves against available navigation. */
  preferredReplyOrder?: XThreadReplyOrder | null;
};

export type XRelatedNavCandidate = {
  /** Canonical published X post URL (never invented). */
  postUrl: string;
  publicationId: string;
  /** Relation reasons from existing canonical metadata scorer. */
  reasons: string[];
};

export type XThreadComposedPost = {
  sequence: number;
  /** DB role (ROOT / CTA) — PARENT→ROOT, replies→CTA */
  role: "ROOT" | "CTA";
  /** Semantic role for tracking / dry-run */
  threadRole: XThreadPostRole;
  body: string;
  linkKind: "none" | "wp" | "fanza" | "related_x";
  /** 1-based sequence this post replies to (undefined for PARENT) */
  replyToSequence?: number;
  relatedPublicationId?: string;
};

/** Adjustable presentation templates (not Writer copy). Varied — never one fixed CTA. */
export const X_THREAD_NAV_TEMPLATE_POOLS = {
  affiliateReply: ["作品はこちら↓", "作品リンクはこちら"],
  wpReply: [
    "記事はこちら",
    "紹介記事はこちら",
    "この作品の記事はこちら",
  ],
  relatedReply: [
    "関連する過去投稿はこちら",
    "近い話題の投稿はこちら",
    "あわせてこちらも",
  ],
} as const;

/** @deprecated Prefer pools — kept for AFFILIATE_THREAD default labels in tests. */
export const X_THREAD_NAV_TEMPLATES = {
  affiliateReply: X_THREAD_NAV_TEMPLATE_POOLS.affiliateReply[0]!,
  wpReply: X_THREAD_NAV_TEMPLATE_POOLS.wpReply[0]!,
  relatedReply: X_THREAD_NAV_TEMPLATE_POOLS.relatedReply[0]!,
} as const;

export type ResolveXPublicationStrategyInput = {
  /** Feature flag X_AFFILIATE_THREAD_MODE (default false). */
  affiliateThreadMode?: boolean;
  /** Canonical WP public URL available. */
  wpUrl?: string | null;
  /** Formal affiliate URL for this CID only. */
  fanzaUrl?: string | null;
  affiliateLinkReady?: boolean;
};

/**
 * Resolve publication strategy. Affiliate thread never activates unless flag ON
 * and both WP + ready FANZA affiliate URLs exist for the same CID.
 */
export function resolveXPublicationStrategy(
  input: ResolveXPublicationStrategyInput,
): {
  strategy: XPublicationStrategy;
  reason: string;
  wpUrl: string | null;
  fanzaUrl: string | null;
} {
  const wpUrl = input.wpUrl?.trim() || null;
  const fanzaReady = input.affiliateLinkReady === true && Boolean(input.fanzaUrl?.trim());
  const fanzaUrl = fanzaReady ? input.fanzaUrl!.trim() : null;
  const modeOn = input.affiliateThreadMode === true;

  if (modeOn && wpUrl && fanzaUrl) {
    return {
      strategy: "AFFILIATE_THREAD",
      reason: "affiliate_thread_mode_enabled",
      wpUrl,
      fanzaUrl,
    };
  }
  if (modeOn && (!wpUrl || !fanzaUrl)) {
    return {
      strategy: "WP_TRAFFIC_EMBED",
      reason: !wpUrl
        ? "affiliate_thread_missing_wp_fallback_embed"
        : "affiliate_thread_missing_fanza_fallback_embed",
      wpUrl,
      fanzaUrl: null,
    };
  }
  return {
    strategy: "WP_TRAFFIC_EMBED",
    reason: "affiliate_thread_mode_off",
    wpUrl,
    fanzaUrl: null,
  };
}

function withDisclosure(body: string, disclosure: string): string {
  const label = normalizeDisclosureLabel(disclosure);
  const cleaned = stripLegacyHashPr(body);
  if (!label) return cleaned;
  if (label === "PR" || cleaned.includes(label)) {
    if (hasClearAdDisclosure(cleaned) || cleaned.includes(label)) return cleaned;
  }
  return `${label}\n${cleaned}`.trim();
}

/** Parent is writer copy. URLs belong on replies. */
function stripUrls(body: string): string {
  return body.replace(/https?:\/\/\S+/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * Disclosure belongs on the publication unit, on the commercial reply when one exists.
 * Parent is not forced to carry the WP URL, a fixed CTA, or the disclosure tag.
 */
function applyUnitDisclosure(
  posts: XThreadComposedPost[],
  disclosure: string,
): XThreadComposedPost[] {
  if (!disclosure) {
    return posts.map((post) => ({ ...post, body: stripLegacyHashPr(post.body) }));
  }
  const commercial = posts.find(
    (p) => p.threadRole === "AFFILIATE_REPLY" || p.threadRole === "WP_REPLY",
  );
  const targetSequence = commercial?.sequence ?? posts.find((p) => p.threadRole === "PARENT")?.sequence;
  if (targetSequence == null) return posts;
  return posts.map((p) =>
    p.sequence === targetSequence
      ? { ...p, body: withDisclosure(p.body, disclosure) }
      : { ...p, body: stripLegacyHashPr(p.body) },
  );
}

function pickTemplate(pool: readonly string[], seed: string): string {
  if (pool.length === 0) return "";
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length]!;
}

/** Strong relation only — single weak genre tag must not attach unrelated posts. */
export function isStrongRelatedRelation(reasons: string[]): boolean {
  const set = new Set(reasons);
  if (set.has("sameActress") || set.has("samePerformer") || set.has("sameSeries")) {
    return true;
  }
  if (set.has("sameGenre") && set.has("sameMaker")) return true;
  const strong = ["sameActress", "samePerformer", "sameSeries", "sameGenre", "sameMaker"].filter(
    (r) => set.has(r),
  );
  return strong.length >= 2;
}

export function isPublishedXPostUrl(url: string | null | undefined): boolean {
  const u = url?.trim() ?? "";
  if (!u) return false;
  if (!/^https?:\/\/(x\.com|twitter\.com)\//i.test(u)) return false;
  if (!/\/status\/\d+/i.test(u)) return false;
  return true;
}

/**
 * Resolve concrete reply order from Planner intent + available navigation.
 * Never invents replies when candidates are missing.
 */
export function resolveThreadReplyOrder(input: {
  intent?: XPublicationIntent | null;
  hasWp: boolean;
  hasRelated: boolean;
}): XThreadReplyOrder {
  const intent = input.intent ?? {
    needsArticleReply: input.hasWp,
    relatedPostUseful: input.hasRelated,
  };
  const wantWp = intent.needsArticleReply === true && input.hasWp;
  const wantRelated = intent.relatedPostUseful === true && input.hasRelated;

  if (!wantWp && !wantRelated) return "parent_only";
  if (wantWp && !wantRelated) return "wp_only";
  if (!wantWp && wantRelated) return "related_only";

  const pref = intent.preferredReplyOrder;
  if (pref === "related_then_wp" || pref === "wp_then_related") return pref;
  if (pref === "related_only" && wantRelated) return "related_only";
  if (pref === "wp_only" && wantWp) return "wp_only";
  // Default when both: article first, then related.
  return "wp_then_related";
}

/**
 * Assemble posts for the chosen publication strategy.
 * `parentBody` is Writer output only (no URLs).
 */
export function composeXThreadPublication(input: {
  strategy: XPublicationStrategy;
  parentBody: string;
  wpUrl: string | null;
  fanzaUrl: string | null;
  disclosure?: string | null;
  intent?: XPublicationIntent | null;
  related?: XRelatedNavCandidate | null;
  /** Seed for nav template variation (cid / parent hash). */
  navSeed?: string | null;
  templates?: Partial<typeof X_THREAD_NAV_TEMPLATES>;
}): XThreadComposedPost[] {
  const disclosure = input.disclosure?.trim() || "";
  const parent = stripUrls(input.parentBody);
  if (!parent) return [];

  const seed = input.navSeed?.trim() || parent.slice(0, 24);
  const templates = {
    affiliateReply:
      input.templates?.affiliateReply ??
      pickTemplate(X_THREAD_NAV_TEMPLATE_POOLS.affiliateReply, `${seed}:af`),
    wpReply:
      input.templates?.wpReply ??
      pickTemplate(X_THREAD_NAV_TEMPLATE_POOLS.wpReply, `${seed}:wp`),
    relatedReply:
      input.templates?.relatedReply ??
      pickTemplate(X_THREAD_NAV_TEMPLATE_POOLS.relatedReply, `${seed}:rel`),
  };

  const related =
    input.related &&
    isPublishedXPostUrl(input.related.postUrl) &&
    isStrongRelatedRelation(input.related.reasons)
      ? input.related
      : null;

  if (input.strategy === "FANZA_DIRECT") {
    if (!input.fanzaUrl?.trim()) return [];
    if (textContainsWordPressUrl(input.fanzaUrl) || textContainsWordPressUrl(parent)) return [];
    return [
      {
        sequence: 1,
        role: "ROOT",
        threadRole: "PARENT",
        body: parent,
        linkKind: "none",
      },
      {
        sequence: 2,
        role: "CTA",
        threadRole: "AFFILIATE_REPLY",
        body: `PR\n${input.fanzaUrl.trim()}`,
        linkKind: "fanza",
        replyToSequence: 1,
      },
    ];
  }

  if (input.strategy === "AFFILIATE_THREAD") {
    const posts: XThreadComposedPost[] = [
      {
        sequence: 1,
        role: "ROOT",
        threadRole: "PARENT",
        body: parent,
        linkKind: "none",
      },
    ];

    if (input.fanzaUrl) {
      posts.push({
        sequence: 2,
        role: "CTA",
        threadRole: "AFFILIATE_REPLY",
        body: `${templates.affiliateReply}\n${input.fanzaUrl}`.trim(),
        linkKind: "fanza",
        replyToSequence: 1,
      });
    }

    if (input.wpUrl) {
      const replyTo = posts.length;
      posts.push({
        sequence: posts.length + 1,
        role: "CTA",
        threadRole: "WP_REPLY",
        body: `${templates.wpReply}\n${input.wpUrl}`.trim(),
        linkKind: "wp",
        replyToSequence: replyTo,
      });
    }

    if (related) {
      const replyTo = posts.length;
      posts.push({
        sequence: posts.length + 1,
        role: "CTA",
        threadRole: "RELATED_REPLY",
        body: `${templates.relatedReply}\n${related.postUrl}`.trim(),
        linkKind: "related_x",
        replyToSequence: replyTo,
        relatedPublicationId: related.publicationId,
      });
    }

    return applyUnitDisclosure(posts, disclosure);
  }

  // WP_TRAFFIC_EMBED: parent never forced to carry WP URL.
  const posts: XThreadComposedPost[] = [
    {
      sequence: 1,
      role: "ROOT",
      threadRole: "PARENT",
      body: parent,
      linkKind: "none",
    },
  ];

  const order = resolveThreadReplyOrder({
    intent: input.intent,
    hasWp: Boolean(input.wpUrl),
    hasRelated: Boolean(related),
  });

  const pushWp = () => {
    if (!input.wpUrl) return;
    const replyTo = posts.length;
    posts.push({
      sequence: posts.length + 1,
      role: "CTA",
      threadRole: "WP_REPLY",
      body: `${templates.wpReply}\n${input.wpUrl}`.trim(),
      linkKind: "wp",
      replyToSequence: replyTo,
    });
  };

  const pushRelated = () => {
    if (!related) return;
    const replyTo = posts.length;
    posts.push({
      sequence: posts.length + 1,
      role: "CTA",
      threadRole: "RELATED_REPLY",
      body: `${templates.relatedReply}\n${related.postUrl}`.trim(),
      linkKind: "related_x",
      replyToSequence: replyTo,
      relatedPublicationId: related.publicationId,
    });
  };

  switch (order) {
    case "wp_only":
      pushWp();
      break;
    case "related_only":
      pushRelated();
      break;
    case "wp_then_related":
      pushWp();
      pushRelated();
      break;
    case "related_then_wp":
      pushRelated();
      pushWp();
      break;
    case "parent_only":
    default:
      break;
  }

  return applyUnitDisclosure(posts, disclosure);
}

/** Extract tracked post IDs from persisted XPublicationPost rows. */
export function extractThreadPostIds(
  posts: Array<{ sequence: number; role: string; xPostId?: string | null; body?: string }>,
): {
  PARENT_POST_ID: string | null;
  AFFILIATE_REPLY_POST_ID: string | null;
  WP_REPLY_POST_ID: string | null;
  RELATED_REPLY_POST_ID: string | null;
} {
  const bySeq = [...posts].sort((a, b) => a.sequence - b.sequence);
  const parent = bySeq.find((p) => p.role === "ROOT") ?? bySeq[0];
  const affiliate =
    bySeq.find((p) => /al\.fanza\.co\.jp|af_id=/i.test(p.body ?? "")) ??
    bySeq.find((p) => p.sequence === 2 && p.role === "CTA" && /al\.fanza/i.test(p.body ?? ""));
  const wp =
    bySeq.find(
      (p) =>
        /otonaselect\.net/i.test(p.body ?? "") &&
        p.role === "CTA" &&
        p.sequence !== affiliate?.sequence,
    ) ?? null;
  const related =
    bySeq.find(
      (p) =>
        p.role === "CTA" &&
        /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(p.body ?? "") &&
        p.sequence !== affiliate?.sequence &&
        p.sequence !== wp?.sequence,
    ) ?? null;

  return {
    PARENT_POST_ID: parent?.xPostId ?? null,
    AFFILIATE_REPLY_POST_ID: affiliate?.xPostId ?? null,
    WP_REPLY_POST_ID: wp?.xPostId ?? null,
    RELATED_REPLY_POST_ID: related?.xPostId ?? null,
  };
}
