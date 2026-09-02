/**
 * r79 — OPTION B section cardinality + scarce ArticlePlan (LLM=0).
 */
import { describe, expect, it } from "vitest";
import {
  articleOutputContractFromSectionBounds,
  applyArticleOutputContractToLlmSchema,
  getSectionsCardinalityFromLlmSchema,
} from "../../generation/article-output-contract.js";
import { getOptionBBloggerArticleLlmJsonSchema } from "../../generation/structured-article.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { buildEditorialExecutionPlan } from "../../editorial-brain/generation/editorial-execution-plan.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";

describe("r79 OPTION B length / cardinality", () => {
  it("binds maxItems from claimUsage bounds without Structure Pattern", () => {
    const contract = articleOutputContractFromSectionBounds({
      minArticleSections: 1,
      maxArticleSections: 1,
    });
    const schema = applyArticleOutputContractToLlmSchema(
      getOptionBBloggerArticleLlmJsonSchema(),
      contract,
    );
    expect(getSectionsCardinalityFromLlmSchema(schema)).toEqual({
      minItems: 1,
      maxItems: 1,
    });
  });

  it("scarce HOW still stops expand-forever developmentStrategy (Planner-internal)", () => {
    const execution = buildEditorialExecutionPlan({
      materialDepth: "scarce",
      omitCtaBridge: true,
      omitInterestDevelopment: false,
    });
    expect(execution.developmentStrategy).toBe(
      "short_dense_stop_when_concrete_exhausted",
    );
    expect(execution.informationProgression).toContain(
      "body:one_unused_concrete_then_stop",
    );
  });

  it("OPTION B prompt embeds Writer system + maxItems; ArticlePlan scarce", () => {
    const contract = articleOutputContractFromSectionBounds({
      minArticleSections: 1,
      maxArticleSections: 1,
    });
    const plan = {
      schemaVersion: 1 as const,
      materialDepth: "scarce" as const,
      productTitle: "t",
      title: { job: "who_plus_core", facts: ["出演者A"] },
      lead: { job: "opening_facts", facts: ["120分"] },
      body: [] as Array<{ job: string; facts: string[] }>,
    };
    const auth = buildOptionBGenerationAuthority({ articlePlan: plan });
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: "t",
      ctaUrl: "https://example.invalid",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
      articleOutputContract: contract,
    });
    expect(prompt.systemInstruction).toContain(OPTION_B_WRITER_SYSTEM);
    expect(prompt.systemInstruction).toContain("maxItems=1");
    expect(getSectionsCardinalityFromLlmSchema(prompt.outputSchema).maxItems).toBe(1);
    expect(auth.ARTICLE_PLAN).toEqual(plan);
    expect(
      (auth.FACTUAL_SAFETY as Record<string, unknown>).stopWhenConcreteEvidenceExhausted,
    ).toBeUndefined();
  });
});
