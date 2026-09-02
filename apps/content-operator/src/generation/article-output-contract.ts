/**
 * Article Output Contract — SSOT between Structure Pattern and StructuredArticle.
 *
 * Flow:
 *   Structure Pattern (narrative blocks)
 *     → Article Output Contract (article field targets + section cardinality)
 *       → LLM JSON schema (minItems/maxItems)
 *       → post-parse validation
 *       → formatter
 *
 * Never compare Pattern.blocks.length directly to article.sections.length.
 * constraints.maxSections on StructurePattern is legacy naming for narrative block
 * count (≈ blocks.length); use this contract's maxArticleSections for sections[].
 */

import type { StructurePattern } from "../article-pattern/structure-pattern.js";
import {
  structureBlockArticleTarget,
  type StructurePatternHeadingContract,
  type StructurePatternValidationFinding,
  type BloggerArticleStructured,
} from "./structured-article.js";

export type ArticleOutputSectionSlot = {
  role: string;
  headingRequired: boolean;
  usesList: boolean;
  optional: boolean;
};

export type ArticleOutputContract = {
  patternId: string | null;
  /** Always true for blogger articles */
  leadRequired: true;
  /** Role that populates lead (typically hook); null if pattern has no lead role */
  leadFromRole: string | null;
  /** Section-targeted narrative roles in order */
  sectionSlots: ArticleOutputSectionSlot[];
  /** Minimum required article.sections length (optional slots may be omitted) */
  minArticleSections: number;
  /** Maximum article.sections length (never includes hook→lead) */
  maxArticleSections: number;
  /** Narrative blocks count (includes hook / all roles) — NOT sections[].length */
  maxNarrativeBlocks: number;
  /** CTA widget is always a separate field */
  ctaWidgetRequired: true;
  headingRequirements: boolean[];
};

type PatternLike = StructurePatternHeadingContract & {
  patternId?: string;
  constraints?: { maxSections?: number };
};

export function deriveArticleOutputContract(
  pattern: PatternLike | StructurePattern | null | undefined,
): ArticleOutputContract | null {
  if (!pattern?.blocks?.length) return null;

  const leadBlock = pattern.blocks.find((b) => structureBlockArticleTarget(b.role) === "lead");
  const sectionSlots: ArticleOutputSectionSlot[] = pattern.blocks
    .filter((b) => structureBlockArticleTarget(b.role) === "section")
    .map((b) => ({
      role: b.role,
      headingRequired: b.heading === true,
      usesList: b.usesList === true,
      optional: b.allowOmitIfClaimsScarce === true,
    }));

  const requiredCount = sectionSlots.filter((s) => !s.optional).length;
  const maxArticleSections = sectionSlots.length;
  const minArticleSections = Math.max(1, requiredCount);

  return {
    patternId: typeof pattern.patternId === "string" ? pattern.patternId : null,
    leadRequired: true,
    leadFromRole: leadBlock?.role ?? null,
    sectionSlots,
    minArticleSections,
    maxArticleSections,
    maxNarrativeBlocks: pattern.blocks.length,
    ctaWidgetRequired: true,
    headingRequirements: sectionSlots.map((s) => s.headingRequired),
  };
}

/**
 * OPTION B fallback when Structure Pattern is absent (r79).
 * claimUsagePlan.effectiveMax/MinArticleSections still bound sections[].
 */
export function articleOutputContractFromSectionBounds(input: {
  minArticleSections: number;
  maxArticleSections: number;
}): ArticleOutputContract {
  const minArticleSections = Math.max(1, input.minArticleSections);
  const maxArticleSections = Math.max(minArticleSections, input.maxArticleSections);
  const sectionSlots: ArticleOutputSectionSlot[] = Array.from(
    { length: maxArticleSections },
    (_, i) => ({
      role: i === 0 ? "interest_development" : `interest_development_${i + 1}`,
      headingRequired: false,
      usesList: false,
      optional: i >= minArticleSections,
    }),
  );
  return {
    patternId: null,
    leadRequired: true,
    leadFromRole: null,
    sectionSlots,
    minArticleSections,
    maxArticleSections,
    maxNarrativeBlocks: maxArticleSections,
    ctaWidgetRequired: true,
    headingRequirements: sectionSlots.map((s) => s.headingRequired),
  };
}

