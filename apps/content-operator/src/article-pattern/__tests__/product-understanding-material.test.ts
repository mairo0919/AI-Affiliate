/**
 * Product-understanding material — demote career noise; keep work facets;
 * presentationPurpose; SEMANTIC for short theme facets (LLM=0).
 */
import { describe, expect, it } from "vitest";
import {
  extractOfficialPageFactAtoms,
  extractSafeConcreteSalvageTokens,
  isUnusablePageAtomFragment,
} from "../official-page-evidence-atoms.js";
import {
  classifyEvidenceMaterialRole,
  derivePresentationPurpose,
  isDemotedBodyMaterial,
} from "../evidence-material-role.js";
import {
  deriveExecutionMode,
  deriveInformationAxis,
  buildArticlePlanExecutionContract,
} from "../plan-execution-contract.js";
import { buildEvidencePack, claimStatementsFromPageEvidence } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";
import type { PageEvidenceMetaShape } from "../official-page-evidence-atoms.js";

const OFJE_DESC =
  "AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中！円熟した濃厚なセックスとエロポテンシャル、低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾。今回は彼女の最新12タイトル、なお且つ全コーナーを収録した豪華でスペシャルなベスト版です。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です！！！";

function ofjePipeline() {
  const pe = {
    description: { text: OFJE_DESC },
    actors: ["奥田咲"],
  } as PageEvidenceMetaShape;
  const statements = claimStatementsFromPageEvidence({
    pageEvidenceMeta: pe,
    productTitle: "ofje00230",
    actors: pe.actors,
  });
  const pack = buildEvidencePack({
    productTitle: "ofje00230",
    claims: statements.slice(0, 8).map((s, i) => ({
      id: `c${i}`,
      statement: s,
      status: "SUPPORTED" as const,
    })),
    pageEvidenceMeta: pe,
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const plan = buildArticlePlan({
    productTitle: "ofje00230",
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  const exec = buildArticlePlanExecutionContract(plan);
  return { atoms: extractOfficialPageFactAtoms({ descriptionText: OFJE_DESC }), pack, plan, exec };
}

describe("product-understanding material (ofje-shaped)", () => {
  it("keeps short Latin genre codes like NTR (not UNUSABLE dialogue crumbs)", () => {
    expect(isUnusablePageAtomFragment("NTR")).toBe(false);
    expect(isUnusablePageAtomFragment("あぁ")).toBe(true);
    const atoms = extractOfficialPageFactAtoms({ descriptionText: OFJE_DESC });
    // Bare NTR is subsumed into theme-scope collection compound when present as a list.
    expect(
      atoms.concrete.some(
        (a) =>
          a.fact.toUpperCase() === "NTR" ||
          (/NTR/i.test(a.fact) && /などを収録$/.test(a.fact)),
      ),
    ).toBe(true);
  });

  it("salvages body traits from evaluative compound without keeping promo wrapper", () => {
    const salvaged = extractSafeConcreteSalvageTokens(
      "低身長なのにグラマラスボディが魅力の奥田咲",
    );
    expect(salvaged.some((t) => /低身長|グラマラス/.test(t))).toBe(true);
    expect(salvaged.every((t) => !/魅力/.test(t))).toBe(true);
  });

  it("demotes performer external career from core body material", () => {
    expect(classifyEvidenceMaterialRole("映画や舞台でも絶賛活躍中")).toBe(
      "PERFORMER_EXTERNAL_ACTIVITY",
    );
    expect(isDemotedBodyMaterial("映画や舞台でも絶賛活躍中")).toBe(true);
    expect(isDemotedBodyMaterial("人妻")).toBe(false);
    expect(isDemotedBodyMaterial("追撃ピストン")).toBe(false);
  });

  it("ARTICLE_PLAN body omits career fact; keeps work facets; attaches presentationPurpose", () => {
    const { plan } = ofjePipeline();
    const bodyFacts = plan.body.flatMap((b) => b.facts);
    expect(bodyFacts.some((f) => /映画|舞台/.test(f))).toBe(false);
    expect(bodyFacts.some((f) => f === "人妻" || f.includes("人妻"))).toBe(true);
    expect(bodyFacts.some((f) => /NTR/i.test(f))).toBe(true);
    expect(bodyFacts.some((f) => /追撃ピストン/.test(f))).toBe(true);
    expect(bodyFacts.some((f) => /12タイトル|55コーナー|8時間/.test(f))).toBe(true);
    expect(plan.body[0]?.presentationPurpose).toBeTruthy();
    expect(plan.body[0]?.factPurposes?.length).toBe(plan.body[0]?.facts.length);
  });

  it("short theme/play facets use SEMANTIC_PRESERVE and non-cast axis", () => {
    expect(deriveExecutionMode("人妻", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("追撃ピストン", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("NTR", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("8時間", "body")).toBe("EXACT_SURFACE");
    expect(deriveInformationAxis("人妻")).toBe("trait");
    expect(deriveInformationAxis("追撃ピストン")).toBe("scene");
    expect(derivePresentationPurpose("人妻")).toBe("SCENE_VARIETY");
    expect(derivePresentationPurpose("追撃ピストン")).toBe("PLAY_STYLE");
  });

  it("Writer contract requires product-aspect understanding beyond tag lists", () => {
    expect(OPTION_B_WRITER_SYSTEM).toMatch(
      /more than a bare (?:surface mention|checklist drop)|tag list|checklist/i,
    );
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/presentationPurpose|factPurposes/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/Coverage ≠ expansion|coverage ≠ expansion/i);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/Never use fixed character or paragraph quotas/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/Do not output a lead field/);
    expect(OPTION_B_WRITER_SYSTEM).not.toMatch(/最低500|必ず3段落|300字以上/);
  });
});
