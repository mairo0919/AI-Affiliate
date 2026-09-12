/**
 * Daily multi-channel LIVE orchestrator.
 * Blog publication path: OPTION B generate → APPROVED → WordPress (shared publish path).
 * X path unchanged. Ranking Writer remains deferred.
 */

import type { AppConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  P6Repository,
  ResearchRepository,
  type DatabaseClient,
  type LifecycleRepository,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import type { PublisherAdapter } from "../adapters/types.js";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import {
  wordpressCredentialsPresent,
} from "../adapters/publisher/wordpress-api-publisher.js";
import { ContentReviewService } from "../admin/content-review-service.js";
import { ContentEngine } from "../content/content-engine.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import {
  buildKnownPublication,
  checkDuplicatePublication,
  type KnownPublication,
} from "../daily-blog/duplicate-gate.js";
import { dailyRunIdempotencyKey, tokyoDateString } from "../daily-blog/idempotency.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { runCanonicalArticlePipeline } from "../generation/canonical-article-pipeline.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import {
  assertPublicBodyClean,
  sanitizePublicBody,
} from "../publication/public-body-sanitizer.js";
import { evaluateStructuredContentImagesForWordPress } from "../publication/image-publication-eligibility.js";
import {
  createDefaultWordPressPublisher,
  publishContentVersionToWordPress,
} from "../wordpress/wordpress-publish-path.js";
import { XPublicationService } from "../x/publication-service.js";
import { loadDailyCandidatePool } from "./candidate-pool.js";
import { planDailyChannels } from "./channel-selection.js";
import {
  loadDailyMultiChannelConfig,
  type DailyMultiChannelConfig,
} from "./config.js";
import {
  BLOG_PUBLICATION_PLATFORMS,
  countBlogPublishedOnTokyoDay,
  countXPublishedOnTokyoDay,
  loadChannelPublicationHistory,
  loadRecentBlogActressKeys,
  loadRecentMixHistory,
  loadRecentXMixHistory,
  loadRecentXRoutes,
} from "./publication-history.js";

export interface DailyLiveResult {
  dayKey: string;
  skipped: boolean;
  skipReason: string | null;
  dryRun: boolean;
  blog: {
    attempted: boolean;
    published: boolean;
    held: boolean;
    canonicalId: string | null;
    contentVersionId: string | null;
    externalId: string | null;
    url: string | null;
    failureCodes: string[];
    note: string | null;
  };
  x: {
    attempted: boolean;
    published: boolean;
    held: boolean;
    canonicalId: string | null;
    route: string | null;
    publicationId: string | null;
    externalId: string | null;
    url: string | null;
    note: string | null;
  };
  ranking: { productionReady: false; deferred: true };
  llmCalls: number;
  /** WordPress createDraft/publish attempts that reached the adapter. */
  wordpressPublishCalls: number;
  /** @deprecated Always 0 — Blogger is no longer on the daily-ops live path. */
  bloggerPublishCalls: number;
  xPublishCalls: number;
}

export interface DailyLiveDeps {
  logger: Logger;
  database: DatabaseClient;
  config: AppConfig;
  lifecycle: LifecycleRepository;
  contentEngine: ContentEngine;
  xPublicationService: XPublicationService;
  dailyConfig?: DailyMultiChannelConfig;
  now?: () => Date;
  /** When true, force attempt even if day's quota already met (smoke). */
  forceSmoke?: boolean;
  /** Override candidate externalId for smoke (optional). */
  smokeCanonicalId?: string;
  /** Inject WordPress publisher (tests / mock). */
  wordpressPublisher?: PublisherAdapter;
  /** Inject review authority (tests). Default: ContentReviewService + P6Repository. */
  contentReview?: ContentReviewService;
}

