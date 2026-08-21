import type { AppConfig } from "@ai-affiliate/config";
import type {
  XPublicationRepository,
  XPublicationStrategyType,
  XStrategyConfidenceLevel,
  XStrategyPerformance,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { computeEngagementRate, computeRate } from "./metrics-collector.js";
import { STRATEGY_VERSION } from "./types.js";

export interface XStrategyEvaluatorDeps {
  logger: Logger;
  config: AppConfig;
  publications: XPublicationRepository;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_STRATEGY_EVALUATION_COMPLETED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export interface StrategyEvaluationReport {
  windowHours: number;
  minimumSamples: number;
  rows: XStrategyPerformance[];
  recommendedStrategy: XPublicationStrategyType | null;
  confidenceLevel: XStrategyConfidenceLevel;
  dataLimitations: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function winsorizedMean(values: number[]): number | null {
  if (values.length === 0) return null;
  if (values.length < 4) return average(values);
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * 0.1));
  const trimmed = sorted.slice(cut, sorted.length - cut);
  return average(trimmed.length > 0 ? trimmed : sorted);
}

const ALL_STRATEGIES: XPublicationStrategyType[] = [
  "SINGLE_POST",
  "ROOT_WITH_REPLY",
  "THREAD",
  "RELATED_POST_LINK",
  "HUB_POST",
  "CONTROL",
];

export class XStrategyEvaluator {
  private readonly now: () => Date;

  constructor(private readonly deps: XStrategyEvaluatorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async evaluate(options?: {
    windowHours?: number;
    minimumSamples?: number;
  }): Promise<StrategyEvaluationReport> {
    const windowHours =
      options?.windowHours ?? this.deps.config.xStrategyEvaluationWindowHours;
    const minimumSamples =
      options?.minimumSamples ?? this.deps.config.xStrategyMinSampleSize;
    const since = new Date(this.now().getTime() - windowHours * 60 * 60 * 1000);

    const publications = await this.deps.publications.listPublishedWithPosts({
      since,
      limit: 500,
    });

    const snapshots = await this.deps.publications.listMetricSnapshots({ limit: 2000 });
    const byPublication = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      const list = byPublication.get(snap.publicationId) ?? [];
      list.push(snap);
      byPublication.set(snap.publicationId, list);
    }

    const dataLimitations: string[] = [];
    const rows: XStrategyPerformance[] = [];
    let bestScore: number | null = null;
    let recommended: XPublicationStrategyType | null = null;
    let overallConfidence: XStrategyConfidenceLevel = "INSUFFICIENT";

    for (const strategyType of ALL_STRATEGIES) {
      const pubs = publications.filter((p) => p.strategyType === strategyType);
      const impressions: number[] = [];
      const engagementRates: number[] = [];
      const urlClickRates: number[] = [];
      const profileClickRates: number[] = [];
      const replyContinuationRates: number[] = [];
      let eligible = 0;
      let missingUrl = 0;

      for (const pub of pubs) {
        const snaps = byPublication.get(pub.id) ?? [];
        // Prefer latest snapshot for root post
        const root = pub.posts.find((p) => p.sequence === 1);
        const rootSnaps = snaps
          .filter((s) => s.publicationPostId === root?.id || s.xPostId === root?.xPostId)
          .sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime());
        const snap = rootSnaps[0] ?? snaps.sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())[0];
        if (!snap) continue;

        eligible += 1;
        if (snap.impressionCount != null) impressions.push(snap.impressionCount);

        const engagement = computeEngagementRate(
          [snap.likeCount, snap.replyCount, snap.repostCount, snap.quoteCount, snap.bookmarkCount].every(
            (v) => v == null,
          )
            ? null
            : (snap.likeCount ?? 0) +
                (snap.replyCount ?? 0) +
                (snap.repostCount ?? 0) +
                (snap.quoteCount ?? 0) +
                (snap.bookmarkCount ?? 0),
          snap.impressionCount,
        );
        if (engagement != null) engagementRates.push(engagement);

        const urlRate = computeRate(snap.urlClickCount, snap.impressionCount);
        if (urlRate != null) urlClickRates.push(urlRate);
        else missingUrl += 1;

        const profileRate = computeRate(snap.profileClickCount, snap.impressionCount);
        if (profileRate != null) profileClickRates.push(profileRate);

        // reply continuation: reply post impressions / root impressions when both available
        const reply = pub.posts.find((p) => p.sequence === 2 && p.status === "PUBLISHED");
        if (reply) {
          const replySnap = snaps.find((s) => s.publicationPostId === reply.id);
          const rate = computeRate(replySnap?.impressionCount ?? null, snap.impressionCount);
          if (rate != null) replyContinuationRates.push(rate);
        }
      }

      const sampleCount = pubs.length;
      let confidence: XStrategyConfidenceLevel = "INSUFFICIENT";
      if (eligible >= minimumSamples) {
        confidence = eligible >= minimumSamples * 2 ? "HIGH" : "MEDIUM";
      } else if (eligible >= Math.ceil(minimumSamples / 2)) {
        confidence = "LOW";
      }

      const weights = { ...this.deps.config.xScoreWeights };
      // Renormalize if URL clicks unavailable for this strategy
      if (urlClickRates.length === 0) {
        missingUrl = Math.max(missingUrl, 1);
        dataLimitations.push(`${strategyType}:urlClickUnavailable`);
        const { urlClickRate: _drop, ...rest } = weights;
        void _drop;
        const total = Object.values(rest).reduce((s, v) => s + v, 0);
        weights.impressions = (rest.impressions / total) * 100;
        weights.engagementRate = (rest.engagementRate / total) * 100;
        weights.profileClickRate = (rest.profileClickRate / total) * 100;
        weights.urlClickRate = 0;
      }

      const avgImp = average(impressions);
      const avgEng = average(engagementRates);
      const avgUrl = average(urlClickRates);
      const avgProfile = average(profileClickRates);

      let score: number | null = null;
      if (confidence !== "INSUFFICIENT") {
        // Normalize impressions heuristically by dividing by 1000, clamp 0-1
        const impComponent = avgImp != null ? Math.min(1, avgImp / 1000) : null;
        const components: Array<{ weight: number; value: number | null }> = [
          { weight: weights.impressions, value: impComponent },
          { weight: weights.engagementRate, value: avgEng },
          { weight: weights.urlClickRate, value: avgUrl },
          { weight: weights.profileClickRate, value: avgProfile },
        ];
        const available = components.filter((c) => c.value != null && c.weight > 0);
        const weightSum = available.reduce((s, c) => s + c.weight, 0);
        if (available.length > 0 && weightSum > 0) {
          score =
            available.reduce((s, c) => s + (c.value! * c.weight) / weightSum, 0) * 100;
        }
      }

      const row = await this.deps.publications.saveStrategyPerformance({
        strategyType,
        strategyVersion: STRATEGY_VERSION,
        evaluationWindowHours: windowHours,
        sampleCount,
        eligibleSampleCount: eligible,
        averageImpressions: avgImp,
        medianImpressions: median(impressions),
        averageEngagementRate: avgEng,
        medianEngagementRate: median(engagementRates),
        averageUrlClickRate: avgUrl,
        averageProfileClickRate: avgProfile,
        averageReplyContinuationRate: average(replyContinuationRates),
        confidenceLevel: confidence,
        score,
        recommendedStrategy: null,
        supportingMetrics: {
          winsorizedImpressions: winsorizedMean(impressions),
          missingUrlRate: sampleCount > 0 ? missingUrl / Math.max(eligible, 1) : null,
        },
        dataLimitations: {
          notes: dataLimitations.filter((d) => d.startsWith(strategyType)),
        },
        calculatedAt: this.now(),
        parameters: {
          minimumSamples,
          weights,
          metricsVersion: "x-metrics-v1",
        },
      });
      rows.push(row);

      if (score != null && (bestScore == null || score > bestScore)) {
        bestScore = score;
        recommended = strategyType;
        overallConfidence = confidence;
      }
    }

    if (overallConfidence === "INSUFFICIENT") {
      recommended = null;
      dataLimitations.push("insufficient samples — no strategy asserted");
    }

    // Persist recommendation onto latest rows conceptually via report
    for (const row of rows) {
      if (row.strategyType === recommended) {
        // already stored; report carries recommendation
      }
    }

    await this.deps.notifications?.emitXEvent?.("X_STRATEGY_EVALUATION_COMPLETED", {
      recommendedStrategy: recommended,
      confidenceLevel: overallConfidence,
      sampleSize: publications.length,
    });

    // Auto optimization disabled: do not mutate selection mode / experiment weights here.

    return {
      windowHours,
      minimumSamples,
      rows,
      recommendedStrategy: recommended,
      confidenceLevel: overallConfidence,
      dataLimitations,
    };
  }
}
