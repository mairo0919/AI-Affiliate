import type { Content, ContentVersion, LifecycleRepository } from "@ai-affiliate/database";
import { validateClaimsAgainstArticle } from "./claim-validator.js";
import { assertBloggerGenerationPreflight, GenerationPreflightError } from "./generation-preflight.js";
import { resolveArticleImagesForTopic } from "./resolve-article-images.js";
import {
  parseBloggerArticle,
  structuredToPlainBody,
  type BloggerArticleStructured,
} from "./structured-article.js";

export class ResumeBloggerGenerationError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `resume_blogger_failed: ${code}: ${detail}` : `resume_blogger_failed: ${code}`);
    this.name = "ResumeBloggerGenerationError";
    this.code = code;
  }
}

export interface ResumeBloggerGenerationInput {
  modelRunId: string;
  topicId: string;
  strategyId: string;
  claimIds?: string[];
  productTitle?: string;
  ctaUrl?: string | null;
}

/**
 * Persist a previously validated blogger ModelRun output without calling the LLM.
 */
export async function resumeBloggerGenerationFromModelRun(
  repo: LifecycleRepository,
  input: ResumeBloggerGenerationInput,
): Promise<{
  content: Content;
  version: ContentVersion;
  article: BloggerArticleStructured;
  modelRunId: string;
  llmCalls: 0;
}> {
  const modelRun = await repo.findModelRun(input.modelRunId);
  if (!modelRun) {
    throw new ResumeBloggerGenerationError("model_run_not_found", input.modelRunId);
  }
  if (modelRun.taskType !== "GENERATION_BLOGGER") {
    throw new ResumeBloggerGenerationError(
      "invalid_task_type",
      `expected GENERATION_BLOGGER got ${modelRun.taskType}`,
    );
  }
  if (modelRun.promptIdentifier && modelRun.promptIdentifier !== "blogger.generate") {
    throw new ResumeBloggerGenerationError(
      "invalid_prompt_identifier",
      String(modelRun.promptIdentifier),
    );
  }

  const meta =
    modelRun.metadata && typeof modelRun.metadata === "object" && !Array.isArray(modelRun.metadata)
      ? (modelRun.metadata as Record<string, unknown>)
      : {};
  const rawOutput = meta.output;
  if (!rawOutput || typeof rawOutput !== "object" || Array.isArray(rawOutput)) {
    throw new ResumeBloggerGenerationError("output_missing", "ModelRun.metadata.output required");
  }

  let article: BloggerArticleStructured;
  try {
    article = parseBloggerArticle(rawOutput as Record<string, unknown>);
  } catch (error) {
    throw new ResumeBloggerGenerationError(
      "output_schema_invalid",
      error instanceof Error ? error.message.slice(0, 200) : "parse failed",
    );
  }

  // Empty usedClaimIds cannot prove grounding against current Research claims.
  if (article.usedClaimIds.length === 0) {
    throw new ResumeBloggerGenerationError(
      "grounding_unproven",
      "usedClaimIds is empty; refuse resume to avoid ungrounded Content",
    );
  }

  let preflight;
  try {
    preflight = await assertBloggerGenerationPreflight(repo, {
      topicId: input.topicId,
      strategyId: input.strategyId,
      claimIds: input.claimIds,
    });
  } catch (error) {
    if (error instanceof GenerationPreflightError) {
      throw new ResumeBloggerGenerationError(error.code, error.message);
    }
    throw error;
  }

  const imageResolution = await resolveArticleImagesForTopic(repo, input.topicId);
  const articleImages = imageResolution.images;
  const body = structuredToPlainBody(article, { images: articleImages });
  const claimCheck = validateClaimsAgainstArticle({
    article,
    claims: preflight.claims,
    bodyText: body,
  });
  if (!claimCheck.ok) {
    throw new ResumeBloggerGenerationError(
      "grounding_failed",
      claimCheck.findings.map((f) => f.code).join(","),
    );
  }

  const allowed = new Set(preflight.claims.filter((c) => c.status === "SUPPORTED").map((c) => c.id));
  for (const claimId of article.usedClaimIds) {
    if (!allowed.has(claimId)) {
      throw new ResumeBloggerGenerationError(
        "grounding_claim_not_in_current_set",
        claimId,
      );
    }
  }

  const content = await repo.createContent({
    topicCandidateId: input.topicId,
    strategyId: input.strategyId,
    status: "GENERATING",
    primaryLanguage: "ja",
    contentPurpose: "blogger-article",
    monetizationStatus: input.ctaUrl ? "PENDING_AFFILIATE" : "UNMONETIZED",
  });

  const latest = await repo.findLatestContentVersion(content.id);
  const version = await repo.createContentVersion({
    contentId: content.id,
    versionNumber: (latest?.versionNumber ?? 0) + 1,
    parentVersionId: latest?.id ?? null,
    revisionType: "resume_from_model_run",
    title: article.title,
    summary: article.summary,
    body,
    structuredContent: {
      channel: "BLOGGER",
      article,
      images: articleImages,
      imageMeta: {
        productId: imageResolution.productId,
        externalIdsTried: imageResolution.externalIdsTried,
        researchImageCount: imageResolution.researchImageCount,
        pageImageCount: imageResolution.pageImageCount,
        displayMode: "url_reference",
      },
      disclosure: true,
      resumedFromModelRunId: input.modelRunId,
      seo: {
        title: article.seoTitle,
        metaDescription: article.metaDescription,
        labels: article.labels,
      },
    },
    status: "REVIEWING",
    createdBy: "resume-blogger-generation",
    modelRunId: modelRun.id,
  });

  for (const claimId of article.usedClaimIds) {
    await repo.attachVersionClaim({
      contentVersionId: version.id,
      claimId,
      usageType: "supporting",
      validationStatus: "validated",
    });
  }

  const prevMeta = meta;
  await repo.completeModelRun(modelRun.id, {
    status: modelRun.status === "FAILED" ? "COMPLETED" : modelRun.status,
    structuredOutputValid: true,
    metadata: {
      ...prevMeta,
      output: rawOutput,
      llmCompleted: true,
      persistenceCompleted: true,
      persistenceErrorType: null,
      resumedAt: new Date().toISOString(),
      resumedContentId: content.id,
      resumedContentVersionId: version.id,
    },
  });

  return {
    content,
    version,
    article,
    modelRunId: modelRun.id,
    llmCalls: 0,
  };
}
