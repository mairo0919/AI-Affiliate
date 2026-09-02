/**
 * R159 — ops blockers only: thin title enrichment, fragment atoms, long-fact OMISSION.
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import {
  extractOfficialPageFactAtoms,
  isUnusablePageAtomFragment,
} from "../official-page-evidence-atoms.js";
import { projectWriterSafeFact } from "../evidence-pack.js";
import {
  resolveFactRealization,
  isFactRealized,
} from "../../editorial-brain/generation/plan-fact-matching.js";

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
  return buildArticlePlan({
    productTitle,
    pack,
    assignment: feasibility.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
}

describe("R159 title selection — not performer/duration only when facets exist", () => {
  it("ssis-like: CID product title + performer metadata → identity + facet, not name-only", () => {
    const plan = planFor(
      "ssis00700",
      "性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを限界突破させる究極のピストン作品！120分のハードピストン！",
      ["小島みなみ"],
    );
    expect(plan.title.facts.join("")).not.toBe("小島みなみ");
    expect(plan.title.facts.some((f) => f.includes("小島みなみ") || f.includes("120") || /ピストン/.test(f))).toBe(
      true,
    );
    expect(plan.title.facts.length).toBeGreaterThanOrEqual(1);
    expect(plan.title.facts.every((f) => !/^ssis00700$/i.test(f))).toBe(true);
  });

  it("ssni-like: not performer-only when scene facets exist", () => {
    const plan = planFor(
      "ssni00300",
      "透明感溢れる19歳の美人お姉さん「初乃ふみか」の専属第二弾！中年オヤジとのネットリ接吻性交、休憩なしの絶頂しっぱなし3P、激ピス！色白スレンダー巨乳の身体に想像を超える快感と衝撃！",
      ["初乃ふみか"],
    );
    expect(plan.title.facts.join("")).not.toBe("初乃ふみか");
    expect(plan.title.facts.length).toBeGreaterThan(1);
    expect(
      plan.title.facts.some(
        (f) => /激ピス|3P|接吻|スレンダー|巨乳|快感/.test(f),
      ),
    ).toBe(true);
  });

  it("nnpj-like: not duration-only when scene facets exist", () => {
    const plan = planFor(
      "nnpj00500",
      "ドエロい！即効型！即ホテル！即ハメ！ノンストップ！連発射精！Sexで日頃のストレスを発散する人妻！2時間で5発射精！アナル舐め！オナニー見せド変態妻！",
      [],
    );
    expect(plan.title.facts).not.toEqual(["2時間"]);
    expect(plan.title.facts.some((f) => !/^\d+\s*時間$/.test(f))).toBe(true);
  });
});

describe("R159 fragment atom exclusion", () => {
  it("marks standalone exclamation / dialogue / kana reading as unusable", () => {
    expect(isUnusablePageAtomFragment("あぁ")).toBe(true);
    expect(isUnusablePageAtomFragment("ヤッテ")).toBe(true);
    expect(isUnusablePageAtomFragment("（きょうしゃ）")).toBe(true);
    expect(isUnusablePageAtomFragment("絶対空域")).toBe(false);
    expect(isUnusablePageAtomFragment("激ピス")).toBe(false);
    expect(isUnusablePageAtomFragment("ノンストップ")).toBe(false);
  });

  it("does not admit fragments into concrete atoms or Writer projection", () => {
    const desc =
      "ドエロい！即ハメ！ヤッテ、ヤッテ！あぁ…イクイクイグぅぅうう！アナル舐め！（きょうしゃ）柔らかいオッパイのパイズリ！";
    const { concrete } = extractOfficialPageFactAtoms({ descriptionText: desc });
    const facts = concrete.map((a) => a.fact);
    expect(facts).not.toContain("あぁ");
    expect(facts).not.toContain("ヤッテ");
    expect(facts).not.toContain("（きょうしゃ）");
    expect(facts.some((f) => f.includes("アナル舐め") || f.includes("パイズリ") || f.includes("即ハメ"))).toBe(
      true,
    );
    expect(projectWriterSafeFact("あぁ", "unknown_concrete")).toBeNull();
    expect(projectWriterSafeFact("ヤッテ", "unknown_concrete")).toBeNull();
    expect(projectWriterSafeFact("（きょうしゃ）", "unknown_concrete")).toBeNull();
    expect(projectWriterSafeFact("絶対空域", "unknown_concrete")).toBe("絶対空域");
  });
});

describe("R159 long narrative SEMANTIC realization (not full surface)", () => {
  it("realizes paraphrased long scene without requiring full atom restage", () => {
    const fact =
      "念願の美脚を舐めしゃぶりまくって中出しセックス";
    const body =
      "憧れの美脚を執拗に舐めしゃぶり、そのまま中出しセックスへと突入する。";
    const r = resolveFactRealization(body, fact, { padBearing: false });
    expect(isFactRealized(r.status)).toBe(true);
  });

  it("realizes long concessive narrative via major meaning, not exact marker only", () => {
    const fact =
      "生徒と言えどチンポの快感に負けてしまった一花は先生の立場を捨て女としてイキまくる";
    const body =
      "生徒の立場でも快感には抗えず、一花は先生としての矜持を捨てて女としてイキまくる。";
    const r = resolveFactRealization(body, fact, { padBearing: false });
    expect(isFactRealized(r.status)).toBe(true);
  });

  it("keeps EXACT quantity/performer strict — wrong identity still unrealized", () => {
    expect(
      isFactRealized(
        resolveFactRealization("収録時間は180分です", "13射精", { padBearing: false }).status,
      ),
    ).toBe(false);
    expect(
      isFactRealized(
        resolveFactRealization("出演は松本いちか", "堤セリナ", { padBearing: false }).status,
      ),
    ).toBe(false);
  });
});
