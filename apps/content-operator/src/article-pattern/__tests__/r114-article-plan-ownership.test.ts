/**
 * R114 — ArticlePlan ownership (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan, articlePlanAllFacts } from "../article-plan.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";
import { OPTION_B_LLM_REQUIRED_KEYS } from "../../generation/structured-article.js";

const TITLE =
  "小島みなみ 120分 限界突破 ダイナミックなイキっぷり 究極のピストン";

describe("R114 ArticlePlan ownership", () => {
  function build() {
    const pack = buildEvidencePack({
      productTitle: TITLE,
      claims: [
        {
          id: "c1",
          statement: "120分にわたる激しいピストン",
          kind: "trait_or_scene",
          status: "SUPPORTED",
        },
      ],
      pageEvidenceMeta: {
        description: {
          text: "性欲の化身とも言える小島みなみが魅せる究極のピストン作品。限界突破するダイナミックなイキっぷり。",
          originField: "jsonld.Product.description",
        },
        actors: ["小島みなみ"],
      },
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    expect(feasibility.ok).toBe(true);
    const plan = buildArticlePlan({
      productTitle: TITLE,
      pack,
      assignment: feasibility.assignment,
      materialDepth: profile.materialDepth,
    });
    return { plan, pack, profile, feasibility };
  }

  it("builds Planner-owned ArticlePlan with selected facts", () => {
    const { plan } = build();
    expect(plan.schemaVersion).toBe(1);
    expect(plan.title.job).toBe("who_plus_core");
    expect(plan.lead.job).toBe("opening_facts");
    expect(plan.lead.facts).toEqual([]);
    expect(plan.title.facts.length + plan.body.flatMap((b) => b.facts).length).toBeGreaterThan(0);
    expect(articlePlanAllFacts(plan).length).toBeGreaterThan(0);
  });

  it("Writer authority contains ARTICLE_PLAN only — no EvidencePack/Skeleton soft HOW", () => {
    const { plan } = build();
    const auth = buildOptionBGenerationAuthority({ articlePlan: plan });
    expect(auth.ARTICLE_PLAN).toEqual(
      expect.objectContaining({
        title: plan.title,
        body: plan.body,
        materialDepth: plan.materialDepth,
        productTitle: plan.productTitle,
      }),
    );
    expect((auth.ARTICLE_PLAN as { lead?: unknown }).lead).toBeUndefined();
    expect(auth.EVIDENCE_PACK).toBeUndefined();
    expect(auth.WRITING_SKELETON).toBeUndefined();
    expect(auth.MINIMAL_STYLE).toBeUndefined();
    const factual = auth.FACTUAL_SAFETY as Record<string, unknown>;
    expect(factual.stopWhenConcreteEvidenceExhausted).toBeUndefined();
    expect(factual.noCompletionOnlySemanticAddon).toBeUndefined();

    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: TITLE,
      ctaUrl: "https://example.invalid/p",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    const all = prompt.systemInstruction + prompt.userPrompt;
    expect(all).toContain(OPTION_B_WRITER_SYSTEM);
    expect(all).toContain("ARTICLE_PLAN");
    expect(all).not.toMatch(/COMPOSE_AS_WORK_CONTENT|deepen_hook|progressionRules/);
    expect(all).not.toMatch(/EVIDENCE_PACK|WRITING_SKELETON/);
    expect(all).toMatch(/Required top-level fields: title, sections/);
    expect(all).not.toMatch(/Required top-level fields: title, lead, sections/);
    expect(all).toMatch(/Do not output cta|system appends/i);
    expect([...OPTION_B_LLM_REQUIRED_KEYS]).not.toContain("cta");
    expect([...OPTION_B_LLM_REQUIRED_KEYS]).not.toContain("lead");
  });
});
