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
import {
  buildRawDataAfterStockFailure,
  buildRawDataAfterStockSuccess,
  isStockAttemptEligibleNow,
  readStockAttemptLedger,
} from "./stock-attempt-ledger.js";
import { confirmFanzaAffiliateImageTerms } from "./confirm-fanza-image-terms.js";
import {
  classifyCastShape,
  ensureOfficialEnrichmentForStockItem,
  extractItemListCatalogFacts,
  shouldAvoidSingularPerformerFraming,
} from "./ensure-official-enrichment.js";
import {
  extractSynopsisTheme,
  isMechanicalTemplateTitle,
  isPerformerGenreListTitle,
} from "./repair-quality-guard.js";

function plainTextLength(htmlOrText: unknown): number {
  return String(htmlOrText ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

const GENERIC_PROSE_RE =
  /魅力を存分に味わえる|濃厚な内容|おすすめです|じっくり楽しみたい方|ボリューム感|刺激的な展開/g;

/**
 * Stock auto-approve quality gate — thin/generic/multi-performer misframe → NEEDS_ENRICHMENT.
 */
export function evaluateStockArticleQualityGate(input: {
  productTitle: string;
  rawData: unknown;
  structuredContent: Record<string, unknown>;
  writerTitle?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const catalog = extractItemListCatalogFacts(input.rawData);
  const actors = catalog.actors;
  const castShape = classifyCastShape({ actors, productTitle: input.productTitle });
  const title =
    input.writerTitle?.trim() ||
    String(input.structuredContent.title ?? input.structuredContent.seoTitle ?? "").trim() ||
    "";
  const body = plainTextLength(
    input.structuredContent.bodyHtml ??
      input.structuredContent.body ??
      input.structuredContent.html ??
      input.structuredContent.contentHtml,
  );
  const bodyText = String(
    input.structuredContent.bodyHtml ??
      input.structuredContent.body ??
      input.structuredContent.html ??
      "",
  ).replace(/<[^>]+>/g, " ");
  const genericHits = bodyText.match(GENERIC_PROSE_RE)?.length ?? 0;
  const sentences = Math.max(1, bodyText.split(/[。．.!?！？\n]/).filter((s) => s.trim().length > 8).length);
  const genericRatio = genericHits / sentences;

  if (shouldAvoidSingularPerformerFraming({ actors, productTitle: input.productTitle })) {
    const singularHit = actors.find(
      (a) =>
        a.length >= 2 &&
        (title.includes(`${a}出演`) ||
          title.includes(`${a}が魅せる`) ||
          title.includes(`${a}が贈る`) ||
          /^注目は.+｜/.test(title) && title.includes(a)),
    );
    // Title names exactly one cast member as the star while many exist.
    const namedInTitle = actors.filter((a) => a.length >= 2 && title.includes(a));
    if (singularHit || (namedInTitle.length === 1 && actors.length >= 3 && /出演|が魅せる|が贈る/.test(title))) {
      return {
        ok: false,
        reason: `MULTI_PERFORMER_SINGULAR_TITLE:${castShape}`,
      };
    }
  }

  // Bare form titles with no product theme (e.g. 「ベストと総集編」).
  if (
    /^(?:ベストと総集編|ベスト・総集編|女優ベスト・総集編|ベスト|総集編)(?:の見どころ(?:整理)?|ガイド)?$/u.test(
      title,
    )
  ) {
    return { ok: false, reason: "GENERIC_FORM_TITLE" };
  }

  if (isPerformerGenreListTitle(title, actors)) {
    return { ok: false, reason: "PERFORMER_GENRE_LIST_TITLE" };
  }

  const synopsis = extractSynopsisTheme(input.productTitle, actors);
  if (synopsis && isMechanicalTemplateTitle(title)) {
    return { ok: false, reason: "MECHANICAL_TEMPLATE_OVER_SYNOPSIS" };
  }
  if (
    synopsis &&
    !title.includes(synopsis.slice(0, Math.min(6, synopsis.length))) &&
    isPerformerGenreListTitle(title, actors)
  ) {
    return { ok: false, reason: "SYNOPSIS_IGNORED_FOR_GENRE_TITLE" };
  }

  if (body > 0 && body < 420 && (castShape === "BEST_COMPILATION" || actors.length >= 2 || catalog.genres.length >= 3)) {
    return { ok: false, reason: `THIN_ARTICLE_FOR_RICH_CAST:body=${body}` };
  }

  if (body > 0 && body < 280) {
    return { ok: false, reason: `THIN_ARTICLE:body=${body}` };
  }

  if (genericRatio >= 0.35 && genericHits >= 2) {
    return { ok: false, reason: `GENERIC_PROSE_RATIO:${genericRatio.toFixed(2)}` };
  }

  return { ok: true };
}

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

  // Load ResearchItem attempt ledgers — never delete; only defer retries.
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

  for (let i = 0; i < toGenerate; i++) {
    let produced = false;
    // Try several candidates per batch slot so DEFER does not burn the whole batch.
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

      const enrichment = await ensureOfficialEnrichmentForStockItem({
        lifecycle: deps.lifecycle,
        research: researchRepo,
        config: deps.config,
        logger: createLogger("info"),
        canonicalId: selected.canonicalId,
        productUrl: ctaUrl,
        researchItemId: item.id,
        productTitle: item.title,
        rawData: item.rawData,
      });
      if (enrichment.status === "NEEDS_ENRICHMENT") {
        const reason = "NEEDS_ENRICHMENT:official_evidence_missing";
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
        productCanonicalId: selected.canonicalId,
        claimIds: boot.claimIds,
      });
      generated += 1;
      articled.add(productKey);
      produced = true;

      // Persist product key on structuredContent for stock exclusion / PUBLIC eval.
      const sc = (generatedArticle.version.structuredContent ?? {}) as Record<string, unknown>;
      const quality = evaluateStockArticleQualityGate({
        productTitle: item.title,
        rawData: item.rawData,
        structuredContent: sc,
        writerTitle: generatedArticle.version.title,
      });
      if (!sc.productCanonicalId && !sc.canonicalId) {
        await deps.lifecycle.updateContentVersionStructuredContent(generatedArticle.version.id, {
          ...sc,
          productCanonicalId: selected.canonicalId,
          canonicalId: selected.canonicalId,
          sourceProvider: "research",
          analysisRunId,
          stockRoute: "STOCK_GENERATION",
          officialEnrichmentStatus: enrichment.status,
          officialActorCount: enrichment.actorCount,
        });
      } else {
        await deps.lifecycle.updateContentVersionStructuredContent(generatedArticle.version.id, {
          ...sc,
          officialEnrichmentStatus: enrichment.status,
          officialActorCount: enrichment.actorCount,
        });
      }

      if (!quality.ok) {
        const reason = quality.reason;
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
        // Do not auto-approve thin/misframed articles.
        continue;
      }

      // ResearchItem retained — only stamp attempt ledger as COMPLETED.
      const success = buildRawDataAfterStockSuccess({ rawData: item.rawData, now });
      await deps.database.prisma.researchItem.update({
        where: { id: item.id },
        data: { rawData: asStoredJson(success.rawData) },
      });
      ledgerByResearchId.set(item.id, success.ledger);

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
        const reason =
          reviewErr instanceof Error
            ? `AUTO_REVIEW_FAILED:${reviewErr.message.slice(0, 120)}`
            : "AUTO_REVIEW_FAILED";
        held.push({ canonicalId: selected.canonicalId, reason });
        const failed = buildRawDataAfterStockFailure({
          rawData: success.rawData,
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

  // Operator env flag asserts FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST completed.
  // Promote RC→ALLOWED on stock so PUBLIC-capable future scheduling can proceed.
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
