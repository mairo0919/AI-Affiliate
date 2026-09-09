/**
 * OPTION B Blogger channel — Writer realizes ARTICLE_PLAN as Japanese JSON.
 * Planner owns WHAT / FACT boundary; Writer owns natural prose + editorial interpretation.
 * R151: ARTICLE_PLAN_EXECUTION carries identity/relation safety — not prose templates.
 * CTA is system-appended (not Writer-generated).
 */

import {
  getOptionBBloggerArticleLlmJsonSchema,
  getOptionBBloggerArticleContractExample,
  OPTION_B_LLM_REQUIRED_KEYS,
} from "../../generation/structured-article.js";
import type { ArticleOutputContract } from "../../generation/article-output-contract.js";
import { applyArticleOutputContractToLlmSchema } from "../../generation/article-output-contract.js";
import { OPTION_B_WRITER_SYSTEM } from "../../article-pattern/natural-product-intro-policy.js";
import { formatWritingQualityGuidanceForWriter } from "./success-experience.js";

/**
 * Writer-visible ARTICLE_PLAN: keep facts/jobs; hide internal HOW taxonomy dumps.
 * bodyProgression / factSourceTypes stay Planner-internal (FACT safety uses EXECUTION.notAllowed).
 */
export function toWriterVisibleArticlePlan(plan: unknown): unknown {
  if (!plan || typeof plan !== "object") return plan;
  const p = plan as Record<string, unknown>;
  const body = Array.isArray(p.body)
    ? (p.body as Array<Record<string, unknown>>).map((slot) => {
        const next = { ...slot };
        delete next.factSourceTypes;
        // Keep presentationPurpose lightly if present — optional grouping hint only.
        return next;
      })
    : p.body;
  const out: Record<string, unknown> = {
    schemaVersion: p.schemaVersion,
    materialDepth: p.materialDepth,
    productTitle: p.productTitle,
    title: p.title,
    lead: p.lead,
    body,
  };
  if (p.purpose) out.purpose = p.purpose;
  if (p.coreAngle) out.coreAngle = p.coreAngle;
  // SOURCE density ceiling — length permission, not a paragraph template.
  if (p.sourceExpansion && typeof p.sourceExpansion === "object") {
    const se = p.sourceExpansion as Record<string, unknown>;
    out.sourceExpansion = {
      resolution: se.resolution,
      writerDensityNote: se.writerDensityNote,
    };
  }
  // Intentionally omit bodyProgression.writerNote / full progression dump from Writer surface.
  return out;
}

/** Slim EXECUTION for Writer: FACT safety fields only — no taxonomy lecture notes. */
export function toWriterVisibleExecution(execution: unknown): unknown {
  if (!Array.isArray(execution)) return execution;
  return execution.map((row) => {
    if (!row || typeof row !== "object") return row;
    const r = row as Record<string, unknown>;
    return {
      contributionId: r.contributionId,
      slot: r.slot,
      fact: r.fact,
      executionMode: r.executionMode,
      requiredAnchors: r.requiredAnchors,
      requiredRelations: r.requiredRelations,
      mustPreserve: r.mustPreserve,
      allowed: r.allowed,
      notAllowed: r.notAllowed,
      ...(r.informationAxis ? { informationAxis: r.informationAxis } : {}),
    };
  });
}

