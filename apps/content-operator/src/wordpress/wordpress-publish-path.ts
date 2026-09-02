/**
 * Shared WordPress publication path — reusable by live CLI, batch runner, and future scheduler.
 * No LLM. Builds HTML from ContentVersion structuredContent via formatBloggerHtml + sanitize.
 */
import type { AppConfig } from "@ai-affiliate/config";
import type {
  LifecycleRepository,
  PublicationRecord,
  PublicationTarget,
} from "@ai-affiliate/database";
import type { PublisherAdapter } from "../adapters/types.js";
import {
  createWordPressPublisherFromConfig,
  wordpressCredentialsPresent,
} from "../adapters/publisher/wordpress-api-publisher.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import {
  buildKnownPublication,
  checkDuplicatePublication,
} from "../daily-blog/duplicate-gate.js";
import { evaluatePublishGate } from "../daily-blog/publish-gate.js";
import type { ArticleImage } from "../generation/article-images.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import {
  assertPublicBodyClean,
  sanitizePublicBody,
} from "../publication/public-body-sanitizer.js";

export type WordPressStoredArticle = {
  title?: string;
  lead?: string;
  summary?: string;
  sections?: Array<{ heading?: string | null; paragraphs?: string[]; lists?: string[] }>;
  cta?: { label?: string; url?: string | null };
  seoTitle?: string;
  metaDescription?: string;
};

export interface WordPressPublishPathDeps {
  config: AppConfig;
  lifecycle: LifecycleRepository;
  /** Inject for tests; default from config. */
  publisher?: PublisherAdapter;
  /** Prisma subset used for version lookup + duplicate queries */
  prisma: {
    contentVersion: {
      findUnique: (args: {
        where: { id: string };
      }) => Promise<{
        id: string;
        contentId: string;
        title: string;
        summary: string | null;
        body: string;
        status: string;
        structuredContent: unknown;
      } | null>;
    };
    publicationTarget: {
      findMany: (args: {
        where: Record<string, unknown>;
        take?: number;
      }) => Promise<
        Array<{
          id: string;
          contentVersionId: string;
          status: string;
          publishedExternalId: string | null;
          publishedUrl: string | null;
          publishedAt: Date | null;
          platformMetadata: unknown;
        }>
      >;
    };
  };
}

export interface WordPressPublishOneInput {
  contentVersionId: string;
  canonicalId?: string | null;
  ctaUrl?: string | null;
  /** publish | draft — default from config / allowDirectPublish */
  mode?: "publish" | "draft";
  /** Override dry-run (no external call, no DB write of PUBLISHED when true) */
  dryRun?: boolean;
  route?: string;
  idempotencyKey?: string;
}

export type WordPressPublishOneResult =
  | {
      ok: true;
      published: true;
      skipped: false;
      contentVersionId: string;
      contentId: string;
      canonicalId: string | null;
      publicationTargetId: string;
      publicationRecordId: string;
      externalId: string;
      url: string;
      status: string;
      publishedAt: string;
      duplicate: false;
      dryRun: false;
    }
  | {
      ok: true;
      published: false;
      skipped: true;
      reason: string;
      contentVersionId: string;
      contentId?: string;
      priorExternalId?: string | null;
      priorTargetId?: string | null;
      gateFailures?: string[];
      duplicate: boolean;
      dryRun?: boolean;
    }
  | {
      ok: false;
      published: false;
      skipped: false;
      reason: string;
      contentVersionId: string;
      error?: string;
    };

function resolveCanonicalId(
  structured: Record<string, unknown>,
  explicit?: string | null,
): string | null {
  if (explicit?.trim()) return explicit.trim().toLowerCase();
  for (const key of ["canonicalId", "cid", "externalProductId"]) {
    const v = structured[key];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  }
  const article = structured.article as Record<string, unknown> | undefined;
  if (article) {
    for (const key of ["canonicalId", "cid"]) {
      const v = article[key];
      if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
    }
  }
  return null;
}

