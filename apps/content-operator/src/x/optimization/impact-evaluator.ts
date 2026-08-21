import type { AppConfig } from "@ai-affiliate/config";
import type {
  XOptimizationRecommendation,
  XOptimizationRepository,
  XPublicationRepository,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import {
  computeOptimizationScore,
  ratesFromSnapshot,
} from "./feature-extractor.js";

export type ImpactResultLabel =
  | "IMPROVED"
  | "DECLINED"
  | "NO_CLEAR_DIFFERENCE"
  | "INSUFFICIENT_DATA";

export interface ImpactEvaluationResult {
  recommendationId: string;
  label: ImpactResultLabel;
  controlSampleCount: number;
  variantSampleCount: number;
  controlScore: number | null;
  variantScore: number | null;
  scoreDifference: number | null;
  metricDeltas: Record<string, number | null>;
  missingRate: number;
  confidence: "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH";
  dataLimitations: string[];
  permanentAdoptionCandidate: boolean;
  stopped: boolean;
}

export interface XOptimizationImpactEvaluatorDeps {
  logger: Logger;
  config: AppConfig;
  publications: XPublicationRepository;
  optimization: XOptimizationRepository;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_OPTIMIZATION_IMPROVED" | "X_OPTIMIZATION_DECLINED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function winsorize(values: number[], p = 0.05): number[] {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * p)]!;
  const hi = sorted[Math.ceil(sorted.length * (1 - p)) - 1]!;
  return values.map((v) => Math.min(hi, Math.max(lo, v)));
}

export class XOptimizationImpactEvaluator {
  private readonly now: () => Date;

  constructor(private readonly deps: XOptimizationImpactEvaluatorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async evaluate(recommendationId: string): Promise<ImpactEvaluationResult> {
    const rec = await this.deps.optimization.findRecommendationById(recommendationId);
    if (!rec) {
      throw new Error(`recommendation not found: ${recommendationId}`);
    }

    const applications = await this.deps.optimization.listApplications({
      recommendationId,
      limit: 50,
    });
    const experimentIds = [
      ...new Set(applications.map((a) => a.experimentId).filter(Boolean)),
    ] as string[];

    const publications = await this.deps.publications.listPublishedWithPosts({
      limit: 500,
    });
    const snapshots = await this.deps.publications.listMetricSnapshots({ limit: 5000 });
    const snapByPub = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      const list = snapByPub.get(snap.publicationId) ?? [];
      list.push(snap);
      snapByPub.set(snap.publicationId, list);
    }

    const controlScores: number[] = [];
    const variantScores: number[] = [];
    const controlRates: Array<ReturnType<typeof ratesFromSnapshot>> = [];
    const variantRates: Array<ReturnType<typeof ratesFromSnapshot>> = [];
    const limitations: string[] = [];

    for (const pub of publications) {
      const group = (pub.experimentGroup ?? "").toUpperCase();
      const snaps = snapByPub.get(pub.id) ?? [];
      const snap = snaps.sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())[0];
      if (!snap) continue;
      const rates = ratesFromSnapshot(snap);
      const scored = computeOptimizationScore(
        rates,
        this.deps.config.xOptimizationScoreWeights,
      );
      if (scored.score == null) continue;

      const linkedAsTarget = applications.some((a) => a.targetPublicationId === pub.id);
      const isVariant = group === "VARIANT" || linkedAsTarget;
      const isControl = group === "CONTROL";

      if (experimentIds.length > 0 && !isVariant && !isControl) {
        continue;
      }

      if (isVariant) {
        variantScores.push(scored.score);
        variantRates.push(rates);
      } else if (isControl || experimentIds.length === 0) {
        if (applications.length === 0 || isControl) {
          controlScores.push(scored.score);
          controlRates.push(rates);
        }
      }
    }

    // Synthetic path for tests: use application.result if samples empty
    if (controlScores.length === 0 && variantScores.length === 0) {
      for (const app of applications) {
        const result = app.result as
          | {
              controlScores?: number[];
              variantScores?: number[];
              controlSampleCount?: number;
              variantSampleCount?: number;
            }
          | null;
        if (result?.controlScores) controlScores.push(...result.controlScores);
        if (result?.variantScores) variantScores.push(...result.variantScores);
      }
    }

    const minSample = this.deps.config.xOptimizationMinSampleSize;
    const cN = controlScores.length;
    const vN = variantScores.length;
    const conf =
      Math.min(cN, vN) < minSample
        ? "INSUFFICIENT"
        : Math.min(cN, vN) < minSample * 1.5
          ? "LOW"
          : Math.min(cN, vN) < minSample * 2
            ? "MEDIUM"
            : "HIGH";

    const controlScore = average(winsorize(controlScores));
    const variantScore = average(winsorize(variantScores));
    const scoreDifference =
      controlScore != null && variantScore != null ? variantScore - controlScore : null;

    const metricDeltas: Record<string, number | null> = {
      urlClickRate: deltaAvg(controlRates, variantRates, "urlClickRate"),
      engagementRate: deltaAvg(controlRates, variantRates, "engagementRate"),
      impressionCount: deltaAvg(controlRates, variantRates, "impressionCount"),
      profileClickRate: deltaAvg(controlRates, variantRates, "profileClickRate"),
      bookmarkRate: deltaAvg(controlRates, variantRates, "bookmarkRate"),
      repostRate: deltaAvg(controlRates, variantRates, "repostRate"),
    };

