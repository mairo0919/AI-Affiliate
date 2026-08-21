import type { ContentVersion, PublicationTarget } from "@ai-affiliate/database";
import { assertPublicBodyClean, sanitizePublicBody } from "../publication/public-body-sanitizer.js";

export interface XExportPayload {
  format: "x-manual-export-v1";
  contentId: string;
  contentVersionId: string;
  publicationTargetId?: string;
  title: string;
  body: string;
  /** Alias for copy-ready main post */
  mainPost: string;
  reply: string | null;
  bloggerUrl: string | null;
  productUrl: string | null;
  scheduledRecommendation: string | null;
  claimReferences: string[];
  warnings: string[];
  characterCount: number;
  exportedAt: string;
  instructions: string[];
}

const FULLWIDTH_LIMIT = 140;

/**
 * Export approved X copy for manual posting (no X API).
 * Never includes internal ProductLink / replacement machinery.
 */
export function buildXExport(input: {
  contentId: string;
  version: ContentVersion;
  target?: PublicationTarget | null;
  bloggerUrl?: string | null;
  productUrl?: string | null;
  claimReferences?: string[];
  scheduledRecommendation?: string | null;
}): XExportPayload {
  const sanitized = sanitizePublicBody(input.version.body);
  assertPublicBodyClean(sanitized.body);

  const warnings: string[] = [];
  const chars = [...sanitized.body];
  let mainPost = sanitized.body;
  let reply: string | null = null;

  if (chars.length > FULLWIDTH_LIMIT) {
    warnings.push(`Main post exceeds ${FULLWIDTH_LIMIT} fullwidth chars — reply candidate generated`);
    mainPost = chars.slice(0, FULLWIDTH_LIMIT).join("");
    const rest = chars.slice(FULLWIDTH_LIMIT).join("").trim();
    reply = rest.length > 0 ? rest.slice(0, FULLWIDTH_LIMIT) : null;
  }

  const bloggerUrl = input.bloggerUrl ?? input.target?.publishedUrl ?? null;
  const productUrl = input.productUrl ?? extractFirstUrl(sanitized.body);

  return {
    format: "x-manual-export-v1",
    contentId: input.contentId,
    contentVersionId: input.version.id,
    publicationTargetId: input.target?.id,
    title: input.version.title,
    body: mainPost,
    mainPost,
    reply,
    bloggerUrl,
    productUrl,
    scheduledRecommendation: input.scheduledRecommendation ?? "平日夜帯を推奨（運用判断）",
    claimReferences: input.claimReferences ?? [],
    warnings,
    characterCount: [...mainPost].length,
    exportedAt: new Date().toISOString(),
    instructions: [
      "Paste into X manually. Do not auto-publish from this export.",
      "Keep affiliate disclosure text intact when applicable.",
      "Prefer Blogger URL over product URL when both exist.",
      "Do not alter product URLs.",
    ],
  };
}

function extractFirstUrl(body: string): string | null {
  const m = body.match(/https?:\/\/\S+/i);
  return m?.[0] ?? null;
}
