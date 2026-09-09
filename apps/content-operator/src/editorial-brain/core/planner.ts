/**
 * Deterministic Core Planner — no LLM in Phase 1.
 * Reuses claim selection / usage allocation concepts without owning generation.
 */

import { buildClaimProfileFingerprint } from "./claim-profile.js";
import { extractTextFacets } from "../generation/text-surface.js";
import type {
  ClaimAllocation,
  CoreEditorialPlan,
  DevelopmentDepth,
  EditorialChannelId,
  InferencePolicy,
  OmittedClaim,
} from "./types.js";

const META_PLAN_KINDS = new Set(["maker", "availability", "temporal_sale", "label"]);

const DEFAULT_INFERENCE: InferencePolicy = {
  allowed: ["direct_paraphrase", "safe_composition", "editorial_interpretation"],
  forbidden: ["social_proof", "name_derived_setting", "external_world_claim"],
};

export type PlannerClaimInput = {
  id: string;
  statement: string;
  kind: string;
};

export type BuildCorePlanInput = {
  channel: EditorialChannelId;
  formatKey: string | null;
  contentType: string;
  availableClaims: PlannerClaimInput[];
  selectedClaims: PlannerClaimInput[];
  deferredClaimIds?: string[];
  openingClaimIds: string[];
  hookClaimIds: string[];
  developmentClaimIds: string[];
  structurePatternId: string | null;
  editorialPatternId: string | null;
  retrievedExperienceIds?: string[];
  softLengthGuidance?: {
    targetMaxCharsApprox: number;
    targetMaxParagraphs: number;
  } | null;
  /** Optional executable HOW from reference patterns */
  editorialExecution?: import("./types.js").CoreEditorialExecutionSlice | null;
  /** Override strategies when editorial execution is provided */
  titleStrategy?: string;
  summaryStrategy?: string;
  ctaStrategy?: string;
};

export function buildCoreEditorialPlan(input: BuildCorePlanInput): CoreEditorialPlan {
  const selectedSet = new Set(input.selectedClaims.map((c) => c.id));
  const hookSet = new Set(input.hookClaimIds);
  const devSet = new Set(input.developmentClaimIds);

  const omittedClaimIds: OmittedClaim[] = [];
  for (const c of input.availableClaims) {
    if (!selectedSet.has(c.id)) {
      omittedClaimIds.push({
        claimId: c.id,
        reason: (input.deferredClaimIds ?? []).includes(c.id)
          ? "deferred_by_selection"
          : "not_selected",
      });
    }
  }
  for (const c of input.selectedClaims) {
    if (!hookSet.has(c.id) && !devSet.has(c.id)) {
      omittedClaimIds.push({ claimId: c.id, reason: "selected_but_unallocated" });
    }
  }

  const claimAllocation: ClaimAllocation[] = input.selectedClaims.map((c) => ({
    claimId: c.id,
    kind: c.kind,
    role: hookSet.has(c.id)
      ? "opening"
      : devSet.has(c.id)
        ? "development"
        : "unused",
  }));

  const assigned = claimAllocation.filter((a) => a.role !== "unused").length;
  // Scarcity = low SUPPORTED informational capacity, not merely ≤2 assigned claimIds.
  // A single long title/trait claim can carry enough facets for short editorial posts.
  const editorialSelected = input.selectedClaims.filter(
    (c) => !META_PLAN_KINDS.has((c.kind ?? "").toLowerCase()),
  );
  const facetKeys = new Set<string>();
  for (const c of editorialSelected) {
    for (const f of extractTextFacets(c.statement)) {
      const key = f.replace(/\s+/g, "").toLowerCase();
      if (key.length >= 2) facetKeys.add(key);
    }
  }
  // Capacity for depth = strong editorial differentiators (qty/scene), not name/catalog noise.
  const STRONG_FACET_RE =
    /\d+(?:名|時間|作品|分|人|泊|日)|ベロキス|セックス|舐め|痴女|わからせ|乱交|生ハメ|潮|ピストン|ナンパ|巨乳|水着|メスガキ|超敏感|ガッチリ|痙攣|発掘|育成|バスツアー/;
  const editorialFacetCapacity = [...facetKeys].filter((k) => STRONG_FACET_RE.test(k)).length;
  // Scarce when strong differentiators are thin (performer-name bags do not inflate).
  const scarcityMode =
    editorialSelected.length === 0 || editorialFacetCapacity <= 1;
  const developmentDepth: DevelopmentDepth =
    assigned >= 5 || editorialFacetCapacity >= 5
      ? "rich"
      : scarcityMode
        ? "scarce"
        : "standard";

  // Target = expected novel supported assertions (not claim-ID appearance count).
  // X single posts: 1 concrete SUPPORTED contribution is enough — do not force blog-scale gain.
  const informationGainTarget =
    input.channel === "X"
      ? developmentDepth === "rich"
        ? 2
        : 1
      : developmentDepth === "scarce"
        ? 1
        : developmentDepth === "rich"
          ? 3
          : 2;

  const claimProfile = buildClaimProfileFingerprint(input.selectedClaims, {
    formatKey: input.formatKey,
    contentType: input.contentType,
  });

  return {
    channel: input.channel,
    formatKey: input.formatKey,
    contentType: input.contentType,
    availableClaimIds: input.availableClaims.map((c) => c.id),
    selectedClaimIds: input.selectedClaims.map((c) => c.id),
    omittedClaimIds,
    openingDriverClaimIds: input.openingClaimIds.slice(0, Math.max(1, Math.min(2, assigned || 1))),
    claimAllocation,
    structurePatternId: input.structurePatternId,
    editorialPatternId: input.editorialPatternId,
    developmentDepth,
    informationGainTarget,
    scarcityMode,
    titleStrategy:
      input.titleStrategy ??
      input.editorialExecution?.titleStrategy ??
      "performer_or_identity_plus_concrete_trait",
    summaryStrategy:
      input.summaryStrategy ??
      input.editorialExecution?.summaryStrategy ??
      "list_snippet_from_central_claims_not_meta_intro",
    ctaStrategy:
      input.ctaStrategy ??
      (input.editorialExecution?.ctaBridgeOmit
        ? "widget_only_no_generic_bridge"
        : "omit_bridge_unless_editorial_value"),
    inferencePolicy: DEFAULT_INFERENCE,
    catalogMetadataPolicy: { allowCatalogDump: false, preferNaturalProse: true },
    retrievedExperienceIds: input.retrievedExperienceIds ?? [],
    claimProfile,
    softLengthGuidance: input.softLengthGuidance,
    editorialExecution: input.editorialExecution ?? null,
  };
}
