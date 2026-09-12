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
import {
  ensureOfficialEnrichmentForStockItem,
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
  /** Optional extra deterministic checks after Review PASS (never replace Review). */
  auxiliarySafetyOk?: (input: {
    title: string;
    structuredContent: Record<string, unknown>;
  }) => { ok: true } | { ok: false; reason: string };
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
    if (!shape.description?.text?.trim()) return null;
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

  const generated = await input.generation.generateBloggerArticle({
    topicId: boot.topicId,
    strategyId: boot.strategyId,
    productTitle: input.productTitle,
    ctaUrl: input.ctaUrl,
    productCanonicalId: input.productCanonicalId,
    claimIds: boot.claimIds,
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

  const review = await input.generation.runQualityReviews(generated.version.id);
  if (review.overall === "failed") {
    return {
      ok: false,
      reason: "CANONICAL_REVIEW_FAILED",
      enrichment,
      contentVersionId: generated.version.id,
      reviewOverall: review.overall,
    };
  }

  if (input.auxiliarySafetyOk) {
    const aux = input.auxiliarySafetyOk({
      title: generated.version.title,
      structuredContent: {
        ...sc,
        title: generated.version.title,
        bodyHtml: generated.version.body,
      },
    });
    if (!aux.ok) {
      return {
        ok: false,
        reason: `AUXILIARY_SAFETY:${aux.reason}`,
        enrichment,
        contentVersionId: generated.version.id,
        reviewOverall: review.overall,
      };
    }
  }

  let approved = false;
  if (input.autoApprove) {
    // ContentReviewService enforces: reviews executed + no FAILED.
    await input.contentReview.decide({
      contentVersionId: generated.version.id,
      decision: "approve",
      actor: input.approveActor,
      reason: `Canonical pipeline Review ${review.overall}`,
      approvalPolicy: "auto",
    });
    approved = true;
  }

  return {
    ok: true,
    contentVersionId: generated.version.id,
    contentId: generated.content.id,
    approved,
    reviewOverall: review.overall,
    enrichment,
    title: generated.version.title,
  };
}
