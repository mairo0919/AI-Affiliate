/**
 * WritingSkeleton — Generator HOW SSOT (OPTION B).
 * Abstract editorial conversion only — NEVER stores reference prose.
 * Prefer natural FANZA product-intro density over complex editorial engines.
 */

import type { ReferenceEditorialBlueprint } from "./reference-editorial-blueprint.js";
import type { ReferenceEditorialTransformationBlueprint } from "./reference-editorial-transformation.js";
import {
  extractTransformationFromEditorialBlueprint,
  isReferenceEditorialTransformationBlueprint,
} from "./reference-editorial-transformation.js";
import { classifyReferenceEditorialType } from "./reference-type-profile.js";
import {
  NATURAL_INTRO_GLOBAL_AVOID,
  NATURAL_PRODUCT_INTRO_STRUCTURE,
} from "./natural-product-intro-policy.js";

export type WritingSkeleton = {
  schemaVersion: 1;
  referenceType: string;
  referenceId: string | null;
  /** When set, Generator treats slots as natural product-intro HOW */
  articleShape?: "natural_product_intro";
  title: {
    focus: string;
    transformation: string;
  };
  opening: {
    purpose: string;
    primaryEvidenceRole: string;
    supportingEvidenceRoles: string[];
    packaging: string;
    avoid: string[];
  };
  body: Array<{
    order: number;
    purpose: string;
    primaryEvidenceRole: string;
    supportingEvidenceRoles: string[];
    transformation: string;
    transitionFromPrevious?: string;
    stopCondition?: string;
    avoid: string[];
  }>;
  ending: {
    strategy: string;
  };
  globalAvoid: string[];
};

const DEFAULT_AVOID = [...NATURAL_INTRO_GLOBAL_AVOID];

/**
 * Convert existing ReferenceEditorialBlueprint (+ optional Transform) into WritingSkeleton.
 * Preserves Observations via adapter — does not discard blueprints.
 * Body capped at 2 — never force long multi-section essays.
 */
export function writingSkeletonFromReference(input: {
  blueprint: ReferenceEditorialBlueprint | null | undefined;
  transform?: ReferenceEditorialTransformationBlueprint | null;
  referenceType?: string | null;
}): WritingSkeleton | null {
  const bp = input.blueprint;
  if (!bp || !Array.isArray(bp.segments) || bp.segments.length === 0) return null;

  const transform =
    input.transform && isReferenceEditorialTransformationBlueprint(input.transform)
      ? input.transform
      : extractTransformationFromEditorialBlueprint(bp);

  const referenceType =
    input.referenceType ?? classifyReferenceEditorialType(bp);
  const lead =
    bp.segments.find((s) => s.role === "lead") ?? bp.segments[0]!;
  const bodySegs = bp.segments.filter(
    (s) =>
      s.role === "development" &&
      !["evaluative_framing", "availability_or_catalog", "transition_only"].includes(
        s.primaryEvidenceType,
      ),
  );
  // Natural intro structure: at most 2 body SLOTS (content + optional placement).
  // This is slot structure — not a "write short" goal; Generator prose length is Evidence-driven.
  const bodyLimited = bodySegs.slice(0, 2);
  const leadOp = transform.segmentOps.find((o) => o.segmentIndex === lead.index);
  const globalAvoid = [
    ...new Set([...(bp.avoidPatterns ?? []), ...DEFAULT_AVOID, ...transform.catalogAvoidance]),
  ];

  return {
    schemaVersion: 1,
    referenceType,
    referenceId: bp.referenceId,
    articleShape: "natural_product_intro",
    title: {
      focus: lead.primaryEvidenceType,
      transformation: transform.titleTransformation,
    },
    opening: {
      purpose: NATURAL_PRODUCT_INTRO_STRUCTURE.slots[0]!.purpose,
      primaryEvidenceRole: lead.primaryEvidenceType,
      supportingEvidenceRoles: lead.evidenceTypeUsed
        .filter((t) => t !== lead.primaryEvidenceType)
        .slice(0, 3),
      packaging: leadOp?.clausePackaging ?? "NATURAL_COMPOSE",
      avoid: [...globalAvoid],
    },
    body: bodyLimited.map((seg, i) => {
      const op = transform.segmentOps.find((o) => o.segmentIndex === seg.index);
      return {
        order: i + 1,
        purpose:
          i === 0
            ? NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose
            : NATURAL_PRODUCT_INTRO_STRUCTURE.slots[2]!.purpose,
        primaryEvidenceRole: seg.primaryEvidenceType,
        supportingEvidenceRoles: seg.evidenceTypeUsed
          .filter((t) => t !== seg.primaryEvidenceType)
          .slice(0, 3),
        transformation: "natural_compose_multi_fact",
        transitionFromPrevious: op?.transitionStrategy ?? "continue_naturally",
        stopCondition: "stop_when_mapped_evidence_exhausted_do_not_pad",
        avoid: [...globalAvoid],
      };
    }),
    ending: {
      strategy: "optional_product_form_context_then_stop — CTA is channel widget",
    },
    globalAvoid,
  };
}

/** Fallback / preferred HOW: natural product intro (user quality-bar structure). */
export function writingSkeletonFallback(input: {
  materialDepth?: "scarce" | "standard" | "rich";
  openingStrategy?: string | null;
  developmentStrategy?: string | null;
}): WritingSkeleton {
  const scarce = input.materialDepth === "scarce";
  return {
    schemaVersion: 1,
    referenceType: scarce ? "scarce_material" : "natural_product_intro",
    referenceId: null,
    articleShape: "natural_product_intro",
    title: {
      focus: "performer_or_concrete_trait",
      transformation: "concise_identity_plus_key_traits",
    },
    opening: {
      purpose:
        input.openingStrategy ?? NATURAL_PRODUCT_INTRO_STRUCTURE.slots[0]!.purpose,
      primaryEvidenceRole: "performer_identity",
      supportingEvidenceRoles: ["series_or_event", "quantity_or_runtime", "body_trait"],
      packaging: "NATURAL_COMPOSE",
      avoid: [...DEFAULT_AVOID],
    },
    body: scarce
      ? []
      : [
          {
            order: 1,
            purpose:
              input.developmentStrategy ??
              NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose,
            primaryEvidenceRole: "quantity_or_runtime",
            supportingEvidenceRoles: ["scene_or_act", "body_trait", "series_or_event"],
            transformation: "natural_compose_multi_fact",
            transitionFromPrevious: "continue_naturally",
            stopCondition: "stop_when_mapped_evidence_exhausted_do_not_pad",
            avoid: [...DEFAULT_AVOID],
          },
        ],
    ending: {
      strategy: scarce
        ? "stop_when_opening_done — CTA is channel widget"
        : "optional_product_form_context_then_stop — CTA is channel widget",
    },
    globalAvoid: [...DEFAULT_AVOID],
  };
}

/**
 * Compact Writer prompt projection — HOW only (r43).
 * No assignedFacts / atom re-injection; planning assignment stays internal.
 */
export function toWritingSkeletonPromptContract(
  skeleton: WritingSkeleton | null | undefined,
): Record<string, unknown> | null {
  if (!skeleton) return null;

  return {
    articleShape: skeleton.articleShape ?? "natural_product_intro",
    opening: {
      purpose: skeleton.opening.purpose,
    },
    body: skeleton.body.map((b) => ({
      order: b.order,
      purpose: b.purpose,
    })),
    ending: {
      strategy: skeleton.ending.strategy,
    },
  };
}
