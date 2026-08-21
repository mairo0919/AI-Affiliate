import { createHash } from "node:crypto";
import type { AppConfig } from "@ai-affiliate/config";
import type {
  ContentRepository,
  GeneratedContent,
  XOptimizationDimension,
  XOptimizationRecommendation,
  XOptimizationRepository,
  XPublicationRepository,
  XPublicationStrategyType,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { ContentEngine } from "../../content/content-engine.js";
import { hashNormalizedContent } from "../../content/normalize.js";
import type { StructuredContentOutput } from "../../content/types.js";
import { XPublicationBuilder } from "../publication-builder.js";
import { postingTimeBucket, tokyoParts } from "./feature-extractor.js";
import { XOptimizationValidator } from "./optimization-validator.js";

export interface OptimizeApplyResult {
  applicationId: string;
  generatedContentId: string | null;
  experimentId: string | null;
  dimension: XOptimizationDimension;
  changedDimensions: XOptimizationDimension[];
  diff: Record<string, { before: string | null; after: string | null }>;
  recommendationId: string;
  status: string;
  validationFailed?: boolean;
  issues?: Array<{ code: string; message: string }>;
  parentContentId: string;
  version: number | null;
}

export interface XContentOptimizerDeps {
  logger: Logger;
  config: AppConfig;
  contents: ContentRepository;
  publications: XPublicationRepository;
  optimization: XOptimizationRepository;
  contentEngine: ContentEngine;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType:
        | "X_OPTIMIZATION_EXPERIMENT_STARTED"
        | "X_OPTIMIZATION_VALIDATION_FAILED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

function asOutput(row: GeneratedContent): StructuredContentOutput {
  const hashtags = Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [];
  return {
    title: row.title,
    body: row.body,
    summary: row.summary ?? undefined,
    hashtags,
    callToAction: row.callToAction ?? undefined,
  };
}

function extractNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? [])
    .map((m) => Number.parseFloat(m))
    .filter((n) => Number.isFinite(n));
}

function combinedText(output: StructuredContentOutput): string {
  return [output.title, output.body, output.summary, ...(output.hashtags ?? [])]
    .filter(Boolean)
    .join("\n");
}

function parseStrategy(value: string): XPublicationStrategyType | null {
  const v = value.toUpperCase();
  if (
    v === "SINGLE_POST" ||
    v === "ROOT_WITH_REPLY" ||
    v === "RELATED_POST_LINK" ||
    v === "CONTROL"
  ) {
    return v;
  }
  return null;
}

function bucketToHour(bucket: string): number {
  const start = bucket.split("-")[0]?.split(":")[0];
  const h = Number.parseInt(start ?? "21", 10);
  return Number.isFinite(h) ? h : 21;
}

