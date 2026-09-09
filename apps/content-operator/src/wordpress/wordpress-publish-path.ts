/**
 * Shared WordPress publication path — reusable by live CLI, batch runner, and future scheduler.
 * No LLM. Builds HTML from ContentVersion structuredContent via formatBloggerHtml + sanitize.
 */
import type { AppConfig } from "@ai-affiliate/config";
import type {
  LifecycleRepository,
  PublicationRecord,
} from "@ai-affiliate/database";
import type { PublisherAdapter } from "../adapters/types.js";
import {
  createWordPressPublisherFromConfig,
  wordpressCredentialsPresent,
} from "../adapters/publisher/wordpress-api-publisher.js";
import { resolvePublicationOffer } from "../publication/offer-resolution.js";
import {
  buildKnownPublication,
  checkDuplicatePublication,
} from "../daily-blog/duplicate-gate.js";
import { evaluatePublishGate } from "../daily-blog/publish-gate.js";
import {
  buildWordPressSeoAttach,
  OTONASELECT_PRODUCTION_ORIGIN,
  type WordPressSeoAttach,
} from "./wordpress-seo-attach.js";
import {
  deriveWordPressTaxonomyFromEvidence,
  type EvidenceTaxonomyLabel,
} from "./evidence-taxonomy.js";
import { resolveWordPressPostDates } from "./wordpress-datetime.js";
import type { ArticleImage } from "../generation/article-images.js";
import { parseArticleImages } from "../generation/article-images.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import {
  resolveArticleImagesByExternalIds,
  resolveImagesForContentVersion,
} from "../generation/resolve-article-images.js";
import {
  assertPublicBodyClean,
  sanitizePublicBody,
} from "../publication/public-body-sanitizer.js";
import {
  evaluateImagesForWordPressPublication,
} from "../publication/image-publication-eligibility.js";
import { FANZA_PROVIDER_KEY } from "../publication/provider-registry-meta.js";
import type { WordPressApiPublisher } from "../adapters/publisher/wordpress-api-publisher.js";

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
  /** Prisma subset used for version lookup + duplicate queries + evidence tags */
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
  /** Prefer product FANZA cid for image resolution (distinct from duplicate-gate keys). */
  productCanonicalId?: string | null;
  ctaUrl?: string | null;
  /** publish | draft | future — future requires scheduledAt and PUBLIC image gate */
  mode?: "publish" | "draft" | "future";
  /**
   * Absolute Instant for WordPress future reservation (JST slots via caller).
   * When set with mode=future|publish, post dates use this Instant.
   */
  scheduledAt?: Date;
  /** Override dry-run (no external call, no DB write of PUBLISHED when true) */
  dryRun?: boolean;
  route?: string;
  idempotencyKey?: string;
  /** Merged into PublicationTarget.platformMetadata (daily ops mix keys, etc.). */
  platformMetadata?: Record<string, unknown>;
  /**
   * When a WORDPRESS DRAFT already exists for this contentVersion, rebuild HTML
   * (including draft-eligible RC preview images) and PATCH the same post.
   * Never creates a new post. Never touches posts 13–25 unless they are this target.
   */
  updateExistingDraft?: boolean;
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

function looksLikeProductExternalId(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v || v.length < 4 || v.length > 32) return false;
  if (v.includes("-") && /c[a-z0-9]{20,}/.test(v)) return false;
  if (/^ofje-density|^tmp-|^test-/.test(v)) return false;
  return /^[a-z][a-z0-9]{2,31}$/.test(v);
}

function resolveProductCanonicalId(input: {
  structured: Record<string, unknown>;
  explicit?: string | null;
  fallbackCanonicalId?: string | null;
  platformMetadata?: unknown;
}): string | null {
  if (input.explicit?.trim() && looksLikeProductExternalId(input.explicit)) {
    return input.explicit.trim().toLowerCase();
  }
  for (const key of ["productCanonicalId", "canonicalId", "cid", "externalProductId"]) {
    const v = input.structured[key];
    if (typeof v === "string" && looksLikeProductExternalId(v)) {
      return v.trim().toLowerCase();
    }
  }
  const meta =
    input.platformMetadata &&
    typeof input.platformMetadata === "object" &&
    !Array.isArray(input.platformMetadata)
      ? (input.platformMetadata as Record<string, unknown>)
      : null;
  if (meta) {
    for (const key of ["productCanonicalId", "canonicalId", "cid"]) {
      const v = meta[key];
      if (typeof v === "string" && looksLikeProductExternalId(v)) {
        return v.trim().toLowerCase();
      }
    }
  }
  if (input.fallbackCanonicalId && looksLikeProductExternalId(input.fallbackCanonicalId)) {
    return input.fallbackCanonicalId.trim().toLowerCase();
  }
  return null;
}

