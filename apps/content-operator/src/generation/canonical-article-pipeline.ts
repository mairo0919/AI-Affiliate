/**
 * Canonical article generation orchestration (SSOT).
 *
 * Provider differences stop at collect/normalize/enrichment.
 * All production article paths must enter here:
 *   Evidence → Claims → generateBloggerArticle → runQualityReviews → (optional revise) → approve eligibility
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { LifecycleRepository, ResearchRepository } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import type { ContentReviewService } from "../admin/content-review-service.js";
import { claimStatementsFromPageEvidence } from "../article-pattern/evidence-pack.js";
import type { PageEvidenceMetaShape } from "../article-pattern/official-page-evidence-atoms.js";
import type { ContentGenerationService } from "../generation/content-generation-service.js";
import { readLlmSafety, settleWpRuns } from "../adapters/llm/wp-article-safety.js";
import { isSystemStopReason } from "../stock/stock-attempt-ledger.js";
import { extractProductKeyFromStructured } from "../stock/approved-stock.js";
import { normalizeProductKey } from "../daily-ops/blog-product-exclusion.js";
import {
  ensureOfficialEnrichmentForStockItem,
  isUsableOfficialPageEvidence,
  readPageEvidenceFromDocMetadata,
  type OfficialEnrichmentResult,
} from "../stock/ensure-official-enrichment.js";

export type CanonicalPipelineRoute =
  | "STOCK_GENERATION"
  | "DAILY_OPS"
  | "P45"
  | "REPAIR"
  | "MANUAL";

export type CanonicalPipelineInput = {
  lifecycle: LifecycleRepository;
  research: ResearchRepository;
  generation: ContentGenerationService;
  contentReview: ContentReviewService;
  config: AppConfig;
  logger: Logger;
  researchItemId: string;
  productTitle: string;
  productCanonicalId: string;
  productUrl: string;
  rawData: unknown;
  ctaUrl: string;
  route: CanonicalPipelineRoute;
  objective: string;
  autoApprove: boolean;
  approveActor: string;
  /**
   * Optional extra deterministic checks (never replace Review). They run before the LLM
   * reviews so a version they reject does not pay for six reviews first.
   */
  auxiliarySafetyOk?: (input: {
    title: string;
    structuredContent: Record<string, unknown>;
  }) => { ok: true } | { ok: false; reason: string };
  /** Evidence-matched demand keywords. Provenance only; not article facts. */
  demandMatchKeywords?: string[];
};

export type CanonicalPipelineResult =
  | {
      ok: true;
      contentVersionId: string;
      contentId: string;
      approved: boolean;
      reviewOverall: string;
      enrichment: OfficialEnrichmentResult;
      title: string;
    }
  | {
      ok: false;
      reason: string;
      enrichment?: OfficialEnrichmentResult;
      contentVersionId?: string;
      reviewOverall?: string;
    };

function isSynthesizedPageEvidence(meta: unknown): boolean {
  const pe = readPageEvidenceFromDocMetadata(meta);
  const raw = pe as Record<string, unknown> | null;
  if (raw?.synthesizedFrom !== "itemlist") return false;
  // Real page fetch stamps fetchMode — treat as official Evidence.
  if (typeof raw.fetchMode === "string" && raw.fetchMode.trim()) return false;
  return true;
}

function readPageEvidence(
  lifecycle: LifecycleRepository,
  canonicalId: string,
): Promise<PageEvidenceMetaShape | null> {
  return lifecycle.findLatestSourceDocumentByUrlContains(canonicalId).then((doc) => {
    if (!doc?.metadata || typeof doc.metadata !== "object" || Array.isArray(doc.metadata)) {
      return null;
    }
    if (isSynthesizedPageEvidence(doc.metadata)) return null;
    const pe = (doc.metadata as Record<string, unknown>).pageEvidence;
    if (!pe || typeof pe !== "object" || Array.isArray(pe)) return null;
    const shape = pe as PageEvidenceMetaShape;
    if (!isUsableOfficialPageEvidence(shape)) return null;
    return shape;
  });
}

/**
 * Build lifecycle topic/strategy/claims from real page Evidence only.
 * Catalog shell claims are forbidden.
 */