function nextTokyoScheduledAt(now: Date, bucket: string): Date {
  const hour = bucketToHour(bucket);
  const candidate = new Date(now.getTime());
  for (let i = 1; i <= 48; i += 1) {
    candidate.setTime(now.getTime() + i * 60 * 60 * 1000);
    const parts = tokyoParts(candidate);
    if (postingTimeBucket(parts.hour) === bucket || parts.hour === hour) {
      return candidate;
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export class XContentOptimizer {
  private readonly now: () => Date;
  private readonly validator: XOptimizationValidator;
  private readonly builder: XPublicationBuilder;

  constructor(private readonly deps: XContentOptimizerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.validator = new XOptimizationValidator(deps.config);
    this.builder = new XPublicationBuilder(deps.config);
  }

  async apply(options: {
    recommendationId: string;
    contentId: string;
    sourcePublicationId?: string;
    createExperiment?: boolean;
    allowUnapproved?: boolean;
  }): Promise<OptimizeApplyResult> {
    const rec = await this.deps.optimization.findRecommendationById(options.recommendationId);
    if (!rec) {
      throw new Error(`recommendation not found: ${options.recommendationId}`);
    }
    if (rec.status !== "APPROVED" && !options.allowUnapproved) {
      throw new Error(`recommendation is not APPROVED (status=${rec.status})`);
    }
    if (rec.expiresAt && rec.expiresAt.getTime() < this.now().getTime()) {
      throw new Error("recommendation expired");
    }

    const recent = await this.deps.optimization.hasRecentApplication(rec.id, 7);
    if (recent) {
      throw new Error("recommendation was recently applied; re-apply blocked");
    }

    if (options.createExperiment !== false) {
      const concurrent = await this.deps.optimization.countActiveExperimentsForDimension(
        rec.dimension,
      );
      if (concurrent >= this.deps.config.xOptimizationMaxConcurrentExperimentsPerDimension) {
        throw new Error(`concurrent experiment limit for dimension ${rec.dimension}`);
      }
    }

    const parent = await this.deps.contents.findGeneratedContentById(options.contentId);
    if (!parent) {
      throw new Error(`content not found: ${options.contentId}`);
    }

    const application = await this.deps.optimization.createApplication({
      recommendationId: rec.id,
      sourcePublicationId: options.sourcePublicationId ?? null,
      generatedContentId: parent.id,
      appliedValue: rec.recommendedValue,
      status: "PREPARED",
    });

    try {
      return await this.applyDimension(rec, parent, application.id, options);
    } catch (error) {
      await this.deps.optimization.updateApplication(application.id, {
        status: "FAILED",
        result: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  private async applyDimension(
    rec: XOptimizationRecommendation,
    parent: GeneratedContent,
    applicationId: string,
    options: { createExperiment?: boolean },
  ): Promise<OptimizeApplyResult> {
    const parentOut = asOutput(parent);
    const snapshot =
      parent.inputSnapshot && typeof parent.inputSnapshot === "object"
        ? (parent.inputSnapshot as Record<string, unknown>)
        : {};
    const affiliateUrl = parent.affiliateUrl;
    const disclosure = this.deps.config.xAffiliateDisclosure;
    const tags = snapshot.tags as
      | { actress?: string[]; genre?: string[] }
      | undefined;
    const knownNames = [
      parent.title,
      ...(tags?.actress ?? []),
      ...(tags?.genre ?? []),
    ].filter(Boolean);

    let nextContent: GeneratedContent = parent;
    let scheduledAt: Date | null = null;
    let experimentId: string | null = null;
    let postFormatChanged = false;
    let hashtagsOnlyChanged = false;
    const diff: OptimizeApplyResult["diff"] = {};
    const salt = createHash("sha256")
      .update(`${rec.id}:${this.now().toISOString()}`)
      .digest("hex")
      .slice(0, 12);

    switch (rec.dimension) {
      case "POSTING_TIME": {
        scheduledAt = nextTokyoScheduledAt(this.now(), rec.recommendedValue);
        nextContent = await this.deps.contents.createContentVersion(parent.id, {
          contentCandidateId: parent.contentCandidateId,
          researchItemId: parent.researchItemId,
          contentType: parent.contentType,
          targetChannel: parent.targetChannel,
          title: parent.title,
          body: parent.body,
          summary: parent.summary,
          hashtags: Array.isArray(parent.hashtags) ? (parent.hashtags as string[]) : [],
          callToAction: parent.callToAction,
          affiliateUrl: parent.affiliateUrl,
          status: "REVIEW_REQUIRED",
          generationProvider: parent.generationProvider,
          generationModel: parent.generationModel,
          promptVersion: parent.promptVersion,
          contentHash: hashNormalizedContent(`${parent.body}|opt-time|${salt}`),
          generatedAt: this.now(),
          inputSnapshot: {
            ...snapshot,
            optimization: {
              recommendationId: rec.id,
              dimension: rec.dimension,
              scheduledAt: scheduledAt.toISOString(),
            },
          },
          validationResult: {
            scheduledAtHint: scheduledAt.toISOString(),
            appliedRecommendationId: rec.id,
          },
        });
        diff.postingTime = { before: rec.currentValue, after: rec.recommendedValue };
        break;
      }
      case "HASHTAG_SET": {
        const nextTags = this.resolveHashtagSet(rec.recommendedValue, snapshot);
        hashtagsOnlyChanged = true;
        const bodyWithoutTrailingTags = parent.body.replace(
          /(\s#[\w\u3040-\u30ff\u3400-\u9fff]+)+\s*$/u,
          "",
        );
        const tagLine = nextTags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
        const body =
          nextTags.length > 0
            ? `${bodyWithoutTrailingTags.trim()} ${tagLine}`.trim()
            : bodyWithoutTrailingTags.trim();
        nextContent = await this.deps.contents.createContentVersion(parent.id, {
          contentCandidateId: parent.contentCandidateId,
          researchItemId: parent.researchItemId,
          contentType: parent.contentType,
          targetChannel: parent.targetChannel,
          title: parent.title,
          body,
          summary: parent.summary,
          hashtags: nextTags,
          callToAction: parent.callToAction,
          affiliateUrl: parent.affiliateUrl,
          status: "REVIEW_REQUIRED",
          generationProvider: parent.generationProvider,
          generationModel: parent.generationModel,
          promptVersion: parent.promptVersion,
          contentHash: hashNormalizedContent(`${body}|${salt}`),
          generatedAt: this.now(),
          inputSnapshot: {
            ...snapshot,
            optimization: { recommendationId: rec.id, dimension: rec.dimension },
          },
          validationResult: {
            appliedRecommendationId: rec.id,
            hashtagSet: rec.recommendedValue,
          },
        });
        diff.hashtagSet = { before: rec.currentValue, after: rec.recommendedValue };
        break;
      }
      case "POST_FORMAT": {
        const strategy = parseStrategy(rec.recommendedValue) ?? "SINGLE_POST";
        const built = this.builder.build(strategy, {
          title: parent.title,
          affiliateUrl,
          hashtags: Array.isArray(parent.hashtags) ? (parent.hashtags as string[]) : [],
          summary: parent.summary,
          callToAction: parent.callToAction,
          facts: [parent.summary ?? ""].filter(Boolean),
        });
        postFormatChanged = true;
        const body = built.posts.map((p) => p.body).join("\n---\n");
        nextContent = await this.deps.contents.createContentVersion(parent.id, {
          contentCandidateId: parent.contentCandidateId,
          researchItemId: parent.researchItemId,
          contentType: parent.contentType,
          targetChannel: parent.targetChannel,
          title: parent.title,
          body,
          summary: parent.summary,
          hashtags: Array.isArray(parent.hashtags) ? (parent.hashtags as string[]) : [],
          callToAction: parent.callToAction,
          affiliateUrl: parent.affiliateUrl,
          status: "REVIEW_REQUIRED",
          generationProvider: parent.generationProvider,
          generationModel: parent.generationModel,
          promptVersion: parent.promptVersion,
          contentHash: hashNormalizedContent(`${body}|${salt}`),
          generatedAt: this.now(),
          inputSnapshot: {
            ...snapshot,
            optimization: {
              recommendationId: rec.id,
              dimension: rec.dimension,
              strategyType: strategy,
            },
          },
          validationResult: {
            appliedRecommendationId: rec.id,
            strategyType: strategy,
            postCount: built.posts.length,
          },
        });
        diff.postFormat = { before: rec.currentValue, after: strategy };
        break;
      }
      case "CONTENT_ANGLE":
      default: {
        const instruction = [
          `OPTIMIZATION_DIMENSION=${rec.dimension}`,
          `CHANGE_ONLY=${rec.dimension}`,
          `FROM=${rec.currentValue}`,
          `TO=${rec.recommendedValue}`,
          "DO_NOT_CHANGE: affiliateUrl, numeric facts, product title entities, disclosure",
          "DO_NOT_ADD: unverified facts",
          `rationale: ${rec.rationale.slice(0, 200)}`,
        ].join("; ");
        const regenerated = await this.deps.contentEngine.regenerate({
          contentId: parent.id,
          instruction,
        });
        const newId = regenerated.items[0]?.contentId;
        if (!newId) {
          throw new Error("content regeneration failed");
        }
        const loaded = await this.deps.contents.findGeneratedContentById(newId);
        if (!loaded) {
          throw new Error("generated content missing after regenerate");
        }
        nextContent = loaded;
        diff[rec.dimension.toLowerCase()] = {
          before: rec.currentValue,
          after: rec.recommendedValue,
        };
        break;
      }
    }

    const nextOut = asOutput(nextContent);
    const validation = this.validator.validate({
      dimension: rec.dimension,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      affiliateUrl,
      disclosure,
      parent: parentOut,
      next: nextOut,
      parentNumbers: extractNumbers(combinedText(parentOut)),
      knownNames,
      scheduledAtChanged: scheduledAt != null,
      postFormatChanged,
      hashtagsOnlyChanged,
    });

    if (!validation.ok) {
      await this.deps.contents.updateGeneratedContentStatus(nextContent.id, "VALIDATION_FAILED", {
        validationResult: { issues: validation.issues },
      });
      await this.deps.optimization.updateApplication(applicationId, {
        status: "FAILED",
        generatedContentId: nextContent.id,
        result: { issues: validation.issues, validationFailed: true },
      });
      await this.deps.notifications?.emitXEvent?.("X_OPTIMIZATION_VALIDATION_FAILED", {
        recommendationId: rec.id,
        contentId: nextContent.id,
      });
      return {
        applicationId,
        generatedContentId: nextContent.id,
        experimentId: null,
        dimension: rec.dimension,
        changedDimensions: [rec.dimension],
        diff,
        recommendationId: rec.id,
        status: "FAILED",
        validationFailed: true,
        issues: validation.issues,
        parentContentId: parent.id,
        version: nextContent.version,
      };
    }

    await this.deps.optimization.upsertContentVariant({
      generatedContentId: nextContent.id,
      contentAngle: rec.dimension === "CONTENT_ANGLE" ? rec.recommendedValue : null,
      postFormat: rec.dimension === "POST_FORMAT" ? rec.recommendedValue : null,
      postingTimeBucket: rec.dimension === "POSTING_TIME" ? rec.recommendedValue : null,
      hashtagSet: rec.dimension === "HASHTAG_SET" ? rec.recommendedValue : null,
      featureSnapshot: {
        recommendationId: rec.id,
        dimension: rec.dimension,
        appliedValue: rec.recommendedValue,
        scheduledAt: scheduledAt?.toISOString() ?? null,
        parentContentId: parent.id,
        version: nextContent.version,
      },
    });

    if (options.createExperiment !== false) {
      experimentId = await this.createExperimentPair(rec, nextContent.id);
    }

    await this.deps.optimization.updateApplication(applicationId, {
      status: experimentId ? "EVALUATING" : "APPLIED",
      generatedContentId: nextContent.id,
      experimentId,
      result: {
        diff,
        scheduledAt: scheduledAt?.toISOString() ?? null,
        parentContentId: parent.id,
        version: nextContent.version,
      },
    });
    await this.deps.optimization.markRecommendationApplied(rec.id);

    return {
      applicationId,
      generatedContentId: nextContent.id,
      experimentId,
      dimension: rec.dimension,
      changedDimensions: [rec.dimension],
      diff,
      recommendationId: rec.id,
      status: experimentId ? "EVALUATING" : "APPLIED",
      parentContentId: parent.id,
      version: nextContent.version,
    };
  }

  private resolveHashtagSet(
    value: string,
    snapshot: Record<string, unknown>,
  ): string[] {
    const tags = snapshot.tags as
      | { actress?: string[]; genre?: string[] }
      | undefined;
    switch (value) {
      case "NONE":
      case "PR_ONLY_IN_DISCLOSURE":
        return [];
      case "PR_PLUS_FANZA":
        return ["FANZA"];
      case "PR_PLUS_GENRE":
        return [tags?.genre?.[0] ?? "ジャンル"].filter(Boolean);
      case "PR_PLUS_ENTITY":
        return [tags?.actress?.[0] ?? "出演"].filter(Boolean);
      default:
        return value.startsWith("#") ? [value.slice(1)] : [value];
    }
  }

  private async createExperimentPair(
    rec: XOptimizationRecommendation,
    variantContentId: string,
  ): Promise<string> {
    const experiment = await this.deps.publications.createExperiment({
      name: `opt-${rec.dimension}-${rec.id.slice(0, 8)}`,
      strategyVariants: {
        optimizationDimension: rec.dimension,
        multivariate: false,
        allocation: { CONTROL: 0.5, VARIANT: 0.5 },
        control: { value: rec.currentValue },
        variant: { value: rec.recommendedValue, contentId: variantContentId },
        recommendationId: rec.id,
      },
      allocationMethod: "ROUND_ROBIN",
      minimumSampleSize: rec.requiredSampleSize,
      evaluationWindowHours: this.deps.config.xOptimizationEvaluationWindowHours,
    });
    await this.deps.publications.updateExperimentStatus(experiment.id, "RUNNING", {
      startedAt: this.now(),
    });
    await this.deps.notifications?.emitXEvent?.("X_OPTIMIZATION_EXPERIMENT_STARTED", {
      experimentId: experiment.id,
      recommendationId: rec.id,
      dimension: rec.dimension,
    });
    return experiment.id;
  }
}
