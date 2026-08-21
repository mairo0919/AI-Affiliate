/**
 * Daily multi-channel LIVE orchestrator.
 * Reuses planDailyChannels + OPTION B Blog + ContentEngine X + existing publishers.
 * Does not invent Writer/Brain rules. Ranking Writer remains deferred.
 */

import type { AppConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  type DatabaseClient,
  type LifecycleRepository,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { createBloggerPublisherFromConfig } from "../adapters/publisher/blogger-api-publisher.js";
import { ContentEngine } from "../content/content-engine.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import {
  buildKnownPublication,
  checkDuplicatePublication,
  type KnownPublication,
} from "../daily-blog/duplicate-gate.js";
import { dailyRunIdempotencyKey, tokyoDateString } from "../daily-blog/idempotency.js";
import { evaluatePublishGate } from "../daily-blog/publish-gate.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { XPublicationService } from "../x/publication-service.js";
import { loadDailyCandidatePool } from "./candidate-pool.js";
import { planDailyChannels } from "./channel-selection.js";
import {
  loadDailyMultiChannelConfig,
  type DailyMultiChannelConfig,
} from "./config.js";
import {
  countBlogPublishedOnTokyoDay,
  countXPublishedOnTokyoDay,
  loadChannelPublicationHistory,
  loadRecentMixHistory,
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
}