export async function bootstrapCanonicalClaims(input: {
  lifecycle: LifecycleRepository;
  researchItemId: string;
  title: string;
  canonicalId: string;
  objective: string;
  route: CanonicalPipelineRoute;
  pageEvidenceMeta: PageEvidenceMetaShape;
}): Promise<{ topicId: string; strategyId: string; claimIds: string[] } | { error: string }> {
  const statements = claimStatementsFromPageEvidence({
    pageEvidenceMeta: input.pageEvidenceMeta,
    productTitle: input.title,
    actors: input.pageEvidenceMeta.actors,
  }).filter((s) => s.trim().length > 0);

  if (statements.length === 0) {
    return { error: "NEEDS_ENRICHMENT:no_evidence_claims" };
  }

  const topic = await input.lifecycle.createTopicCandidate({
    title: input.title,
    status: "READY",
    metadata: {
      source: "canonical-article-pipeline",
      route: input.route,
      researchItemId: input.researchItemId,
      canonicalId: input.canonicalId,
    },
  });
  const strategy = await input.lifecycle.createStrategy({
    topicCandidateId: topic.id,
    objective: input.objective,
    targetAudience: "readers",
    userIntent: "product_intro",
    formatCategory: "ARTICLE",
    formatKey: "NEW_RELEASE_SINGLE",
    angle: "single_product",
    primaryChannel: "WORDPRESS",
    candidateChannels: ["WORDPRESS"],
    status: "READY",
  });

  const claimIds: string[] = [];
  for (const statement of statements.slice(0, 8)) {
    const claim = await input.lifecycle.createClaim({
      statement,
      claimType: "FACT",
      status: "SUPPORTED",
      confidence: 0.8,
      strategyId: strategy.id,
      metadata: {
        researchItemId: input.researchItemId,
        source: "canonical-article-pipeline",
        route: input.route,
      },
    });
    claimIds.push(claim.id);
  }
  return { topicId: topic.id, strategyId: strategy.id, claimIds };
}

/**
 * Sole production orchestration for article generation + Review (+ optional auto-approve).
 */
