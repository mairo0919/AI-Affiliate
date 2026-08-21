/**
 * OPTION B Blogger Generator prompt — Evidence-grounded natural product intro.
 * r29: DELETE-FIRST — thin wrapper around generationAuthority JSON. No duty/policy walls.
 */

import {
  getOptionBBloggerArticleLlmJsonSchema,
  getOptionBBloggerArticleContractExample,
  OPTION_B_LLM_REQUIRED_KEYS,
} from "../../generation/structured-article.js";
import { OPTION_B_GENERATOR_POLICY } from "../../article-pattern/natural-product-intro-policy.js";

export function buildOptionBBloggerGeneratorPrompt(input: {
  productTitle: string;
  ctaUrl: string;
  articleFormat: string;
  generationAuthority: Record<string, unknown>;
  /** Optional bounded regen feedback only */
  planViolationNote?: string | null;
}): { systemInstruction: string; userPrompt: string; outputSchema: Record<string, unknown> } {
  const outputSchema = getOptionBBloggerArticleLlmJsonSchema();
  const example = getOptionBBloggerArticleContractExample();
  const required = OPTION_B_LLM_REQUIRED_KEYS.join(", ");

  const systemInstruction = [
    "You are a careful Japanese adult-affiliate content operator for Blogger.",
    "Return ONLY one JSON object. No markdown code fences. No commentary.",
    OPTION_B_GENERATOR_POLICY,
    "generationAuthority is the sole HOW/WHAT SSOT (authorityPriority order). Obey it. Ignore legacy SEGMENT / claimUsage / EditorialExecution.",
    "Do not invent facts beyond EVIDENCE_PACK productTitle, supportedClaims, and officialDescription. Do not invent image URLs.",
    "Never claim first-hand experience. Never expose AVAILABLE/SUPPORTED tokens.",
    `Required top-level fields: ${required}.`,
    'cta MUST be {"label": string, "url": string|null}.',
    "sections: non-empty array; heading string|null; paragraphs string[]; lists string[] (use [] if empty).",
    "JSON Schema:",
    JSON.stringify(outputSchema),
    "Example shape only:",
    JSON.stringify(example),
  ].join("\n");

  const userPrompt = [
    `Generate a structured Blogger article JSON for productTitle=${JSON.stringify(input.productTitle)} (identity source only — do not paste wholesale as title).`,
    `cta.url=${JSON.stringify(input.ctaUrl || null)}`,
    `articleFormat=${JSON.stringify(input.articleFormat)}`,
    "generationAuthority (SSOT):",
    JSON.stringify(input.generationAuthority),
    input.planViolationNote
      ? `Bounded regen note (fix only listed issues): ${input.planViolationNote}`
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