export function buildWordPressHtmlFromVersion(input: {
  title: string;
  summary: string | null;
  structuredContent: unknown;
  ctaUrl: string;
}): {
  title: string;
  lead: string;
  excerpt: string;
  html: string;
  article: WordPressStoredArticle;
} {
  const structured = (input.structuredContent ?? {}) as Record<string, unknown>;
  const article = (structured.article ?? {}) as WordPressStoredArticle;
  const images = Array.isArray(structured.images)
    ? (structured.images as ArticleImage[])
    : undefined;
  const title = article.title || input.title || "";
  // Legacy-only lead. New writes must not invent lead from summary.
  const legacyLead =
    typeof article.lead === "string" && article.lead.trim() ? article.lead.trim() : "";
  const sections = (article.sections ?? []).map((s) => ({
    heading: s.heading ?? null,
    paragraphs: s.paragraphs ?? [],
    lists: s.lists ?? [],
  }));
  const bodyParas = sections.flatMap((s) => s.paragraphs ?? []).filter((p) => p.trim());
  if (!title || bodyParas.length === 0) {
    throw new Error("stored article incomplete for WordPress publish");
  }
  const html = formatBloggerHtml({
    title,
    lead: legacyLead || null,
    sections,
    cta: {
      label: article.cta?.label || "商品ページを見る",
      url: article.cta?.url || input.ctaUrl,
    },
    images,
  });
  const excerpt =
    article.metaDescription ||
    article.summary ||
    input.summary ||
    bodyParas[0]!.slice(0, 120);
  return { title, lead: legacyLead, excerpt, html, article };
}

export function createDefaultWordPressPublisher(config: AppConfig): PublisherAdapter {
  return createWordPressPublisherFromConfig({
    wordpressMode: config.wordpressMode,
    wordpressAllowExternalRequests: config.wordpressAllowExternalRequests,
    wordpressAllowDirectPublish: config.wordpressAllowDirectPublish,
    wordpressDefaultPublishMode: config.wordpressDefaultPublishMode,
    wordpressBaseUrl: config.wordpressBaseUrl,
    wordpressUsername: config.wordpressUsername,
    wordpressApplicationPassword: config.wordpressApplicationPassword,
    wordpressApiNamespace: config.wordpressApiNamespace,
  });
}

/**
 * Resolve WordPress publish mode for CLI / callers.
 * Priority: explicit → defaultPublishMode → draft.
 * Never promote to publish solely because a live confirm flag is set.
 */
export function resolveWordPressPublishMode(input: {
  explicitMode?: "publish" | "draft" | null;
  defaultPublishMode?: string | null;
}): "publish" | "draft" {
  if (input.explicitMode === "publish" || input.explicitMode === "draft") {
    return input.explicitMode;
  }
  const fallback = (input.defaultPublishMode ?? "").trim().toLowerCase();
  if (fallback === "publish" || fallback === "draft") {
    return fallback;
  }
  return "draft";
}

/**
 * Live CLI may only send status=publish when all three are true:
 * - WORDPRESS_PUBLISH_MODE=publish (explicit)
 * - WORDPRESS_ALLOW_DIRECT_PUBLISH=true
 * - WORDPRESS_LIVE_CONFIRM=1
 */
export function assertWordPressLivePublishAllowed(input: {
  mode: "publish" | "draft";
  explicitPublishMode: boolean;
  allowDirectPublish: boolean;
  liveConfirm: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.mode === "draft") {
    return { ok: true };
  }
  if (!input.explicitPublishMode) {
    return {
      ok: false,
      reason: "WORDPRESS_PUBLISH_REQUIRES_EXPLICIT_MODE",
    };
  }
  if (!input.allowDirectPublish) {
    return {
      ok: false,
      reason: "WORDPRESS_PUBLISH_REQUIRES_ALLOW_DIRECT",
    };
  }
  if (!input.liveConfirm) {
    return {
      ok: false,
      reason: "WORDPRESS_PUBLISH_REQUIRES_LIVE_CONFIRM",
    };
  }
  return { ok: true };
}

/**
 * Publish one APPROVED ContentVersion to WordPress.
 * Idempotent: same contentVersionId already PUBLISHED/DRAFT on WORDPRESS → skip.
 * Non-APPROVED versions are rejected with CONTENT_VERSION_NOT_APPROVED.
 */
