/**
 * Stock generation worker: Analysis → Selection → Canonical Pipeline → APPROVED stock.
 * Does NOT publish to WordPress. Batch-limited. Provider-agnostic candidate pool.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { AnalysisRepository, P6Repository, ResearchRepository } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { AnalysisEngine } from "../analysis/analysis-engine.js";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { runCanonicalArticlePipeline } from "../generation/canonical-article-pipeline.js";
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
import {
  countUnusedApprovedStock,
  loadArticledProductKeys,
} from "./approved-stock.js";
import { loadStockRuntimeConfig } from "./stock-config.js";
import {
  buildRawDataAfterStockFailure,
  buildRawDataAfterStockSuccess,
  isStockAttemptEligibleNow,
  readStockAttemptLedger,
} from "./stock-attempt-ledger.js";
import { confirmFanzaAffiliateImageTerms } from "./confirm-fanza-image-terms.js";
import { evaluateStockArticleQualityGate } from "./stock-quality-gate.js";

export { evaluateStockArticleQualityGate } from "./stock-quality-gate.js";

function fanzaImageTermsVerifiedFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return ["1", "true", "yes", "on"].includes(
    (env.FANZA_AFFILIATE_IMAGE_TERMS_VERIFIED ?? "").trim().toLowerCase(),
  );
}

function asStoredJson(value: Record<string, unknown>): object {
  return JSON.parse(JSON.stringify(value)) as object;
}

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
    const ar = await analysis.run({ limit: 80 });
    analysisOk = true;
    analysisCandidates = ar.selectedItemCount ?? 0;
  } catch {
    analysisOk = false;
  }

  const { pool, analysisRunId } = await loadDailyCandidatePool(deps.database.prisma, {
    releaseAge: daily.releaseAge,
    now,
  });
  const articled = await loadArticledProductKeys(deps.database.prisma, {
    config: deps.config,
  });
  let excludedAsDuplicate = 0;
  const filteredPool = pool.filter((c) => {
    const key = normalizeProductKey(c.canonicalId);
    if (key && articled.has(key)) {
      excludedAsDuplicate += 1;
      return false;
    }
    return true;
  });

  const researchIds = [...new Set(filteredPool.map((c) => c.researchItemId).filter(Boolean))];
  const researchRows =
    researchIds.length > 0
      ? await deps.database.prisma.researchItem.findMany({
          where: { id: { in: researchIds } },
          select: { id: true, rawData: true },
        })
      : [];
  const ledgerByResearchId = new Map(
    researchRows.map((r) => [r.id, readStockAttemptLedger(r.rawData)] as const),
  );
  const retryEligiblePool = filteredPool.filter((c) => {
    const ledger = ledgerByResearchId.get(c.researchItemId);
    if (!ledger) return true;
    return isStockAttemptEligibleNow(ledger, now);
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
  const logger = createLogger("info");

  for (let i = 0; i < toGenerate; i++) {
    let produced = false;
    for (let attempt = 0; attempt < 8 && !produced; attempt++) {
      const remaining = retryEligiblePool.filter((c) => {
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

        const result = await runCanonicalArticlePipeline({
          lifecycle: deps.lifecycle,
          research: researchRepo,
          generation,
          contentReview,
          config: deps.config,
          logger,
          researchItemId: item.id,
          productTitle: item.title,
          productCanonicalId: selected.canonicalId,
          productUrl: ctaUrl,
          rawData: item.rawData,
          ctaUrl,
          route: "STOCK_GENERATION",
          objective: "stock_blog_option_b",
          autoApprove: true,
          approveActor: "stock-auto-review",
          auxiliarySafetyOk: ({ title, structuredContent }) =>
            evaluateStockArticleQualityGate({
              productTitle: item.title,
              rawData: item.rawData,
              structuredContent: {
                ...structuredContent,
                title,
              },
              writerTitle: title,
            }),
        });

        if (!result.ok) {
          const reason = result.reason;
          held.push({ canonicalId: selected.canonicalId, reason });
          const failed = buildRawDataAfterStockFailure({
            rawData: item.rawData,
            reason,
            now,
            maxAttempts: runtime.stockMaxAttemptsBeforeDefer,
          });
          await deps.database.prisma.researchItem.update({
            where: { id: item.id },
            data: { rawData: asStoredJson(failed.rawData) },
          });
          ledgerByResearchId.set(item.id, failed.ledger);
          continue;
        }

        generated += 1;
        articled.add(productKey);
        produced = true;

        // Stamp analysis run id (canonical pipeline already set stockRoute / enrichment).
        if (result.contentVersionId && analysisRunId) {
          const cv = await deps.database.prisma.contentVersion.findUnique({
            where: { id: result.contentVersionId },
            select: { structuredContent: true },
          });
          const sc = (cv?.structuredContent ?? {}) as Record<string, unknown>;
          await deps.lifecycle.updateContentVersionStructuredContent(result.contentVersionId, {
            ...sc,
            sourceProvider: "research",
            analysisRunId,
          });
        }

        const success = buildRawDataAfterStockSuccess({ rawData: item.rawData, now });
        await deps.database.prisma.researchItem.update({
          where: { id: item.id },
          data: { rawData: asStoredJson(success.rawData) },
        });
        ledgerByResearchId.set(item.id, success.ledger);

        if (result.approved) {
          reviewPassed += 1;
          approvedVersionIds.push(result.contentVersionId);
        } else {
          held.push({
            canonicalId: selected.canonicalId,
            reason: "CANONICAL_GENERATED_NOT_APPROVED",
          });
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 160) : String(e);
        held.push({ canonicalId: selected.canonicalId, reason });
        try {
          const item = await deps.database.prisma.researchItem.findUnique({
            where: { id: selected.researchItemId },
            select: { id: true, rawData: true },
          });
          if (item) {
            const failed = buildRawDataAfterStockFailure({
              rawData: item.rawData,
              reason,
              now,
              maxAttempts: runtime.stockMaxAttemptsBeforeDefer,
            });
            await deps.database.prisma.researchItem.update({
              where: { id: item.id },
              data: { rawData: asStoredJson(failed.rawData) },
            });
            ledgerByResearchId.set(item.id, failed.ledger);
          }
        } catch {
          // Ledger update must never cause ResearchItem deletion or abort the batch.
        }
      }
    }
  }

  const unusedAfter = await countUnusedApprovedStock(deps.database.prisma);

  if (fanzaImageTermsVerifiedFromEnv() && (generated > 0 || unusedAfter > 0)) {
    await confirmFanzaAffiliateImageTerms({
      prisma: deps.database.prisma,
      iConfirmChecklist: true,
      actor: "stock-generation-worker",
      contentVersionLimit: 500,
    });
  }

  return {
    skipped: false,
    skipReason: null,
    unusedApprovedBefore: unusedBefore,
    unusedApprovedAfter: await countUnusedApprovedStock(deps.database.prisma),
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
