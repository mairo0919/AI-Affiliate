import type { AppConfig } from "@ai-affiliate/config";
import type {
  AnalysisRepository,
  ContentCandidateType,
  ResearchItemForAnalysis,
  ResearchRepository,
  SourceType,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { evaluateEligibility } from "./eligibility.js";
import { selectCandidates } from "./selection.js";
import type { ScoredItem } from "./selection.js";
import {
  scoreDataQuality,
  scoreFreshness,
  scorePopularity,
  scorePrice,
  scoreReview,
  scoreTrend,
} from "./scoring.js";
import { computeTotalScore } from "./total-score.js";
import {
  DEFAULT_SCORE_WEIGHTS,
  ELIGIBILITY_VERSION,
  SCORING_VERSION,
  SELECTION_VERSION,
  buildMetricIndex,
  buildTagIndex,
} from "./types.js";
import type { ScoreWeights } from "./types.js";

export interface AnalysisRunOptions {
  source?: string;
  limit?: number;
  fromDate?: Date;
  toDate?: Date;
  candidateTypes?: ContentCandidateType[];
  candidateLimit?: number;
  overallCandidateLimit?: number;
  minimumScore?: number;
  includeRequiresConfirmation?: boolean;
  dryRun?: boolean;
  now?: Date;
}

export interface AnalysisRunResult {
  analysisRunId: string | null;
  status: string;
  analyzedItemCount: number;
  eligibleCount: number;
  requiresConfirmationCount: number;
  notEligibleCount: number;
  selectedItemCount: number;
  candidateCounts: Record<string, number>;
  averageScore: number;
  errorCount: number;
  executionTime: number;
  skipped?: boolean;
  skipReason?: string;
}

const DEFAULT_CANDIDATE_TYPES: ContentCandidateType[] = [
  "RANKING",
  "TRENDING",
  "HIGH_RATING",
  "NEW_RELEASE",
  "DISCOUNT",
];

function resolveSourceTypes(source?: string): SourceType[] {
  const normalized = (source ?? "fanza").toLowerCase();
  if (normalized === "all") {
    return ["FANZA", "OTHER"];
  }
  if (normalized === "mock") {
    // Mock fixtures typically use FANZA sourceType with synthetic externalIds
    return ["FANZA", "OTHER"];
  }
  if (normalized === "fanza") {
    return ["FANZA"];
  }
  return ["FANZA", "OTHER"];
}

export interface AnalysisEngineDeps {
  logger: Logger;
  research: ResearchRepository;
  analysis: AnalysisRepository;
  config: AppConfig;
}

export class AnalysisEngine {
  private readonly logger: Logger;
  private readonly research: ResearchRepository;
  private readonly analysis: AnalysisRepository;
  private readonly config: AppConfig;

  constructor(deps: AnalysisEngineDeps) {
    this.logger = deps.logger;
    this.research = deps.research;
    this.analysis = deps.analysis;
    this.config = deps.config;
  }

  async run(options: AnalysisRunOptions = {}): Promise<AnalysisRunResult> {
    const started = Date.now();
    const now = options.now ?? new Date();
    const dryRun = options.dryRun === true;
    const weights: ScoreWeights = {
      ...DEFAULT_SCORE_WEIGHTS,
      ...this.config.analysisScoreWeights,
    };

    const parameters = {
      source: options.source ?? "fanza",
      limit: options.limit ?? 1000,
      candidateTypes: options.candidateTypes ?? DEFAULT_CANDIDATE_TYPES,
      candidateLimit: options.candidateLimit ?? 10,
      overallCandidateLimit: options.overallCandidateLimit ?? 50,
      minimumScore: options.minimumScore ?? 0,
      includeRequiresConfirmation: options.includeRequiresConfirmation === true,
      dryRun,
      scoringVersion: SCORING_VERSION,
      eligibilityVersion: ELIGIBILITY_VERSION,
      selectionVersion: SELECTION_VERSION,
    };

    let runId: string | null = null;
    if (!dryRun) {
      const created = await this.analysis.createAnalysisRun({
        analysisType: "CONTENT_CANDIDATE_SELECTION",
        parameters,
        scoringVersion: SCORING_VERSION,
        eligibilityVersion: ELIGIBILITY_VERSION,
        selectionVersion: SELECTION_VERSION,
      });
      runId = created.id;
      await this.analysis.startAnalysisRun(runId);
    }

    try {
      const items = await this.research.listItemsForAnalysis({
        sourceTypes: resolveSourceTypes(options.source),
        itemType: "PRODUCT",
        limit: parameters.limit,
        fromDate: options.fromDate,
        toDate: options.toDate,
      });

      const byId = new Map<string, ResearchItemForAnalysis>();
      for (const item of items) {
        if (this.isAnalysisTarget(item)) {
          byId.set(item.id, item);
        }
      }
      const targets = [...byId.values()].slice(0, parameters.limit);

      const genrePrices = this.collectGenrePrices(targets);
      const scored: ScoredItem[] = [];
      let eligibleCount = 0;
      let requiresConfirmationCount = 0;
      let notEligibleCount = 0;
      let errorCount = 0;
      let scoreSum = 0;

      for (const item of targets) {
        try {
          const metricsByType = buildMetricIndex(item);
          const tagsByType = buildTagIndex(item);
          const context = {
            item,
            metricsByType,
            tagsByType,
            genrePrices: this.genrePricesForItem(item, genrePrices),
            now,
            weights,
          };

          const eligibility = evaluateEligibility(context);
          if (eligibility.status === "ELIGIBLE") eligibleCount += 1;
          else if (eligibility.status === "REQUIRES_CONFIRMATION") requiresConfirmationCount += 1;
          else notEligibleCount += 1;

          const popularity = scorePopularity(context);
          const trend = scoreTrend(context);
          const review = scoreReview(context);
          const price = scorePrice(context);
          const freshness = scoreFreshness(context);
          const dataQuality = scoreDataQuality(context);

          const { totalScore } = computeTotalScore(
            { popularity, trend, review, price, freshness, dataQuality },
            weights,
          );
          scoreSum += totalScore;

          const breakdown = {
            popularity,
            trend,
            review,
            price,
            freshness,
            dataQuality,
          };

          let analysisId: string | undefined;
          if (!dryRun && runId) {
            const saved = await this.analysis.saveProductAnalysis({
              analysisRunId: runId,
              researchItemId: item.id,
              totalScore,
              popularityScore: popularity.score,
              trendScore: trend.score,
              reviewScore: review.score,
              priceScore: price.score,
              freshnessScore: freshness.score,
              dataQualityScore: dataQuality.score ?? 0,
              eligibilityStatus: eligibility.status,
              exclusionReasons: eligibility.reasons,
              scoreBreakdown: breakdown,
              analyzedAt: now,
            });
            analysisId = saved.id;
          }

          scored.push({
            item,
            analysis: {
              id: analysisId,
              researchItemId: item.id,
              totalScore,
              popularityScore: popularity.score,
              trendScore: trend.score,
              reviewScore: review.score,
              priceScore: price.score,
              freshnessScore: freshness.score,
              dataQualityScore: dataQuality.score ?? 0,
              eligibilityStatus: eligibility.status,
              breakdown,
            },
          });
        } catch (error) {
          errorCount += 1;
          this.logger.warn(
            `analysis item failed itemId=${item.id} (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }

      const candidates = selectCandidates(scored, {
        candidateTypes: parameters.candidateTypes,
        perTypeLimit: parameters.candidateLimit,
        overallLimit: parameters.overallCandidateLimit,
        minimumScore: parameters.minimumScore,
        includeRequiresConfirmation: parameters.includeRequiresConfirmation,
        diversity: this.config.analysisDiversityLimits,
      });

      // Attach analysis ids for dry-run placeholders
      const withIds = candidates.map((candidate) => {
        if (candidate.productAnalysisId) {
          return candidate;
        }
        const match = scored.find((entry) => entry.item.id === candidate.researchItemId);
        return { ...candidate, productAnalysisId: match?.analysis.id ?? "" };
      });

      if (!dryRun && runId) {
        const persistable = withIds.filter((candidate) => candidate.productAnalysisId);
        await this.analysis.createContentCandidates(
          persistable.map((candidate) => ({
            analysisRunId: runId!,
            researchItemId: candidate.researchItemId,
            productAnalysisId: candidate.productAnalysisId,
            candidateType: candidate.candidateType,
            rank: candidate.rank,
            selectionScore: candidate.selectionScore,
            selectionReasons: candidate.selectionReasons,
          })),
        );

        const counts = {
          analyzedItemCount: scored.length,
          selectedItemCount: persistable.length,
          errorCount,
        };
        if (errorCount > 0 && scored.length > 0) {
          await this.analysis.partiallyCompleteAnalysisRun(runId, {
            ...counts,
            errorMessage: `${errorCount} item(s) failed`,
          });
        } else if (scored.length === 0 && errorCount > 0) {
          await this.analysis.failAnalysisRun(runId, "all items failed");
        } else {
          await this.analysis.completeAnalysisRun(runId, counts);
        }
      }

      const candidateCounts: Record<string, number> = {};
      for (const candidate of withIds) {
        candidateCounts[candidate.candidateType] =
          (candidateCounts[candidate.candidateType] ?? 0) + 1;
      }

      const status =
        errorCount > 0 && scored.length > 0
          ? "PARTIALLY_COMPLETED"
          : scored.length === 0 && errorCount > 0
            ? "FAILED"
            : "COMPLETED";

      return {
        analysisRunId: runId,
        status: dryRun ? `DRY_RUN_${status}` : status,
        analyzedItemCount: scored.length,
        eligibleCount,
        requiresConfirmationCount,
        notEligibleCount,
        selectedItemCount: withIds.length,
        candidateCounts,
        averageScore: scored.length > 0 ? Number((scoreSum / scored.length).toFixed(2)) : 0,
        errorCount,
        executionTime: Date.now() - started,
      };
    } catch (error) {
      if (!dryRun && runId) {
        await this.analysis.failAnalysisRun(
          runId,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  private isAnalysisTarget(item: ResearchItemForAnalysis): boolean {
    if (item.itemType !== "PRODUCT") return false;
    if (!item.externalId?.trim()) return false;
    if (!item.title?.trim()) return false;
    if (!item.url?.trim()) return false;
    const sourceType = item.source.type;
    if (sourceType !== "FANZA" && sourceType !== "OTHER") return false;
    return true;
  }

  private collectGenrePrices(items: ResearchItemForAnalysis[]): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (const item of items) {
      const metrics = buildMetricIndex(item);
      const price = metrics.get("price")?.points.at(-1)?.value;
      if (price === undefined) continue;
      const tags = buildTagIndex(item);
      const genres = tags.get("genre") ?? ["__all__"];
      for (const genre of genres) {
        const list = map.get(genre) ?? [];
        list.push(price);
        map.set(genre, list);
      }
    }
    return map;
  }

  private genrePricesForItem(
    item: ResearchItemForAnalysis,
    genrePrices: Map<string, number[]>,
  ): number[] {
    const tags = buildTagIndex(item);
    const genres = tags.get("genre") ?? [];
    const collected: number[] = [];
    for (const genre of genres) {
      collected.push(...(genrePrices.get(genre) ?? []));
    }
    if (collected.length === 0) {
      return [...(genrePrices.get("__all__") ?? [])];
    }
    return collected;
  }
}