export async function publishContentVersionToWordPress(
  deps: WordPressPublishPathDeps,
  input: WordPressPublishOneInput,
): Promise<WordPressPublishOneResult> {
  const version = await deps.prisma.contentVersion.findUnique({
    where: { id: input.contentVersionId },
  });
  if (!version) {
    return {
      ok: false,
      published: false,
      skipped: false,
      reason: "CONTENT_VERSION_MISSING",
      contentVersionId: input.contentVersionId,
    };
  }

  if (version.status !== "APPROVED") {
    return {
      ok: true,
      published: false,
      skipped: true,
      reason: "CONTENT_VERSION_NOT_APPROVED",
      contentVersionId: version.id,
      contentId: version.contentId,
      duplicate: false,
    };
  }

  const structured = (version.structuredContent ?? {}) as Record<string, unknown>;
  const canonicalId = resolveCanonicalId(structured, input.canonicalId);

  const existing = await deps.prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: { in: ["PUBLISHED", "DRAFT"] },
      OR: [
        { contentVersionId: version.id },
        ...(canonicalId
          ? [{ publishedExternalId: { not: null } }]
          : []),
      ],
    },
    take: 50,
  });

  const sameVersion = existing.find(
    (t) =>
      t.contentVersionId === version.id &&
      Boolean(t.publishedExternalId) &&
      (t.status === "PUBLISHED" || t.status === "DRAFT"),
  );
  if (sameVersion) {
    return {
      ok: true,
      published: false,
      skipped: true,
      reason: "DUPLICATE_CONTENT_VERSION",
      contentVersionId: version.id,
      contentId: version.contentId,
      priorExternalId: sameVersion.publishedExternalId,
      priorTargetId: sameVersion.id,
      duplicate: true,
    };
  }

  const known = existing
    .filter((t) => {
      if (t.contentVersionId === version.id) return true;
      if (!canonicalId) return false;
      const meta = t.platformMetadata as { canonicalId?: string } | null;
      return Boolean(meta?.canonicalId && meta.canonicalId === canonicalId);
    })
    .map((t) =>
      buildKnownPublication({
        cid: (t.platformMetadata as { canonicalId?: string } | null)?.canonicalId ?? null,
        contentVersionId: t.contentVersionId,
        bloggerPostId: t.publishedExternalId,
        status: t.status === "PUBLISHED" || t.status === "DRAFT" ? t.status : "UNKNOWN",
        publishedAt: t.publishedAt?.toISOString() ?? null,
      }),
    );
  const dup = checkDuplicatePublication(
    { cid: canonicalId, canonicalId },
    known,
  );
  if (dup.duplicate) {
    return {
      ok: true,
      published: false,
      skipped: true,
      reason: `DUPLICATE_${dup.reason ?? "PRODUCT"}`,
      contentVersionId: version.id,
      contentId: version.contentId,
      priorExternalId: dup.prior?.bloggerPostId ?? null,
      priorTargetId: null,
      duplicate: true,
    };
  }

  const productUrl =
    input.ctaUrl?.trim() ||
    (canonicalId
      ? `https://video.dmm.co.jp/av/content/?id=${canonicalId}`
      : null);
  const ctaCheck = validateFanzaAffiliateUrl(productUrl);
  // Prefer article CTA; fall back to validated product URL; never invent affiliate.
  let built: ReturnType<typeof buildWordPressHtmlFromVersion>;
  try {
    built = buildWordPressHtmlFromVersion({
      title: version.title,
      summary: version.summary,
      structuredContent: version.structuredContent,
      ctaUrl: ctaCheck.url ?? productUrl ?? "",
    });
  } catch (e) {
    return {
      ok: false,
      published: false,
      skipped: false,
      reason: "FORMATTER_FAIL",
      contentVersionId: version.id,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const mode: "publish" | "draft" =
    input.mode ??
    (deps.config.wordpressAllowDirectPublish &&
    deps.config.wordpressDefaultPublishMode === "publish"
      ? "publish"
      : "draft");

  const authPass =
    deps.config.wordpressMode === "mock" ||
    (wordpressCredentialsPresent(deps.config) && deps.config.wordpressAllowExternalRequests);

  const gate = evaluatePublishGate({
    schemaPass: true,
    defer: false,
    claimValidationPass: true,
    integrityPass: true,
    formatterPass: true,
    affiliateUrlValid: ctaCheck.ok || Boolean(built.article.cta?.url),
    imagePipelinePass: true,
    bloggerAuthPass: authPass,
    channelAuthPass: authPass,
    duplicate: false,
    dryRun: Boolean(input.dryRun),
    autoPublishEnabled: true,
    allowDirectPublish: mode === "draft" ? true : deps.config.wordpressAllowDirectPublish,
  });

  if (gate.decision === "HOLD") {
    return {
      ok: true,
      published: false,
      skipped: true,
      reason: `GATE_${gate.decision}`,
      contentVersionId: version.id,
      contentId: version.contentId,
      gateFailures: gate.failureCodes,
      duplicate: false,
    };
  }

  if (gate.decision === "DRY_RUN_OK" || input.dryRun) {
    return {
      ok: true,
      published: false,
      skipped: true,
      reason: "DRY_RUN",
      contentVersionId: version.id,
      contentId: version.contentId,
      duplicate: false,
      dryRun: true,
    };
  }

  const sanitized = sanitizePublicBody(built.html);
  assertPublicBodyClean(built.html);

  const publisher = deps.publisher ?? createDefaultWordPressPublisher(deps.config);
  const idempotencyKey =
    input.idempotencyKey ?? `wordpress:${version.id}:${mode}`;

  const prepared = await publisher.prepare({
    contentVersionId: version.id,
    title: built.title,
    body: sanitized.body,
    targetFormat: "article",
    destinationRef: deps.config.wordpressBaseUrl ?? null,
    metadata: {
      mode,
      excerpt: built.excerpt,
      summary: built.excerpt,
      canonicalId,
      route: input.route ?? "WORDPRESS_PATH",
      idempotencyKey,
      publicBodySanitized: sanitized.removed,
    },
  });

  let published;
  try {
    published =
      mode === "draft" && publisher.createDraft
        ? await publisher.createDraft({ prepared })
        : await publisher.publish({ prepared });
  } catch (e) {
    return {
      ok: false,
      published: false,
      skipped: false,
      reason: "PUBLISH_FAILED",
      contentVersionId: version.id,
      error: e instanceof Error ? e.message.slice(0, 400) : String(e),
    };
  }

  const now = new Date();
  const targetStatus = published.status === "DRAFT" ? "DRAFT" : "PUBLISHED";
  const target: PublicationTarget = await deps.lifecycle.createPublicationTarget({
    contentId: version.contentId,
    contentVersionId: version.id,
    platform: "WORDPRESS",
    destinationRef: deps.config.wordpressBaseUrl ?? null,
    targetFormat: "article",
    approvalMode: "AUTOMATIC",
    status: targetStatus,
    publishedExternalId: published.externalId,
    publishedUrl: published.url,
    publishedAt: now,
    platformMetadata: {
      canonicalId,
      route: input.route ?? "WORDPRESS_PATH",
      idempotencyKey,
      ctaUrl: ctaCheck.url ?? productUrl,
      hasAffiliateIdHint: ctaCheck.hasAffiliateIdHint,
      wordpressMode: deps.config.wordpressMode,
    },
  });

  const record: PublicationRecord = await deps.lifecycle.createPublicationRecord({
    publicationTargetId: target.id,
    platform: "WORDPRESS",
    status: targetStatus,
    externalId: published.externalId,
    url: published.url,
    responseSummary: (published.responseSummary as Record<string, unknown>) ?? null,
  });

  return {
    ok: true,
    published: true,
    skipped: false,
    contentVersionId: version.id,
    contentId: version.contentId,
    canonicalId,
    publicationTargetId: target.id,
    publicationRecordId: record.id,
    externalId: published.externalId,
    url: published.url,
    status: targetStatus,
    publishedAt: now.toISOString(),
    duplicate: false,
    dryRun: false,
  };
}

export interface WordPressBatchInput {
  contentVersionIds: string[];
  /** Max to attempt this run (not a permanent product limit). */
  limit?: number;
  mode?: "publish" | "draft";
  dryRun?: boolean;
  route?: string;
  resolveCanonicalId?: (contentVersionId: string) => string | null | undefined;
  resolveCtaUrl?: (contentVersionId: string) => string | null | undefined;
}

export interface WordPressBatchResult {
  attempted: number;
  published: number;
  skipped: number;
  failed: number;
  results: WordPressPublishOneResult[];
}

/**
 * Continuous auto-publish entry — processes many ContentVersions sequentially.
 * Failures do not abort the rest of the batch.
 */
export async function runWordPressPublicationBatch(
  deps: WordPressPublishPathDeps,
  input: WordPressBatchInput,
): Promise<WordPressBatchResult> {
  const limit = Math.max(1, input.limit ?? input.contentVersionIds.length);
  const ids = input.contentVersionIds.slice(0, limit);
  const results: WordPressPublishOneResult[] = [];
  let published = 0;
  let skipped = 0;
  let failed = 0;

  for (const contentVersionId of ids) {
    const one = await publishContentVersionToWordPress(deps, {
      contentVersionId,
      canonicalId: input.resolveCanonicalId?.(contentVersionId) ?? null,
      ctaUrl: input.resolveCtaUrl?.(contentVersionId) ?? null,
      mode: input.mode,
      dryRun: input.dryRun,
      route: input.route ?? "WORDPRESS_BATCH",
    });
    results.push(one);
    if (one.ok && one.published) published += 1;
    else if (one.ok && one.skipped) skipped += 1;
    else failed += 1;
  }

  return {
    attempted: results.length,
    published,
    skipped,
    failed,
    results,
  };
}