async function resolveImagesForWordPressPublish(input: {
  deps: WordPressPublishPathDeps;
  contentVersionId: string;
  structured: Record<string, unknown>;
  productCanonicalId: string | null;
  persistResolved: boolean;
}): Promise<{
  imagesForEval: ArticleImage[];
  structuredWithImages: Record<string, unknown>;
  imageRefreshMeta: Record<string, unknown> & { notes: string[] };
}> {
  const notes: string[] = [];
  const stored = parseArticleImages(input.structured.images);
  let images = stored;
  let source: string = stored.length > 0 ? "structured" : "empty";

  if (images.length === 0) {
    try {
      const refreshed = await resolveImagesForContentVersion(
        input.deps.lifecycle,
        input.contentVersionId,
        { refresh: true },
      );
      if (refreshed.images.length > 0) {
        images = refreshed.images;
        source = `resolved:${String(refreshed.source)}`;
        notes.push(`image_refresh_from_topic_or_structured=${images.length}`);
      }
    } catch {
      notes.push("image_refresh_topic_lookup_failed");
    }
  }

  if (images.length === 0 && input.productCanonicalId) {
    try {
      const byCid = await resolveArticleImagesByExternalIds(
        input.deps.lifecycle,
        [input.productCanonicalId],
      );
      if (byCid.images.length > 0) {
        images = byCid.images;
        source = "resolved:productCanonicalId";
        notes.push(`image_refresh_from_productCanonicalId=${images.length}`);
      }
    } catch {
      notes.push("image_refresh_productCanonicalId_failed");
    }
  }

  const structuredWithImages: Record<string, unknown> = {
    ...input.structured,
    images,
    imageMeta: {
      ...((input.structured.imageMeta as Record<string, unknown> | undefined) ?? {}),
      displayMode: "url_reference",
      researchImageCount: images.length,
      refreshedAtPublish: source !== "structured" && source !== "empty",
      refreshSource: source,
      productCanonicalId: input.productCanonicalId,
    },
  };

  if (
    input.persistResolved &&
    images.length > 0 &&
    stored.length === 0 &&
    typeof input.deps.lifecycle.updateContentVersionStructuredContent === "function"
  ) {
    await input.deps.lifecycle.updateContentVersionStructuredContent(
      input.contentVersionId,
      structuredWithImages,
    );
    notes.push("persisted_structuredContent.images_for_draft_preview");
  }

  return {
    imagesForEval: images,
    structuredWithImages,
    imageRefreshMeta: { source, count: images.length, notes },
  };
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
  const updatingExistingDraft =
    Boolean(input.updateExistingDraft) &&
    sameVersion?.status === "DRAFT" &&
    Boolean(sameVersion.publishedExternalId);

  if (sameVersion && !updatingExistingDraft) {
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
  if (!updatingExistingDraft) {
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
  }

  const productCanonicalId = resolveProductCanonicalId({
    structured,
    explicit: input.productCanonicalId,
    fallbackCanonicalId: canonicalId,
    platformMetadata: sameVersion?.platformMetadata ?? input.platformMetadata,
  });

  const offer = resolvePublicationOffer({
    providerKey: FANZA_PROVIDER_KEY,
    productId: productCanonicalId ?? canonicalId,
    affiliateUrl: input.ctaUrl?.trim() || null,
    canonicalProductUrl: (productCanonicalId ?? canonicalId)
      ? `https://video.dmm.co.jp/av/content/?id=${productCanonicalId ?? canonicalId}`
      : null,
  });
  const productUrl = offer.url;
  const ctaCheck = {
    ok: Boolean(productUrl),
    url: productUrl,
    failureCode: offer.failureCode,
    hasAffiliateIdHint: offer.affiliateLinkReady,
  };

  const mode: "publish" | "draft" | "future" =
    input.mode ??
    (deps.config.wordpressAllowDirectPublish &&
    deps.config.wordpressDefaultPublishMode === "publish"
      ? "publish"
      : "draft");

  // future/publish both require PUBLIC image eligibility (ALLOWED hero).
  const imageMode: "draft" | "publish" =
    mode === "draft" ? "draft" : "publish";

  // Ensure DRAFT can embed RC preview images even when generation left images=[].
  // Does not upgrade usageStatus to ALLOWED. PUBLIC gate stays strict.
  const { imagesForEval, imageRefreshMeta, structuredWithImages } =
    await resolveImagesForWordPressPublish({
      deps,
      contentVersionId: version.id,
      structured,
      productCanonicalId,
      persistResolved: mode === "draft",
    });

  const imageEval = evaluateImagesForWordPressPublication({
    images: imagesForEval,
    mode: imageMode,
  });
  if (!imageEval.pass) {
    return {
      ok: true,
      published: false,
      skipped: true,
      reason: "IMAGE_PUBLIC_ELIGIBILITY",
      contentVersionId: version.id,
      contentId: version.contentId,
      gateFailures: imageEval.failureCodes,
      duplicate: false,
    };
  }

  const structuredForHtml = {
    ...structuredWithImages,
    images: imageEval.imagesForHtml,
  };

  // Prefer article CTA; fall back to validated product URL; never invent affiliate.
  let built: ReturnType<typeof buildWordPressHtmlFromVersion>;
  try {
    built = buildWordPressHtmlFromVersion({
      title: version.title,
      summary: version.summary,
      structuredContent: structuredForHtml,
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
    imagePipelinePass: imageEval.imagePipelinePass,
    bloggerAuthPass: authPass,
    channelAuthPass: authPass,
    duplicate: false,
    dryRun: Boolean(input.dryRun),
    autoPublishEnabled: true,
    allowDirectPublish:
      mode === "draft"
        ? true
        : deps.config.wordpressAllowDirectPublish ||
          (mode === "future" && deps.config.wordpressAllowFutureSchedule),
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

  const seoAttach = buildSeoAttachFromStructured({
    structured: structuredWithImages,
    title: built.title,
    excerptFallback: built.excerpt,
    productCanonicalId,
    siteOrigin: deps.config.wordpressBaseUrl ?? OTONASELECT_PRODUCTION_ORIGIN,
    evidenceLabels: await loadEvidenceLabelsForProduct(deps.prisma, productCanonicalId),
  });
  const seoTermIds = await resolveSeoTermIds(publisher, seoAttach);
  const scheduleInstant =
    input.scheduledAt &&
    (mode === "future" || mode === "publish") &&
    input.scheduledAt.getTime() > Date.now()
      ? input.scheduledAt
      : null;
  const effectiveMode: "draft" | "publish" | "future" =
    scheduleInstant && mode !== "draft" ? "future" : mode;
  if (
    effectiveMode === "future" &&
    !deps.config.wordpressAllowDirectPublish &&
    !deps.config.wordpressAllowFutureSchedule
  ) {
    return {
      ok: true,
      published: false,
      skipped: true,
      reason: "FUTURE_SCHEDULE_DISABLED",
      contentVersionId: version.id,
      contentId: version.contentId,
      duplicate: false,
    };
  }
  const postDates = resolveWordPressPostDates(
    scheduleInstant ?? new Date(),
    deps.config.publicationTimezone || "Asia/Tokyo",
  );

  const prepared = await publisher.prepare({
    contentVersionId: version.id,
    title: built.title,
    body: sanitized.body,
    targetFormat: "article",
    destinationRef: deps.config.wordpressBaseUrl ?? null,
    metadata: {
      mode: effectiveMode,
      status: effectiveMode,
      wpStatus: effectiveMode === "future" ? "future" : effectiveMode,
      excerpt: seoAttach.excerpt || built.excerpt,
      summary: seoAttach.excerpt || built.excerpt,
      canonicalId,
      productCanonicalId: productCanonicalId ?? undefined,
      route: input.route ?? "WORDPRESS_PATH",
      idempotencyKey,
      publicBodySanitized: sanitized.removed,
      wpSeoMeta: seoAttach.meta,
      wpTagIds: seoTermIds.tagIds,
      wpCategoryIds: seoTermIds.categoryIds,
      wpPerformerIds: seoTermIds.performerIds,
      wpSeriesIds: seoTermIds.seriesIds,
      seoAttachNotes: seoAttach.notes,
      wpDate: postDates.date,
      wpDateGmt: postDates.date_gmt,
      scheduledAt: scheduleInstant?.toISOString() ?? null,
    },
  });

  let published;
  try {
    if (updatingExistingDraft && sameVersion?.publishedExternalId && publisher.update) {
      published = await publisher.update({
        externalId: sameVersion.publishedExternalId,
        prepared,
      });
      published = {
        ...published,
        externalId: sameVersion.publishedExternalId,
        status: effectiveMode === "future" ? "DRAFT" : "DRAFT",
        url: published.url ?? sameVersion.publishedUrl ?? "",
      };
    } else {
      published =
        effectiveMode === "draft" && publisher.createDraft
          ? await publisher.createDraft({ prepared })
          : await publisher.publish({ prepared });
    }
  } catch (e) {
    // Theme SEO meta / custom taxonomies may be unavailable until theme v1.5+.
    // Retry once with excerpt + standard tags/categories only (body unchanged).
    const msg = e instanceof Error ? e.message : String(e);
    const canRetrySeo =
      /rest_invalid|未知|invalid_param|performer|series|otonaselect_/i.test(msg) ||
      msg.includes("UPDATE_FAILED") ||
      msg.includes("CREATE_FAILED");
    if (canRetrySeo && publisher.update && updatingExistingDraft && sameVersion?.publishedExternalId) {
      try {
        const fallbackPrepared = await publisher.prepare({
          contentVersionId: version.id,
          title: built.title,
          body: sanitized.body,
          targetFormat: "article",
          destinationRef: deps.config.wordpressBaseUrl ?? null,
          metadata: {
            mode,
            excerpt: seoAttach.excerpt || built.excerpt,
            summary: seoAttach.excerpt || built.excerpt,
            canonicalId,
            productCanonicalId: productCanonicalId ?? undefined,
            route: input.route ?? "WORDPRESS_PATH",
            idempotencyKey: `${idempotencyKey}:seo-fallback`,
            publicBodySanitized: sanitized.removed,
            wpTagIds: seoTermIds.tagIds,
            wpCategoryIds: seoTermIds.categoryIds,
            wpDate: postDates.date,
            wpDateGmt: postDates.date_gmt,
            seoAttachNotes: [...seoAttach.notes, `seo_meta_fallback:${msg.slice(0, 160)}`],
          },
        });
        published = await publisher.update({
          externalId: sameVersion.publishedExternalId,
          prepared: fallbackPrepared,
        });
        published = {
          ...published,
          externalId: sameVersion.publishedExternalId,
          status: "DRAFT",
          url: published.url ?? sameVersion.publishedUrl ?? "",
        };
      } catch (e2) {
        return {
          ok: false,
          published: false,
          skipped: false,
          reason: "PUBLISH_FAILED",
          contentVersionId: version.id,
          error: e2 instanceof Error ? e2.message.slice(0, 400) : String(e2),
        };
      }
    } else {
      return {
        ok: false,
        published: false,
        skipped: false,
        reason: "PUBLISH_FAILED",
        contentVersionId: version.id,
        error: msg.slice(0, 400),
      };
    }
  }

  const now = new Date();
  const targetStatus =
    effectiveMode === "future"
      ? "SCHEDULED"
      : published.status === "DRAFT" || effectiveMode === "draft"
        ? "DRAFT"
        : "PUBLISHED";
  const platformMetadata = {
    canonicalId,
    productCanonicalId: productCanonicalId ?? undefined,
    route: input.route ?? "WORDPRESS_PATH",
    idempotencyKey,
    ctaUrl: ctaCheck.url ?? productUrl,
    hasAffiliateIdHint: ctaCheck.hasAffiliateIdHint,
    offerKind: offer.kind,
    monetizationStatus: offer.monetizationStatus,
    affiliateLinkReady: offer.affiliateLinkReady,
    wordpressMode: deps.config.wordpressMode,
    imageEvalNotes: [...imageEval.notes, ...(imageRefreshMeta.notes ?? [])],
    imageExcludedCount: imageEval.excluded.length,
    imageRefresh: imageRefreshMeta,
    draftOnly: effectiveMode === "draft",
    scheduledAt: scheduleInstant?.toISOString() ?? null,
    wpDate: postDates.date,
    wpDateGmt: postDates.date_gmt,
    protectedWpPosts: [43, 46],
    ...(input.platformMetadata ?? {}),
  };

  if (updatingExistingDraft && sameVersion) {
    if (typeof deps.lifecycle.updatePublicationTarget === "function") {
      await deps.lifecycle.updatePublicationTarget(sameVersion.id, {
        platformMetadata: {
          ...((sameVersion.platformMetadata as Record<string, unknown> | null) ?? {}),
          ...platformMetadata,
          updatedVia: "updateExistingDraft",
          updatedAt: now.toISOString(),
        },
        publishedUrl: published.url || sameVersion.publishedUrl,
        publishedAt: now,
      });
    }
    const record: PublicationRecord = await deps.lifecycle.createPublicationRecord({
      publicationTargetId: sameVersion.id,
      platform: "WORDPRESS",
      status: "DRAFT",
      externalId: sameVersion.publishedExternalId!,
      url: published.url || sameVersion.publishedUrl,
      responseSummary: {
        ...((published.responseSummary as Record<string, unknown>) ?? {}),
        action: "updateExistingDraft",
        imageEvalNotes: platformMetadata.imageEvalNotes,
      },
    });
    return {
      ok: true,
      published: true,
      skipped: false,
      contentVersionId: version.id,
      contentId: version.contentId,
      canonicalId,
      publicationTargetId: sameVersion.id,
      publicationRecordId: record.id,
      externalId: sameVersion.publishedExternalId!,
      url: published.url || sameVersion.publishedUrl || "",
      status: "DRAFT",
      publishedAt: now.toISOString(),
      duplicate: false,
      dryRun: false,
    };
  }

  const target = await deps.lifecycle.createPublicationTarget({
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
    platformMetadata,
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

function buildSeoAttachFromStructured(input: {
  structured: Record<string, unknown>;
  title: string;
  excerptFallback: string;
  productCanonicalId: string | null;
  siteOrigin: string;
  evidenceLabels?: EvidenceTaxonomyLabel[];
}): WordPressSeoAttach {
  const article =
    input.structured.article && typeof input.structured.article === "object"
      ? (input.structured.article as Record<string, unknown>)
      : {};
  const seoBlock =
    input.structured.seo && typeof input.structured.seo === "object"
      ? (input.structured.seo as Record<string, unknown>)
      : {};

  const performers: Array<{ name: string; ascii?: string | null }> = [];
  const pushPerformer = (name: string, ascii?: string | null) => {
    const n = name.trim();
    if (!n) return;
    if (performers.some((p) => p.name.replace(/\s+/g, "") === n.replace(/\s+/g, ""))) return;
    performers.push({ name: n, ascii: ascii ?? null });
  };

  for (const raw of [
    ...(Array.isArray(input.structured.performers) ? input.structured.performers : []),
    ...(Array.isArray(seoBlock.performers) ? seoBlock.performers : []),
    ...(Array.isArray(article.performers) ? article.performers : []),
  ]) {
    if (typeof raw === "string") pushPerformer(raw);
    else if (raw && typeof raw === "object" && typeof (raw as { name?: unknown }).name === "string") {
      const row = raw as { name: string; ascii?: string };
      pushPerformer(row.name, row.ascii);
    }
  }

  const seriesNameFromStructured =
    (typeof input.structured.seriesName === "string" && input.structured.seriesName.trim()) ||
    (typeof seoBlock.seriesName === "string" && seoBlock.seriesName.trim()) ||
    (typeof article.seriesName === "string" && article.seriesName.trim()) ||
    null;

  const structuredCategories = [
    ...(Array.isArray(seoBlock.categories) ? seoBlock.categories : []),
    ...(Array.isArray(article.categories) ? article.categories : []),
  ]
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim());

  const structuredTags = [
    ...(Array.isArray(seoBlock.tags) ? seoBlock.tags : []),
    ...(Array.isArray(article.tags) ? article.tags : []),
  ]
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());

  const derived = deriveWordPressTaxonomyFromEvidence({
    labels: input.evidenceLabels ?? [],
    title: input.title,
    extraPerformers: performers.map((p) => p.name),
    extraSeriesName: seriesNameFromStructured,
    allowCategoryFallback: true,
  });

  // Merge structured categories/tags (only when already present — never invent).
  const categories = [...new Set([...derived.categories, ...structuredCategories])];
  const tags = [...new Set([...derived.tags, ...structuredTags])];

  const attach = buildWordPressSeoAttach({
    title: input.title,
    seoTitle:
      (typeof seoBlock.title === "string" && seoBlock.title) ||
      (typeof article.seoTitle === "string" && article.seoTitle) ||
      input.title,
    metaDescription:
      (typeof seoBlock.metaDescription === "string" && seoBlock.metaDescription) ||
      (typeof article.metaDescription === "string" && article.metaDescription) ||
      input.excerptFallback,
    summary: input.excerptFallback,
    performers: derived.performers.map((name) => {
      const hit = performers.find((p) => p.name.replace(/\s+/g, "") === name.replace(/\s+/g, ""));
      return { name, ascii: hit?.ascii ?? null };
    }),
    seriesNames: derived.seriesNames,
    seriesName: derived.seriesName,
    categories,
    tags,
    productCanonicalId: input.productCanonicalId,
    safeOgImageUrl: null,
    siteOrigin: input.siteOrigin,
  });
  return {
    ...attach,
    notes: [...attach.notes, ...derived.notes],
  };
}

async function loadEvidenceLabelsForProduct(
  prisma: WordPressPublishPathDeps["prisma"],
  productCanonicalId: string | null,
): Promise<EvidenceTaxonomyLabel[]> {
  if (!productCanonicalId?.trim()) return [];
  const cid = productCanonicalId.trim().toLowerCase();
  const researchItem = (
    prisma as {
      researchItem?: {
        findFirst: (args: Record<string, unknown>) => Promise<{
          tags?: Array<{ researchTag: { type: string; name: string } }>;
        } | null>;
      };
    }
  ).researchItem;
  if (!researchItem?.findFirst) return [];
  try {
    const item = await researchItem.findFirst({
      where: {
        OR: [
          { externalId: { equals: cid, mode: "insensitive" } },
          { externalId: { startsWith: cid, mode: "insensitive" } },
        ],
      },
      orderBy: { collectedAt: "desc" },
      include: {
        tags: { include: { researchTag: true } },
      },
    });
    if (!item?.tags?.length) return [];
    return item.tags.map((t) => ({
      type: t.researchTag.type,
      name: t.researchTag.name,
    }));
  } catch {
    return [];
  }
}

async function resolveSeoTermIds(
  publisher: PublisherAdapter,
  attach: WordPressSeoAttach,
): Promise<{
  tagIds: number[];
  categoryIds: number[];
  performerIds: number[];
  seriesIds: number[];
}> {
  const ensure =
    typeof (publisher as WordPressApiPublisher).ensureTerm === "function"
      ? (publisher as WordPressApiPublisher).ensureTerm.bind(publisher)
      : null;
  if (!ensure) {
    return { tagIds: [], categoryIds: [], performerIds: [], seriesIds: [] };
  }

  const tagIds: number[] = [];
  for (const name of attach.tags) {
    try {
      const id = await ensure({ taxonomyRestBase: "tags", name });
      if (id) tagIds.push(id);
    } catch {
      /* ignore */
    }
  }
  const categoryIds: number[] = [];
  for (const name of attach.categories) {
    try {
      const id = await ensure({ taxonomyRestBase: "categories", name });
      if (id) categoryIds.push(id);
    } catch {
      /* ignore */
    }
  }
  // When meaningful categories resolved, WordPress replaces Uncategorized via categories[].
  // If empty, do not invent — leave WP default (caller notes via seoAttach).
  const performerIds: number[] = [];
  for (const p of attach.performers) {
    try {
      const id = await ensure({
        taxonomyRestBase: "performer",
        name: p.name,
        slug: p.stableSlug,
      });
      if (id) performerIds.push(id);
    } catch {
      /* taxonomy may not exist until theme v1.5 is active */
    }
  }
  const seriesIds: number[] = [];
  for (const s of attach.seriesList.length > 0 ? attach.seriesList : attach.series ? [attach.series] : []) {
    try {
      const id = await ensure({
        taxonomyRestBase: "series",
        name: s.name,
        slug: s.stableSlug,
      });
      if (id) seriesIds.push(id);
    } catch {
      /* taxonomy may not exist until theme v1.5 is active */
    }
  }
  return { tagIds, categoryIds, performerIds, seriesIds };
}