export async function runDailyMultiChannelLive(deps: DailyLiveDeps): Promise<DailyLiveResult> {
  const daily = deps.dailyConfig ?? loadDailyMultiChannelConfig();
  const now = deps.now?.() ?? new Date();
  const dayKey = tokyoDateString(now, daily.timezone);
  const emptyBlog = {
    attempted: false,
    published: false,
    held: false,
    canonicalId: null as string | null,
    contentVersionId: null as string | null,
    externalId: null as string | null,
    url: null as string | null,
    failureCodes: [] as string[],
    note: null as string | null,
  };
  const emptyX = {
    attempted: false,
    published: false,
    held: false,
    canonicalId: null as string | null,
    route: null as string | null,
    publicationId: null as string | null,
    externalId: null as string | null,
    url: null as string | null,
    note: null as string | null,
  };

  if (!daily.enabled && !deps.forceSmoke) {
    return {
      dayKey,
      skipped: true,
      skipReason: "DAILY_OPS_ENABLED_FALSE",
      dryRun: daily.dryRun,
      blog: emptyBlog,
      x: emptyX,
      ranking: { productionReady: false, deferred: true },
      llmCalls: 0,
      wordpressPublishCalls: 0,
      bloggerPublishCalls: 0,
      xPublishCalls: 0,
    };
  }

  let llmCalls = 0;
  let wordpressPublishCalls = 0;
  let xPublishCalls = 0;

  const blogDone = await countBlogPublishedOnTokyoDay(
    deps.database.prisma,
    dayKey,
    daily.timezone,
  );
  const xDone = await countXPublishedOnTokyoDay(deps.database.prisma, dayKey, daily.timezone);
  const blogNeeded = Math.max(0, daily.blogArticlesPerDay - blogDone);
  const xNeeded = Math.max(0, daily.xPostsPerDay - xDone);

  if (!deps.forceSmoke && blogNeeded <= 0 && xNeeded <= 0) {
    return {
      dayKey,
      skipped: true,
      skipReason: "DAILY_TARGETS_ALREADY_MET",
      dryRun: daily.dryRun,
      blog: { ...emptyBlog, note: `blogDone=${blogDone}` },
      x: { ...emptyX, note: `xDone=${xDone}` },
      ranking: { productionReady: false, deferred: true },
      llmCalls: 0,
      wordpressPublishCalls: 0,
      bloggerPublishCalls: 0,
      xPublishCalls: 0,
    };
  }

  const { pool, analysisRunId } = await loadDailyCandidatePool(deps.database.prisma, {
    releaseAge: daily.releaseAge,
    now,
  });
  if (pool.length === 0) {
    return {
      dayKey,
      skipped: true,
      skipReason: "EMPTY_CANDIDATE_POOL",
      dryRun: daily.dryRun,
      blog: emptyBlog,
      x: emptyX,
      ranking: { productionReady: false, deferred: true },
      llmCalls: 0,
      wordpressPublishCalls: 0,
      bloggerPublishCalls: 0,
      xPublishCalls: 0,
    };
  }

  const channelHistory = await loadChannelPublicationHistory(deps.database.prisma);
  const recentMix = await loadRecentMixHistory(deps.database.prisma);
  const recentXMix = await loadRecentXMixHistory(deps.database.prisma);
  const xRecentRoutes = await loadRecentXRoutes(deps.database.prisma);
  const blogRecentActressKeys = await loadRecentBlogActressKeys(deps.database.prisma);

  const plan = planDailyChannels({
    pool: deps.smokeCanonicalId
      ? pool.filter((c) => c.canonicalId.toLowerCase() === deps.smokeCanonicalId!.toLowerCase())
      : pool,
    mixWeights: daily.mixWeights,
    releaseAge: daily.releaseAge,
    recentBlogMix: recentMix,
    recentXMix,
    channelHistory,
    channelDuplicate: daily.channelDuplicate,
    dayKey,
    blogRecentActressKeys,
    xRecentActressKeys: blogRecentActressKeys,
    xRecentRoutes,
    minTotalScore: deps.forceSmoke ? 1 : 20,
    minSampleImages: deps.forceSmoke ? 0 : 3,
    minEvidenceRichness: deps.forceSmoke ? 0 : 0.25,
    now,
  });

  const blog = { ...emptyBlog };
  const x = { ...emptyX };

  // ——— BLOG (WordPress) ———
  if ((blogNeeded > 0 || deps.forceSmoke) && plan.blog.selection.selected && !plan.blog.blocked) {
    blog.attempted = true;
    const selected = plan.blog.selection.selected;
    blog.canonicalId = selected.canonicalId;
    // Prefer affiliate URL when present; otherwise official product URL (R61 interim CTA).
    const ctaUrl =
      selected.affiliateUrl?.trim() ||
      (selected.canonicalId
        ? `https://video.dmm.co.jp/av/content/?id=${selected.canonicalId}`
        : "");
    const affiliateCheck = validateFanzaAffiliateUrl(ctaUrl);

    const known: KnownPublication[] = channelHistory
      .filter((h) => h.channel === "BLOG")
      .map((h) =>
        buildKnownPublication({
          cid: h.canonicalId,
          status: "PUBLISHED",
          publishedAt: h.publishedAt,
        }),
      );
    const dup = checkDuplicatePublication(
      { cid: selected.canonicalId, affiliateUrl: ctaUrl },
      known,
    );

    const idempotencyKey = dailyRunIdempotencyKey({
      timezoneDate: dayKey,
      articleKind: "PRODUCT",
      canonicalId: selected.canonicalId,
    });

    // Intent lock — WORDPRESS primary; BLOGGER kept for mid-transition retries.
    const priorIntent = await deps.database.prisma.publicationTarget.findFirst({
      where: {
        platform: { in: [...BLOG_PUBLICATION_PLATFORMS] },
        platformMetadata: { path: ["dailyIdempotencyKey"], equals: idempotencyKey },
        status: { in: ["PUBLISHED", "DRAFT", "SCHEDULED", "AWAITING_APPROVAL"] },
      },
    });
    if (
      priorIntent?.status === "PUBLISHED" ||
      priorIntent?.status === "DRAFT" ||
      priorIntent?.status === "AWAITING_APPROVAL"
    ) {
      blog.held = true;
      blog.note =
        priorIntent.status === "AWAITING_APPROVAL"
          ? "idempotent_awaiting_review"
          : priorIntent.status === "DRAFT"
            ? "idempotent_already_drafted"
            : "idempotent_already_published";
      blog.externalId = priorIntent.publishedExternalId;
      blog.url = priorIntent.publishedUrl;
      blog.contentVersionId = priorIntent.contentVersionId;
    } else if (dup.duplicate) {
      blog.held = true;
      blog.failureCodes = ["DUPLICATE_PRODUCT"];
      blog.note = dup.reason;
    } else if (!affiliateCheck.ok) {
      blog.held = true;
      blog.failureCodes = ["AFFILIATE_URL_INVALID"];
      blog.note = affiliateCheck.failureCode;
    } else if (daily.dryRun && !deps.forceSmoke) {
      blog.held = true;
      blog.note = "DAILY_OPS_DRY_RUN";
    } else {
      try {
        const item = await deps.database.prisma.researchItem.findUnique({
          where: { id: selected.researchItemId },
        });
        if (!item) throw new Error(`researchItem missing: ${selected.researchItemId}`);

        await seedP45Prompts(deps.lifecycle);
        const llm = requireApiLLMProvider(deps.config);
        const generation = new ContentGenerationService(deps.lifecycle, llm, {
          generation: deps.config.llmModelGeneration,
          review: deps.config.llmModelReview,
          revision: deps.config.llmModelRevision,
        });
        const contentReview =
          deps.contentReview ??
          new ContentReviewService(
            deps.lifecycle,
            new P6Repository(deps.database.prisma),
          );
        const research = new ResearchRepository(deps.database.prisma);

        // Canonical: Evidence → Claims → Writer → runQualityReviews (approve deferred to readiness).
        const pipeline = await runCanonicalArticlePipeline({
          lifecycle: deps.lifecycle,
          research,
          generation,
          contentReview,
          config: deps.config,
          logger: deps.logger,
          researchItemId: item.id,
          productTitle: item.title,
          productCanonicalId: selected.canonicalId,
          productUrl: ctaUrl,
          rawData: item.rawData,
          ctaUrl,
          route: "DAILY_OPS",
          objective: "daily_blog_option_b",
          autoApprove: false,
          approveActor: "daily-ops-auto-review",
        });
        llmCalls += 1;

        if (!pipeline.ok) {
          blog.held = true;
          const reason = pipeline.reason;
          blog.failureCodes = reason.startsWith("NEEDS_ENRICHMENT")
            ? ["NEEDS_ENRICHMENT"]
            : reason.includes("REVIEW")
              ? ["CANONICAL_REVIEW_FAILED"]
              : ["GENERATION_ERROR"];
          blog.note = reason.slice(0, 240);
          blog.contentVersionId = pipeline.contentVersionId ?? null;
          throw Object.assign(new Error("BLOG_GEN_HELD"), { held: true });
        }

        blog.contentVersionId = pipeline.contentVersionId;
        const version = await deps.lifecycle.findContentVersion(pipeline.contentVersionId);
        if (!version) throw new Error(`contentVersion missing: ${pipeline.contentVersionId}`);
        const sc = (version.structuredContent ?? {}) as Record<string, unknown>;
        const article = sc.article as
          | {
              title: string;
              lead?: string;
              sections: Array<{ heading?: string | null; paragraphs: string[]; lists?: string[] }>;
              cta: { label: string; url?: string | null };
            }
          | undefined;

        // ——— Generation + canonical Review complete: ContentVersion remains REVIEWING ———
        let formatterPass = true;
        try {
          if (!article) throw new Error("missing article");
          const html = formatBloggerHtml({
            title: article.title,
            lead: article.lead,
            sections: article.sections,
            cta: {
              label: article.cta.label,
              url: article.cta.url ?? ctaUrl,
            },
          });
          sanitizePublicBody(html);
          assertPublicBodyClean(html);
        } catch {
          formatterPass = false;
        }

        const wpMode: "draft" | "publish" =
          deps.config.wordpressAllowDirectPublish &&
          deps.config.wordpressDefaultPublishMode === "publish"
            ? "publish"
            : "draft";
        const authPass =
          deps.config.wordpressMode === "mock" ||
          (wordpressCredentialsPresent(deps.config) &&
            deps.config.wordpressAllowExternalRequests);

        const reviewFailureCodes: string[] = [];
        if (!article) reviewFailureCodes.push("SCHEMA_FAIL");
        if (!formatterPass) reviewFailureCodes.push("FORMATTER_FAIL");
        if (!affiliateCheck.ok) reviewFailureCodes.push("AFFILIATE_URL_INVALID");
        if (!authPass) reviewFailureCodes.push("CHANNEL_AUTH_FAIL");
        if (pipeline.reviewOverall === "failed") {
          reviewFailureCodes.push("CANONICAL_REVIEW_FAILED");
        }

        const imageEval = evaluateStructuredContentImagesForWordPress({
          structuredContent: version.structuredContent,
          mode: wpMode,
        });
        if (!imageEval.imagePipelinePass) {
          reviewFailureCodes.push(...imageEval.failureCodes);
        }

        if (reviewFailureCodes.length > 0) {
          blog.held = true;
          blog.failureCodes = reviewFailureCodes;
          blog.note = "review_readiness_hold";
        } else if (daily.reviewPolicy === "manual") {
          await deps.lifecycle.createPublicationTarget({
            contentId: pipeline.contentId,
            contentVersionId: pipeline.contentVersionId,
            platform: "WORDPRESS",
            destinationRef: deps.config.wordpressBaseUrl ?? null,
            targetFormat: "article",
            approvalMode: "MANUAL",
            status: "AWAITING_APPROVAL",
            publishedAt: now,
            platformMetadata: {
              dailyIdempotencyKey: idempotencyKey,
              canonicalId: selected.canonicalId,
              mixSlot: plan.blogMixSlot,
              blogMixSlot: plan.blogMixSlot,
              actressKey: selected.actressKey,
              analysisRunId,
              route: "DAILY_OPS_LIVE",
              reviewPolicy: "manual",
              awaitingContentReview: true,
              pipelineRoute: "CANONICAL",
            },
          });
          blog.held = true;
          blog.failureCodes = ["REVIEW_POLICY_MANUAL"];
          blog.note = "AWAITING_MANUAL_REVIEW";
        } else {
          // Auto approve only after canonical Review PASS + publication readiness.
          try {
            await contentReview.decide({
              contentVersionId: pipeline.contentVersionId,
              decision: "approve",
              actor: "daily-ops-auto-review",
              reason: `Canonical Review ${pipeline.reviewOverall} + publication readiness`,
              correlationId: idempotencyKey,
              approvalPolicy: "auto",
            });
          } catch (reviewErr) {
            blog.held = true;
            blog.failureCodes = ["AUTO_REVIEW_FAILED"];
            blog.note =
              reviewErr instanceof Error
                ? reviewErr.message.slice(0, 240)
                : String(reviewErr);
            throw Object.assign(new Error("BLOG_REVIEW_HELD"), { held: true });
          }

          if (
            wpMode === "publish" &&
            !deps.config.wordpressAllowDirectPublish
          ) {
            blog.held = true;
            blog.failureCodes = ["DIRECT_PUBLISH_DISABLED"];
            blog.note = "approved_but_direct_publish_disabled";
          } else {
            const publisher =
              deps.wordpressPublisher ?? createDefaultWordPressPublisher(deps.config);
            const wpResult = await publishContentVersionToWordPress(
              {
                config: deps.config,
                lifecycle: deps.lifecycle,
                prisma: deps.database.prisma,
                publisher,
              },
              {
                contentVersionId: pipeline.contentVersionId,
                canonicalId: selected.canonicalId,
                ctaUrl,
                mode: wpMode,
                route: "DAILY_OPS_LIVE",
                idempotencyKey: `wordpress:${pipeline.contentVersionId}:${wpMode}`,
                platformMetadata: {
                  dailyIdempotencyKey: idempotencyKey,
                  canonicalId: selected.canonicalId,
                  mixSlot: plan.blogMixSlot,
                  blogMixSlot: plan.blogMixSlot,
                  actressKey: selected.actressKey,
                  analysisRunId,
                  route: "DAILY_OPS_LIVE",
                  reviewPolicy: "auto",
                  pipelineRoute: "CANONICAL",
                },
              },
            );
            wordpressPublishCalls += 1;

            if (wpResult.ok && wpResult.published) {
              blog.published = true;
              blog.externalId = wpResult.externalId;
              blog.url = wpResult.url;
              blog.note =
                wpResult.status === "DRAFT"
                  ? "live_wordpress_draft"
                  : "live_wordpress_published";
            } else if (wpResult.ok && wpResult.skipped) {
              blog.held = true;
              blog.failureCodes = wpResult.gateFailures ?? [wpResult.reason];
              blog.note = `wordpress_skipped_${wpResult.reason}`;
              blog.externalId = wpResult.priorExternalId ?? null;
            } else {
              blog.held = true;
              blog.failureCodes = [wpResult.reason];
              blog.note = (
                "error" in wpResult && wpResult.error
                  ? wpResult.error
                  : wpResult.reason
              ).slice(0, 240);
            }
          }
        }
      } catch (error) {
        if ((error as { held?: boolean })?.held) {
          // already recorded on blog
        } else {
          blog.held = true;
          blog.note = error instanceof Error ? error.message.slice(0, 240) : String(error);
          blog.failureCodes = ["BLOG_PIPELINE_ERROR"];
          deps.logger.warn(`daily blog phase error: ${blog.note}`);
        }
      }
    }
  } else if (blogNeeded > 0) {
    blog.note = plan.blog.blocked
      ? plan.blog.blockReason
      : plan.blog.selection.reason || "no_blog_selection";
  }

  // ——— X ———
  if ((xNeeded > 0 || deps.forceSmoke) && plan.x.selection.selected && !plan.x.blocked) {
    x.attempted = true;
    const selected = plan.x.selection.selected;
    x.canonicalId = selected.canonicalId;
    x.route = plan.x.route?.route ?? null;
    const destinationUrl = plan.x.route?.destinationUrl ?? selected.affiliateUrl ?? "";

    if (daily.dryRun && !deps.forceSmoke) {
      x.held = true;
      x.note = "DAILY_OPS_DRY_RUN";
    } else if (!deps.config.xApiEnabled && deps.config.xApiProvider !== "mock") {
      x.held = true;
      x.note = "X_API_DISABLED";
    } else if (
      deps.config.xReleaseMode !== "LIMITED" &&
      deps.config.xReleaseMode !== "FULL" &&
      deps.config.xApiProvider !== "mock"
    ) {
      x.held = true;
      x.note = `X_RELEASE_MODE_${deps.config.xReleaseMode}`;
    } else {
      try {
        // Prefer ContentCandidate for selected research item in latest analysis
        let candidateId: string | null = null;
        if (analysisRunId) {
          const cand = await deps.database.prisma.contentCandidate.findFirst({
            where: {
              analysisRunId,
              researchItemId: selected.researchItemId,
            },
            orderBy: { rank: "asc" },
          });
          candidateId = cand?.id ?? null;
        }
        if (!candidateId) {
          x.held = true;
          x.note = "NO_CONTENT_CANDIDATE_FOR_RESEARCH_ITEM";
        } else {
          const gen = await deps.contentEngine.generate({
            contentType: "X_POST",
            candidateId,
            limit: 1,
            force: true,
            skipExistingSameType: false,
            minScore: 0,
            includeRequiresConfirmation: true,
          });
          llmCalls += gen.generatedCount > 0 ? 1 : 0;
          const created = gen.items.find((i) => i.contentId && !i.skipped);
          if (!created?.contentId) {
            x.held = true;
            x.note = `x_generate_${gen.items[0]?.skipReason ?? "failed"}`;
          } else {
            const contents = new ContentRepository(deps.database.prisma);
            const contentId = created.contentId;
            const row = await contents.findGeneratedContentById(contentId);
            if (!row) throw new Error("generated content missing");

            // Ensure destination matches route (DIRECT affiliate vs blog URL)
            if (destinationUrl && row.affiliateUrl !== destinationUrl) {
              await deps.database.prisma.generatedContent.update({
                where: { id: contentId },
                data: {
                  affiliateUrl: destinationUrl,
                  callToAction: destinationUrl,
                  inputSnapshot: {
                    ...((row.inputSnapshot as object) ?? {}),
                    dailyXRoute: x.route,
                    destinationUrl,
                  },
                },
              });
            }

            let status = row.status;
            if (status === "REVIEW_REQUIRED" || status === "DRAFT") {
              await contents.approveContent(contentId, "daily-ops");
              status = "APPROVED";
            }
            if (status === "APPROVED") {
              await contents.markReadyToPublish(contentId);
              status = "READY_TO_PUBLISH";
            }
            if (status !== "READY_TO_PUBLISH") {
              x.held = true;
              x.note = `content_not_ready:${status}`;
            } else {
              const idempotencyKey = `x-daily:${dayKey}:${selected.canonicalId}:${x.route ?? "DIRECT"}`;
              const existing = await deps.database.prisma.xPublication.findUnique({
                where: { idempotencyKey },
              });
              if (existing?.status === "PUBLISHED" || existing?.status === "PARTIALLY_PUBLISHED") {
                x.held = true;
                x.note = "idempotent_already_published";
                x.publicationId = existing.id;
                x.url = existing.rootPostUrl;
                x.externalId = existing.rootPostId;
              } else {
                const pub = await deps.xPublicationService.createFromContent({
                  contentId,
                  strategy: "AUTO",
                  publishNow: true,
                });
                x.publicationId = pub.id;
                await deps.database.prisma.xPublication.update({
                  where: { id: pub.id },
                  data: {
                    strategyVersion: `${plan.xMixSlot}|AUTO`,
                  },
                }).catch(() => undefined);
                const due = await deps.xPublicationService.runDue(5);
                xPublishCalls += due.filter(
                  (p) => p.status === "PUBLISHED" || p.status === "PARTIALLY_PUBLISHED",
                ).length;
                const refreshed = await deps.database.prisma.xPublication.findUnique({
                  where: { id: pub.id },
                });
                if (
                  refreshed?.status === "PUBLISHED" ||
                  refreshed?.status === "PARTIALLY_PUBLISHED"
                ) {
                  x.published = true;
                  x.url = refreshed.rootPostUrl;
                  x.externalId = refreshed.rootPostId;
                  x.note = "live_published";
                } else {
                  x.held = true;
                  x.note = `x_status_${refreshed?.status ?? "unknown"}`;
                }
              }
            }
          }
        }
      } catch (error) {
        x.held = true;
        x.note = error instanceof Error ? error.message.slice(0, 240) : String(error);
        deps.logger.warn(`daily x phase error: ${x.note}`);
      }
    }
  } else if (xNeeded > 0) {
    x.note = plan.x.blocked ? plan.x.blockReason : plan.x.selection.reason || "no_x_selection";
  }

  return {
    dayKey,
    skipped: false,
    skipReason: null,
    dryRun: daily.dryRun && !deps.forceSmoke,
    blog,
    x,
    ranking: { productionReady: false, deferred: true },
    llmCalls,
    wordpressPublishCalls,
    bloggerPublishCalls: 0,
    xPublishCalls,
  };
}
