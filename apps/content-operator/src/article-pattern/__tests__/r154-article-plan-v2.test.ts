/**
 * ARTICLE_PLAN V2 Phase 1 — purpose / coreAngle / reader jobs / title compose.
 */
import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import { buildArticlePlan, articlePlanAllFacts } from "../article-plan.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import {
  allocateReaderJobs,
  composeTitleFacts,
  resolveArticlePurpose,
  resolveCoreAngle,
} from "../article-plan-editorial-frame.js";
import {
  buildArticlePlanExecutionContract,
  toWriterExecutionContractView,
} from "../plan-execution-contract.js";
import { buildGenerationAuthorityPromptContract } from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";

const PARA_TITLE = "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "コインランドリーでナンパした女子大生のマン毛。女性専門高級回春エステに通う女性のマン毛。催●術にかかった女性のマン毛。不倫中の団地妻など。当写真館の巨乳学芸員。";

function buildPlan(title: string, desc: string, actors: string[]) {
  const pack = buildEvidencePack({
    productTitle: title,
    claims: [{ id: "c0", statement: title.slice(0, 24), status: "SUPPORTED" }],
    pageEvidenceMeta: {
      actors,
      description: { text: desc, originField: "jsonld.Product.description" },
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const plan = buildArticlePlan({
    productTitle: title,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
    editorialFrame: true,
  });
  return { pack, profile, plan, feas };
}

describe("ARTICLE_PLAN V2 Phase 1", () => {
  it("emits schemaVersion 2 with purpose and reader jobs for parathd-like material", () => {
    const { plan, profile } = buildPlan(PARA_TITLE, PARA_DESC, ["優梨まいな", "ましろ杏"]);
    expect(plan.schemaVersion).toBe(2);
    expect(plan.title.job).toBe("title_compose");
    expect(plan.lead.job).toBe("overview");
    expect(plan.purpose == null || typeof plan.purpose.statement === "string").toBe(true);
    if (plan.purpose) {
      expect(plan.purpose.evidenceIds.length).toBeGreaterThan(0);
      expect(plan.purpose.statement).not.toMatch(/飽き|楽しめる|世界観/);
    }
    expect(plan.body.length).toBeGreaterThanOrEqual(1);
    const jobs = plan.body.map((b) => b.job);
    expect(jobs.every((j) => j !== "body_facts" || plan.body.length === 1)).toBe(true);
    // no duplicate facts across jobs
    const keys = articlePlanAllFacts(plan).map((f) => f.replace(/\s+/g, ""));
    const bodyKeys = plan.body.flatMap((b) => b.facts.map((f) => f.replace(/\s+/g, "")));
    expect(new Set(bodyKeys).size).toBe(bodyKeys.length);
    expect(plan.lead.facts.join(" ")).not.toMatch(/公式ページで確認/);
    void profile;
    void keys;
  });

  it("does not invent coreAngle from bare performer-only packs", () => {
    const pack = buildEvidencePack({
      productTitle: "優梨まいな",
      claims: [{ id: "c1", statement: "優梨まいな", status: "SUPPORTED", kind: "performer" }],
      pageEvidenceMeta: { actors: ["優梨まいな"] },
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const angle = resolveCoreAngle({ pack, profile, titleFacts: ["優梨まいな"] });
    expect(angle).toBeNull();
  });

  it("title compose stays within verified facts (no theme padding)", () => {
    const composed = composeTitleFacts({
      titleFacts: ["優梨まいな"],
      coreAngle: {
        id: "a",
        fact: "マン毛モロ出し写真館",
        evidenceId: "e1",
        rankReason: "discriminative",
      },
      pack: buildEvidencePack({
        productTitle: PARA_TITLE,
        claims: [],
        pageEvidenceMeta: { actors: ["優梨まいな"], description: { text: PARA_DESC } },
      }),
    });
    expect(composed.join(" ")).toMatch(/優梨まいな/);
    expect(composed.join(" ")).not.toMatch(/世界観|魅力|徹底/);
  });

  it("scarce depth does not inflate reader jobs", () => {
    const pack = buildEvidencePack({
      productTitle: "短尺テスト",
      claims: [{ id: "c1", statement: "ワンシーンのみ", status: "SUPPORTED" }],
      pageEvidenceMeta: {
        actors: ["テスト"],
        description: { text: "ワンシーンのみ収録。", originField: "jsonld.Product.description" },
      },
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    profile.materialDepth = "scarce";
    profile.independentDevelopmentFamilyCount = 1;
    const slots = allocateReaderJobs({
      bodyFacts: ["ワンシーンのみ"],
      pack,
      depth: "scarce",
      profile,
      leadFacts: ["テスト"],
    });
    expect(slots.length).toBeLessThanOrEqual(2);
  });

  it("EXEC connects readerJob and still reaches Writer prompt", () => {
    const { plan } = buildPlan(
      "長身脚長バレー女子たちのガニ股天空杭打ち騎乗位ハーレム",
      "全員170cmオーバーのデカ女子4人身長差手コキ◆13射精◆180分◆杭打ち騎乗位",
      ["木下ひまり", "辻井ほのか", "滝ゆいな", "堤セリナ"],
    );
    const exec = toWriterExecutionContractView(buildArticlePlanExecutionContract(plan));
    expect(exec.length).toBeGreaterThan(0);
    expect(exec.some((e) => e.slot === "title" && e.executionMode === "EXACT_SURFACE")).toBe(true);
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        articlePlan: plan,
        ARTICLE_PLAN: plan,
        ARTICLE_PLAN_EXECUTION: exec,
        layers: { ARTICLE_PLAN: plan, ARTICLE_PLAN_EXECUTION: exec },
      },
    });
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: plan.productTitle,
      ctaUrl: "https://example.com",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    expect(prompt.userPrompt).toContain("ARTICLE_PLAN_EXECUTION");
    expect(prompt.systemInstruction).toMatch(/ARTICLE_PLAN|factual boundary/i);
    // R154 purpose/overview framing is no longer required in Writer system (baseline restore).
  });

  it("catalog confirmation still excluded from V2 plan", () => {
    const { plan } = buildPlan(PARA_TITLE, PARA_DESC, ["優梨まいな", "ましろ杏"]);
    const all = articlePlanAllFacts(plan).join(" ");
    expect(all).not.toMatch(/公式ページ|出演者として.*確認できる/);
    const purpose = resolveArticlePurpose({
      pack: buildEvidencePack({
        productTitle: PARA_TITLE,
        claims: [
          {
            id: "bad",
            statement: "出演者として 優梨まいな が公式ページで確認できる。",
            status: "SUPPORTED",
          },
        ],
        pageEvidenceMeta: {
          actors: ["優梨まいな", "ましろ杏"],
          description: { text: PARA_DESC },
        },
      }),
      profile: buildProductMaterialProfileFromPack(
        buildEvidencePack({
          productTitle: PARA_TITLE,
          claims: [],
          pageEvidenceMeta: {
            actors: ["優梨まいな", "ましろ杏"],
            description: { text: PARA_DESC },
          },
        }),
      ),
    });
    if (purpose) expect(purpose.statement).not.toMatch(/公式ページ/);
  });
});
