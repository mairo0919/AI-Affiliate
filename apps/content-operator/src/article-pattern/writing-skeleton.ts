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
  NATURAL_PRODUCT_INTRO_STRUCTURE,
  OPTION_B_EVIDENCE_VOICE_RULE,
  OPTION_B_SLOT_STOP_CONDITION,
  OPTION_B_WRITER_SLOT_SPEECH,
  WRITER_VISIBLE_ARTICLE_SHAPE,
} from "./natural-product-intro-policy.js";

/** Internal skeleton avoid tags — never projected to Writer prompt (r105). */
const SKELETON_INTERNAL_AVOID: string[] = [
  "catalog_metadata_as_body_fuel",
  "external_product_reviewer_voice",
  "sku_evaluation_from_outside",
  "ungrounded_evaluation_only_sentence",
  "title_restatement_as_development",
  "pad_with_empty_connecting_or_evaluation_sentences",
];
import type { EditorialExecutionPlan } from "../editorial-brain/generation/editorial-execution-plan.js";
import type { SkeletonEvidenceAssignment } from "./skeleton-evidence-assignment.js";
import { projectWriterSafeFact, projectWriterSafeFactFromPackItem } from "./evidence-pack.js";
import type { EvidencePackItem } from "./evidence-pack.js";

/** Brain/Planner HOW fields projected into WRITING_SKELETON (r70/r83). */
export type WritingSkeletonBrainHowInput = {
  openingStrategy?: string;
  developmentStrategy?: string;
  materialDepth?: string;
  expansionGuidance?: string;
  informationProgression?: string[];
  contributionPolicy?: EditorialExecutionPlan["contributionPolicy"];
  repetitionPolicy?: EditorialExecutionPlan["repetitionPolicy"];
  experienceConstraints?: Array<{ failureClass: string; constraint: string }>;
  /** From editorialExecution.sectionRoles — not internal skeleton transform tokens. */
  bodyTransitionFromPrevious?: string;
  /** Article angle for Writer (r83) — no taxonomy / claim ids. */
  articleAngle?: string;
  readerFunction?: string;
};

export function brainHowFromEditorialExecution(
  plan: EditorialExecutionPlan,
): WritingSkeletonBrainHowInput {
  const bodyRole =
    plan.sectionRoles.find((r) => r.role === "interest_development") ?? plan.sectionRoles[0];
  return {
    openingStrategy: plan.openingStrategy,
    developmentStrategy: plan.developmentStrategy,
    materialDepth: plan.materialDepth,
    expansionGuidance:
      plan.materialDepth === "scarce" ? plan.scarceStrategy.note : plan.richStrategy.note,
    informationProgression: plan.informationProgression,
    contributionPolicy: plan.contributionPolicy,
    repetitionPolicy: plan.repetitionPolicy,
    bodyTransitionFromPrevious:
      bodyRole?.transitionFunction ?? "deepen_hook_without_repeating_it",
    articleAngle: plan.titleStrategy || plan.openingStrategy,
    readerFunction: bodyRole?.readerFunction,
  };
}

