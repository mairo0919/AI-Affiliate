/**
 * R105/R114 — obsolete cleanup + ArticlePlan Writer path (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { OPTION_B_WRITER_SYSTEM } from "../../article-pattern/natural-product-intro-policy.js";
import { buildEvidencePack } from "../../article-pattern/evidence-pack.js";
import { buildArticlePlan } from "../../article-pattern/article-plan.js";
import { buildProductMaterialProfileFromPack } from "../../article-pattern/reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../../article-pattern/skeleton-feasibility.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../generation/option-b-blogger-prompt.js";
import { applyArticlePlanComplianceMutations } from "../generation/article-plan-compliance.js";

const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

function buildProductionPrompt() {
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
  return {
    prompt: buildOptionBBloggerGeneratorPrompt({
      productTitle: MIZD,
      ctaUrl: "https://example.invalid/p",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    }),
    auth,
    plan,
  };
}

describe("R105/R114 title/lead + ArticlePlan (LLM=0)", () => {
  it("obsolete promotion/length policies absent from production prompt", () => {
    const { prompt } = buildProductionPrompt();
    const all = prompt.systemInstruction + prompt.userPrompt;
    expect(all).not.toMatch(/GROUNDED_PROMOTION/);
    expect(all).not.toMatch(/allowedWhenGrounded/);
    expect(all).not.toMatch(/EVIDENCE_DRIVEN_LENGTH/);
    expect(all).not.toMatch(/OPTION_B_BRAIN_PRIORITIES/);
  });

  it("Writer SSOT is ARTICLE_PLAN", () => {
    const { prompt, auth, plan } = buildProductionPrompt();
    const all = prompt.systemInstruction + prompt.userPrompt;
    expect(all).toContain(OPTION_B_WRITER_SYSTEM);
    expect(all).toMatch(/ARTICLE_PLAN/);
    expect(all).not.toMatch(/Generate a structured Blogger article/i);
    expect(all).not.toMatch(/progressionRules|COMPOSE_AS_WORK_CONTENT|deepen_hook/);
    expect(all).not.toMatch(/noEvaluativePadding|EVIDENCE_PACK/);
    expect(auth.ARTICLE_PLAN).toEqual(
      expect.objectContaining({
        title: plan.title,
        body: plan.body,
        materialDepth: plan.materialDepth,
        productTitle: plan.productTitle,
      }),
    );
    expect((auth.ARTICLE_PLAN as { lead?: unknown }).lead).toBeUndefined();
    expect(plan.title.facts.length + plan.body.flatMap((b) => b.facts).length).toBeGreaterThan(0);
  });

  it("r108 projects R83 title facts into ArticlePlan without mutating assignment", () => {
    const DESC =
      "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！";
    const pack = buildEvidencePack({
      productTitle: MIZD,
      claims: [{ id: "c1", statement: MIZD, kind: "product_title", status: "SUPPORTED" }],
      pageEvidenceMeta: {
        description: { text: DESC, originField: "jsonld.Product.description" },
        actors: ["松本いちか"],
      },
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    expect(feasibility.ok).toBe(true);
    const a = feasibility.assignment;
    expect(a.title.allowReuseInOpening).toBe(true);
    const openingBefore = a.opening.primary?.id ?? null;
    const bodyBefore = a.body.map((b) => b.primary?.id ?? null);
    const plan = buildArticlePlan({
      productTitle: MIZD,
      pack,
      assignment: a,
      materialDepth: profile.materialDepth,
    });
    expect(plan.title.facts.length).toBeGreaterThan(0);
    expect(a.opening.primary?.id ?? null).toBe(openingBefore);
    expect(a.body.map((b) => b.primary?.id ?? null)).toEqual(bodyBefore);
  });

  it("R121 completion-only DROP via ArticlePlan compliance", () => {
    const result = applyArticlePlanComplianceMutations({
      article: {
        title: "痴女ベスト",
        summary: "8時間",
        lead: "8時間の円熟した濃厚セックス",
        sections: [
          {
            heading: null,
            paragraphs: [
              "最新12タイトルを収録したベスト第6弾です。",
              "痴女としての魅力を最大限に発揮し、熟練の技と情熱で観る者を惹きつけます。",
            ],
          },
        ],
      },
      articlePlan: {
        schemaVersion: 1,
        materialDepth: "standard",
        productTitle: "痴女ベスト",
        title: { job: "who_plus_core", facts: [] },
        lead: { job: "opening_facts", facts: ["8時間"] },
        body: [{ job: "body_facts", facts: ["12タイトル", "ベスト第6弾"] }],
      },
    });
    expect(result.droppedSentences.some((s) => /惹きつけ/.test(s))).toBe(true);
  });
});