export async function runCanonicalArticlePipeline(
  input: CanonicalPipelineInput,
): Promise<CanonicalPipelineResult> {
  const enrichment = await ensureOfficialEnrichmentForStockItem({
    lifecycle: input.lifecycle,
    research: input.research,
    config: input.config,
    logger: input.logger,
    canonicalId: input.productCanonicalId,
    productUrl: input.productUrl,
    researchItemId: input.researchItemId,
    productTitle: input.productTitle,
    rawData: input.rawData,
  });

  if (enrichment.status === "NEEDS_ENRICHMENT") {
    return {
      ok: false,
      reason: "NEEDS_ENRICHMENT:official_page_evidence_required",
      enrichment,
    };
  }

  const pageEvidenceMeta = await readPageEvidence(input.lifecycle, input.productCanonicalId);
  if (!pageEvidenceMeta) {
    return {
      ok: false,
      reason: "NEEDS_ENRICHMENT:page_evidence_missing_or_synthesized",
      enrichment,
    };
  }

  const boot = await bootstrapCanonicalClaims({
    lifecycle: input.lifecycle,
    researchItemId: input.researchItemId,
    title: input.productTitle,
    canonicalId: input.productCanonicalId,
    objective: input.objective,
    route: input.route,
    pageEvidenceMeta,
  });
  if ("error" in boot) {
    return { ok: false, reason: boot.error, enrichment };
  }

  const priorReviewFindings = await loadPriorReviewFindings(input.lifecycle, input.productCanonicalId).catch(
    () => [] as string[],
  );
  const generated = await input.generation.generateBloggerArticle({
    topicId: boot.topicId,
    strategyId: boot.strategyId,
    productTitle: input.productTitle,
    ctaUrl: input.ctaUrl,
    productCanonicalId: input.productCanonicalId,
    claimIds: boot.claimIds,
    demandMatchKeywords: input.demandMatchKeywords,
    // The stock route's own exclusion rules decide when a work may be written again.
    regenerateReason: "canonical-regeneration",
    priorReviewFindings,
  });

  const sc = (generated.version.structuredContent ?? {}) as Record<string, unknown>;
  await input.lifecycle.updateContentVersionStructuredContent(generated.version.id, {
    ...sc,
    productCanonicalId: input.productCanonicalId,
    canonicalId: input.productCanonicalId,
    pipelineRoute: "CANONICAL",
    stockRoute: input.route === "STOCK_GENERATION" ? "STOCK_GENERATION" : sc.stockRoute,
    generationRoute: input.route,
    officialEnrichmentStatus: enrichment.status,
    officialActorCount: enrichment.actorCount,
  });

  let finalVersion = generated.version;
  if (input.auxiliarySafetyOk) {
    let aux = input.auxiliarySafetyOk({
      title: generated.version.title,
      structuredContent: {
        ...sc,
        title: generated.version.title,
        bodyHtml: generated.version.body,
      },
    });
    if (!aux.ok) {
      // Fix the named defect once, the same way a failed review is fixed.
      let revised: Awaited<ReturnType<ContentGenerationService["reviseContentVersion"]>>;
      try {
        revised = await input.generation.reviseContentVersion({
          contentVersionId: finalVersion.id,
          mode: "partial_revision",
          rationale: auxiliaryFindingRationale(aux.reason),
          productTitle: input.productTitle,
          ctaUrl: input.ctaUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await input.lifecycle.updateContentVersionStatus(
          finalVersion.id,
          isSystemStopReason(message) ? "ARCHIVED" : "REVISION_REQUIRED",
        );
        throw error;
      }
      // The revision supersedes the draft; archived, so it neither blocks the work nor counts as a rejection.
      await input.lifecycle.updateContentVersionStatus(finalVersion.id, "ARCHIVED");
      finalVersion = revised.version;
      const revisedSc = (finalVersion.structuredContent ?? {}) as Record<string, unknown>;
      aux = input.auxiliarySafetyOk({
        title: finalVersion.title,
        structuredContent: { ...revisedSc, title: finalVersion.title, bodyHtml: finalVersion.body },
      });
    }
    if (!aux.ok) {
      const writers = readLlmSafety(finalVersion.structuredContent).runs.filter(
        (run) => run.operation === "WP_WRITER" || run.operation === "WP_REWRITE",
      );
      const latest = writers.reduce<(typeof writers)[number] | null>(
        (best, run) => (!best || run.logicalAttempt >= best.logicalAttempt ? run : best),
        null,
      );
      if (latest) {
        await settleWpRuns([latest], () => "DISCARDED_POLICY", { contentVersionId: finalVersion.id });
      }
      // REVISION_REQUIRED counts toward the same-cid regeneration cap. Leaving the
      // version in REVIEWING blocked the cid permanently after one attempt.
      await input.lifecycle.updateContentVersionStatus(finalVersion.id, "REVISION_REQUIRED");
      return {
        ok: false,
        reason: `AUXILIARY_SAFETY:${aux.reason}`,
        enrichment,
        contentVersionId: finalVersion.id,
      };
    }
  }

  let review: Awaited<ReturnType<ContentGenerationService["runQualityReviews"]>>;
  let approved = false;
  try {
    review = await input.generation.runQualityReviews(finalVersion.id, {
      stopOnFirstFailure: true,
    });
    if (review.overall === "failed") {
      // Fix the article with the reviewers' findings once, instead of discarding it.
      const rationale = reviewFindingsRationale(review.reviews);
      const revised = await input.generation.reviseContentVersion({
        contentVersionId: finalVersion.id,
        mode: "partial_revision",
        rationale,
        productTitle: input.productTitle,
        ctaUrl: input.ctaUrl,
      });
      finalVersion = revised.version;
      const revisedSc = (finalVersion.structuredContent ?? {}) as Record<string, unknown>;
      const aux = input.auxiliarySafetyOk?.({
        title: finalVersion.title,
        structuredContent: { ...revisedSc, title: finalVersion.title, bodyHtml: finalVersion.body },
      });
      if (aux && !aux.ok) {
        await input.lifecycle.updateContentVersionStatus(finalVersion.id, "REVISION_REQUIRED");
        return {
          ok: false,
          reason: `AUXILIARY_SAFETY:${aux.reason}`,
          enrichment,
          contentVersionId: finalVersion.id,
        };
      }
      review = await input.generation.runQualityReviews(finalVersion.id, {
        stopOnFirstFailure: true,
      });
    }
    if (review.overall === "failed") {
      return {
        ok: false,
        reason: "CANONICAL_REVIEW_FAILED",
        enrichment,
        contentVersionId: finalVersion.id,
        reviewOverall: review.overall,
      };
    }
    if (input.autoApprove) {
      // ContentReviewService enforces: reviews executed + no FAILED.
      await input.contentReview.decide({
        contentVersionId: finalVersion.id,
        decision: "approve",
        actor: input.approveActor,
        reason: `Canonical pipeline Review ${review.overall}`,
        approvalPolicy: "auto",
      });
      approved = true;
    }
  } catch (error) {
    // A version left REVIEWING blocks its work. A system stop is not the article's fault, so
    // it is archived (not counted as a rejection); any other error counts as one.
    const message = error instanceof Error ? error.message : String(error);
    await input.lifecycle.updateContentVersionStatus(
      finalVersion.id,
      isSystemStopReason(message) ? "ARCHIVED" : "REVISION_REQUIRED",
    );
    throw error;
  }

  return {
    ok: true,
    contentVersionId: finalVersion.id,
    contentId: generated.content.id,
    approved,
    reviewOverall: review.overall,
    enrichment,
    title: finalVersion.title,
  };
}

type ReviewLike = { reviewType: string; result: string; findings: unknown };

function reviewFindingLines(reviews: ReadonlyArray<ReviewLike>): string[] {
  const lines: string[] = [];
  for (const review of reviews) {
    if (review.result !== "FAILED") continue;
    const findings = Array.isArray(review.findings) ? review.findings : [review.findings];
    for (const finding of findings) {
      if (finding == null) continue;
      const text =
        typeof finding === "string"
          ? finding
          : typeof (finding as Record<string, unknown>).message === "string"
            ? String((finding as Record<string, unknown>).message)
            : JSON.stringify(finding);
      lines.push(`[${review.reviewType}] ${text.slice(0, 300)}`);
    }
  }
  return lines;
}

/** The auxiliary gate's reason, as the rationale for one partial revision. */
export function auxiliaryFindingRationale(reason: string): string {
  if (reason.startsWith("TITLE_COPIES_OFFICIAL")) {
    return [
      `Auxiliary check failed: ${reason}`,
      "- The title reuses a long run of the official work title verbatim. Rewrite only the title in your own words from the plan facts. Performer names are fine.",
      "- The article prints the official work title separately, so the title does not need to carry it.",
    ].join("\n");
  }
  return `Auxiliary check failed: ${reason}\n- Fix only what this check names.`;
}

/** The failed reviews' findings, as the rationale for one partial revision. */
export function reviewFindingsRationale(reviews: ReadonlyArray<ReviewLike>): string {
  const lines = reviewFindingLines(reviews);
  return lines.length
    ? `Review findings to fix:\n${lines.slice(0, 12).map((line) => `- ${line}`).join("\n")}`
    : "Review failed without findings.";
}

type PriorFindingsDb = {
  contentVersion: {
    findMany(args: unknown): Promise<Array<{ id: string; structuredContent: unknown }>>;
  };
  qualityReviewRecord: {
    findMany(args: unknown): Promise<ReviewLike[]>;
  };
};

/** Findings from this work's most recent rejected versions, so the writer does not repeat them. */
export async function loadPriorReviewFindings(
  lifecycle: unknown,
  productCanonicalId: string,
  maxVersions = 3,
): Promise<string[]> {
  const db = (lifecycle as { prisma?: PriorFindingsDb }).prisma;
  const key = normalizeProductKey(productCanonicalId);
  if (!db || !key) return [];
  const rejected = await db.contentVersion.findMany({
    where: { status: "REVISION_REQUIRED" },
    select: { id: true, structuredContent: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const ids = rejected
    .filter((version) => extractProductKeyFromStructured(version.structuredContent) === key)
    .slice(0, maxVersions)
    .map((version) => version.id);
  if (ids.length === 0) return [];
  const reviews = await db.qualityReviewRecord.findMany({
    where: { contentVersionId: { in: ids }, result: "FAILED" },
    select: { reviewType: true, result: true, findings: true },
  });
  return [...new Set(reviewFindingLines(reviews))].slice(0, 8);
}
