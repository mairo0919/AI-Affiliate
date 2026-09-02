/**
 * Executable Editorial Plan — bridges reference-derived Structure/Editorial Patterns
 * into Planner → Generation Contract (not competitor prose).
 *
 * Claims = WHAT to write. EditorialExecutionPlan = HOW to develop the article.
 */

import type { EditorialPattern } from "../../article-pattern/editorial-pattern.js";
import type { StructurePattern } from "../../article-pattern/structure-pattern.js";
import type { DevelopmentDepth } from "../core/types.js";

export type SectionRolePlan = {
  role: string;
  readerFunction: string;
  transitionFunction: string;
  maxNewClaims: number;
  optional: boolean;
  headingRequired: boolean;
  avoidCatalogMetadata: boolean;
  forbidRestatePriorClaims: boolean;
};

export type EditorialExecutionPlan = {
  /** Provenance from ACTIVE Format.metadata patterns */
  source: {
    structurePatternId: string | null;
    structurePatternLabel: string | null;
    editorialPatternId: string | null;
    editorialPatternLabel: string | null;
    sourceDomains: string[];
  };
  materialDepth: DevelopmentDepth;
  openingStrategy: string;
  developmentStrategy: string;
  informationProgression: string[];
  sectionRoles: SectionRolePlan[];
  contributionPolicy: {
    leadMaxClaims: number;
    eachParagraphMustAdvance: boolean;
    forbidRestatePriorClaims: boolean;
    forbidCatalogMetadataDetour: boolean;
    forbidGenericMetaEvaluation: boolean;
  };
  scarceStrategy: {
    mode: "short_dense" | "standard" | "multi_detail";
    allowCatalogPadding: false;
    preferDeferWhenNoConcreteBody: boolean;
    note: string;
  };
  richStrategy: {
    mode: "compose_assigned_slots" | "compressed";
    preferDenseEditorialPattern: boolean;
    note: string;
  };
  repetitionPolicy: {
    style: "no_cross_role_restatement";
    requireNewAngleOrFact: boolean;
  };
  summaryStrategy: string;
  ctaBridge: {
    strategy: string;
    omit: boolean;
    allowNewClaims: false;
  };
  titleStrategy: string;
  avoidCategories: string[];
  generatorDuty: string[];
};

/**
 * Build executable plan from retrieved reference patterns + material depth.
 * Never embeds competitor article text.
 */
