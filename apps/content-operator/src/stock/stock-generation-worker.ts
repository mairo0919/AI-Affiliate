/**
 * Stock generation worker: Analysis → Selection → Generate → Review → APPROVED stock.
 * Does NOT publish to WordPress. Batch-limited. Provider-agnostic candidate pool.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { AnalysisRepository, P6Repository, ResearchRepository } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { AnalysisEngine } from "../analysis/analysis-engine.js";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { ContentReviewService } from "../admin/content-review-service.js";
import { loadDailyCandidatePool } from "../daily-ops/candidate-pool.js";
import { loadDailyMultiChannelConfig } from "../daily-ops/config.js";
import { planDailyChannels } from "../daily-ops/channel-selection.js";
import {
  loadChannelPublicationHistory,
  loadRecentMixHistory,
  loadRecentBlogActressKeys,
} from "../daily-ops/publication-history.js";
import { tokyoDateString } from "../daily-blog/idempotency.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import { normalizeProductKey } from "../daily-ops/blog-product-exclusion.js";
import { claimStatementsFromPageEvidence } from "../article-pattern/evidence-pack.js";
import type { PageEvidenceMetaShape } from "../article-pattern/official-page-evidence-atoms.js";
import {
  countUnusedApprovedStock,
  loadArticledProductKeys,
} from "./approved-stock.js";
import { loadStockRuntimeConfig } from "./stock-config.js";

/** Count ContentVersions stamped with stockRoute on a Tokyo calendar day. */
async function countStockGenerationsOnTokyoDay(
  prisma: DatabaseClient["prisma"],
  dayKey: string,
): Promise<number> {
  const start = new Date(`${dayKey}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return prisma.contentVersion.count({
    where: {
      createdAt: { gte: start, lt: end },
      structuredContent: {
        path: ["stockRoute"],
        equals: "STOCK_GENERATION",
      },
    },
  });
}

export type StockGenerationResult = {
  skipped: boolean;
  skipReason: string | null;
  unusedApprovedBefore: number;
  unusedApprovedAfter: number;
  minStock: number;
  batchLimit: number;
  analysisOk: boolean;
  analysisCandidates: number;
  generated: number;
  reviewPassed: number;
  excludedAsDuplicate: number;
  held: Array<{ canonicalId: string; reason: string }>;
  approvedVersionIds: string[];
};

async function bootstrapLifecycleForResearchItem(input: {
  lifecycle: LifecycleRepository;
  researchItemId: string;
  title: string;
  canonicalId: string;
}): Promise<{ topicId: string; strategyId: string; claimIds: string[] }> {
  const topic = await input.lifecycle.createTopicCandidate({
    title: input.title,
    status: "READY",
    metadata: {
      source: "stock-generation",
      researchItemId: input.researchItemId,
      canonicalId: input.canonicalId,
    },
  });
  const strategy = await input.lifecycle.createStrategy({
    topicCandidateId: topic.id,
    objective: "stock_blog_option_b",
    targetAudience: "readers",
    userIntent: "product_intro",
    formatCategory: "ARTICLE",
    formatKey: "NEW_RELEASE_SINGLE",
    angle: "single_product",
    primaryChannel: "WORDPRESS",
    candidateChannels: ["WORDPRESS"],
    status: "READY",
  });

  const doc = await input.lifecycle.findLatestSourceDocumentByUrlContains(input.canonicalId);
  const pageEvidenceMeta =
    doc?.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
      ? ((doc.metadata as Record<string, unknown>).pageEvidence as PageEvidenceMetaShape | undefined)
      : undefined;

  const statements =
    pageEvidenceMeta?.description?.text
      ? claimStatementsFromPageEvidence({
          pageEvidenceMeta,
          productTitle: input.title,
          actors: pageEvidenceMeta.actors,
        })
      : input.title.trim()
        ? [`${input.title.trim()} は公開カタログ上で確認できる。`]
        : [`${input.canonicalId} の公開ページが存在する。`];

  const claimIds: string[] = [];
  for (const statement of statements.slice(0, 4)) {
    const claim = await input.lifecycle.createClaim({
      statement,
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.8,
      strategyId: strategy.id,
      metadata: { researchItemId: input.researchItemId, source: "stock-generation" },
    });
    claimIds.push(claim.id);
  }

  return { topicId: topic.id, strategyId: strategy.id, claimIds };
}

export async function runStockGenerationBatch(deps: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  now?: Date;
  forceBatch?: number;
}): Promise<StockGenerationResult> {
  const runtime = loadStockRuntimeConfig();
  const now = deps.now ?? new Date();
  const daily = loadDailyMultiChannelConfig();
  const unusedBefore = await countUnusedApprovedStock(deps.database.prisma);

  if (!runtime.stockGenerationEnabled) {
    return {
      skipped: true,
      skipReason: "STOCK_GENERATION_ENABLED_FALSE",
      unusedApprovedBefore: unusedBefore,
      unusedApprovedAfter: unusedBefore,
      minStock: runtime.minApprovedStock,
      batchLimit: runtime.generationBatch,
      analysisOk: false,
      analysisCandidates: 0,
      generated: 0,
      reviewPassed: 0,
      excludedAsDuplicate: 0,
      held: [],
      approvedVersionIds: [],
    };
  }

  // Continuous generation: never stop solely because APPROVED >= 9.
  // Cap per tick = generationBatch; optional soft daily cap for LLM cost.
  const generatedToday = await countStockGenerationsOnTokyoDay(
    deps.database.prisma,
    tokyoDateString(now, daily.timezone),
  );
  if (generatedToday >= runtime.maxGenerationsPerDay) {
    return {
      skipped: true,
      skipReason: "STOCK_MAX_GENERATIONS_PER_DAY",
      unusedApprovedBefore: unusedBefore,
      unusedApprovedAfter: unusedBefore,
      minStock: runtime.minApprovedStock,
      batchLimit: runtime.generationBatch,
      analysisOk: false,
      analysisCandidates: 0,
      generated: 0,
      reviewPassed: 0,
      excludedAsDuplicate: 0,
      held: [],
      approvedVersionIds: [],
    };
  }

  const remainingDaily = Math.max(0, runtime.maxGenerationsPerDay - generatedToday);
  // --batch / forceBatch overrides the default tick size (still capped by daily soft budget).
  const requested =
    deps.forceBatch != null && Number.isFinite(deps.forceBatch)
      ? Math.max(0, Math.floor(deps.forceBatch))
      : runtime.generationBatch;
  const toGenerate = Math.min(requested, remainingDaily);

  if (toGenerate <= 0) {
    return {
      skipped: true,
      skipReason: "EMPTY_GENERATION_BUDGET",
      unusedApprovedBefore: unusedBefore,
      unusedApprovedAfter: unusedBefore,
      minStock: runtime.minApprovedStock,
      batchLimit: runtime.generationBatch,
      analysisOk: false,
      analysisCandidates: 0,
      generated: 0,
      reviewPassed: 0,
      excludedAsDuplicate: 0,
      held: [],
      approvedVersionIds: [],
    };
  }

  const analysisRepo = new AnalysisRepository(deps.database.prisma);
  const researchRepo = new ResearchRepository(deps.database.prisma);
  const analysis = new AnalysisEngine({
    logger: createLogger("info"),
    research: researchRepo,
    analysis: analysisRepo,
    config: deps.config,
  });
  let analysisOk = false;
  let analysisCandidates = 0;
  try {
    const ar = await analysis.run({ limit: 80, source: "all" });
    analysisOk = true;
    analysisCandidates = ar.selectedItemCount ?? 0;
  } catch {
    analysisOk = false;
  }

  const { pool, analysisRunId } = await loadDailyCandidatePool(deps.database.prisma, {
    releaseAge: daily.releaseAge,
    now,
  });
  const articled = await loadArticledProductKeys(deps.database.prisma);
  let excludedAsDuplicate = 0;
  const filteredPool = pool.filter((c) => {
    const key = normalizeProductKey(c.canonicalId);
    if (key && articled.has(key)) {
      excludedAsDuplicate += 1;
      return false;
    }
    return true;
  });

  const channelHistory = await loadChannelPublicationHistory(deps.database.prisma);
  const recentMix = await loadRecentMixHistory(deps.database.prisma);
  const blogRecentActressKeys = await loadRecentBlogActressKeys(deps.database.prisma);
  const dayKey = tokyoDateString(now, daily.timezone);

  const held: Array<{ canonicalId: string; reason: string }> = [];
  const approvedVersionIds: string[] = [];
  let generated = 0;
  let reviewPassed = 0;
  const usedThisBatch = new Set<string>();

  await seedP45Prompts(deps.lifecycle);
  const llm = requireApiLLMProvider(deps.config);
  const generation = new ContentGenerationService(deps.lifecycle, llm, {
    generation: deps.config.llmModelGeneration,
    review: deps.config.llmModelReview,
    revision: deps.config.llmModelRevision,
  });
  const contentReview = new ContentReviewService(
    deps.lifecycle,
    new P6Repository(deps.database.prisma),
  );

  for (let i = 0; i < toGenerate; i++) {
    let produced = false;
    // Try several candidates per batch slot so DEFER does not burn the whole batch.
    for (let attempt = 0; attempt < 8 && !produced; attempt++) {
    const remaining = filteredPool.filter((c) => {
      const key = normalizeProductKey(c.canonicalId);
      return !key || !usedThisBatch.has(key);
    });
    if (remaining.length === 0) {
      held.push({ canonicalId: "-", reason: "EMPTY_ELIGIBLE_POOL" });
      break;
    }

    const plan = planDailyChannels({
      pool: remaining,
      mixWeights: daily.mixWeights,
      releaseAge: daily.releaseAge,
      recentBlogMix: recentMix,
      channelHistory,
      channelDuplicate: daily.channelDuplicate,
      dayKey: `${dayKey}-stock-${i}-${attempt}`,
      blogRecentActressKeys,
      minTotalScore: 20,
      minSampleImages: 3,
      minEvidenceRichness: 0.25,
      now,
    });

    const selected = plan.blog.selection.selected;
    if (!selected || plan.blog.blocked) {
      held.push({
        canonicalId: selected?.canonicalId ?? "-",
        reason: plan.blog.blockReason ?? "BLOG_BLOCKED",
      });
      break;
    }

    const productKey = normalizeProductKey(selected.canonicalId) ?? selected.canonicalId;
    usedThisBatch.add(productKey);

    const ctaUrl =
      selected.affiliateUrl?.trim() ||
      buildFanzaCanonicalProductUrl(selected.canonicalId);
    const affiliateCheck = validateFanzaAffiliateUrl(ctaUrl);
    if (!affiliateCheck.ok) {
      held.push({ canonicalId: selected.canonicalId, reason: "AFFILIATE_URL_INVALID" });
      continue;
    }

    try {
      const item = await deps.database.prisma.researchItem.findUnique({
        where: { id: selected.researchItemId },
      });
      if (!item) {
        held.push({ canonicalId: selected.canonicalId, reason: "RESEARCH_ITEM_MISSING" });
        continue;
      }

      const boot = await bootstrapLifecycleForResearchItem({
        lifecycle: deps.lifecycle,
        researchItemId: item.id,
        title: item.title,
        canonicalId: selected.canonicalId,
      });

      const generatedArticle = await generation.generateBloggerArticle({
        topicId: boot.topicId,
        strategyId: boot.strategyId,
        productTitle: item.title,
        ctaUrl,
        claimIds: boot.claimIds,
      });
      generated += 1;
      articled.add(productKey);
      produced = true;

      // Persist product key on structuredContent for stock exclusion / PUBLIC eval.
      const sc = (generatedArticle.version.structuredContent ?? {}) as Record<string, unknown>;
      if (!sc.productCanonicalId && !sc.canonicalId) {
        await deps.lifecycle.updateContentVersionStructuredContent(generatedArticle.version.id, {
          ...sc,
          productCanonicalId: selected.canonicalId,
          canonicalId: selected.canonicalId,
          sourceProvider: "research",
          analysisRunId,
          stockRoute: "STOCK_GENERATION",
        });
      }

      try {
        await contentReview.decide({
          contentVersionId: generatedArticle.version.id,
          decision: "approve",
          actor: "stock-auto-review",
          reason: "Stock pipeline auto review after generation gates",
          approvalPolicy: "auto",
        });
        reviewPassed += 1;
        approvedVersionIds.push(generatedArticle.version.id);
      } catch (reviewErr) {
        held.push({
          canonicalId: selected.canonicalId,
          reason:
            reviewErr instanceof Error
              ? `AUTO_REVIEW_FAILED:${reviewErr.message.slice(0, 120)}`
              : "AUTO_REVIEW_FAILED",
        });
      }
    } catch (e) {
      held.push({
        canonicalId: selected.canonicalId,
        reason: e instanceof Error ? e.message.slice(0, 160) : String(e),
      });
    }
    }
  }

  const unusedAfter = await countUnusedApprovedStock(deps.database.prisma);
  return {
    skipped: false,
    skipReason: null,
    unusedApprovedBefore: unusedBefore,
    unusedApprovedAfter: unusedAfter,
    minStock: runtime.minApprovedStock,
    batchLimit: runtime.generationBatch,
    analysisOk,
    analysisCandidates,
    generated,
    reviewPassed,
    excludedAsDuplicate,
    held,
    approvedVersionIds,
  };
}