    const missingBits = [
      ...controlRates.flatMap((r) =>
        Object.entries(r)
          .filter(([, v]) => v == null)
          .map(([k]) => k),
      ),
      ...variantRates.flatMap((r) =>
        Object.entries(r)
          .filter(([, v]) => v == null)
          .map(([k]) => k),
      ),
    ];
    const missingRate =
      controlRates.length + variantRates.length === 0
        ? 1
        : missingBits.length /
          ((controlRates.length + variantRates.length) * 7);

    let label: ImpactResultLabel = "NO_CLEAR_DIFFERENCE";
    if (conf === "INSUFFICIENT") {
      label = "INSUFFICIENT_DATA";
      limitations.push("below-min-sample");
    } else if (
      scoreDifference != null &&
      scoreDifference >= this.deps.config.xOptimizationMinScoreImprovement * 100
    ) {
      label = "IMPROVED";
    } else if (
      scoreDifference != null &&
      scoreDifference <= this.deps.config.xOptimizationDeclineStopThreshold * 100
    ) {
      label = "DECLINED";
    } else {
      label = "NO_CLEAR_DIFFERENCE";
    }

    let stopped = false;
    if (label === "DECLINED") {
      stopped = true;
      await this.stopRecommendation(rec);
      await this.deps.notifications?.emitXEvent?.("X_OPTIMIZATION_DECLINED", {
        recommendationId: rec.id,
        scoreDifference,
      });
    } else if (label === "IMPROVED") {
      await this.deps.notifications?.emitXEvent?.("X_OPTIMIZATION_IMPROVED", {
        recommendationId: rec.id,
        scoreDifference,
      });
    }

    const priorApps = applications.filter((a) => a.status === "COMPLETED");
    const fixtureExperimentCount = applications.reduce((max, a) => {
      const result = a.result as { experimentCount?: number } | null;
      return Math.max(max, result?.experimentCount ?? 0);
    }, 0);
    const experimentCount = Math.max(
      experimentIds.length,
      priorApps.length + (applications.length > 0 ? 1 : 0),
      fixtureExperimentCount,
    );
    const totalSamples = cN + vN;
    const permanentAdoptionCandidate =
      label === "IMPROVED" &&
      experimentCount >= 2 &&
      totalSamples >= minSample * 2 &&
      scoreDifference != null &&
      scoreDifference > 0;

    if (!permanentAdoptionCandidate && label === "IMPROVED") {
      limitations.push("single-experiment-not-permanent");
    }

    for (const app of applications) {
      if (app.status === "EVALUATING" || app.status === "APPLIED") {
        await this.deps.optimization.updateApplication(app.id, {
          status: "COMPLETED",
          result: {
            ...(typeof app.result === "object" && app.result ? app.result : {}),
            impact: {
              label,
              controlSampleCount: cN,
              variantSampleCount: vN,
              scoreDifference,
              permanentAdoptionCandidate,
              evaluatedAt: this.now().toISOString(),
            },
          },
        });
      }
    }

    return {
      recommendationId: rec.id,
      label,
      controlSampleCount: cN,
      variantSampleCount: vN,
      controlScore,
      variantScore,
      scoreDifference,
      metricDeltas,
      missingRate,
      confidence: conf,
      dataLimitations: limitations,
      permanentAdoptionCandidate,
      stopped,
    };
  }

  /** Evaluate using explicit sample arrays (tests / CLI fixtures). */
  async evaluateWithSamples(options: {
    recommendationId: string;
    controlScores: number[];
    variantScores: number[];
    experimentCount?: number;
  }): Promise<ImpactEvaluationResult> {
    const apps = await this.deps.optimization.listApplications({
      recommendationId: options.recommendationId,
      limit: 1,
    });
    if (apps[0]) {
      await this.deps.optimization.updateApplication(apps[0].id, {
        status: "EVALUATING",
        result: {
          controlScores: options.controlScores,
          variantScores: options.variantScores,
          experimentCount: options.experimentCount ?? 1,
        },
      });
    } else {
      await this.deps.optimization.createApplication({
        recommendationId: options.recommendationId,
        appliedValue: "fixture",
        status: "EVALUATING",
        result: {
          controlScores: options.controlScores,
          variantScores: options.variantScores,
          experimentCount: options.experimentCount ?? 1,
        },
      });
    }
    return this.evaluate(options.recommendationId);
  }

  private async stopRecommendation(rec: XOptimizationRecommendation): Promise<void> {
    if (rec.status === "APPROVED" || rec.status === "APPLIED") {
      await this.deps.optimization.expireRecommendation(rec.id);
    }
    const apps = await this.deps.optimization.listApplications({
      recommendationId: rec.id,
      limit: 20,
    });
    for (const app of apps) {
      if (app.experimentId) {
        await this.deps.publications.updateExperimentStatus(app.experimentId, "PAUSED", {
          endedAt: this.now(),
          result: { stopReason: "DECLINE_STOP_THRESHOLD" },
        });
      }
      if (app.status === "EVALUATING" || app.status === "APPLIED") {
        await this.deps.optimization.updateApplication(app.id, { status: "CANCELLED" });
      }
    }
  }
}

function deltaAvg(
  control: Array<ReturnType<typeof ratesFromSnapshot>>,
  variant: Array<ReturnType<typeof ratesFromSnapshot>>,
  key: keyof ReturnType<typeof ratesFromSnapshot>,
): number | null {
  const c = average(
    control.map((r) => r[key]).filter((n): n is number => n != null),
  );
  const v = average(
    variant.map((r) => r[key]).filter((n): n is number => n != null),
  );
  if (c == null || v == null) return null;
  return v - c;
}
