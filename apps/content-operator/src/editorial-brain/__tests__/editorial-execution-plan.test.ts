/**
 * Editorial execution plan — reference patterns → Planner HOW → prompt layers.
 */
import { describe, expect, it } from "vitest";
import {
  buildEditorialExecutionPlan,
  toCoreEditorialExecutionSlice,
  toEditorialExecutionPromptContract,
} from "../generation/editorial-execution-plan.js";
import {
  buildBrainGenerationInputContract,
  toBrainGenerationPromptContract,
} from "../generation/generation-input-contract.js";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { buildBlogChannelPlan } from "../channels/blog/adapter.js";
import { selectEditorialPattern } from "../../article-pattern/editorial-pattern.js";
import type { EditorialPattern } from "../../article-pattern/editorial-pattern.js";
import type { StructurePattern } from "../../article-pattern/structure-pattern.js";

const sparseEd: EditorialPattern = {
  patternId: "ed_sparse_test",
  label: "sparse_editorial_interest_1",
  sampleCount: 5,
  sourceObservationIds: [],
  sourceDomains: ["example.com"],
  fingerprint: "strongest_concrete_trait|sparse|scenario|balanced|bridge_cta",
  opening: {
    strategy: "strongest_concrete_trait",
    claimPriority: ["trait_or_scene", "performer"],
    claimAvoid: ["maker", "availability"],
    maxOpeningClaims: 2,
    preferTraitsEmbeddedInTitleClaims: true,
  },
  development: {
    strategy: "deepen_interest_with_new_supported_detail",
    eachParagraphMustAdvance: true,
    forbidRestatePriorClaims: true,
    forbidCatalogMetadataDetour: true,
    forbidGenericMetaEvaluation: true,
  },
  informationSelection: {
    priority: ["trait_or_scene", "performer"],
    omitWhenLowValue: ["availability", "maker"],
    maxClaimsSuggested: 4,
  },
  transition: { style: "advance_interest_to_next_supported_detail", requireNewAngleOrFact: true },
  ctaMotivation: {
    strategy: "bridge_from_established_interest",
    allowNewClaims: false,
    reuseEstablishedInterestOnly: true,
  },
  title: {
    strategy: "performer_plus_concrete_trait",
    avoidCatalogIdentityOnly: true,
    avoidFullProductTitle: true,
    preferCuriosityFromSupportedTrait: true,
    maxApproxChars: 48,
  },
  tone: {
    targetParagraphLength: "short",
    catalogStyleMax: "low",
    preferScenarioOrConcreteTrait: true,
    lowPerformerNameRepetition: true,
  },
  avoidCategories: ["catalog_narration", "unsupported_social_proof"],
  summaryRole: "list_snippet_not_body_restatement",
};

const denseEd: EditorialPattern = {
  ...sparseEd,
  patternId: "ed_dense_test",
  label: "multi_section_editorial_1",
  fingerprint: "strongest_concrete_trait|dense|scenario|balanced|bridge_cta",
};