/** Fact strings only for Writer — no ids / types / taxonomy. r94: Writer-safe projection. */
function slotAssignedFactStrings(
  primary: EvidencePackItem | null | undefined,
  supporting: EvidencePackItem[] | undefined,
  max = 4,
  opts?: { allowTitleIdentityCore?: boolean },
): string[] {
  const out: string[] = [];
  const pushItem = (item: EvidencePackItem | null | undefined) => {
    if (!item?.fact) return;
    let safe = item.generationEligible
      ? projectWriterSafeFactFromPackItem(item)
      : projectWriterSafeFact(item.fact, String(item.type), item.provenance.sourceType);
    // r108: title planned-core visibility — R83 often assigns performer_identity from product_title;
    // Writer-safe projection drops bare names, which would leave title.assignedFacts empty.
    // This is visibility of the existing assignment only (not a new fact assignment).
    if (
      !safe &&
      opts?.allowTitleIdentityCore &&
      item.type === "performer_identity" &&
      item.provenance.sourceType === "product_title"
    ) {
      const raw = item.fact.trim();
      if (raw.length >= 2 && raw.length <= 40) safe = raw;
    }
    if (!safe || out.includes(safe)) return;
    out.push(safe);
  };
  pushItem(primary ?? null);
  for (const s of supporting ?? []) {
    pushItem(s);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

function progressionRulesFromBrainHow(
  brainHow?: WritingSkeletonBrainHowInput | null,
): Record<string, unknown> {
  const cp = brainHow?.contributionPolicy;
  const rp = brainHow?.repetitionPolicy;
  const scarce = brainHow?.materialDepth === "scarce";
  return {
    forbidRestatePriorClaims: cp?.forbidRestatePriorClaims ?? true,
    eachParagraphMustAdvance: cp?.eachParagraphMustAdvance ?? true,
    forbidCatalogMetadataDetour: cp?.forbidCatalogMetadataDetour ?? true,
    forbidGenericMetaEvaluation: cp?.forbidGenericMetaEvaluation ?? true,
    requireNewAngleOrFact: rp?.requireNewAngleOrFact ?? true,
    repetitionStyle: rp?.style ?? "no_cross_role_restatement",
    // r91/r108 — cross-slot progression (additive; not absolute family exclusion)
    // Title↔lead may share a fact family (aligns with R83 allowReuseInOpening).
    // Lead must not be title paraphrase-only: add unused concrete when Evidence has it.
    forbidTitleLeadParaphrase: true,
    requireLeadAdditiveConcreteWhenAvailable: true,
    forbidBodyOpenWithLeadRestatement: true,
    evidenceVoiceRule: OPTION_B_EVIDENCE_VOICE_RULE,
    // r110: slot speech lives only on title/opening/body notes — no duplicate speechAct strings here
    // r79 — continue while unused concrete remains
    stopWhenConcreteEvidenceExhausted: true,
    // r112 — realization-complete / sufficiency (merged former noEvaluativePadding)
    stopWhenSlotRealizationComplete: true,
    noCompletionOnlySemanticAddon: true,
    ...(scarce
      ? {
          preferShortDense: true,
          maxBodyAdvancesBeyondLead: 1,
        }
      : {}),
  };
}

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

const DEFAULT_AVOID = SKELETON_INTERNAL_AVOID;

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
      packaging: leadOp?.clausePackaging ?? "COMPOSE_AS_WORK_CONTENT",
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
        transformation: "compose_assigned_facts_as_work_content",
        transitionFromPrevious: op?.transitionStrategy ?? "deepen_hook_without_repeating_it",
        stopCondition: OPTION_B_SLOT_STOP_CONDITION,
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
      packaging: "COMPOSE_AS_WORK_CONTENT",
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
            transformation: "compose_assigned_facts_as_work_content",
            transitionFromPrevious: "deepen_hook_without_repeating_it",
            stopCondition: OPTION_B_SLOT_STOP_CONDITION,
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
 * Compact Writer prompt projection — article plan HOW (r43/r83).
 *
 * r83: Propagate Brain/Planner composition plan (angle, readerFunction, assignedFacts
 * as fact strings, packaging/transformation/stopCondition). Still omit taxonomy,
 * evidence types, claimIds, SEGMENT, ClaimUsagePlan.
 *
 * r60: EditorialExecution deepen_hook reaches Writer via body transition.
 */
export function toWritingSkeletonPromptContract(
  skeleton: WritingSkeleton | null | undefined,
  brainHow?: WritingSkeletonBrainHowInput | null,
  assignment?: SkeletonEvidenceAssignment | null,
): Record<string, unknown> | null {
  if (!skeleton) return null;

  const openingSlot = NATURAL_PRODUCT_INTRO_STRUCTURE.slots[0]!;
  const bodyContentSlot = NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!;
  const bodyOptionalSlot = NATURAL_PRODUCT_INTRO_STRUCTURE.slots[2]!;

  const openingFacts = assignment
    ? slotAssignedFactStrings(assignment.opening.primary, assignment.opening.supporting)
    : [];
  // r108 — project R83 title assignment as planned core (visibility only; not verbatim duty)
  const titleFacts = assignment
    ? slotAssignedFactStrings(assignment.title.primary, assignment.title.supporting, 4, {
        allowTitleIdentityCore: true,
      })
    : [];

  const out: Record<string, unknown> = {
    // r110 — Writer-visible shape (internal skeleton may still use natural_product_intro)
    articleShape: WRITER_VISIBLE_ARTICLE_SHAPE,
    title: {
      purpose: OPTION_B_WRITER_SLOT_SPEECH.title.purpose,
      note: OPTION_B_WRITER_SLOT_SPEECH.title.note,
      ...(titleFacts.length > 0 ? { assignedFacts: titleFacts } : {}),
    },
    opening: {
      purpose: openingSlot.purpose,
      note: openingSlot.note,
      packaging: skeleton.opening.packaging,
      ...(openingFacts.length > 0 ? { assignedFacts: openingFacts } : {}),
    },
    body: skeleton.body.map((b) => {
      const slotNote = b.order <= 1 ? bodyContentSlot.note : bodyOptionalSlot.note;
      const bodyAssign = assignment?.body.find((x) => x.order === b.order);
      const bodyFacts = bodyAssign
        ? slotAssignedFactStrings(bodyAssign.primary, bodyAssign.supporting)
        : [];
      return {
        order: b.order,
        purpose: b.purpose,
        note: slotNote,
        transformation: b.transformation,
        ...(b.stopCondition ? { stopCondition: b.stopCondition } : {}),
        transitionFromPrevious:
          brainHow?.bodyTransitionFromPrevious ?? "deepen_hook_without_repeating_it",
        ...(bodyFacts.length > 0 ? { assignedFacts: bodyFacts } : {}),
      };
    }),
    ending: {
      strategy: skeleton.ending.strategy,
    },
    progressionRules: progressionRulesFromBrainHow(brainHow),
  };

  if (brainHow?.articleAngle) out.articleAngle = brainHow.articleAngle;
  if (brainHow?.readerFunction) out.readerFunction = brainHow.readerFunction;
  if (brainHow?.openingStrategy) out.openingStrategy = brainHow.openingStrategy;
  if (brainHow?.developmentStrategy) out.developmentStrategy = brainHow.developmentStrategy;
  if (brainHow?.materialDepth) out.materialDepth = brainHow.materialDepth;
  if (brainHow?.expansionGuidance) out.expansionGuidance = brainHow.expansionGuidance;
  if (brainHow?.informationProgression?.length) {
    out.informationProgression = brainHow.informationProgression;
  }
  if (brainHow?.experienceConstraints?.length) {
    out.experienceConstraints = brainHow.experienceConstraints.slice(0, 3);
  }

  return out;
}
