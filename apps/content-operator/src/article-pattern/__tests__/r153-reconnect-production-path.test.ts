/**
 * Reconnect regression — R149 catalog hygiene + R151 EXEC must reach production Writer path.
 * LLM=0. No new quality gates; only prove existing improvements are wired.
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  isCatalogConfirmationProse,
  stripCatalogWrapper,
} from "../evidence-pack.js";
import { buildArticlePlan } from "../article-plan.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import {
  buildArticlePlanExecutionContract,
  deriveExecutionMode,
  toWriterExecutionContractView,
} from "../plan-execution-contract.js";
import {
  buildGenerationAuthorityPromptContract,
  buildOptionBGenerationAuthority,
  resolveArticlePlanExecution,
} from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import { isWriterCatalogConfirmation } from "../writer-evidence-filter.js";

const PARA_TITLE = "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "コインランドリーでナンパした女子大生のマン毛。女性専門高級回春エステに通う女性のマン毛。催●術にかかった女性のマン毛。不倫中の団地妻など。当写真館の巨乳学芸員。";
const CATALOG_SPACED = "出演者として 優梨まいな が公式ページで確認できる。";
const CATALOG_TIGHT = "出演者として優梨まいなが公式ページで確認できる。";

function pipeline(claims: Array<{ id: string; statement: string; kind?: string }>) {
  const pack = buildEvidencePack({
    productTitle: PARA_TITLE,
    claims: claims.map((c) => ({ ...c, status: "SUPPORTED" as const })),
    pageEvidenceMeta: {
      actors: ["優梨まいな", "ましろ杏"],
      description: { text: PARA_DESC, originField: "jsonld.Product.description" },
    },
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const plan = buildArticlePlan({
    productTitle: PARA_TITLE,
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  return { pack, profile, plan, feas };
}

describe("R153 reconnect production path (R149/R151)", () => {
  it("stripCatalogWrapper recovers performer from 公式ページ confirmation", () => {
    expect(isCatalogConfirmationProse(CATALOG_SPACED)).toBe(true);
    expect(isWriterCatalogConfirmation(CATALOG_SPACED)).toBe(true);
    expect(stripCatalogWrapper(CATALOG_SPACED)).toBe("優梨まいな");
    expect(stripCatalogWrapper(CATALOG_TIGHT)).toBe("優梨まいな");
  });

  it("catalog confirmation never enters ARTICLE_PLAN lead/title/body", () => {
    const { plan } = pipeline([
      { id: "c1", statement: CATALOG_SPACED, kind: "performer" },
      { id: "c2", statement: "当写真館の巨乳学芸員" },
      { id: "c3", statement: "コインランドリーでナンパした女子大生のマン毛" },
    ]);
    const all = [plan.title.facts, plan.lead.facts, ...plan.body.map((b) => b.facts)]
      .flat()
      .join(" ");
    expect(all).not.toMatch(/公式ページ|出演者として.*確認できる/);
    expect(plan.lead.facts.every((f) => !isCatalogConfirmationProse(f))).toBe(true);
  });

  it("catalog claim does not block concrete scene plan facts", () => {
    const { plan } = pipeline([
      { id: "c1", statement: CATALOG_SPACED, kind: "performer" },
      { id: "c2", statement: "当写真館の巨乳学芸員" },
      { id: "c3", statement: "コインランドリーでナンパした女子大生のマン毛" },
    ]);
    const all = [plan.title.facts, plan.lead.facts, ...plan.body.map((b) => b.facts)]
      .flat()
      .join(" ");
    expect(all).not.toMatch(/公式ページで確認できる/);
    expect(all).toMatch(/コインランドリー|学芸員|優梨|ましろ/);
  });

  it("ARTICLE_PLAN_EXECUTION is derived when contract forgot to attach it", () => {
    const { plan } = pipeline([
      { id: "c1", statement: "当写真館の巨乳学芸員" },
      { id: "c2", statement: "コインランドリーでナンパした女子大生のマン毛" },
    ]);
    // Simulate pre-R151 persist shape: plan only, no EXEC on contract
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        articlePlan: plan,
        ARTICLE_PLAN: plan,
        layers: { ARTICLE_PLAN: plan },
      },
    });
    expect(Array.isArray(auth.ARTICLE_PLAN_EXECUTION)).toBe(true);
    expect((auth.ARTICLE_PLAN_EXECUTION as unknown[]).length).toBeGreaterThan(0);
    const titleExec = (auth.ARTICLE_PLAN_EXECUTION as Array<{ slot: string; executionMode: string }>).find(
      (e) => e.slot === "title",
    );
    expect(titleExec?.executionMode).toBe("EXACT_SURFACE");

    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: PARA_TITLE,
      ctaUrl: "https://example.com",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    expect(prompt.userPrompt).toContain("ARTICLE_PLAN_EXECUTION");
    expect(prompt.userPrompt).toContain("EXACT_SURFACE");
    expect(prompt.userPrompt).not.toMatch(/公式ページで確認/);
  });

  it("resolveArticlePlanExecution rebuilds from plan facts", () => {
    const plan = {
      title: { job: "who_plus_core", facts: ["優梨まいな"] },
      lead: { job: "opening_facts", facts: ["優梨まいなとましろ杏"] },
      body: [{ job: "body_facts", facts: ["コインランドリーでナンパした女子大生のマン毛"] }],
    };
    const exec = resolveArticlePlanExecution(plan, null);
    expect(exec.length).toBe(3);
    expect(deriveExecutionMode("優梨まいな", "title")).toBe("EXACT_SURFACE");
    const auth = buildOptionBGenerationAuthority({
      articlePlan: plan,
      articlePlanExecution: null,
    });
    expect(Array.isArray(auth.ARTICLE_PLAN_EXECUTION)).toBe(true);
    expect(
      (auth.ARTICLE_PLAN_EXECUTION as Array<{ fact: string; executionMode: string }>).some(
        (e) => e.fact === "優梨まいな" && e.executionMode === "EXACT_SURFACE",
      ),
    ).toBe(true);
  });

  it("explicit EXEC on plan.execution is preferred", () => {
    const plan = {
      title: { job: "who_plus_core", facts: ["優梨まいな"] },
      lead: { job: "opening_facts", facts: ["リード"] },
      body: [{ job: "body_facts", facts: ["ボディ"] }],
    };
    const explicit = toWriterExecutionContractView(buildArticlePlanExecutionContract(plan));
    const withExec = { ...plan, execution: explicit };
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        articlePlan: withExec,
        layers: { ARTICLE_PLAN: withExec },
      },
    });
    expect(auth.ARTICLE_PLAN_EXECUTION).toEqual(explicit);
  });
});
