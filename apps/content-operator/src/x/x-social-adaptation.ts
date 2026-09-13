/**
 * Canonical ContentVersion / Evidence → X social adaptation.
 *
 * SSOT: Factory canonical title + Evidence/Claims (+ product identity).
 * Never scrapes WordPress body; never uses WP title as the only title input.
 * Does not invent facts absent from Evidence-safe facets.
 */

import { detectXAdultExpressions, filterClaimsForXSocialContent } from "./x-social-content-policy.js";
import { isWordPressPublicForXTraffic } from "./x-eligibility.js";

export type XLinkMode = "WP_TRAFFIC" | "DIRECT_AFFILIATE" | "COMBINED";

export type XThreadShape = "SINGLE" | "SHORT_THREAD" | "RICH_THREAD";

export type XAdaptedPost = {
  sequence: number;
  role: "ROOT" | "REPLY" | "CTA";
  body: string;
  /** Which link (if any) this post carries. */
  linkKind: "none" | "wp" | "fanza";
};

export type XSocialAdaptationInput = {
  /** Writer / ContentVersion canonical title — preferred over WP display title. */
  canonicalTitle: string;
  /** Optional WP title for divergence detection only — never sole copy source. */
  wordpressTitle?: string | null;
  /** Product / official title fragment when useful as facet (not pasted wholesale). */
  productTitle?: string | null;
  cid: string;
  performerNames?: string[];
  seriesName?: string | null;
  /** Evidence / claim statements already filtered or raw (we re-filter). */
  claimStatements?: Array<{ id?: string; statement: string }>;
  safeFacets?: string[];
  publishedBlogUrl?: string | null;
  wpStatus?: string | null;
  affiliateUrl?: string | null;
  affiliateLinkReady?: boolean;
  /** Prefer a specific link mode when possible. */
  preferredLinkMode?: XLinkMode | null;
  disclosure?: string | null;
  /** Soft balance hint from recent routes. */
  preferWpTraffic?: boolean;
};

export type XSocialAdaptationResult = {
  threadShape: XThreadShape;
  linkMode: XLinkMode;
  posts: XAdaptedPost[];
  canonicalTitleUsed: string;
  wpTitleUsedAsSoleInput: false;
  titleDivergence: boolean;
  hooks: string[];
  wpUrl: string | null;
  fanzaUrl: string | null;
  mediaMode: "TEXT_ONLY";
  warnings: string[];
  tracking: {
    format: "x-social-adaptation-v1";
    cid: string;
    linkMode: XLinkMode;
    threadShape: XThreadShape;
    hookCount: number;
  };
};

const GENERIC_BANNED_RE =
  /この設定、.{0,12}一言では括れない|気になる作品を紹介|好きならチェック|注目ポイントをチェック|スレッドで紹介|まとめてチェックしたい人向け/u;

/** Catalog noise that alone must not drive X hooks. */
const LOW_VALUE_FACET_RE =
  /^(独占配信|単体作品|ハイビジョン|HD|4K|配信|セール|期間限定|おすすめ|人気|ランキング|コレクター|4時間以上作品|VR専用|8KVR|ハイクオリティVR)$/u;

/** Sexual catalog tokens unsafe / low-signal as X timeline hooks (X surface only). */
const X_UNSAFE_GENRE_HOOK_RE =
  /騎乗位|手コキ|フェラ|中出し|痴女|M女|SM|拘束|調教|貧乳|微乳|巨乳|美乳|乱交|近親|NTR|寝取|主観|SEX|セックス/iu;

/**
 * Choose WP / FANZA / combined without skipping article generation concerns.
 * When WP is not publicly reachable, never emit WP_TRAFFIC / COMBINED with a live WP URL.
 */
