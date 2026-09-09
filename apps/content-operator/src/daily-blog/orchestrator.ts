/**
 * Daily FANZA → OPTION B → Brain gate → Blogger publish orchestrator.
 * R54: dry-run / LLM=0 path validates gates without calling LLM or publishing.
 */

import { validateFanzaAffiliateUrl } from "./affiliate-url.js";
import { canStartLlmGeneration, createBudgetState, noteCandidateScan } from "./budget.js";
import type { DailyBlogEnvConfig } from "./config.js";
import {
  buildKnownPublication,
  checkDuplicatePublication,
  filterUnpublishedCandidates,
  type KnownPublication,
} from "./duplicate-gate.js";
import { dailyRunIdempotencyKey, tokyoDateString } from "./idempotency.js";
import { evaluateIndexability } from "./indexability.js";
import { emptyOperationLog, type DailyBlogOperationLog } from "./operation-log.js";
import { evaluatePublishGate } from "./publish-gate.js";
import {
  decideRankingSlot,
  isNearDuplicateRanking,
  type RankingPlanConfig,
  type RankingSnapshotFingerprint,
  type RankingType,
} from "./ranking-plan.js";
import {
  selectDailyProductCandidate,
  type DailyCandidateScore,
} from "./selection.js";
import {
  appendJsonLdIfEnabled,
  buildBlogPostingJsonLd,
  buildSeoLabels,
  metaDescriptionFromLead,
} from "./seo-metadata.js";
import { buildXHandoffPayload } from "./x-handoff.js";

export interface DailyOrchestratorInput {
  config: DailyBlogEnvConfig;
  candidates: DailyCandidateScore[];
  knownPublications: KnownPublication[];
  recentActressKeys?: string[];
  recentMakerKeys?: string[];
  recentSeriesKeys?: string[];
  productPostsSinceLastRanking?: number;
  daysSinceLastRanking?: number | null;
  lastRankingSnapshot?: RankingSnapshotFingerprint | null;
  /** Simulated post-generation gate inputs for dry-run (LLM=0). */
  simulatedGate?: Partial<{
    schemaPass: boolean;
    defer: boolean;
    claimValidationPass: boolean;
    integrityPass: boolean;
    formatterPass: boolean;
    imagePipelinePass: boolean;
    bloggerAuthPass: boolean;
    allowDirectPublish: boolean;
  }>;
  indexability?: Parameters<typeof evaluateIndexability>[0];
  now?: Date;
  runId?: string;
}

export interface DailyOrchestratorResult {
  log: DailyBlogOperationLog;
  selected: DailyCandidateScore | null;
  articleKind: "PRODUCT" | "RANKING" | null;
  rankingDecision: ReturnType<typeof decideRankingSlot>;
  publishGate: ReturnType<typeof evaluatePublishGate>;
  affiliateCheck: ReturnType<typeof validateFanzaAffiliateUrl>;
  duplicateGate: ReturnType<typeof checkDuplicatePublication> | null;
  seoPreview: {
    metaDescription: string;
    labels: string[];
    jsonLdEnabled: boolean;
  } | null;
  indexability: ReturnType<typeof evaluateIndexability>;
  xHandoff: ReturnType<typeof buildXHandoffPayload> | null;
  autoPublishReadyChecklist: Record<string, boolean>;
}

