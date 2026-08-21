import type { AppConfig } from "@ai-affiliate/config";
import type {
  ContentRepository,
  ContentTargetChannel,
  GeneratedContentType,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { ContentGenerationInputBuilder } from "./input-builder.js";
import { ContentValidator } from "./content-validator.js";
import {
  createContentGenerationProvider,
  type ContentGenerationProvider,
} from "./providers/index.js";
import {
  blogPrompt,
  productIntroductionPrompt,
  resolvePromptBundleVersion,
  shortVideoPrompt,
  systemPrompt,
  xPostPrompt,
} from "./prompts/index.js";
import type { ContentGenerationRequest } from "./types.js";
import {
  parseStructuredOutput,
  repairStructuredJsonOnce,
  tryParseJsonObject,
} from "./structured-output.js";

export interface ContentGenerateOptions {
  candidateId?: string;
  analysisRunId?: string;
  candidateType?: string;
  contentType: GeneratedContentType;
  targetChannel?: ContentTargetChannel;
  limit?: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
  dryRun?: boolean;
  force?: boolean;
  includeRequiresConfirmation?: boolean;
  minScore?: number;
  skipExistingSameType?: boolean;
  mockBehavior?: ContentGenerationRequest["mockBehavior"];
  regenerationInstruction?: string;
  parentContentId?: string;
}

export interface ContentItemResult {
  candidateId: string;
  contentId: string | null;
  status: string;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
  version?: number;
  title?: string;
  validationIssueCount?: number;
}

export interface ContentGenerateResult {
  generationRunId: string | null;
  status: string;
  candidateCount: number;
  generatedCount: number;
  skippedCount: number;
  errorCount: number;
  items: ContentItemResult[];
  dryRun: boolean;
}

function mapCandidateType(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  const allowed = new Set([
    "RANKING",
    "TRENDING",
    "HIGH_RATING",
    "NEW_RELEASE",
    "DISCOUNT",
    "EDITORIAL",
  ]);
  return allowed.has(normalized) ? normalized : undefined;
}

function defaultChannel(contentType: GeneratedContentType): ContentTargetChannel {
  switch (contentType) {
    case "BLOG_ARTICLE":
      return "BLOG";
    case "X_POST":
      return "X";
    case "SHORT_VIDEO_SCRIPT":
      return "SHORT_VIDEO";
    default:
      return "GENERIC";
  }
}

function buildUserPrompt(
  contentType: GeneratedContentType,
  input: Record<string, unknown>,
  config: AppConfig,
  instruction?: string,
): string {
  const params = {
    input,
    maxLength: config.contentXMaxLength,
    contentAngle: input.contentAngle,
    instruction,
  };
  switch (contentType) {
    case "BLOG_ARTICLE":
      return blogPrompt.build(params);
    case "X_POST":
      return xPostPrompt.build(params);
    case "SHORT_VIDEO_SCRIPT":
      return shortVideoPrompt.build(params);
    case "PRODUCT_INTRODUCTION":
      return productIntroductionPrompt.build(params);
    default:
      return JSON.stringify(input);
  }
}

export interface ContentEngineDeps {
  logger: Logger;
  config: AppConfig;
  contents: ContentRepository;
  provider?: ContentGenerationProvider;
  notifications?: {
    emitContentEvent?: (
      eventType:
        | "CONTENT_GENERATION_FAILED"
        | "CONTENT_VALIDATION_FAILED"
        | "CONTENT_REVIEW_REQUIRED"
        | "CONTENT_APPROVED"
        | "CONTENT_REJECTED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export class ContentEngine {
  private readonly logger: Logger;
  private readonly config: AppConfig;
  private readonly contents: ContentRepository;
  private readonly provider: ContentGenerationProvider;
  private readonly inputBuilder = new ContentGenerationInputBuilder();
  private readonly validator: ContentValidator;
  private readonly notifications: ContentEngineDeps["notifications"];

  constructor(deps: ContentEngineDeps) {
    this.logger = deps.logger;
    this.config = deps.config;
    this.contents = deps.contents;
    this.provider =
      deps.provider ??
      createContentGenerationProvider(deps.config.contentGenerationProvider);
    this.validator = new ContentValidator(deps.config, deps.contents);
    this.notifications = deps.notifications;
  }

  async generate(options: ContentGenerateOptions): Promise<ContentGenerateResult> {
    const dryRun = options.dryRun === true;
    const contentType = options.contentType;
    const targetChannel = options.targetChannel ?? defaultChannel(contentType);
    const providerName = options.provider ?? this.provider.providerName;
    const modelName = options.model ?? this.config.contentGenerationModel;
    const promptVersion =
      options.promptVersion ?? resolvePromptBundleVersion(contentType);

    const candidates = await this.contents.listCandidatesForGeneration({
      candidateId: options.candidateId,
      analysisRunId: options.analysisRunId,
      candidateType: mapCandidateType(options.candidateType),
      minScore: options.minScore,
      includeRequiresConfirmation: options.includeRequiresConfirmation === true,
      limit: options.limit ?? 10,
      contentType,
      skipExistingSameType: options.force !== true && options.skipExistingSameType !== false,
    });

    let runId: string | null = null;
    if (!dryRun) {
      const run = await this.contents.createGenerationRun({
        providerName,
        modelName,
        promptVersion,
        candidateCount: candidates.length,
        parameters: {
          contentType,
          targetChannel,
          candidateType: options.candidateType ?? null,
          analysisRunId: options.analysisRunId ?? null,
          limit: options.limit ?? 10,
          dryRun: false,
        },
      });
      runId = run.id;
      await this.contents.startGenerationRun(runId);
    }

    const items: ContentItemResult[] = [];
    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const candidate of candidates) {
      try {
        if (candidate.productAnalysis.eligibilityStatus === "NOT_ELIGIBLE") {
          skippedCount += 1;
          items.push({
            candidateId: candidate.id,
            contentId: null,
            status: "SKIPPED",
            skipped: true,
            skipReason: "NOT_ELIGIBLE",
          });
          continue;
        }

        if (
          candidate.productAnalysis.eligibilityStatus === "REQUIRES_CONFIRMATION" &&
          options.includeRequiresConfirmation !== true
        ) {
          skippedCount += 1;
          items.push({
            candidateId: candidate.id,
            contentId: null,
            status: "SKIPPED",
            skipped: true,
            skipReason: "REQUIRES_CONFIRMATION",
          });
          continue;
        }

        const safeInput = this.inputBuilder.build({
          candidate,
          contentType,
          targetChannel,
          regenerationInstruction: options.regenerationInstruction,
        });

        // Prompt is built for future real providers; Mock uses structured input directly.
        void systemPrompt.build({});
        void buildUserPrompt(
          contentType,
          safeInput as unknown as Record<string, unknown>,
          this.config,
          options.regenerationInstruction,
        );

        const request: ContentGenerationRequest = {
          contentType,
          targetChannel,
          input: safeInput,
          promptVersion,
          modelName,
          timeoutMs: this.config.contentGenerationTimeoutMs,
          mockBehavior: options.mockBehavior,
        };

        let generation = await this.provider.generate(request);
        let output = generation.output;

        if (!output && generation.rawText) {
          const repaired = repairStructuredJsonOnce(generation.rawText);
          if (repaired) {
            const parsed = tryParseJsonObject(repaired);
            if (parsed) {
              try {
                output = parseStructuredOutput(parsed);
                generation = { ...generation, output, repaired: true, rawText: repaired };
              } catch {
                output = null;
              }
            }
          }
        }

        if (!output) {
          errorCount += 1;
          items.push({
            candidateId: candidate.id,
            contentId: null,
            status: "VALIDATION_FAILED",
            error: generation.errorMessage ?? "structure invalid",
          });
          if (!dryRun) {
            await this.notifications?.emitContentEvent?.("CONTENT_GENERATION_FAILED", {
              candidateId: candidate.id,
              contentType,
              error: generation.errorMessage ?? "structure invalid",
            });
          }
          continue;
        }

        const imageUsageById = new Map(
          candidate.researchItem.images.map((img) => [img.id, img.usageStatus]),
        );
        const selectedImageId = safeInput.allowedImages[0]?.id ?? null;

        // Load rawData only for forbidden-text similarity (never pass to provider)
        const rawData = await this.loadRawData(candidate.researchItemId);

        const parent = options.parentContentId
          ? await this.contents.findGeneratedContentById(options.parentContentId)
          : null;
        const latest = await this.contents.findLatestVersionForCandidate(
          candidate.id,
          contentType,
        );
        const version = parent || latest ? (latest?.version ?? 0) + 1 : 1;

        const validation = await this.validator.validate({
          contentType,
          targetChannel,
          input: safeInput,
          output,
          researchItemId: candidate.researchItemId,
          rawData,
          selectedImageId,
          imageUsageById,
          excludeContentId: parent?.id,
        });

        if (dryRun) {
          generatedCount += 1;
          items.push({
            candidateId: candidate.id,
            contentId: null,
            status: validation.status,
            version,
            title: output.title,
            validationIssueCount: validation.issues.length,
          });
          continue;
        }

        const inputSnapshot: Record<string, unknown> = {
          ...safeInput,
          ...(options.regenerationInstruction
            ? { regenerationInstruction: options.regenerationInstruction }
            : {}),
        };

        const created = options.parentContentId
          ? await this.contents.createContentVersion(options.parentContentId, {
              generationRunId: runId,
              contentCandidateId: candidate.id,
              researchItemId: candidate.researchItemId,
              contentType,
              targetChannel,
              status: validation.status,
              title: output.title,
              body: output.body,
              summary: output.summary ?? null,
              hashtags: output.hashtags ?? [],
              callToAction: output.callToAction ?? null,
              affiliateUrl: safeInput.affiliateUrl,
              imageId: selectedImageId,
              promptVersion,
              generationProvider: generation.providerName,
              generationModel: modelName,
              inputSnapshot,
              validationResult: {
                issueCount: validation.issues.length,
                blocking: validation.status === "VALIDATION_FAILED",
              },
              contentHash: validation.contentHash,
              generatedAt: new Date(),
            })
          : await this.contents.createGeneratedContent({
              generationRunId: runId,
              contentCandidateId: candidate.id,
              researchItemId: candidate.researchItemId,
              contentType,
              targetChannel,
              status: validation.status,
              title: output.title,
              body: output.body,
              summary: output.summary ?? null,
              hashtags: output.hashtags ?? [],
              callToAction: output.callToAction ?? null,
              affiliateUrl: safeInput.affiliateUrl,
              imageId: selectedImageId,
              promptVersion,
              generationProvider: generation.providerName,
              generationModel: modelName,
              inputSnapshot,
              validationResult: {
                issueCount: validation.issues.length,
                blocking: validation.status === "VALIDATION_FAILED",
              },
              contentHash: validation.contentHash,
              version,
              generatedAt: new Date(),
            });

        await this.contents.saveValidationIssues(created.id, validation.issues);
        await this.contents.markCandidateContentCreated(candidate.id);

        if (validation.status === "VALIDATION_FAILED") {
          await this.notifications?.emitContentEvent?.("CONTENT_VALIDATION_FAILED", {
            contentId: created.id,
            candidateId: candidate.id,
            contentType,
          });
        }

        generatedCount += 1;
        items.push({
          candidateId: candidate.id,
          contentId: created.id,
          status: created.status,
          version: created.version,
          title: created.title,
          validationIssueCount: validation.issues.length,
        });
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`content generation failed candidate=${candidate.id}: ${message}`);
        items.push({
          candidateId: candidate.id,
          contentId: null,
          status: "ERROR",
          error: message,
        });
        if (!dryRun) {
          await this.notifications?.emitContentEvent?.("CONTENT_GENERATION_FAILED", {
            candidateId: candidate.id,
            contentType,
            error: message,
          });
        }
      }
    }

    let status = "COMPLETED";
    if (errorCount > 0 && generatedCount > 0) {
      status = "PARTIALLY_COMPLETED";
    } else if (errorCount > 0 && generatedCount === 0) {
      status = "FAILED";
    } else if (candidates.length === 0) {
      status = "COMPLETED";
    }

    if (!dryRun && runId) {
      const counts = {
        candidateCount: candidates.length,
        generatedCount,
        skippedCount,
        errorCount,
      };
      if (status === "PARTIALLY_COMPLETED") {
        await this.contents.partiallyCompleteGenerationRun(runId, counts);
      } else if (status === "FAILED") {
        await this.contents.failGenerationRun(runId, "all candidates failed");
      } else {
        await this.contents.completeGenerationRun(runId, counts);
      }
    }

    return {
      generationRunId: runId,
      status,
      candidateCount: candidates.length,
      generatedCount,
      skippedCount,
      errorCount,
      items,
      dryRun,
    };
  }

  async regenerate(options: {
    contentId: string;
    instruction?: string;
    dryRun?: boolean;
    mockBehavior?: ContentGenerationRequest["mockBehavior"];
  }): Promise<ContentGenerateResult> {
    const existing = await this.contents.findGeneratedContentById(options.contentId);
    if (!existing) {
      throw new Error(`content not found: ${options.contentId}`);
    }
    // Do not overwrite approved/published — create a new version instead.
    return this.generate({
      candidateId: existing.contentCandidateId,
      contentType: existing.contentType,
      targetChannel: existing.targetChannel,
      limit: 1,
      force: true,
      skipExistingSameType: false,
      dryRun: options.dryRun,
      regenerationInstruction: options.instruction,
      parentContentId: existing.id,
      mockBehavior: options.mockBehavior,
    });
  }

  private async loadRawData(researchItemId: string): Promise<unknown> {
    if (this.rawDataLoader) {
      return this.rawDataLoader(researchItemId);
    }
    return this.contents.getResearchItemRawData(researchItemId);
  }

  /** Optional injector for tests. */
  rawDataLoader?: (researchItemId: string) => Promise<unknown>;
}

export function parseContentTypeFlag(value?: string): GeneratedContentType | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  switch (normalized) {
    case "blog-article":
    case "blog":
      return "BLOG_ARTICLE";
    case "x-post":
    case "x":
      return "X_POST";
    case "short-video-script":
    case "short-video":
      return "SHORT_VIDEO_SCRIPT";
    case "product-introduction":
    case "product-intro":
      return "PRODUCT_INTRODUCTION";
    default:
      return undefined;
  }
}

export function parseContentStatusFlag(
  value?: string,
):
  | "DRAFT"
  | "VALIDATION_FAILED"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "REJECTED"
  | "READY_TO_PUBLISH"
  | "PUBLISHED"
  | "ARCHIVED"
  | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  const allowed = new Set([
    "DRAFT",
    "VALIDATION_FAILED",
    "REVIEW_REQUIRED",
    "APPROVED",
    "REJECTED",
    "READY_TO_PUBLISH",
    "PUBLISHED",
    "ARCHIVED",
  ]);
  return allowed.has(normalized) ? (normalized as never) : undefined;
}
