import type { ContentVersion, LifecycleRepository, QualityReviewRecord } from "@ai-affiliate/database";
import { ContentVersionStatus } from "@ai-affiliate/database";
import type { ContentGenerationService } from "./content-generation-service.js";

export type QualityRecommendedAction =
  | "approve_candidate"
  | "partial_revision"
  | "full_regeneration"
  | "additional_research"
  | "strategy_change"
  | "manual_review"
  | "abandon";

export interface QualityGateFinding {
  code: string;
  severity: "blocking" | "warning" | "info";
  message: string;
  stage: string;
}

export interface QualityGateResult {
  contentVersionId: string;
  score: number;
  confidence: number;
  overall: "passed" | "warning" | "failed" | "manual_review_required";
  recommendedAction: QualityRecommendedAction;
  blockingFindings: QualityGateFinding[];
  warnings: QualityGateFinding[];
  strengths: string[];
  weaknesses: string[];
  stages: Array<{ stage: string; ok: boolean; detail?: string }>;
  reviews: QualityReviewRecord[];
  usedFallback: boolean;
}

/**
 * Production Quality Gate — not score-only.
 * Runs schema → claims → deterministic facts → LLM reviews → policy → CTA readiness.
 */
export class QualityGateService {
  constructor(
    private readonly repo: LifecycleRepository,
    private readonly generation: ContentGenerationService,
  ) {}

