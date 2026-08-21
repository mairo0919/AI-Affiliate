/**
 * r29 — DELETE-FIRST Generator instruction reduction (LLM=0).
 */

import { describe, expect, it } from "vitest";
import {
  OPTION_B_GENERATOR_POLICY,
  NATURAL_PRODUCT_INTRO_STRUCTURE,
} from "../natural-product-intro-policy.js";
import { buildEvidencePack, toOptionBWriterSourceMaterial } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { toWritingSkeletonPromptContract } from "../writing-skeleton.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import {
  buildOptionBBloggerGeneratorPrompt,
  utf8Bytes,
} from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import {
  fillOptionBArticleDefaults,
  OPTION_B_LLM_REQUIRED_KEYS,
  BLOGGER_ARTICLE_REQUIRED_KEYS,
  parseBloggerArticle,
  getOptionBBloggerArticleLlmJsonSchema,
} from "../../generation/structured-article.js";
import { optionBAllowsPostLlmProseMutation } from "../../editorial-brain/generation/option-b-blog-boundary.js";
import { classifySemanticEvidence } from "../semantic-evidence.js";

const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

/** r28/r27 measured before-delete baseline (frozen for regression). */
const BEFORE = {
  systemLines: 44,
  systemBytes: 9266,
  userDutyRestatement: true,
  dutyCopies: 4,
  generatorDutyFlags: 17,
  minimalStyleKeys: 11,
  requiredSchemaFields: BLOGGER_ARTICLE_REQUIRED_KEYS.length,
};