const structure: StructurePattern = {
  patternId: "sp_test",
  label: "sparse_interest_flow_1",
  sampleCount: 3,
  sourceObservationIds: [],
  sourceDomains: ["example.com"],
  fingerprint: "fp",
  blocks: [
    {
      role: "hook",
      order: 1,
      heading: false,
      usesList: false,
      imageSlot: "hero",
      usesImage: true,
      approxChars: 120,
      claimPurpose: "strongest_interest_driver",
      paragraphCountHint: 1,
      allowOmitIfClaimsScarce: false,
      generation: {
        listPurpose: "none",
        maxNewClaims: 2,
        readerFunction: "open_with_the_single_most_interesting_confirmed_trait_or_identity",
        claimKindsAvoid: ["availability", "maker"],
        transitionFunction: "none_start",
        claimKindsPreferred: ["trait_or_scene"],
        avoidCatalogMetadata: true,
        preferShortParagraphs: true,
        forbidRestatePriorClaims: true,
        avoidMetaEvaluationPhrases: true,
      },
    },
    {
      role: "interest_development",
      order: 2,
      heading: false,
      usesList: false,
      imageSlot: "none",
      usesImage: false,
      approxChars: 180,
      claimPurpose: "new_supported_detail",
      paragraphCountHint: 2,
      allowOmitIfClaimsScarce: true,
      generation: {
        listPurpose: "none",
        maxNewClaims: 3,
        readerFunction: "develop_confirmed_scene_or_trait_so_reader_wants_to_know_more",
        claimKindsAvoid: ["availability"],
        transitionFunction: "deepen_hook_without_repeating_it",
        claimKindsPreferred: ["trait_or_scene", "performer"],
        avoidCatalogMetadata: true,
        preferShortParagraphs: true,
        forbidRestatePriorClaims: true,
        avoidMetaEvaluationPhrases: true,
      },
    },
  ],
  imageLayout: {
    preferredImageCount: 1,
    heroPosition: "before_lead",
    auxiliaryPosition: "none",
  },
  constraints: {
    forbidSummaryRestatement: true,
    forbidCatalogDump: true,
    preferFewHeadings: true,
    maxSections: 2,
    forbidCatalogHeadings: true,
    claimUsage: "selective",
    maxClaimsSuggested: 4,
  },
};

describe("editorial execution plan wiring", () => {
  it("selects dense editorial when materialDepth=rich", () => {
    const selected = selectEditorialPattern([sparseEd, denseEd], {
      materialDepth: "rich",
      preferDense: true,
    });
    expect(selected?.patternId).toBe("ed_dense_test");
  });

  it("selects sparse editorial when materialDepth=scarce", () => {
    const selected = selectEditorialPattern([sparseEd, denseEd], {
      materialDepth: "scarce",
      preferSparse: true,
    });
    expect(selected?.patternId).toBe("ed_sparse_test");
  });

  it("attaches EDITORIAL_PLAN layer into brainGenerationContract", () => {
    const execution = buildEditorialExecutionPlan({
      structurePattern: structure,
      editorialPattern: sparseEd,
      materialDepth: "standard",
      omitCtaBridge: true,
      omitInterestDevelopment: false,
    });
    expect(execution.source.editorialPatternId).toBe("ed_sparse_test");
    expect(execution.sectionRoles.some((s) => s.role === "interest_development")).toBe(true);
    expect(execution.scarceStrategy.allowCatalogPadding).toBe(false);

    const claims = [
      { id: "c1", statement: "高感度の反応が連続する展開が公開されている。", kind: "trait_or_scene" },
      { id: "c2", statement: "顔面ビンタを含む展開が公開されている。", kind: "trait_or_scene" },
    ];
    const core = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      availableClaims: claims,
      selectedClaims: claims,
      openingClaimIds: ["c1"],
      hookClaimIds: ["c1"],
      developmentClaimIds: ["c2"],
      structurePatternId: structure.patternId,
      editorialPatternId: sparseEd.patternId,
      editorialExecution: toCoreEditorialExecutionSlice(execution),
      titleStrategy: execution.titleStrategy,
      summaryStrategy: execution.summaryStrategy,
    });
    expect(core.editorialExecution?.openingStrategy).toBe("strongest_concrete_trait");

    const contract = buildBrainGenerationInputContract({
      corePlan: core,
      channelPlan: buildBlogChannelPlan(core),
      claims,
    });
    const prompt = toBrainGenerationPromptContract(contract);
    expect(prompt.layers).toBeTruthy();
    const layers = prompt.layers as { FACTS: unknown };
    expect(layers.FACTS).toBeTruthy();
    expect((prompt.layers as Record<string, unknown>).SEGMENT_CONTRACTS).toBeUndefined();
    const plan = toEditorialExecutionPromptContract(execution);
    expect(plan.openingStrategy).toBe("strongest_concrete_trait");
    expect(Array.isArray(prompt.priority) ? prompt.priority.join(" ") : String(prompt.priority)).toMatch(
      /ARTICLE_PLAN|FACTUAL/,
    );
    expect(prompt.segmentExecution).toBeUndefined();
  });
});
