/**
 * r83 — Brain/R83 assignment reaches ArticlePlan (r114 Writer SSOT).
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
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";

const TITLE =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";
const DESC =
  "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！";

describe("r83 assignment → ArticlePlan (r114)", () => {
  it("R83 assignment facts become ArticlePlan execution targets", () => {
    const pack = buildEvidencePack({
      productTitle: TITLE,
      claims: [{ id: "c1", statement: TITLE, kind: "product_title", status: "SUPPORTED" }],
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
    expect(feasibility.assignment.title.allowReuseInOpening).toBe(true);

    const plan = buildArticlePlan({
      productTitle: TITLE,
      pack,
      assignment: feasibility.assignment,
      materialDepth: profile.materialDepth,
    });
    expect(plan.title.job).toBe("who_plus_core");
    expect(plan.lead.job).toBe("opening_facts");
    expect(plan.schemaVersion).toBe(1);
    expect(plan.title.facts.length).toBeGreaterThan(0);
    // Leadless: opening facts are internalized into body (lead.facts empty).
    expect(plan.lead.facts).toEqual([]);
    expect(plan.body.flatMap((b) => b.facts).length).toBeGreaterThan(0);
    expect(articlePlanAllFacts(plan).join(" ")).not.toMatch(/公式ページで確認できる/);

    const auth = buildOptionBGenerationAuthority({ articlePlan: plan });
    expect(auth.ARTICLE_PLAN).toEqual(
      expect.objectContaining({
        title: plan.title,
        body: plan.body,
        materialDepth: plan.materialDepth,
      }),
    );
    expect((auth.ARTICLE_PLAN as { lead?: unknown }).lead).toBeUndefined();
    expect(auth.WRITING_SKELETON).toBeUndefined();
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/ARTICLE_PLAN/);
    expect(OPTION_B_WRITER_SYSTEM).not.toMatch(/各スロットで同じfact familyを再消費しない/);
  });
});
