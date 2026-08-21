/**
 * Natural product-intro policy — LLM=0 (no external API).
 */

import { describe, expect, it } from "vitest";
import {
  NATURAL_PRODUCT_INTRO_STRUCTURE,
  OPTION_B_BRAIN_PRIORITIES,
  GROUNDED_PROMOTION_POLICY,
  noteExternalReferenceForNaturalIntro,
  optionBNaturalIntroInformationGainFloor,
} from "../../article-pattern/natural-product-intro-policy.js";
import {
  buildEvidencePack,
  toOptionBWriterSourceMaterial,
} from "../../article-pattern/evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../../article-pattern/reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../../article-pattern/skeleton-feasibility.js";
import { toWritingSkeletonPromptContract } from "../../article-pattern/writing-skeleton.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../generation/option-b-blogger-prompt.js";
import { evaluateBlogArticleEditorialSufficiency } from "../generation/article-sufficiency.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";

const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

describe("natural product intro policy (LLM=0)", () => {
  it("user quality-bar structure is the skeleton priority sample", () => {
    expect(NATURAL_PRODUCT_INTRO_STRUCTURE.source).toBe("user_quality_bar_mizd00320");
    expect(NATURAL_PRODUCT_INTRO_STRUCTURE.slots.map((s) => s.id)).toEqual([
      "opening",
      "body_content",
      "ending_audience",
      "cta",
    ]);
  });

  it("external ranking URL is not used as product-intro skeleton when listicle", () => {
    const note = noteExternalReferenceForNaturalIntro({
      url: "https://osusume.dmm.co.jp/articles/staff/2553/",
      fetched: true,
      observedGenre: "ranking_listicle",
    });
    expect(note.usableAsProductIntroSkeleton).toBe(false);
    expect(note.note).toMatch(/Reference Library articleType=ranking|ranking/i);
  });

  it("unfetched URL must not invent structure", () => {
    const note = noteExternalReferenceForNaturalIntro({
      url: "https://example.invalid/missing",
      fetched: false,
    });
    expect(note.usableAsProductIntroSkeleton).toBe(false);
    expect(note.note).toMatch(/do not invent/i);
  });

  it("mizd-like profile → natural intro skeleton with ≤2 body slots (structure, not brevity goal)", () => {
    const pack = buildEvidencePack({
      productTitle: MIZD,
      claims: [
        {
          id: "q",
          statement: "10作品が収録規模として記載されている。",
          kind: "trait_or_scene",
          status: "SUPPORTED",
        },
      ],
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const sk = skeletonFromMaterialProfile(profile);
    expect(sk.articleShape).toBe("natural_product_intro");
    expect(sk.body.length).toBeLessThanOrEqual(2);
    const feasibility = ensureFeasibleWritingSkeleton({ skeleton: sk, pack, profile });
    expect(feasibility.ok).toBe(true);
    expect(feasibility.skeleton.body.length).toBeLessThanOrEqual(2);
  });

  it("r29 Generator prompt is thin: single policy + authority SSOT; no Brain quality walls", () => {
    const pack = buildEvidencePack({ productTitle: MIZD, claims: [] });
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
        claims: [],
        officialDescription: null,
      }),
    });
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: MIZD,
      ctaUrl: "https://example.invalid/p",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    const all = prompt.systemInstruction + prompt.userPrompt;
    expect(all).toMatch(/EvidencePackの事実だけを使い/);
    expect(all).not.toMatch(/GROUNDED PROMOTION/);
    expect(all).not.toMatch(/UNGROUNDED EVALUATION/);
    expect(all).not.toMatch(/として知られる/);
    expect(all).not.toMatch(/Shorter readable articles are SUCCESS/);
    expect(auth.GENERATOR_DUTY).toBeUndefined();
    expect(auth.generatorDuty).toHaveLength(1);
    expect(auth.MINIMAL_STYLE).toEqual({
      language: "ja",
      articleShape: "natural_product_intro",
    });
    expect(GROUNDED_PROMOTION_POLICY.forbidEvaluationOnlySentence).toBe(true);
    expect(NATURAL_PRODUCT_INTRO_STRUCTURE.slots[1]!.purpose).toBe(
      "compose_concrete_evidence_into_natural_intro",
    );
    expect(auth.WRITING_SKELETON).toMatchObject({ articleShape: "natural_product_intro" });
  });

  it("legacy EVIDENCE_DRIVEN_LENGTH_POLICY docs retained; Generator uses OPTION_B_GENERATOR_POLICY", async () => {
    const { EVIDENCE_DRIVEN_LENGTH_POLICY, OPTION_B_GENERATOR_POLICY } = await import(
      "../../article-pattern/natural-product-intro-policy.js"
    );
    expect(EVIDENCE_DRIVEN_LENGTH_POLICY.principle).toBe("ARTICLE_LENGTH_EQUALS_EVIDENCE_DRIVEN");
    expect(EVIDENCE_DRIVEN_LENGTH_POLICY.notGoals).toContain("write_as_short_as_possible");
    expect(NATURAL_PRODUCT_INTRO_STRUCTURE.densityNote).toBe(OPTION_B_GENERATOR_POLICY);
  });

  it("Brain priorities deprioritize coverage maximization", () => {
    expect(OPTION_B_BRAIN_PRIORITIES[0]).toBe("factual_grounding_no_contradiction");
    expect(OPTION_B_BRAIN_PRIORITIES).not.toContain("use_every_evidence_item");
    expect(optionBNaturalIntroInformationGainFloor()).toBe(1);
  });

  it("natural intro sufficiency uses floor=1 not high informationGainTarget", () => {
    const artifact = {
      channel: "BLOG" as const,
      title: "松本いちか 10作品8時間ベスト",
      summary: "松本いちかのメスガキベスト",
      lead: "松本いちかの「令和イチのメスガキ」シリーズをまとめたベスト作品が登場。",
      sections: [
        {
          paragraphs: [
            "本作にはわからせ痴女られ作品を中心に全10作品を収録。合計8時間のボリュームです。",
          ],
          lists: [],
        },
      ],
      bodyText: "x",
    };
    const assertions = [
      {
        assertion: "松本いちか",
        supportType: "DIRECT" as const,
        sourceSegment: "lead",
        supportingClaimIds: ["c1"],
        novelFacets: ["松本いちか"],
        failureCodes: [] as string[],
        predicateFamilies: ["FACTUAL_ATTRIBUTE"],
      },
      {
        assertion: "10作品",
        supportType: "DIRECT" as const,
        sourceSegment: "section:0:p0",
        supportingClaimIds: ["c1"],
        novelFacets: ["10作品"],
        failureCodes: [] as string[],
        predicateFamilies: ["FACTUAL_ATTRIBUTE", "EVENT_OR_SCENE"],
      },
    ];
    const corePlan = {
      informationGainTarget: 5,
      scarcityMode: false,
    } as never;
    const low = evaluateBlogArticleEditorialSufficiency({
      artifact,
      assertions: assertions as never,
      corePlan,
      claimStatements: [{ id: "c1", statement: MIZD, kind: "trait_or_scene" }],
      naturalProductIntro: false,
    });
    expect(low.ok).toBe(false);
    const ok = evaluateBlogArticleEditorialSufficiency({
      artifact,
      assertions: assertions as never,
      corePlan,
      claimStatements: [{ id: "c1", statement: MIZD, kind: "trait_or_scene" }],
      naturalProductIntro: true,
    });
    expect(ok.ok).toBe(true);
  });

  it("OPTION B natural intro review does not fail solely for unused contribution coverage", () => {
    const review = reviewArtifactShadow({
      artifact: {
        channel: "BLOG",
        title: "松本いちか 10作品8時間ベスト",
        summary: "ベスト作品",
        lead: "松本いちかのメスガキベストが登場。",
        sections: [
          {
            paragraphs: ["全10作品・合計8時間を収録したベスト版です。"],
            lists: [],
          },
        ],
        bodyText: "松本いちかのメスガキベストが登場。全10作品・合計8時間を収録したベスト版です。",
      },
      corePlan: {
        channel: "BLOG",
        selectedClaimIds: ["c1", "c2", "c3"],
        openingDriverClaimIds: ["c1"],
        claimAllocation: [
          { claimId: "c1", role: "opening" },
          { claimId: "c2", role: "development" },
          { claimId: "c3", role: "development" },
        ],
        informationGainTarget: 8,
        scarcityMode: false,
        inferencePolicy: { allowed: ["direct_paraphrase"], forbidden: [] },
      } as never,
      claimStatements: [
        { id: "c1", statement: "松本いちか", kind: "performer" },
        { id: "c2", statement: "10作品収録", kind: "trait_or_scene" },
        { id: "c3", statement: "8時間", kind: "trait_or_scene" },
      ],
      optionBNaturalIntro: true,
    });
    expect(review.failures.some((f) => f.code === "INFORMATION_GAIN_LOW" && /informationGainTarget=8/.test(f.message))).toBe(
      false,
    );
  });
});
