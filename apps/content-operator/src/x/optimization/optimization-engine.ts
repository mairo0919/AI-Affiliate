import type { AppConfig } from "@ai-affiliate/config";
import type {
  PublicationWithPosts,
  XOptimizationDimension,
  XOptimizationRepository,
  XPublicationRepository,
  XStrategyConfidenceLevel,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import {
  computeOptimizationScore,
  ratesFromSnapshot,
  stableSegmentKey,
  XContentFeatureExtractor,
  type XContentFeatures,
  OPTIMIZATION_METRICS_VERSION,
} from "./feature-extractor.js";

export interface OptimizationRunResult {
  runId: string;
  status: string;
  analyzedPublicationCount: number;
  findingCount: number;
  generatedRecommendationCount: number;
  errorCount: number;
}

type SampleRow = {
  publication: PublicationWithPosts;
  features: XContentFeatures;
  score: number | null;
  rates: ReturnType<typeof ratesFromSnapshot>;
  missingRate: number;
};

const AUTO_DIMENSIONS: XOptimizationDimension[] = [
  "CONTENT_ANGLE",
  "POST_FORMAT",
  "POSTING_TIME",
  "HASHTAG_SET",
  "RELATED_POST_USAGE",
  "INFORMATION_DENSITY",
];

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function variantOf(features: XContentFeatures, dimension: XOptimizationDimension): string {
  switch (dimension) {
    case "CONTENT_ANGLE":
      return features.contentAngle;
    case "POST_FORMAT":
      return features.strategyType;
    case "POSTING_TIME":
      return features.postingTimeBucket ?? "UNKNOWN";
    case "HASHTAG_SET":
      return features.hashtagSet;
    case "URL_PLACEMENT":
      return features.urlPlacement;
    case "DISCLOSURE_PLACEMENT":
      return features.disclosurePlacement;
    case "CTA_STYLE":
      return features.ctaStyle;
    case "RELATED_POST_USAGE":
      return features.hasRelatedPostLink ? "WITH_RELATED" : "WITHOUT_RELATED";
    case "INFORMATION_DENSITY":
      return features.informationDensity;
    case "TITLE_LENGTH":
      if ((features.titleWeightedLength ?? 0) < 40) return "SHORT";
      if ((features.titleWeightedLength ?? 0) < 80) return "MEDIUM";
      return "LONG";
    default:
      return "UNKNOWN";
  }
}

function confidenceOf(
  nA: number,
  nB: number,
  min: number,
): XStrategyConfidenceLevel {
  const n = Math.min(nA, nB);
  if (n < min) return "INSUFFICIENT";
  if (n < min * 1.5) return "LOW";
  if (n < min * 2) return "MEDIUM";
  return "HIGH";
}

export interface XOptimizationEngineDeps {
  logger: Logger;
  config: AppConfig;
  publications: XPublicationRepository;
  optimization: XOptimizationRepository;
  now?: () => Date;
  loadPublicationContext?: (publication: PublicationWithPosts) => Promise<{
    title?: string | null;
    candidateType?: string | null;
    productScore?: number | null;
    price?: number | null;
    reviewCount?: number | null;
    inputSnapshot?: Record<string, unknown> | null;
  }>;
  notifications?: {
    emitXEvent?: (
      eventType:
        | "X_OPTIMIZATION_RECOMMENDATION_CREATED"
        | "X_OPTIMIZATION_VALIDATION_FAILED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export class XOptimizationEngine {
  private readonly now: () => Date;
  private readonly extractor: XContentFeatureExtractor;

  constructor(private readonly deps: XOptimizationEngineDeps) {
    this.now = deps.now ?? (() => new Date());
    this.extractor = new XContentFeatureExtractor(deps.config);
  }

  async run(options?: {
    windowHours?: number;
    lookbackDays?: number;
    mode?: AppConfig["xOptimizationMode"];
  }): Promise<OptimizationRunResult> {
    const windowHours =
      options?.windowHours ?? this.deps.config.xOptimizationEvaluationWindowHours;
    const lookbackDays =
      options?.lookbackDays ?? this.deps.config.xOptimizationLookbackDays;
    const mode = options?.mode ?? this.deps.config.xOptimizationMode;
    const minSample = this.deps.config.xOptimizationMinSampleSize;
    const minImprove = this.deps.config.xOptimizationMinScoreImprovement;
    const maxMissing = this.deps.config.xOptimizationMaxMissingRate;

    await this.deps.optimization.expireDueRecommendations(this.now());

    const run = await this.deps.optimization.createRun({
      evaluationWindowHours: windowHours,
      parameters: {
        lookbackDays,
        mode,
        minSample,
        minImprove,
        maxMissing,
        metricVersion: OPTIMIZATION_METRICS_VERSION,
      },
    });
    await this.deps.optimization.startRun(run.id);

    let analyzed = 0;
    let findingCount = 0;
    let recommendationCount = 0;
    let errorCount = 0;

    try {
      const since = new Date(this.now().getTime() - lookbackDays * 24 * 60 * 60 * 1000);
      const publications = await this.deps.publications.listPublishedWithPosts({
        since,
        limit: 500,
      });
      const snapshots = await this.deps.publications.listMetricSnapshots({ limit: 5000 });
      const snapByPub = new Map<string, typeof snapshots>();
      for (const snap of snapshots) {
        const list = snapByPub.get(snap.publicationId) ?? [];
        list.push(snap);
        snapByPub.set(snap.publicationId, list);
      }

      const samples: SampleRow[] = [];
      for (const publication of publications) {
        try {
          const ctx =
            (await this.deps.loadPublicationContext?.(publication)) ?? {};
          const features = this.extractor.extract({
            publication,
            title: ctx.title,
            candidateType: ctx.candidateType,
            productScore: ctx.productScore,
            price: ctx.price,
            reviewCount: ctx.reviewCount,
            inputSnapshot: ctx.inputSnapshot,
          });
          await this.deps.optimization.upsertContentVariant({
            publicationId: publication.id,
            generatedContentId: publication.generatedContentId,
            contentAngle: features.contentAngle,
            postFormat: features.strategyType,
            postingTimeBucket: features.postingTimeBucket,
            weekday: features.weekday,
            hashtagSet: features.hashtagSet,
            urlPlacement: features.urlPlacement,
            disclosurePlacement: features.disclosurePlacement,
            ctaStyle: features.ctaStyle,
            informationDensity: features.informationDensity,
            titleWeightedLength: features.titleWeightedLength,
            bodyWeightedLength: features.totalWeightedLength,
            featureSnapshot: this.extractor.featureSnapshot(features),
          });

          const snaps = (snapByPub.get(publication.id) ?? []).sort(
            (a, b) => b.measuredAt.getTime() - a.measuredAt.getTime(),
          );
          const root = publication.posts.find((p) => p.sequence === 1);
          const snap =
            snaps.find((s) => s.publicationPostId === root?.id) ?? snaps[0];
          if (!snap) {
            analyzed += 1;
            continue;
          }
          const rates = ratesFromSnapshot(snap);
          const scored = computeOptimizationScore(rates, this.deps.config.xOptimizationScoreWeights);
          const missingRate = scored.missing.length / 6;
          samples.push({
            publication,
            features,
            score: scored.score,
            rates,
            missingRate,
          });
          analyzed += 1;
        } catch (error) {
          errorCount += 1;
          this.deps.logger.warn(`optimization sample failed: ${String(error)}`);
        }
      }

      for (const dimension of AUTO_DIMENSIONS) {
        const segmentPlans: Array<Record<string, string | null | undefined>> = [
          {},
          // candidateType segments added dynamically below
        ];

        const candidateTypes = [
          ...new Set(samples.map((s) => s.features.candidateType).filter(Boolean)),
        ] as string[];
        for (const ct of candidateTypes) {
          segmentPlans.push({ candidateType: ct });
          const buckets = [
            ...new Set(
              samples
                .filter((s) => s.features.candidateType === ct)
                .map((s) => s.features.postingTimeBucket)
                .filter(Boolean),
            ),
          ] as string[];
          for (const bucket of buckets) {
            segmentPlans.push({ candidateType: ct, postingTimeBucket: bucket });
          }
        }

        for (const plan of segmentPlans) {
          const filtered = samples.filter((s) => {
            if (plan.candidateType && s.features.candidateType !== plan.candidateType) {
              return false;
            }
            if (
              plan.postingTimeBucket &&
              s.features.postingTimeBucket !== plan.postingTimeBucket
            ) {
              return false;
            }
            return true;
          });

          // Fallback if too fine: skip empty
          if (filtered.length === 0) continue;

          const byVariant = new Map<string, SampleRow[]>();
          for (const row of filtered) {
            const key = variantOf(row.features, dimension);
            const list = byVariant.get(key) ?? [];
            list.push(row);
            byVariant.set(key, list);
          }
          const variants = [...byVariant.keys()].sort();
          if (variants.length < 2) continue;

          // Compare top two by sample size then score
          const ranked = variants
            .map((v) => {
              const rows = byVariant.get(v)!;
              const scores = rows
                .map((r) => r.score)
                .filter((n): n is number => n != null);
              return {
                variant: v,
                rows,
                sampleCount: rows.length,
                avgScore: average(scores),
                missingRate: average(rows.map((r) => r.missingRate)) ?? 1,
              };
            })
            .sort((a, b) => b.sampleCount - a.sampleCount || (b.avgScore ?? 0) - (a.avgScore ?? 0));

          for (let i = 0; i < ranked.length; i += 1) {
            for (let j = i + 1; j < ranked.length; j += 1) {
              const left = ranked[i]!;
              const right = ranked[j]!;
              const better =
                (left.avgScore ?? -Infinity) >= (right.avgScore ?? -Infinity) ? left : right;
              const worse = better === left ? right : left;
              const conf = confidenceOf(worse.sampleCount, better.sampleCount, minSample);
              const diff =
                worse.avgScore != null && better.avgScore != null
                  ? better.avgScore - worse.avgScore
                  : null;
              const limitations: string[] = [];
              if (plan.postingTimeBucket && worse.sampleCount + better.sampleCount < minSample) {
                limitations.push("narrow-segment-fallback-candidate");
              }
              if ((worse.missingRate + better.missingRate) / 2 > maxMissing) {
                limitations.push("high-missing-rate");
              }

              let findingType:
                | "POSITIVE"
                | "NEGATIVE"
                | "NEUTRAL"
                | "INSUFFICIENT_DATA"
                | "CONFLICTING" = "NEUTRAL";
              if (conf === "INSUFFICIENT") findingType = "INSUFFICIENT_DATA";
              else if (diff != null && Math.abs(diff) < minImprove * 100) findingType = "NEUTRAL";
              else if (diff != null && diff > 0) findingType = "POSITIVE";
              else if (diff != null && diff < 0) findingType = "NEGATIVE";

              const segmentKey = stableSegmentKey({
                dimension,
                ...plan,
                a: worse.variant,
                b: better.variant,
              });

              const finding = await this.deps.optimization.createFinding({
                optimizationRunId: run.id,
                dimension,
                segmentKey,
                currentVariant: worse.variant,
                comparedVariant: better.variant,
                currentSampleCount: worse.sampleCount,
                comparedSampleCount: better.sampleCount,
                currentScore: worse.avgScore,
                comparedScore: better.avgScore,
                scoreDifference: diff,
                confidenceLevel: conf,
                supportingMetrics: {
                  currentMissingRate: worse.missingRate,
                  comparedMissingRate: better.missingRate,
                },
                dataLimitations: { notes: limitations },
                findingType,
                statisticalResult: {
                  note: "observational comparison — not causal",
                },
              });
              findingCount += 1;

              const canRecommend =
                mode !== "OBSERVE_ONLY" &&
                conf !== "INSUFFICIENT" &&
                findingType === "POSITIVE" &&
                diff != null &&
                diff >= minImprove * 100 &&
                (worse.missingRate + better.missingRate) / 2 <= maxMissing;

              if (canRecommend) {
                const active = await this.deps.optimization.countActiveRecommendations();
                if (active >= this.deps.config.xOptimizationMaxActiveRecommendations) {
                  continue;
                }
                const expiresAt = new Date(
                  this.now().getTime() +
                    this.deps.config.xOptimizationRecommendationTtlDays *
                      24 *
                      60 *
                      60 *
                      1000,
                );
                const rationale = [
                  `現時点のデータでは、dimension=${dimension} において`,
                  `「${worse.variant}」より「${better.variant}」の総合scoreが高い関連が見られます`,
                  `(n=${worse.sampleCount}/${better.sampleCount}, Δscore=${diff.toFixed(2)}, confidence=${conf})。`,
                  `因果関係は断定できません。比較条件: segment=${JSON.stringify(plan)}。`,
                  limitations.length > 0 ? `制約: ${limitations.join(", ")}` : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                const rec = await this.deps.optimization.createRecommendation({
                  optimizationRunId: run.id,
                  findingId: finding.id,
                  dimension,
                  currentValue: worse.variant,
                  recommendedValue: better.variant,
                  rationale,
                  expectedImpact: { scoreDifference: diff },
                  confidenceLevel: conf,
                  requiredSampleSize: minSample,
                  expiresAt,
                  priority: conf === "HIGH" ? "HIGH" : conf === "MEDIUM" ? "MEDIUM" : "LOW",
                });
                recommendationCount += 1;
                await this.deps.notifications?.emitXEvent?.(
                  "X_OPTIMIZATION_RECOMMENDATION_CREATED",
                  { recommendationId: rec.id, dimension },
                );
              }
            }
          }
        }
      }

      const completed = await this.deps.optimization.completeRun(run.id, {
        analyzedPublicationCount: analyzed,
        generatedRecommendationCount: recommendationCount,
        errorCount,
        status: errorCount > 0 && recommendationCount === 0 ? "PARTIALLY_COMPLETED" : "COMPLETED",
      });

      return {
        runId: completed.id,
        status: completed.status,
        analyzedPublicationCount: analyzed,
        findingCount,
        generatedRecommendationCount: recommendationCount,
        errorCount,
      };
    } catch (error) {
      await this.deps.optimization.completeRun(run.id, {
        analyzedPublicationCount: analyzed,
        generatedRecommendationCount: recommendationCount,
        errorCount: errorCount + 1,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
