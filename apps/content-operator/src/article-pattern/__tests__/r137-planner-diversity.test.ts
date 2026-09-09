/**
 * R137 — Planner body fact family diversity (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan, articlePlanAllFacts } from "../article-plan.js";

const OFJE_DESC =
  "AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中！円熟した濃厚なセックスとエロポテンシャル、低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾。今回は彼女の最新12タイトル、なお且つ全コーナーを収録した豪華でスペシャルなベスト版です。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です！！！";

function buildOfjePlan() {
  const pack = buildEvidencePack({
    productTitle: "ofje00230",
    claims: [{ id: "c1", statement: "ofje00230", status: "SUPPORTED" }],
    pageEvidenceMeta: {
      description: { text: OFJE_DESC, originField: "jsonld.Product.description" },
      actors: ["奥田咲"],
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feasibility = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const plan = buildArticlePlan({
    productTitle: "ofje00230",
    pack,
    assignment: feasibility.assignment,
    materialDepth: profile.materialDepth,
  });
  return plan;
}

describe("R137 planner body fact diversity", () => {
  it("ofje00230 keeps theme-scope / edition facts when meta streak would otherwise fill body", () => {
    const plan = buildOfjePlan();
    const body = plan.body.flatMap((b) => b.facts);
    const all = articlePlanAllFacts(plan);
    // Theme enumeration compounds are expanded to membership labels for Writer development.
    expect(body).toEqual(expect.arrayContaining(["人妻", "NTR", "痴女", "追撃ピストン"]));
    expect(body.some((f) => /などを収録$/.test(f))).toBe(false);
    expect(all.some((f) => /ベスト第\d+弾/.test(f))).toBe(true);
    // rich body budget is family-preserving (hard ceiling only), not fixed-8.
    expect(body.length).toBeLessThanOrEqual(18);
    expect(body.length).toBeGreaterThanOrEqual(4);
  });

  it("ofje00230 ArticlePlan is deterministic across rebuilds", () => {
    const a = articlePlanAllFacts(buildOfjePlan());
    const b = articlePlanAllFacts(buildOfjePlan());
    expect(a).toEqual(b);
  });
});
