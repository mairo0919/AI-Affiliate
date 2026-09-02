/**
 * R156 — rich family-preserving body selection + title/lead safety (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan, articlePlanAllFacts } from "../article-plan.js";
import { extractOfficialPageFactAtoms } from "../official-page-evidence-atoms.js";
import { isUnsafeTitleExecutionTarget } from "../writer-evidence-filter.js";

const MIZD_DESC =
  "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！最強の天使な小悪魔、松本いちかの本気をみさらせや！";

const MIZD_TITLE = "令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

const HALT_TITLE =
  "一日中履いてムレた黒パンストでパンパンに張ったどデカ透け尻を見せつけてくる無防備エリート人妻女上司に残業中即ハメ！旦那がいるのに淫語マシンガンで誘惑してくるので満足するまで会社でも自宅でも何度も中出ししてあげた 北野未奈";

const HALT_DESC =
  "出版会社のしっかり者エリート人妻女上司・北野未奈。今日も終電過ぎまで残業に付き合うダメなZ世代部下のボク。【ムレムレ黒パンスト】のどデカ透け尻！残業中のオフィスで【即ハメバック中出し】！";

function planFor(productTitle: string, desc: string, actors: string[]) {
  const pack = buildEvidencePack({
    productTitle,
    claims: [{ id: "c1", statement: productTitle.slice(0, 12), status: "SUPPORTED" }],
    pageEvidenceMeta: {
      description: { text: desc, originField: "jsonld.Product.description" },
      actors,
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feasibility = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const plan = buildArticlePlan({
    productTitle,
    pack,
    assignment: feasibility.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  return { pack, profile, plan };
}

describe("R156 material restore", () => {
  it("atomizes MOODYZベスト第2弾 / 生意気 / 大人をバカにした表情 from mizd description", () => {
    const { concrete } = extractOfficialPageFactAtoms({ descriptionText: MIZD_DESC });
    const facts = concrete.map((a) => a.fact);
    expect(facts.some((f) => /MOODYZベスト第2弾|ベスト第2弾/.test(f))).toBe(true);
    expect(facts.some((f) => f.includes("生意気"))).toBe(true);
    expect(facts.some((f) => f.includes("大人をバカにした表情"))).toBe(true);
  });

  it("mizd rich body keeps scene/series families — not quantity-only under fixed-8", () => {
    const { plan, profile } = planFor(MIZD_TITLE, MIZD_DESC, ["松本いちか"]);
    expect(profile.materialDepth).toBe("rich");
    const body = plan.body.flatMap((b) => b.facts);
    const all = articlePlanAllFacts(plan).join("\n");
    // Short theme tags may be absorbed into broader clauses under current projection.
    expect(body.some((f) => f.includes("小悪魔") || /痴女|激ピス|メスガキ/.test(f))).toBe(true);
    expect(body.length).toBeGreaterThan(5);
    expect(body.every((f) => !/^[a-z]{2,8}\d{0,5}$/i.test(f))).toBe(true);
    expect(articlePlanAllFacts(plan).some((f) => /MOODYZベスト第2弾|ベスト第2弾/.test(f))).toBe(
      true,
    );
  });

  it("halt title is performer + title-safe facet — not name-only; unsafe title stays out of body overview", () => {
    expect(isUnsafeTitleExecutionTarget(HALT_TITLE)).toBe(true);
    const { plan } = planFor(HALT_TITLE, HALT_DESC, ["北野未奈"]);
    expect(plan.title.facts).toContain("北野未奈");
    expect(plan.title.facts.length).toBeGreaterThan(1);
    expect(plan.title.facts.join("")).not.toBe("北野未奈");
    expect(plan.title.facts.some(isUnsafeTitleExecutionTarget)).toBe(false);
    expect(plan.title.facts.some((f) => /^halt$/i.test(f))).toBe(false);
    expect(plan.lead.facts).toEqual([]);
    const bodyFacts = plan.body.flatMap((b) => b.facts);
    expect(bodyFacts.some((f) => f === HALT_TITLE)).toBe(false);
    expect(bodyFacts.some(isUnsafeTitleExecutionTarget)).toBe(false);
    expect(bodyFacts.some((f) => f !== "北野未奈")).toBe(true);
  });
});