describe("r29 DELETE-FIRST generator reduction (LLM=0)", () => {
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
    const auth = buildOptionBGenerationAuthority({
      writingSkeleton: toWritingSkeletonPromptContract(feasibility.skeleton)!,
      evidencePack: toOptionBWriterSourceMaterial({
        productTitle: MIZD,
        claims: [
          {
            id: "c1",
            statement: "10作品が収録規模として記載されている。",
            kind: "trait_or_scene",
          },
        ],
        officialDescription: "松本いちか 10作品 480分",
      }),
    });
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: MIZD,
      ctaUrl: "https://example.invalid/p",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    return { auth, prompt, pack, feasibility };
  }

  it("A/B: system lines/bytes reduced; user has no duty restatement", () => {
    const { prompt } = buildPrompt();
    const sysLines = prompt.systemInstruction.split("\n").filter(Boolean).length;
    const sysBytes = utf8Bytes(prompt.systemInstruction);
    expect(sysLines).toBeLessThan(BEFORE.systemLines);
    expect(sysBytes).toBeLessThan(BEFORE.systemBytes);
    expect(prompt.userPrompt).not.toMatch(/ARTICLE LENGTH|Grounded promotion|TITLE_LABEL/);
    expect(prompt.userPrompt).toMatch(/generationAuthority \(SSOT\)/);
  });

  it("C: priority is authority JSON only (no prose ranks wall)", () => {
    const { prompt, auth } = buildPrompt();
    expect(auth.authorityPriority).toEqual([
      "FACTUAL_SAFETY",
      "EVIDENCE_PACK",
      "WRITING_SKELETON",
      "BLOG_CHANNEL_REQUIREMENTS",
      "MINIMAL_STYLE",
    ]);
    expect(prompt.systemInstruction).not.toMatch(
      /1\) FACTUAL\/SAFETY — only Evidence Pack/,
    );
    expect(prompt.systemInstruction).not.toMatch(
      /Priority: FACTUAL\/SAFETY > EVIDENCE_PACK/,
    );
  });

  it("C: canonical duty is 1 string; skeleton/pack have no duty arrays", () => {
    const { auth } = buildPrompt();
    expect(auth.generatorDuty).toEqual([OPTION_B_GENERATOR_POLICY]);
    expect(auth.GENERATOR_DUTY).toBeUndefined();
    const sk = auth.WRITING_SKELETON as Record<string, unknown>;
    const pack = auth.EVIDENCE_PACK as Record<string, unknown>;
    expect(sk.duty).toBeUndefined();
    expect(sk.globalAvoid).toBeUndefined();
    expect(pack.duty).toBeUndefined();
  });

  it("D/E: Brain-overlapping Generator quality walls removed from prompt", () => {
    const { prompt, auth } = buildPrompt();
    const all = prompt.systemInstruction + prompt.userPrompt;
    expect(all).not.toMatch(/REPETITION|information gain|INFORMATION_DENSITY/i);
    expect(all).not.toMatch(/UNGROUNDED EVALUATION|evaluation-only sentences forbidden/i);
    expect(all).not.toMatch(/short is success/i);
    expect(all).not.toMatch(/Shorter readable articles are SUCCESS/);
    expect(auth.MINIMAL_STYLE).toEqual({
      language: "ja",
      articleShape: "natural_product_intro",
    });
    expect(all).toContain(OPTION_B_GENERATOR_POLICY);
  });

  it("F: softLength short-is-success deleted from OPTION B path (null guidance)", () => {
    // Covered by content-generation-service change; assert comment absence in authority/prompt.
    const { prompt } = buildPrompt();
    expect(prompt.systemInstruction + prompt.userPrompt).not.toMatch(/900/);
    expect(prompt.systemInstruction + prompt.userPrompt).not.toMatch(/short is success/i);
  });

  it("F: post-LLM mutation remains forbidden", () => {
    expect(optionBAllowsPostLlmProseMutation()).toBe(false);
  });

  it("G: Writer source material present in authority (no atom lists)", () => {
    const { auth } = buildPrompt();
    const pack = auth.EVIDENCE_PACK as {
      productTitle?: string;
      supportedClaims?: unknown[];
      officialDescription?: string | null;
      concreteEvidence?: unknown;
    };
    expect(pack.productTitle).toBe(MIZD);
    expect(Array.isArray(pack.supportedClaims)).toBe(true);
    expect((pack.supportedClaims ?? []).length).toBeGreaterThan(0);
    expect(typeof pack.officialDescription).toBe("string");
    expect(pack.concreteEvidence).toBeUndefined();
  });

  it("H: TITLE_LABEL classification still works (not deleted)", () => {
    const c = classifySemanticEvidence("令和イチのメスガキ", {
      sourceType: "product_title",
      titleIdentityToken: true,
    });
    expect(c.primary).toBe("TITLE_LABEL");
  });

  it("I: schema optionalize — LLM required slim; defaults fill persistence fields", () => {
    expect(OPTION_B_LLM_REQUIRED_KEYS).toEqual(["title", "lead", "sections", "cta"]);
    expect(OPTION_B_LLM_REQUIRED_KEYS.length).toBeLessThan(BEFORE.requiredSchemaFields);
    const schema = getOptionBBloggerArticleLlmJsonSchema();
    expect(schema.required).toEqual(["title", "lead", "sections", "cta"]);
    const filled = fillOptionBArticleDefaults({
      title: "タイトル",
      lead: "リード文です。",
      sections: [{ heading: null, paragraphs: ["本文"], lists: [] }],
      cta: { label: "確認", url: "https://example.invalid" },
    });
    const parsed = parseBloggerArticle(filled);
    expect(parsed.summary.length).toBeGreaterThan(0);
    expect(parsed.seoTitle).toBe("タイトル");
    expect(parsed.metaDescription.length).toBeGreaterThan(0);
    expect(parsed.labels).toEqual([]);
  });

  it("reports before/after control reduction", () => {
    const { prompt, auth } = buildPrompt();
    const after = {
      systemLines: prompt.systemInstruction.split("\n").filter(Boolean).length,
      systemBytes: utf8Bytes(prompt.systemInstruction),
      userBytes: utf8Bytes(prompt.userPrompt),
      dutyCopies: Array.isArray(auth.generatorDuty) ? auth.generatorDuty.length : 0,
      minimalStyleKeys: Object.keys(auth.MINIMAL_STYLE as object).length,
      requiredSchemaFields: OPTION_B_LLM_REQUIRED_KEYS.length,
    };
    expect(after.systemLines).toBeLessThan(BEFORE.systemLines * 0.5);
    expect(after.systemBytes).toBeLessThan(BEFORE.systemBytes * 0.5);
    expect(after.dutyCopies).toBe(1);
    expect(after.minimalStyleKeys).toBe(2);
    expect(after.requiredSchemaFields).toBe(4);
    // Record for human report
    expect(NATURAL_PRODUCT_INTRO_STRUCTURE.densityNote).toBe(OPTION_B_GENERATOR_POLICY);
  });
});