  async evaluate(contentVersionId: string, options?: {
    usedLlmFallback?: boolean;
    minScore?: number;
  }): Promise<QualityGateResult> {
    const version = await this.repo.findContentVersion(contentVersionId);
    if (!version) throw new Error(`ContentVersion not found: ${contentVersionId}`);

    const stages: QualityGateResult["stages"] = [];
    const blocking: QualityGateFinding[] = [];
    const warnings: QualityGateFinding[] = [];
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const usedFallback = Boolean(options?.usedLlmFallback);

    // 1) schema / body presence
    const schemaOk = version.title.trim().length > 0 && version.body.trim().length >= 80;
    stages.push({ stage: "schema_validation", ok: schemaOk });
    if (!schemaOk) {
      blocking.push({
        code: "SCHEMA_INVALID",
        severity: "blocking",
        message: "Title/body schema incomplete",
        stage: "schema_validation",
      });
    } else {
      strengths.push("Basic schema present");
    }

    // 2) Claim validation
    const detail = await this.repo.inspectContentLifecycle(version.contentId);
    const full = detail?.versions.find((v) => v.id === version.id);
    const claims = full?.versionClaims?.map((vc) => vc.claim) ?? [];
    const blockedClaims = claims.filter((c) =>
      ["UNSUPPORTED", "DISPUTED", "REJECTED"].includes(c.status),
    );
    const claimOk = blockedClaims.length === 0 && claims.length > 0;
    stages.push({
      stage: "claim_validation",
      ok: claimOk,
      detail: `claims=${claims.length} blocked=${blockedClaims.length}`,
    });
    if (blockedClaims.length > 0) {
      blocking.push({
        code: "CLAIM_BLOCKED",
        severity: "blocking",
        message: `Blocked claims: ${blockedClaims.map((c) => c.id).join(",")}`,
        stage: "claim_validation",
      });
    } else if (claims.length === 0) {
      warnings.push({
        code: "CLAIM_MISSING",
        severity: "warning",
        message: "No claims attached",
        stage: "claim_validation",
      });
      weaknesses.push("Claim coverage missing");
    } else {
      strengths.push(`${claims.length} claims attached`);
    }

    // 3) Deterministic fact / CTA / public body
    const hasCtaUrl = /https?:\/\/\S+/i.test(version.body);
    const hasInternalPlaceholder = /\[\[|__PRODUCT_LINK_|placeholder:/i.test(version.body);
    const disclosure = /アフィリエイト|広告/.test(version.body);
    stages.push({ stage: "deterministic_fact_validation", ok: !hasInternalPlaceholder });
    if (hasInternalPlaceholder) {
      blocking.push({
        code: "INTERNAL_PLACEHOLDER",
        severity: "blocking",
        message: "Internal placeholder leaked into public body",
        stage: "deterministic_fact_validation",
      });
    }
    stages.push({ stage: "cta_product_link_validation", ok: hasCtaUrl });
    if (!hasCtaUrl) {
      warnings.push({
        code: "CTA_MISSING",
        severity: "warning",
        message: "No public URL/CTA detected",
        stage: "cta_product_link_validation",
      });
    }
    if (!disclosure) {
      warnings.push({
        code: "DISCLOSURE_MISSING",
        severity: "warning",
        message: "Affiliate/ad disclosure text not detected",
        stage: "policy_review",
      });
    }

    // Intro / AI boilerplate (deterministic; also recorded inside runQualityReviews)
    const { evaluateIntroQuality } = await import("./intro-quality.js");
    const intro = evaluateIntroQuality({
      title: version.title,
      body: version.body,
      lead: version.summary,
    });
    stages.push({ stage: "intro_quality", ok: intro.ok });
    if (!intro.ok) {
      for (const f of intro.findings) {
        warnings.push({
          code: f.code,
          severity: "warning",
          message: f.message,
          stage: "intro_quality",
        });
      }
      weaknesses.push("Intro/boilerplate quality issues");
    }

    // 4–8) LLM + policy reviews (reuse when body+prompt unchanged)
    const reviewResult = await this.generation.runQualityReviews(contentVersionId);
    stages.push({
      stage: "llm_quality_reviews",
      ok: reviewResult.overall !== "failed",
      detail: `overall=${reviewResult.overall} reused=${reviewResult.reusedCount} new=${reviewResult.newLlmReviewCount}`,
    });
    for (const r of reviewResult.reviews) {
      const findings = Array.isArray(r.findings) ? r.findings : [];
      for (const f of findings) {
        const row = f as { code?: string; message?: string };
        const item: QualityGateFinding = {
          code: row.code ?? r.reviewType,
          severity: r.result === "FAILED" ? "blocking" : "warning",
          message: row.message ?? r.reviewType,
          stage: r.reviewType,
        };
        if (item.severity === "blocking") blocking.push(item);
        else warnings.push(item);
      }
    }

    // 9) Blogger suitability already in reviewTypes; 10) publication readiness
    const scores = reviewResult.reviews
      .map((r) => r.score)
      .filter((s): s is number => typeof s === "number");
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : schemaOk ? 0.6 : 0.2;
    const minScore = options?.minScore ?? 0.55;

    if (usedFallback) {
      blocking.push({
        code: "LLM_FALLBACK_USED",
        severity: "blocking",
        message: "Rule-based/fallback output must not auto-publish — manual review required",
        stage: "final_publication_readiness",
      });
    }

    let overall: QualityGateResult["overall"] = "passed";
    if (blocking.length > 0 || reviewResult.overall === "failed") overall = "failed";
    else if (usedFallback || reviewResult.overall === "manual_review_required") {
      overall = "manual_review_required";
    } else if (warnings.length > 0 || reviewResult.overall === "warning" || avgScore < minScore) {
      overall = "warning";
    }

    const recommendedAction = this.recommend(overall, blocking, warnings, avgScore);
    stages.push({
      stage: "final_publication_readiness",
      ok: overall === "passed" || overall === "warning",
      detail: recommendedAction,
    });

    // Ensure status: fallback / blocking → not APPROVED; keep REVIEWING or REVISION_REQUIRED
    if (overall === "failed") {
      await this.repo.updateContentVersionStatus(
        version.id,
        ContentVersionStatus.REVISION_REQUIRED,
      );
    } else if (overall === "manual_review_required" || usedFallback) {
      await this.repo.updateContentVersionStatus(version.id, ContentVersionStatus.REVIEWING);
    }

    return {
      contentVersionId: version.id,
      score: avgScore,
      confidence: Math.min(0.95, 0.4 + claims.length * 0.1 + (schemaOk ? 0.2 : 0)),
      overall,
      recommendedAction,
      blockingFindings: blocking,
      warnings,
      strengths,
      weaknesses,
      stages,
      reviews: reviewResult.reviews,
      usedFallback,
    };
  }

  private recommend(
    overall: QualityGateResult["overall"],
    blocking: QualityGateFinding[],
    warnings: QualityGateFinding[],
    score: number,
  ): QualityRecommendedAction {
    if (blocking.some((b) => b.code === "CLAIM_BLOCKED")) return "additional_research";
    if (blocking.some((b) => b.code === "INTERNAL_PLACEHOLDER")) return "full_regeneration";
    if (blocking.some((b) => b.code === "LLM_FALLBACK_USED")) return "manual_review";
    if (overall === "failed" && score < 0.35) return "full_regeneration";
    if (overall === "failed") return "partial_revision";
    if (overall === "manual_review_required") return "manual_review";
    if (warnings.some((w) => w.code === "CLAIM_MISSING")) return "additional_research";
    if (overall === "warning") return "partial_revision";
    if (score < 0.55) return "manual_review";
    return "approve_candidate";
  }
}

export function summarizeVersionMetrics(version: ContentVersion): {
  title: string;
  headings: string[];
  sectionCount: number;
  articleLength: number;
  linkCount: number;
  hasFaq: boolean;
  hasListOrTable: boolean;
} {
  const headings = [...version.body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1] ?? "");
  const linkCount = [...version.body.matchAll(/https?:\/\/\S+/gi)].length;
  return {
    title: version.title,
    headings,
    sectionCount: Math.max(1, headings.length),
    articleLength: version.body.length,
    linkCount,
    hasFaq: /FAQ|よくある質問/i.test(version.body),
    hasListOrTable: /(^|\n)\s*[-*•]|\|.*\|/m.test(version.body),
  };
}