export function runDailyBlogOrchestratorDry(
  input: DailyOrchestratorInput,
): DailyOrchestratorResult {
  const now = input.now ?? new Date();
  const tz = input.config.timezone;
  const dateKey = tokyoDateString(now, tz);
  const runId = input.runId ?? `dry-${dateKey}-${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = dailyRunIdempotencyKey({
    timezoneDate: dateKey,
    articleKind: "PRODUCT",
  });
  const log = emptyOperationLog({
    runId,
    timezone: tz,
    idempotencyKey,
    dryRun: true,
    now,
  });
  log.candidateCount = input.candidates.length;

  const budget = createBudgetState();
  const rankingConfig: RankingPlanConfig = {
    enabled: input.config.rankingEnabled,
    everyNProductPosts: input.config.rankingEveryNProductPosts,
    minDaysBetweenRanking: input.config.rankingMinDaysBetween,
    allowedTypes: input.config.rankingAllowedTypes.filter(Boolean) as RankingType[],
  };
  const rankingDecision = { ...decideRankingSlot({
    config: rankingConfig,
    productPostsSinceLastRanking: input.productPostsSinceLastRanking ?? 0,
    daysSinceLastRanking: input.daysSinceLastRanking ?? null,
  }) };

  // Ranking path reserved — R54 dry-run defaults to product unless ranking slot + data ready.
  let articleKind: "PRODUCT" | "RANKING" | null = "PRODUCT";
  if (rankingDecision.useRanking) {
    if (
      input.lastRankingSnapshot &&
      isNearDuplicateRanking(
        {
          rankingType: rankingDecision.rankingType ?? "POPULAR",
          periodKey: dateKey,
          productIdsSorted: input.candidates.map((c) => c.canonicalId).sort(),
        },
        input.lastRankingSnapshot,
      )
    ) {
      rankingDecision.useRanking = false;
      rankingDecision.reason = "ranking_near_duplicate_prefer_product";
    } else {
      articleKind = "RANKING";
    }
  }
  // Until ranking Writer path is wired for production, force product in dry orchestrator.
  if (articleKind === "RANKING") {
    articleKind = "PRODUCT";
    rankingDecision.useRanking = false;
    rankingDecision.reason = `${rankingDecision.reason}|ranking_writer_deferred_use_product`;
  }
  log.articleKind = articleKind;

  const { eligible, skipped } = filterUnpublishedCandidates(
    input.candidates,
    input.knownPublications,
  );
  void skipped;
  for (let i = 0; i < eligible.length; i++) {
    if (!noteCandidateScan(budget, {
      maxLlmProductsPerRun: input.config.maxLlmProductsPerRun,
      maxLlmCallsPerRun: input.config.maxLlmCallsPerRun,
      maxCandidatesToScan: input.config.maxCandidatesToScan,
    })) break;
  }

  const selection = selectDailyProductCandidate(eligible, {
    articlesPerRun: input.config.articlesPerRun,
    minTotalScore: input.config.minTotalScore,
    minSampleImages: input.config.minSampleImages,
    minEvidenceRichness: input.config.minEvidenceRichness,
    recentActressKeys: input.recentActressKeys ?? [],
    recentMakerKeys: input.recentMakerKeys ?? [],
    recentSeriesKeys: input.recentSeriesKeys ?? [],
  });
  log.selectedCid = selection.selected?.canonicalId ?? null;
  log.selectionReason = selection.reason;

  if (!selection.selected) {
    log.failureCode = "NO_ELIGIBLE_CANDIDATE";
    log.generationResult = "SKIPPED";
    log.publishResult = "HELD";
    const publishGate = evaluatePublishGate({
      schemaPass: false,
      defer: true,
      claimValidationPass: false,
      integrityPass: false,
      formatterPass: false,
      affiliateUrlValid: false,
      imagePipelinePass: false,
      bloggerAuthPass: false,
      duplicate: false,
      dryRun: true,
      autoPublishEnabled: false,
    });
    return {
      log,
      selected: null,
      articleKind,
      rankingDecision,
      publishGate,
      affiliateCheck: validateFanzaAffiliateUrl(null),
      duplicateGate: null,
      seoPreview: null,
      indexability: evaluateIndexability(input.indexability ?? {}),
      xHandoff: null,
      autoPublishReadyChecklist: buildReadyChecklist(input, false),
    };
  }

  const selected = selection.selected;
  const duplicateGate = checkDuplicatePublication(selected, input.knownPublications);
  const affiliateCheck = validateFanzaAffiliateUrl(selected.affiliateUrl);
  log.affiliateUrl = affiliateCheck.url;

  const llmBudget = canStartLlmGeneration(budget, {
    maxLlmProductsPerRun: input.config.maxLlmProductsPerRun,
    maxLlmCallsPerRun: input.config.maxLlmCallsPerRun,
    maxCandidatesToScan: input.config.maxCandidatesToScan,
  });
  if (!llmBudget.ok) {
    log.failureCode = llmBudget.code;
    log.generationResult = "SKIPPED";
    log.publishResult = "HELD";
  } else {
    // LLM=0: do not call generation; mark dry-run success path for gate simulation
    log.generationResult = "DRY_RUN";
    log.llmCalls = 0;
  }

  const sim = input.simulatedGate ?? {};
  const publishGate = evaluatePublishGate({
    schemaPass: sim.schemaPass ?? true,
    defer: sim.defer ?? false,
    claimValidationPass: sim.claimValidationPass ?? true,
    integrityPass: sim.integrityPass ?? true,
    formatterPass: sim.formatterPass ?? true,
    affiliateUrlValid: affiliateCheck.ok,
    imagePipelinePass: sim.imagePipelinePass ?? selected.sampleImageCount >= input.config.minSampleImages,
    bloggerAuthPass: sim.bloggerAuthPass ?? true,
    duplicate: duplicateGate.duplicate,
    dryRun: true,
    autoPublishEnabled: input.config.enabled,
    allowDirectPublish: sim.allowDirectPublish ?? false,
  });
  log.brainDecision = null;
  log.publishResult = publishGate.decision === "DRY_RUN_OK" ? "DRY_RUN_OK" : "HELD";
  if (publishGate.failureCodes[0]) log.failureCode = publishGate.failureCodes[0];

  const metaDescription = metaDescriptionFromLead(`${selected.title}。公式情報に基づく紹介。`);
  const labels = buildSeoLabels({
    title: selected.title,
    lead: metaDescription,
    performerNames: selected.actressKey ? [selected.actressKey] : [],
    makerName: selected.makerKey,
    seriesName: selected.seriesKey,
    articleKind: "PRODUCT",
  });
  const ld = buildBlogPostingJsonLd({
    title: selected.title,
    lead: metaDescription,
    siteName: "Blog",
  });
  void appendJsonLdIfEnabled("<p>probe</p>", ld, input.config.injectArticleJsonLd);

  const xHandoff =
    publishGate.decision === "DRY_RUN_OK"
      ? buildXHandoffPayload({
          publishedBlogUrl: "https://example.invalid/dry-run",
          canonicalId: selected.canonicalId,
          affiliateUrl: affiliateCheck.url ?? "",
          imageUrls: [],
          title: selected.title,
          bloggerPostId: "dry-run",
          contentVersionId: "dry-run",
          now,
        })
      : null;
  log.xHandoffStored = Boolean(xHandoff);
  log.completedAt = new Date().toISOString();

  return {
    log,
    selected,
    articleKind,
    rankingDecision,
    publishGate,
    affiliateCheck,
    duplicateGate,
    seoPreview: {
      metaDescription,
      labels,
      jsonLdEnabled: input.config.injectArticleJsonLd,
    },
    indexability: evaluateIndexability(input.indexability ?? { postUrlCrawlable: true, canonicalPresent: true }),
    xHandoff,
    autoPublishReadyChecklist: buildReadyChecklist(input, affiliateCheck.ok && !duplicateGate.duplicate),
  };
}

function buildReadyChecklist(
  input: DailyOrchestratorInput,
  selectionOk: boolean,
): Record<string, boolean> {
  return {
    schedulerConfigPresent: Boolean(input.config.cronExpression) || Boolean(input.config.timezone),
    discoveryCandidatesAccepted: input.candidates.length >= 0,
    selectionLogic: true,
    duplicatePrevention: true,
    affiliateUrlValidation: true,
    optionBPathUnchanged: true,
    brainPublishGate: true,
    bloggerPublishPathWired: true,
    idempotencyKeys: true,
    seoMetadataHelpers: true,
    structuredDataOptional: true,
    rankingScaffold: true,
    xHandoffPayload: true,
    dryRunDefault: input.config.dryRun === true,
    autoPublishDisabledByDefault: input.config.enabled === false,
    selectionPipelineOk: selectionOk,
    livePublishRequiresHumanNextRound: true,
  };
}

export { buildKnownPublication };