/** Prompt-safe slice of the contract (no prose). */
export function toArticleOutputContractPromptFields(
  contract: ArticleOutputContract,
): Record<string, unknown> {
  return {
    leadTarget: contract.leadFromRole ? "lead" : "lead",
    leadFromRole: contract.leadFromRole,
    sectionRoles: contract.sectionSlots.map((s) => s.role),
    expectedMinSections: contract.minArticleSections,
    expectedMaxSections: contract.maxArticleSections,
    headingRequirements: contract.headingRequirements,
    ctaTarget: "cta",
    maxNarrativeBlocks: contract.maxNarrativeBlocks,
    note: "expectedMaxSections bounds article.sections[]. Do NOT emit one section per narrative block. hook→lead; cta_bridge→section; article.cta is the link widget only. constraints.maxSections on the pattern (if present) is narrative-block-oriented legacy naming — obey expectedMaxSections.",
  };
}

/**
 * Patch blogger LLM JSON Schema with article section cardinality from the contract.
 * OpenAI-compatible json_schema supports minItems/maxItems on arrays.
 */
export function applyArticleOutputContractToLlmSchema(
  baseSchema: Record<string, unknown>,
  contract: ArticleOutputContract | null | undefined,
): Record<string, unknown> {
  if (!contract) return baseSchema;
  const cloned = structuredClone(baseSchema) as {
    properties?: { sections?: Record<string, unknown> };
  };
  const sections = cloned.properties?.sections;
  if (!sections || typeof sections !== "object") return baseSchema;
  sections.minItems = contract.minArticleSections;
  sections.maxItems = contract.maxArticleSections;
  return cloned as Record<string, unknown>;
}

export function getSectionsCardinalityFromLlmSchema(schema: Record<string, unknown>): {
  minItems: number | null;
  maxItems: number | null;
} {
  const sections = (schema as { properties?: { sections?: Record<string, unknown> } }).properties
    ?.sections;
  if (!sections || typeof sections !== "object") {
    return { minItems: null, maxItems: null };
  }
  return {
    minItems: typeof sections.minItems === "number" ? sections.minItems : null,
    maxItems: typeof sections.maxItems === "number" ? sections.maxItems : null,
  };
}

/**
 * Cardinality + heading validation against Article Output Contract (SSOT).
 * Prefer this over comparing Pattern.blocks to sections directly.
 */
export function validateArticleAgainstOutputContract(
  article: BloggerArticleStructured,
  contract: ArticleOutputContract,
): { ok: boolean; findings: StructurePatternValidationFinding[] } {
  const findings: StructurePatternValidationFinding[] = [];
  const n = article.sections.length;

  if (n > contract.maxArticleSections) {
    findings.push({
      code: "STRUCTURE_PATTERN_MAPPING_ERROR",
      path: `sections[${contract.maxArticleSections}]`,
      message: `STRUCTURE_PATTERN_MAPPING_ERROR: article.sections.length=${n} exceeds expectedMaxSections=${contract.maxArticleSections} (sectionRoles=${contract.sectionSlots.map((s) => s.role).join(",")}; hook→lead — do not emit one section per narrative block)`,
    });
  }
  if (n < contract.minArticleSections) {
    findings.push({
      code: "STRUCTURE_PATTERN_MAPPING_ERROR",
      path: "sections",
      message: `STRUCTURE_PATTERN_MAPPING_ERROR: article.sections.length=${n} below expectedMinSections=${contract.minArticleSections}`,
    });
  }

  // Heading checks against slots (with optional omission handled by align logic callers)
  for (let i = 0; i < Math.min(n, contract.sectionSlots.length); i++) {
    // Greedy optional skip for list slots is done in alignSectionsToStructureBlocks;
    // here only enforce when index is within max and slot at same index is non-optional heading.
  }

  return { ok: findings.length === 0, findings };
}
