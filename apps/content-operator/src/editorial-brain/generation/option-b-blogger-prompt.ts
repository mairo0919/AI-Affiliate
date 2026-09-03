/**
 * OPTION B Blogger channel — Writer realizes ARTICLE_PLAN as Japanese JSON.
 * r114: Planner owns WHAT/ORDER/DEPTH/STOP; Writer owns surface only.
 * R151: ARTICLE_PLAN_EXECUTION adds per-fact identity/relation constraints.
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

  const plan =
    input.generationAuthority.ARTICLE_PLAN &&
    typeof input.generationAuthority.ARTICLE_PLAN === "object"
      ? input.generationAuthority.ARTICLE_PLAN
      : null;

  const execution = Array.isArray(input.generationAuthority.ARTICLE_PLAN_EXECUTION)
    ? input.generationAuthority.ARTICLE_PLAN_EXECUTION
    : null;

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
    `Realize ARTICLE_PLAN as JSON fields (${required}). productTitle in the plan is identity only — do not paste wholesale as title.`,
    `outputChannel=BLOGGER articleFormat=${JSON.stringify(input.articleFormat)}`,
    "ARTICLE_PLAN:",
    JSON.stringify(plan),
    execution
      ? [
          "ARTICLE_PLAN_EXECUTION (per contribution — preserve mustPreserve; do not invent):",
          JSON.stringify(execution),
          "Title facts with executionMode=EXACT_SURFACE: keep planned surface identity only — compose one natural Japanese product title that identifies the work (助詞/読点: の・と etc.). Never a space-separated keyword list, never unfinished clauses (〜を迎え), never mechanical concatenation of every title.fact when one already covers another. Do not add modifiers absent from title.facts.",
          "SEMANTIC_PRESERVE (typical for body descriptive facts): natural grammar and product-intro connection OK; requiredRelations and anchors must remain; no new concrete facts. Combine related SEMANTIC_PRESERVE facts into coherent sentences and paragraphs.",
          "Short work-theme planned facts (membership tags): state recorded membership/variety only. Obey notAllowed — do not invent emotions, psychology, narrative roles, or plot from genre knowledge.",
          "FREE_CONNECTIVE: connection/transition only — not new facts.",
          "Write one body section. Express every body.facts item (paraphrase OK under SEMANTIC_PRESERVE), grouping by informationAxis / presentationPurpose / related meaning — one fact ≠ one sentence/paragraph. Open by identifying the product from planned body facts, then advance remaining axes. For long scene/trait/play-style facts, make clear what product aspect those facts describe without inventing unsupported detail. materialDepth=rich means do not omit independent axes; it does not mean elaborate each fact or open a new paragraph per fact. Long compound facts are already dense: weave, do not inflate.",
          "TERMINATION: when all planned body facts are realized, stop. Do not add a summary, recommendation, reader invitation, or evaluative wrap-up whose meaning is absent from ARTICLE_PLAN. Explicitly forbidden unless already in planned facts: 楽しめます / 堪能できる / 充実した内容 / 余すところなく / 存分に味わえる / 魅力が詰まった as closing glue. A short ending on a factual sentence is correct. Do not pad for length.",
          "Short facts: weave with related axes. Deixis (この美女) must keep noun+deixis identity when merged. Narrative intensifiers (ただ) may soften; meaning cores must remain. Never invent promotional closers after coverage is complete.",
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