export function buildEditorialExecutionPlan(input: {
  structurePattern: StructurePattern | null;
  editorialPattern: EditorialPattern | null;
  materialDepth: DevelopmentDepth;
  omitCtaBridge: boolean;
  omitInterestDevelopment: boolean;
}): EditorialExecutionPlan {
  const editorial = input.editorialPattern;
  const structure = input.structurePattern;
  const depth = input.materialDepth;

  const sectionRoles: SectionRolePlan[] = (structure?.blocks ?? [])
    .filter((b) => b.role !== "hook")
    .map((b) => ({
      role: b.role,
      readerFunction:
        b.generation?.readerFunction ??
        (b.role === "interest_development"
          ? "carry_reader_through_what_happens_from_evidence"
          : b.role === "cta_bridge"
            ? "bridge_from_established_interest_to_cta"
            : "advance_with_new_supported_content_detail"),
      transitionFunction:
        b.generation?.transitionFunction ?? "advance_interest_to_next_supported_detail",
      maxNewClaims: b.generation?.maxNewClaims ?? 2,
      optional: b.allowOmitIfClaimsScarce === true || input.omitInterestDevelopment,
      headingRequired: Boolean(b.heading),
      avoidCatalogMetadata: b.generation?.avoidCatalogMetadata !== false,
      forbidRestatePriorClaims: b.generation?.forbidRestatePriorClaims !== false,
    }));

  // When structure has no body blocks, synthesize one interest slot from editorial
  if (sectionRoles.length === 0 && !input.omitInterestDevelopment) {
    sectionRoles.push({
      role: "interest_development",
      readerFunction: "carry_reader_through_what_happens_from_evidence",
      transitionFunction: "deepen_hook_without_repeating_it",
      maxNewClaims: depth === "rich" ? 3 : 2,
      optional: false,
      headingRequired: false,
      avoidCatalogMetadata: true,
      forbidRestatePriorClaims: true,
    });
  }

  const scarceMode =
    depth === "scarce" || input.omitInterestDevelopment
      ? "short_dense"
      : depth === "rich"
        ? "multi_detail"
        : "standard";

  const informationProgression: string[] = [
    `open:${editorial?.opening.strategy ?? "strongest_concrete_trait"}`,
    ...(depth === "scarce"
      ? ["body:one_unused_concrete_then_stop"]
      : input.omitInterestDevelopment
        ? ["body:omit_or_minimal_non_catalog_line"]
        : ["body:compose_assigned_slot_facts"]),
    `summary:${editorial?.summaryRole ?? "list_snippet_not_body_restatement"}`,
    input.omitCtaBridge ? "cta:widget_only" : "cta:bridge_from_interest",
  ];

  return {
    source: {
      structurePatternId: structure?.patternId ?? null,
      structurePatternLabel: structure?.label ?? null,
      editorialPatternId: editorial?.patternId ?? null,
      editorialPatternLabel: editorial?.label ?? null,
      sourceDomains: [
        ...new Set([
          ...(editorial?.sourceDomains ?? []),
          ...(structure?.sourceDomains ?? []),
        ]),
      ].slice(0, 8),
    },
    materialDepth: depth,
    openingStrategy: editorial?.opening.strategy ?? "strongest_concrete_trait",
    developmentStrategy:
      depth === "scarce"
        ? "short_dense_stop_when_concrete_exhausted"
        : (editorial?.development.strategy ?? "compose_assigned_evidence_into_content_prose"),
    informationProgression,
    sectionRoles: input.omitCtaBridge
      ? sectionRoles.filter((s) => s.role !== "cta_bridge")
      : sectionRoles,
    contributionPolicy: {
      leadMaxClaims: editorial?.opening.maxOpeningClaims ?? 2,
      eachParagraphMustAdvance: editorial?.development.eachParagraphMustAdvance ?? true,
      forbidRestatePriorClaims: editorial?.development.forbidRestatePriorClaims ?? true,
      forbidCatalogMetadataDetour: editorial?.development.forbidCatalogMetadataDetour ?? true,
      forbidGenericMetaEvaluation: editorial?.development.forbidGenericMetaEvaluation ?? true,
    },
    scarceStrategy: {
      mode: scarceMode === "short_dense" ? "short_dense" : scarceMode === "multi_detail" ? "multi_detail" : "standard",
      allowCatalogPadding: false,
      preferDeferWhenNoConcreteBody: true,
      note:
        scarceMode === "short_dense"
          ? "Few concrete facts: keep article short and dense. Stop when unused concrete evidence is exhausted. Do not pad with evaluation or maker/availability/独占-only. Prefer DEFER over filler."
          : "Use only unused concrete facets in body; never catalog padding.",
    },
    richStrategy: {
      mode: depth === "rich" ? "compose_assigned_slots" : "compressed",
      preferDenseEditorialPattern: depth === "rich",
      note:
        depth === "rich"
          ? "Compose each slot's assignedFacts into evidence-grounded work-content prose. Do not enumerate leftover evidence in sequence. Fulfill the slot plan, then stop."
          : "Standard depth: compose assigned opening/body facts as work content; one body advance beyond lead is enough.",
    },
    repetitionPolicy: {
      style: "no_cross_role_restatement",
      requireNewAngleOrFact: editorial?.transition.requireNewAngleOrFact ?? true,
    },
    summaryStrategy: editorial?.summaryRole ?? "list_snippet_not_body_restatement",
    ctaBridge: {
      strategy: editorial?.ctaMotivation.strategy ?? "bridge_from_established_interest",
      omit: input.omitCtaBridge,
      allowNewClaims: false,
    },
    titleStrategy: editorial?.title.strategy ?? "performer_plus_concrete_trait",
    avoidCategories: editorial?.avoidCategories ?? [
      "unsupported_social_proof",
      "generic_meta_evaluation",
      "non_informational_filler",
      "catalog_narration",
      "generic_cta_boilerplate",
      "full_product_title_copy",
      "catalog_identity_title",
    ],
    generatorDuty: [
      "Execute EDITORIAL_PLAN using only FACTS (supported contributions).",
      "Describe work content from facts — do not write as external SKU reviewer.",
      "Do not invent facts, evaluations, social proof, or catalog padding.",
      "Do not copy competitor wording (none is provided — patterns are abstract strategies only).",
      "Lead uses openingStrategy + lead required contributions only.",
      "Each body paragraph must advance with a new allowed contribution (never restate lead facets).",
      "If scarceStrategy says preferDeferWhenNoConcreteBody and body would be catalog-only: leave body minimal / system may DEFER — do not invent.",
      "Summary is a list snippet, not a body restatement.",
    ],
  };
}

/** Prompt-facing slice — clear FACTS / PLAN separation companion. */
export function toEditorialExecutionPromptContract(
  plan: EditorialExecutionPlan,
): Record<string, unknown> {
  return {
    source: plan.source,
    materialDepth: plan.materialDepth,
    openingStrategy: plan.openingStrategy,
    developmentStrategy: plan.developmentStrategy,
    informationProgression: plan.informationProgression,
    sectionRoles: plan.sectionRoles,
    contributionPolicy: plan.contributionPolicy,
    scarceStrategy: plan.scarceStrategy,
    richStrategy: plan.richStrategy,
    repetitionPolicy: plan.repetitionPolicy,
    summaryStrategy: plan.summaryStrategy,
    ctaBridge: plan.ctaBridge,
    titleStrategy: plan.titleStrategy,
    avoidCategories: plan.avoidCategories,
    generatorDuty: plan.generatorDuty,
  };
}

/** Compact slice stored on CoreEditorialPlan for BrainRun traces. */
export function toCoreEditorialExecutionSlice(
  plan: EditorialExecutionPlan,
): import("../core/types.js").CoreEditorialExecutionSlice {
  return {
    openingStrategy: plan.openingStrategy,
    developmentStrategy: plan.developmentStrategy,
    informationProgression: plan.informationProgression,
    sectionRoles: plan.sectionRoles.map((s) => ({
      role: s.role,
      readerFunction: s.readerFunction,
      transitionFunction: s.transitionFunction,
      maxNewClaims: s.maxNewClaims,
      optional: s.optional,
    })),
    scarceStrategyMode: plan.scarceStrategy.mode,
    repetitionPolicy: plan.repetitionPolicy.style,
    summaryStrategy: plan.summaryStrategy,
    ctaBridgeOmit: plan.ctaBridge.omit,
    titleStrategy: plan.titleStrategy,
    avoidCategories: plan.avoidCategories,
    patternSource: {
      structurePatternId: plan.source.structurePatternId,
      editorialPatternId: plan.source.editorialPatternId,
      structurePatternLabel: plan.source.structurePatternLabel,
      editorialPatternLabel: plan.source.editorialPatternLabel,
      sourceDomains: plan.source.sourceDomains,
    },
  };
}