export function buildOptionBBloggerGeneratorPrompt(input: {
  productTitle: string;
  ctaUrl: string;
  articleFormat: string;
  generationAuthority: Record<string, unknown>;
  /** Optional bounded regen feedback only */
  planViolationNote?: string | null;
  /** r79 — section cardinality bound into embedded + returned schema */
  articleOutputContract?: ArticleOutputContract | null;
}): { systemInstruction: string; userPrompt: string; outputSchema: Record<string, unknown> } {
  const baseSchema = getOptionBBloggerArticleLlmJsonSchema();
  const outputSchema = applyArticleOutputContractToLlmSchema(
    baseSchema,
    input.articleOutputContract,
  );
  const example = getOptionBBloggerArticleContractExample();
  const required = OPTION_B_LLM_REQUIRED_KEYS.join(", ");
  const maxItems =
    input.articleOutputContract?.maxArticleSections ??
    (typeof (outputSchema as { properties?: { sections?: { maxItems?: number } } }).properties
      ?.sections?.maxItems === "number"
      ? (outputSchema as { properties: { sections: { maxItems: number } } }).properties.sections
          .maxItems
      : null);

  const planRaw =
    input.generationAuthority.ARTICLE_PLAN &&
    typeof input.generationAuthority.ARTICLE_PLAN === "object"
      ? input.generationAuthority.ARTICLE_PLAN
      : null;
  const plan = toWriterVisibleArticlePlan(planRaw);

  const executionRaw = Array.isArray(input.generationAuthority.ARTICLE_PLAN_EXECUTION)
    ? input.generationAuthority.ARTICLE_PLAN_EXECUTION
    : null;
  const execution = toWriterVisibleExecution(executionRaw);

  const qualityGuidanceText = formatWritingQualityGuidanceForWriter(
    input.generationAuthority.WRITING_QUALITY_GUIDANCE &&
      typeof input.generationAuthority.WRITING_QUALITY_GUIDANCE === "object"
      ? (input.generationAuthority.WRITING_QUALITY_GUIDANCE as Parameters<
          typeof formatWritingQualityGuidanceForWriter
        >[0])
      : null,
  );

  const systemInstruction = [
    OPTION_B_WRITER_SYSTEM,
    "Return ONLY one JSON object. No markdown code fences. No commentary.",
    `Required top-level fields: ${required}. Do not output cta — the system appends it.`,
    "Do not output a lead field. Do not output summary as article prose.",
    maxItems != null
      ? `sections: array with minItems=1 and maxItems=${maxItems}; heading string|null; paragraphs string[]; lists string[] (use [] if empty). Emit one section per ARTICLE_PLAN.body slot in order; optional heading may match the slot heading. First body paragraphs are the product overview.`
      : "sections: non-empty array; heading string|null; paragraphs string[]; lists string[] (use [] if empty). Emit one section per ARTICLE_PLAN.body slot in order. First body paragraphs are the product overview.",
    "If ARTICLE_PLAN.body is empty, emit one section with paragraphs:[] (no invented body facts).",
    "JSON Schema (structure only):",
    JSON.stringify(outputSchema),
    "Example JSON shape only (not style guidance):",
    JSON.stringify(example),
  ].join("\n");

  const userPrompt = [
    `Write ARTICLE_PLAN as a natural Japanese product intro (${required}). productTitle in the plan is identity only — do not paste wholesale as title.`,
    `outputChannel=BLOGGER articleFormat=${JSON.stringify(input.articleFormat)}`,
    "ARTICLE_PLAN (factual boundary — weave into prose; do not dump as taxonomy):",
    JSON.stringify(plan),
    execution
      ? [
          "ARTICLE_PLAN_EXECUTION (FACT safety per contribution — obey executionMode / mustPreserve / notAllowed; do not invent):",
          JSON.stringify(execution),
          "EXACT_SURFACE (title / names / quantities): keep surface identity. Title: compose one natural Japanese title from title.facts only with 助詞/読点 — never invent modifiers/genres/appeal words absent from title.facts.",
          "SEMANTIC_PRESERVE: natural grammar and editorial connection OK; no new concrete facts. Combine related facts into coherent paragraphs.",
          "Write continuous adult product-intro prose. Weave short tags into the story of the product — do not explain internal labels (genre/play-style/direction categories) to the reader.",
          "End with a short grounded reader orientation when natural — optional when SOURCE is thin (THEME_LEVEL / METADATA). Forbidden unless planned: external reputation/market claims (～で知られている / 売上No.1 / 大人気 / ファンから高評価).",
          "If ARTICLE_PLAN.sourceExpansion.writerDensityNote is present, obey it as a length/expansion ceiling. Stop when planned facts are naturally covered.",
        ].join("\n")
      : "",
    qualityGuidanceText
      ? [
          "WRITING_QUALITY_GUIDANCE (optional abstract HOW — not new facts; do not copy wording; do not override FACT boundary):",
          qualityGuidanceText,
        ].join("\n")
      : "",
    input.planViolationNote
      ? `Bounded regen (fix only listed violations; do not rewrite ARTICLE_PLAN): ${input.planViolationNote}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { systemInstruction, userPrompt, outputSchema };
}

/** Approximate UTF-8 byte length for prompt size regressions (LLM=0). */
export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