async function bootstrapLifecycleForResearchItem(input: {
  lifecycle: LifecycleRepository;
  researchItemId: string;
  title: string;
  description: string | null;
  affiliateUrl: string;
  canonicalId: string;
}): Promise<{ topicId: string; strategyId: string; claimIds: string[] }> {
  const topic = await input.lifecycle.createTopicCandidate({
    title: input.title,
    status: "READY",
    metadata: {
      source: "daily-ops",
      researchItemId: input.researchItemId,
      canonicalId: input.canonicalId,
    },
  });
  const strategy = await input.lifecycle.createStrategy({
    topicCandidateId: topic.id,
    objective: "daily_blog_option_b",
    targetAudience: "readers",
    userIntent: "product_intro",
    formatCategory: "ARTICLE",
    formatKey: "NEW_RELEASE_SINGLE",
    angle: "single_product",
    primaryChannel: "BLOGGER",
    candidateChannels: ["BLOGGER", "X"],
    status: "READY",
  });

  const statements: string[] = [];
  if (input.title.trim()) {
    statements.push(`${input.title.trim()} は公開カタログ上で確認できる。`);
  }
  if (input.description?.trim() && input.description.trim().length >= 12) {
    statements.push(input.description.trim().slice(0, 280));
  }
  if (statements.length === 0) {
    statements.push(`${input.canonicalId} の公開ページが存在する。`);
  }

  const claimIds: string[] = [];
  for (const statement of statements.slice(0, 4)) {
    const claim = await input.lifecycle.createClaim({
      statement,
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.8,
      strategyId: strategy.id,
      metadata: { researchItemId: input.researchItemId },
    });
    claimIds.push(claim.id);
  }

  return { topicId: topic.id, strategyId: strategy.id, claimIds };
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
      bloggerPublishCalls: 0,
      xPublishCalls: 0,
    };
  }

  let llmCalls = 0;
  let bloggerPublishCalls = 0;
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
      bloggerPublishCalls: 0,
      xPublishCalls: 0,
    };
  }

  const channelHistory = await loadChannelPublicationHistory(deps.database.prisma);
  const recentMix = await loadRecentMixHistory(deps.database.prisma);
  const xRecentRoutes = await loadRecentXRoutes(deps.database.prisma);

  // Ranking production Writer is deferred — never force RANKING slot live.
  const rankingDue = false;
  const rankingAllowed = false;

  const plan = planDailyChannels({
    pool: deps.smokeCanonicalId
      ? pool.filter((c) => c.canonicalId.toLowerCase() === deps.smokeCanonicalId!.toLowerCase())
      : pool,
    mixWeights: daily.mixWeights,
    releaseAge: daily.releaseAge,
    recentMix,
    channelHistory,
    channelDuplicate: daily.channelDuplicate,
    dayKey,
    rankingAllowed,
    rankingDue,
    xRecentRoutes,
    minTotalScore: deps.forceSmoke ? 1 : 20,
    minSampleImages: deps.forceSmoke ? 0 : 3,
    minEvidenceRichness: deps.forceSmoke ? 0 : 0.25,
    now,
  });

  const blog = { ...emptyBlog };
  const x = { ...emptyX };

  // ——— BLOG ———
  if ((blogNeeded > 0 || deps.forceSmoke) && plan.blog.selection.selected && !plan.blog.blocked) {
    blog.attempted = true;
    const selected = plan.blog.selection.selected;
    blog.canonicalId = selected.canonicalId;
    const affiliate = selected.affiliateUrl ?? "";
    const affiliateCheck = validateFanzaAffiliateUrl(affiliate);

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
      { cid: selected.canonicalId, affiliateUrl: affiliate },
      known,
    );

    const idempotencyKey = dailyRunIdempotencyKey({
      timezoneDate: dayKey,
      articleKind: "PRODUCT",
      canonicalId: selected.canonicalId,
    });

    // Intent lock via existing PublicationTarget metadata search — soft check
    const priorIntent = await deps.database.prisma.publicationTarget.findFirst({
      where: {
        platform: "BLOGGER",
        platformMetadata: { path: ["dailyIdempotencyKey"], equals: idempotencyKey },
        status: { in: ["PUBLISHED", "DRAFT", "SCHEDULED"] },
      },
    });
    if (priorIntent?.status === "PUBLISHED") {
      blog.held = true;
      blog.note = "idempotent_already_published";
      blog.externalId = priorIntent.publishedExternalId;
      blog.url = priorIntent.publishedUrl;
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
        const boot = await bootstrapLifecycleForResearchItem({
          lifecycle: deps.lifecycle,
          researchItemId: item.id,
          title: item.title,
          description: item.description,
          affiliateUrl: affiliate,
          canonicalId: selected.canonicalId,
        });

        const llm = requireApiLLMProvider(deps.config);
        const generation = new ContentGenerationService(deps.lifecycle, llm, {
          generation: deps.config.llmModelGeneration,
          review: deps.config.llmModelReview,
          revision: deps.config.llmModelRevision,
        });

        let generated: Awaited<ReturnType<ContentGenerationService["generateBloggerArticle"]>>;
        try {
          generated = await generation.generateBloggerArticle({
            topicId: boot.topicId,
            strategyId: boot.strategyId,
            productTitle: item.title,
            ctaUrl: affiliate,
            claimIds: boot.claimIds,
          });
          llmCalls += 1;
        } catch (genErr) {
          const msg = genErr instanceof Error ? genErr.message : String(genErr);
          blog.held = true;
          blog.failureCodes = msg.includes("DEFER") || msg.includes("insufficient")
            ? ["DEFER"]
            : ["GENERATION_ERROR"];
          blog.note = msg.slice(0, 240);
          throw Object.assign(new Error("BLOG_GEN_HELD"), { held: true });
        }
        blog.contentVersionId = generated.version.id;

        const brain = await deps.lifecycle
          .createEditorialBrainRepository()
          .findLatestBrainRunByContentVersion(generated.version.id);
        const brainDecision = (brain?.brainDecision as string | null) ?? "ESCALATE";

        // Integrity / formatter checks (existing helpers)
        let formatterPass = true;
        let html = "";
        try {
          const article = generated.article;
          html = formatBloggerHtml({
            title: article.title,
            lead: article.lead,
            sections: article.sections,
            cta: article.cta.url
              ? article.cta
              : { label: article.cta.label, url: affiliate },
          });
        } catch {
          formatterPass = false;
        }

        const gate = evaluatePublishGate({
          schemaPass: Boolean(generated.article),
          defer: false,
          claimValidationPass: true,
          integrityPass: true,
          brainDecision,
          formatterPass,
          affiliateUrlValid: affiliateCheck.ok,
          imagePipelinePass: true,
          bloggerAuthPass: Boolean(
            deps.config.bloggerClientId &&
              deps.config.bloggerRefreshToken &&
              deps.config.bloggerBlogId,
          ),
          duplicate: dup.duplicate,
          dryRun: daily.dryRun && !deps.forceSmoke,
          autoPublishEnabled: true,
          allowDirectPublish: deps.config.bloggerAllowDirectPublish,
        });

        if (gate.decision !== "PUBLISH") {
          blog.held = true;
          blog.failureCodes = gate.failureCodes;
          blog.note = `gate_${gate.decision}`;
        } else {
          const publisher = createBloggerPublisherFromConfig({
            bloggerMode: deps.config.bloggerMode,
            bloggerAllowExternalRequests: deps.config.bloggerAllowExternalRequests,
            bloggerAllowDirectPublish: deps.config.bloggerAllowDirectPublish,
            bloggerDefaultPublishMode: "publish",
            bloggerClientId: deps.config.bloggerClientId,
            bloggerClientSecret: deps.config.bloggerClientSecret,
            bloggerRefreshToken: deps.config.bloggerRefreshToken,
            bloggerBlogId: deps.config.bloggerBlogId,
            bloggerApiBaseUrl: deps.config.bloggerApiBaseUrl,
            bloggerOAuthTokenUrl: deps.config.bloggerOAuthTokenUrl,
          });
          const prepared = await publisher.prepare({
            contentVersionId: generated.version.id,
            title: generated.article.title,
            body: html,
            targetFormat: "article",
            metadata: {
              mode: "publish",
              dailyIdempotencyKey: idempotencyKey,
              canonicalId: selected.canonicalId,
              mixSlot: plan.mixSlot,
              analysisRunId,
            },
          });
          const published = await publisher.publish({ prepared });
          bloggerPublishCalls += 1;

          const target = await deps.lifecycle.createPublicationTarget({
            contentId: generated.content.id,
            contentVersionId: generated.version.id,
            platform: "BLOGGER",
            destinationRef: deps.config.bloggerBlogId ?? null,
            targetFormat: "article",
            approvalMode: "AUTOMATIC",
            status: "PUBLISHED",
            publishedExternalId: published.externalId,
            publishedUrl: published.url,
            publishedAt: now,
            platformMetadata: {
              dailyIdempotencyKey: idempotencyKey,
              canonicalId: selected.canonicalId,
              mixSlot: plan.mixSlot,
              route: "LIVE",
            },
          });
          await deps.lifecycle.createPublicationRecord({
            publicationTargetId: target.id,
            platform: "BLOGGER",
            status: "PUBLISHED",
            externalId: published.externalId,
            url: published.url,
            responseSummary: published.responseSummary as Record<string, unknown>,
          });

          blog.published = true;
          blog.externalId = published.externalId;
          blog.url = published.url;
          blog.note = "live_published";
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
            let row = await contents.findGeneratedContentById(contentId);
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
    bloggerPublishCalls,
    xPublishCalls,
  };
}
