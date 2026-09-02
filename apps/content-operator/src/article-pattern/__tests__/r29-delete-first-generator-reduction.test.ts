/**
 * r29/r114 — Generator instruction reduction + ArticlePlan (LLM=0).
 */

import { describe, expect, it } from "vitest";
import {
  OPTION_B_WRITER_SYSTEM,
  NATURAL_PRODUCT_INTRO_STRUCTURE,
} from "../natural-product-intro-policy.js";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildArticlePlan } from "../article-plan.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import {
  buildOptionBBloggerGeneratorPrompt,
  utf8Bytes,
} from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import {
  fillOptionBArticleDefaults,
  applyOptionBDeterministicCta,
  OPTION_B_LLM_REQUIRED_KEYS,
  BLOGGER_ARTICLE_REQUIRED_KEYS,
  parseBloggerArticle,
  getOptionBBloggerArticleLlmJsonSchema,
} from "../../generation/structured-article.js";
import { optionBAllowsPostLlmProseMutation } from "../../editorial-brain/generation/option-b-blog-boundary.js";
import { classifySemanticEvidence } from "../semantic-evidence.js";

const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

const BEFORE = {
  systemLines: 44,
  systemBytes: 9266,
  requiredSchemaFields: BLOGGER_ARTICLE_REQUIRED_KEYS.length,
};

describe("r29/r114 DELETE-FIRST + ArticlePlan (LLM=0)", () => {
  function buildPrompt() {
    const pack = buildEvidencePack({
      productTitle: MIZD,
      claims: [
        {
          id: "c1",
          statement: "10作品が収録規模として記載されている。",
          kind: "trait_or_scene",
          status: "SUPPORTED",
        },
      ],
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    expect(feasibility.ok).toBe(true);
    const plan = buildArticlePlan({
      productTitle: MIZD,
      pack,
      assignment: feasibility.assignment,
      materialDepth: profile.materialDepth,
    });
    const auth = buildOptionBGenerationAuthority({ articlePlan: plan });
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: MIZD,
      ctaUrl: "https://example.invalid/p",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    return { auth, prompt, pack, feasibility, plan };
  }

  it("A/B: system lines/bytes reduced; user is ARTICLE_PLAN", () => {
    const { prompt } = buildPrompt();
    const sysLines = prompt.systemInstruction.split("\n").filter(Boolean).length;
    const sysBytes = utf8Bytes(prompt.systemInstruction);
    expect(sysLines).toBeLessThan(BEFORE.systemLines);
    expect(sysBytes).toBeLessThan(BEFORE.systemBytes);
    expect(prompt.userPrompt).toMatch(/ARTICLE_PLAN/);
    expect(prompt.userPrompt).not.toMatch(/generationAuthority \(execution specification\)/);
  });

  it("C: ARTICLE_PLAN is sole Writer authority", () => {
    const { auth } = buildPrompt();
    expect(auth.ARTICLE_PLAN).toBeTruthy();
    expect(auth.EVIDENCE_PACK).toBeUndefined();
    expect(auth.WRITING_SKELETON).toBeUndefined();
    expect(auth.generatorDuty).toBeUndefined();
  });

  it("D/E: Brain-overlapping walls removed; Writer system present", () => {
    const { prompt } = buildPrompt();
    const all = prompt.systemInstruction + prompt.userPrompt;
    expect(all).not.toMatch(/\bREPETITION\b|INFORMATION_DENSITY/i);
    expect(all).not.toMatch(/UNGROUNDED EVALUATION|evaluation-only sentences forbidden/i);
    expect(all).not.toMatch(/Shorter readable articles are SUCCESS/);
    expect(all).toContain(OPTION_B_WRITER_SYSTEM);
  });

  it("F: post-LLM mutation remains forbidden", () => {
    expect(optionBAllowsPostLlmProseMutation()).toBe(false);
  });

  it("G: ArticlePlan facts present", () => {
    const { plan } = buildPrompt();
    expect(plan.title.facts.length + plan.lead.facts.length).toBeGreaterThan(0);
  });

  it("H: TITLE_LABEL classification still works (not deleted)", () => {
    const sem = classifySemanticEvidence("令和イチのメスガキ", {
      sourceType: "product_description",
    });
    expect(sem.primary).toBeTruthy();
  });

  it("I: schema slim — no cta required; defaults + deterministic CTA fill", () => {
    expect([...OPTION_B_LLM_REQUIRED_KEYS]).toEqual(["title", "sections"]);
    expect(OPTION_B_LLM_REQUIRED_KEYS.length).toBeLessThan(BEFORE.requiredSchemaFields);
    const schema = getOptionBBloggerArticleLlmJsonSchema();
    expect((schema.required as string[]).includes("cta")).toBe(false);
    expect((schema.required as string[]).includes("lead")).toBe(false);
    const filled = fillOptionBArticleDefaults(
      applyOptionBDeterministicCta(
        {
          title: "t",
          sections: [{ paragraphs: ["p"], lists: [] }],
        },
        "https://example.invalid/p",
      ),
    );
    const parsed = parseBloggerArticle(filled);
    expect(parsed.cta.url).toBe("https://example.invalid/p");
    expect("lead" in (parsed as object) ? (parsed as { lead?: unknown }).lead : undefined).toBeUndefined();
    expect(NATURAL_PRODUCT_INTRO_STRUCTURE.name).toBe("natural_product_intro");
  });
});