export function chooseXLinkMode(input: {
  publishedBlogUrl?: string | null;
  wpStatus?: string | null;
  affiliateUrl?: string | null;
  affiliateLinkReady?: boolean;
  preferredLinkMode?: XLinkMode | null;
  preferWpTraffic?: boolean;
}): {
  mode: XLinkMode;
  wpUrl: string | null;
  fanzaUrl: string | null;
  reason: string;
} {
  const wpPublic = isWordPressPublicForXTraffic(input.wpStatus);
  const wpUrl =
    wpPublic && input.publishedBlogUrl?.trim() ? input.publishedBlogUrl.trim() : null;
  const fanzaReady = input.affiliateLinkReady === true && Boolean(input.affiliateUrl?.trim());
  const fanzaUrl = fanzaReady ? input.affiliateUrl!.trim() : null;

  if (input.preferredLinkMode === "WP_TRAFFIC") {
    if (wpUrl) {
      return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl, reason: "preferred_wp" };
    }
    if (fanzaUrl) {
      return {
        mode: "DIRECT_AFFILIATE",
        wpUrl: null,
        fanzaUrl,
        reason: "preferred_wp_but_not_public_use_fanza",
      };
    }
  }
  if (input.preferredLinkMode === "DIRECT_AFFILIATE") {
    if (fanzaUrl) {
      return { mode: "DIRECT_AFFILIATE", wpUrl, fanzaUrl, reason: "preferred_fanza" };
    }
    if (wpUrl) {
      return {
        mode: "WP_TRAFFIC",
        wpUrl,
        fanzaUrl: null,
        reason: "preferred_fanza_missing_use_wp",
      };
    }
  }
  if (input.preferredLinkMode === "COMBINED") {
    if (wpUrl && fanzaUrl) {
      return { mode: "COMBINED", wpUrl, fanzaUrl, reason: "preferred_combined" };
    }
    if (wpUrl) {
      return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl: null, reason: "combined_missing_fanza" };
    }
    if (fanzaUrl) {
      return {
        mode: "DIRECT_AFFILIATE",
        wpUrl: null,
        fanzaUrl,
        reason: "combined_wp_not_public",
      };
    }
  }

  if (wpUrl && fanzaUrl) {
    if (input.preferWpTraffic) {
      return { mode: "COMBINED", wpUrl, fanzaUrl, reason: "both_available_prefer_combined" };
    }
    return { mode: "COMBINED", wpUrl, fanzaUrl, reason: "both_available_combined" };
  }
  if (wpUrl) {
    return { mode: "WP_TRAFFIC", wpUrl, fanzaUrl: null, reason: "wp_only" };
  }
  if (fanzaUrl) {
    return { mode: "DIRECT_AFFILIATE", wpUrl: null, fanzaUrl, reason: "fanza_only" };
  }
  return {
    mode: "DIRECT_AFFILIATE",
    wpUrl: null,
    fanzaUrl: input.affiliateUrl?.trim() || null,
    reason: "fallback_any_product_url",
  };
}

/**
 * Variable structure from information density — not a fixed 4-post template.
 */
export function chooseXThreadShape(hooks: string[]): XThreadShape {
  const n = hooks.filter((h) => h.trim().length > 0).length;
  if (n <= 1) return "SINGLE";
  if (n === 2) return "SHORT_THREAD";
  return "RICH_THREAD";
}

function sanitizeHook(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 80) return null;
  if (detectXAdultExpressions(s).hit) return null;
  if (GENERIC_BANNED_RE.test(s)) return null;
  if (LOW_VALUE_FACET_RE.test(s)) return null;
  if (X_UNSAFE_GENRE_HOOK_RE.test(s)) return null;
  return s;
}

/**
 * Build work-specific hooks from Evidence-safe facets / claims / performers.
 * Does not paste official title wholesale as the only hook.
 */
export function extractXSocialHooks(input: {
  canonicalTitle: string;
  productTitle?: string | null;
  performerNames?: string[];
  seriesName?: string | null;
  claimStatements?: Array<{ id?: string; statement: string }>;
  safeFacets?: string[];
}): string[] {
  const hooks: string[] = [];
  const push = (v: string | null | undefined) => {
    const s = v ? sanitizeHook(v) : null;
    if (s && !hooks.includes(s)) hooks.push(s);
  };

  // Prefer title/situation fragments and claims before raw performer lists
  const title = input.canonicalTitle.trim();
  if (title.length >= 6 && title.length <= 48) {
    push(title);
  } else if (title.length > 48) {
    // Keep a situational slice — drop trailing catalog noise if present
    const compact = title
      .replace(/(ハイクオリティ|独占配信|単体作品).*$/u, "")
      .slice(0, 42)
      .replace(/[、。\s]+$/u, "");
    if (compact.length >= 8) push(compact);
  }

  const claims = filterClaimsForXSocialContent(
    (input.claimStatements ?? []).map((c, i) => ({
      id: c.id ?? `c${i}`,
      statement: c.statement,
    })),
  );
  for (const c of claims) {
    push(c.statement);
    if (hooks.length >= 5) break;
  }
  for (const f of input.safeFacets ?? []) {
    push(f);
    if (hooks.length >= 5) break;
  }
  if (input.seriesName) push(input.seriesName);

  // Performers after situational hooks (multi-cast: keep up to 2 names)
  for (const name of (input.performerNames ?? []).slice(0, 2)) {
    push(name);
  }

  return hooks.slice(0, 5);
}

