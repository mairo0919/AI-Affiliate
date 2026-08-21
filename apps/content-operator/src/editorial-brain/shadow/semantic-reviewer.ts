/**
 * Deterministic Semantic Reviewer (Shadow).
 * Implements SemanticReviewerPort without LLM — future LLM port should replace Gate reviews.
 */

import type { EditorialFailureCode } from "../core/failure-taxonomy.js";
import { analyzeSegments, type ClaimInput } from "./claim-entailment.js";
import type {
  SemanticReviewResult,
  SemanticReviewerPort,
  SemanticReviewStats,
} from "./semantic-types.js";

export class DeterministicSemanticReviewer implements SemanticReviewerPort {
  readonly kind = "deterministic" as const;

  review(input: {
    segments: Array<{ role: string; text: string }>;
    claims: ClaimInput[];
    allocatedClaimIds: string[];
    /** Writer-visible source texts (officialDescription) for entailment — not Claim FKs. */
    sourceTexts?: string[];
    optionBNaturalIntro?: boolean;
  }): SemanticReviewResult {
    const allocated = new Set(input.allocatedClaimIds);
    const claims =
      allocated.size > 0
        ? input.claims.filter((c) => allocated.has(c.id))
        : input.claims;

    const { assertions } = analyzeSegments({
      segments: input.segments,
      claims,
      sourceTexts: input.sourceTexts,
      optionBNaturalIntro: input.optionBNaturalIntro,
    });

    const failureCodes = new Set<EditorialFailureCode>();
    for (const a of assertions) {
      for (const c of a.failureCodes) failureCodes.add(c);
    }

    const supportedNovel = assertions.filter(
      (a) => a.addsInformation && (a.supportType === "DIRECT" || a.supportType === "SAFE_COMPOSITION"),
    );
    const novelFacets = new Set(supportedNovel.flatMap((a) => a.novelFacets));

    const stats: SemanticReviewStats = {
      assertionCount: assertions.length,
      supportedNovelAssertionCount: supportedNovel.length,
      unsupportedAssertionCount: assertions.filter((a) =>
        ["UNSUPPORTED", "NAME_DERIVED", "INTERPRETIVE", "EVALUATIVE", "SOCIAL_PROOF"].includes(
          a.supportType,
        ),
      ).length,
      interpretiveCount: assertions.filter((a) => a.supportType === "INTERPRETIVE").length,
      evaluativeCount: assertions.filter((a) => a.supportType === "EVALUATIVE").length,
      nameDerivedCount: assertions.filter((a) => a.supportType === "NAME_DERIVED").length,
      socialProofCount: assertions.filter((a) => a.supportType === "SOCIAL_PROOF").length,
      repetitionCount: assertions.filter((a) => a.supportType === "REPETITION").length,
      fillerCount: assertions.filter(
        (a) => a.supportType === "FILLER" || a.failureCodes.includes("FILLER"),
      ).length,
      novelFacetCoverage: novelFacets.size,
      affectedSegmentRoles: [
        ...new Set(
          assertions.filter((a) => a.failureCodes.length > 0).map((a) => a.sourceSegment),
        ),
      ],
    };

    // Information density: many assertions but few novel supported ones
    if (
      stats.assertionCount >= 3 &&
      stats.supportedNovelAssertionCount > 0 &&
      stats.supportedNovelAssertionCount / stats.assertionCount < 0.35 &&
      stats.repetitionCount + stats.evaluativeCount + stats.nameDerivedCount >= 2
    ) {
      failureCodes.add("INFORMATION_DENSITY_LOW");
    }

    return {
      assertions,
      stats,
      failureCodes: [...failureCodes],
    };
  }
}

export const defaultSemanticReviewer: SemanticReviewerPort = new DeterministicSemanticReviewer();