function withDisclosure(body: string, disclosure: string | null | undefined): string {
  const d = (disclosure ?? "").trim();
  if (!d) return body.trim();
  if (body.includes(d) || /#PR/u.test(body)) return body.trim();
  return `${body.trim()} ${d}`.trim();
}

function appendUrl(body: string, url: string | null): string {
  if (!url) return body;
  if (body.includes(url)) return body;
  return `${body} ${url}`.trim();
}

/**
 * Adapt canonical product understanding into X posts (single or thread).
 */
export function adaptCanonicalToXSocial(
  input: XSocialAdaptationInput,
): XSocialAdaptationResult {
  const warnings: string[] = [];
  const canonicalTitle = input.canonicalTitle.trim();
  const wpTitle = input.wordpressTitle?.trim() || null;
  const titleDivergence = Boolean(wpTitle && wpTitle !== canonicalTitle);
  if (titleDivergence) {
    warnings.push("wp_title_diverges_from_canonical_using_canonical");
  }
  if (!canonicalTitle) {
    warnings.push("canonical_title_missing");
  }

  const hooks = extractXSocialHooks({
    canonicalTitle: canonicalTitle || input.productTitle || input.cid,
    productTitle: input.productTitle,
    performerNames: input.performerNames,
    seriesName: input.seriesName,
    claimStatements: input.claimStatements,
    safeFacets: input.safeFacets,
  });

  if (hooks.length === 0) {
    warnings.push("insufficient_evidence_hooks");
  }

  const link = chooseXLinkMode({
    publishedBlogUrl: input.publishedBlogUrl,
    wpStatus: input.wpStatus,
    affiliateUrl: input.affiliateUrl,
    affiliateLinkReady: input.affiliateLinkReady,
    preferredLinkMode: input.preferredLinkMode,
    preferWpTraffic: input.preferWpTraffic,
  });
  if (!isWordPressPublicForXTraffic(input.wpStatus) && input.publishedBlogUrl) {
    warnings.push("wp_not_public_skip_wp_traffic");
  }
  if (!link.fanzaUrl && input.affiliateUrl && input.affiliateLinkReady !== true) {
    warnings.push("affiliate_not_ready");
  }

  const threadShape = chooseXThreadShape(hooks);
  const disclosure = input.disclosure ?? "#PR";
  const posts = buildPosts({
    hooks,
    threadShape,
    linkMode: link.mode,
    wpUrl: link.wpUrl,
    fanzaUrl: link.fanzaUrl,
    disclosure,
    performers: input.performerNames ?? [],
  });

  for (const p of posts) {
    if (GENERIC_BANNED_RE.test(p.body)) {
      warnings.push(`generic_copy_detected_seq_${p.sequence}`);
    }
    if (detectXAdultExpressions(p.body).hit) {
      warnings.push(`adult_expression_seq_${p.sequence}`);
    }
  }

  return {
    threadShape,
    linkMode: link.mode,
    posts,
    canonicalTitleUsed: canonicalTitle,
    wpTitleUsedAsSoleInput: false,
    titleDivergence,
    hooks,
    wpUrl: link.wpUrl,
    fanzaUrl: link.fanzaUrl,
    mediaMode: "TEXT_ONLY",
    warnings,
    tracking: {
      format: "x-social-adaptation-v1",
      cid: input.cid,
      linkMode: link.mode,
      threadShape,
      hookCount: hooks.length,
    },
  };
}

function buildPosts(input: {
  hooks: string[];
  threadShape: XThreadShape;
  linkMode: XLinkMode;
  wpUrl: string | null;
  fanzaUrl: string | null;
  disclosure: string;
  performers: string[];
}): XAdaptedPost[] {
  const hooks = input.hooks.length
    ? input.hooks
    : input.performers[0]
      ? [`${input.performers[0]}の作品情報`]
      : ["公開情報ベースの作品ポイント"];

  if (input.threadShape === "SINGLE") {
    let body = craftHookLine(hooks[0]!, hooks[1]);
    if (input.linkMode === "WP_TRAFFIC") {
      body = `${body} 記事で整理しています。`;
      body = withDisclosure(body, input.disclosure);
      body = appendUrl(body, input.wpUrl);
      return [{ sequence: 1, role: "ROOT", body, linkKind: "wp" }];
    }
    if (input.linkMode === "COMBINED") {
      // Single post: prefer WP as primary destination; FANZA belongs in thread when combined.
      body = `${body} 記事で整理しています。`;
      body = withDisclosure(body, input.disclosure);
      body = appendUrl(body, input.wpUrl ?? input.fanzaUrl);
      return [
        {
          sequence: 1,
          role: "ROOT",
          body,
          linkKind: input.wpUrl ? "wp" : "fanza",
        },
      ];
    }
    body = withDisclosure(body, input.disclosure);
    body = appendUrl(body, input.fanzaUrl);
    return [{ sequence: 1, role: "ROOT", body, linkKind: input.fanzaUrl ? "fanza" : "none" }];
  }

  // SHORT_THREAD (2) or RICH_THREAD (3)
  const maxPosts = input.threadShape === "SHORT_THREAD" ? 2 : 3;
  const posts: XAdaptedPost[] = [];

  // Post 1: hook only — no link
  posts.push({
    sequence: 1,
    role: "ROOT",
    body: withDisclosure(craftHookLine(hooks[0]!, hooks[1]), input.disclosure),
    linkKind: "none",
  });

  if (maxPosts === 2) {
    let body = hooks[1] ? craftSupportLine(hooks[1]) : craftSupportLine(hooks[0]!);
    if (input.linkMode === "COMBINED" && input.wpUrl && input.fanzaUrl) {
      body = `${body} 記事はこちら。`;
      body = withDisclosure(body, input.disclosure);
      body = appendUrl(body, input.wpUrl);
      posts.push({ sequence: 2, role: "CTA", body, linkKind: "wp" });
      let fanzaBody = "配信ページはこちら。";
      fanzaBody = withDisclosure(fanzaBody, input.disclosure);
      fanzaBody = appendUrl(fanzaBody, input.fanzaUrl);
      posts.push({ sequence: 3, role: "CTA", body: fanzaBody, linkKind: "fanza" });
      return normalizePosts(posts);
    }
    body = placeTerminalLink(body, input);
    posts.push({
      sequence: 2,
      role: "CTA",
      body,
      linkKind: terminalLinkKind(input),
    });
    return posts;
  }

  // RICH_THREAD
  posts.push({
    sequence: 2,
    role: "REPLY",
    body: craftSupportLine(hooks[1] ?? hooks[0]!),
    linkKind: "none",
  });

  if (input.linkMode === "COMBINED" && input.wpUrl && input.fanzaUrl) {
    let wpBody = hooks[2]
      ? `${craftSupportLine(hooks[2])} 記事で詳しく整理。`
      : "記事で詳しく整理しています。";
    wpBody = withDisclosure(wpBody, input.disclosure);
    wpBody = appendUrl(wpBody, input.wpUrl);
    posts.push({ sequence: 3, role: "CTA", body: wpBody, linkKind: "wp" });
    let fanzaBody = "配信ページはこちら。";
    fanzaBody = withDisclosure(fanzaBody, input.disclosure);
    fanzaBody = appendUrl(fanzaBody, input.fanzaUrl);
    posts.push({ sequence: 4, role: "CTA", body: fanzaBody, linkKind: "fanza" });
    return normalizePosts(posts).slice(0, 4);
  }

  let last = hooks[2] ? craftSupportLine(hooks[2]) : "公開情報のポイントは以上です。";
  last = placeTerminalLink(last, input);
  posts.push({
    sequence: 3,
    role: "CTA",
    body: last,
    linkKind: terminalLinkKind(input),
  });
  return posts;
}

function normalizePosts(posts: XAdaptedPost[]): XAdaptedPost[] {
  return posts.map((p, i) => ({
    sequence: i + 1,
    role: i === 0 ? "ROOT" : p.role === "CTA" || i === posts.length - 1 ? p.role : "REPLY",
    body: p.body,
    linkKind: p.linkKind,
  }));
}

function craftHookLine(primary: string, secondary?: string): string {
  if (secondary && secondary !== primary) {
    return `${primary}。${secondary}。`;
  }
  return `${primary}。`;
}

function craftSupportLine(facet: string): string {
  return `${facet}。`;
}

function terminalLinkKind(input: {
  linkMode: XLinkMode;
  wpUrl: string | null;
  fanzaUrl: string | null;
}): "wp" | "fanza" | "none" {
  if (input.linkMode === "WP_TRAFFIC" || (input.linkMode === "COMBINED" && input.wpUrl)) {
    return input.wpUrl ? "wp" : input.fanzaUrl ? "fanza" : "none";
  }
  return input.fanzaUrl ? "fanza" : input.wpUrl ? "wp" : "none";
}

function placeTerminalLink(
  body: string,
  input: {
    linkMode: XLinkMode;
    wpUrl: string | null;
    fanzaUrl: string | null;
    disclosure: string;
  },
): string {
  let out = body;
  if (input.linkMode === "WP_TRAFFIC" && input.wpUrl) {
    out = `${out} 記事で整理しています。`;
    out = withDisclosure(out, input.disclosure);
    return appendUrl(out, input.wpUrl);
  }
  out = withDisclosure(out, input.disclosure);
  return appendUrl(out, input.fanzaUrl ?? input.wpUrl);
}

/** Map adaptation posts → GeneratedContent-style body (root) + replies JSON. */
export function adaptationPostsToGeneratedBodies(posts: XAdaptedPost[]): {
  body: string;
  replies: string[];
} {
  const root = posts.find((p) => p.sequence === 1)?.body ?? "";
  const replies = posts.filter((p) => p.sequence > 1).map((p) => p.body);
  return { body: root, replies };
}
