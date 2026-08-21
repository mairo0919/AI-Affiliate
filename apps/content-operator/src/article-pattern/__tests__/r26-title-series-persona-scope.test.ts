/**
 * r26 — TITLE_LABEL / SERIES / PRODUCT_PERSONA semantic scope (LLM=0).
 */

import { describe, expect, it } from "vitest";
import {
  classifySemanticEvidence,
  titleLabelAttributionAllowed,
  TITLE_SCOPE_ATTRIBUTION_FAIL_RE,
} from "../semantic-evidence.js";
import { buildEvidencePack, toOptionBWriterSourceMaterial } from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  GROUNDED_PROMOTION_POLICY,
  TITLE_SERIES_PERSONA_SCOPE,
} from "../natural-product-intro-policy.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import { toWritingSkeletonPromptContract } from "../writing-skeleton.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";

const TITLE_LABEL = "令和イチのメスガキ";
const PERFORMER = "松本いちか";
const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

describe("r26 title/series persona semantic boundary (LLM=0)", () => {
  it("product_title 「令和イチのメスガキ」 → TITLE_LABEL, not CHARACTER_TRAIT/PERFORMER_TRAIT", () => {
    const c = classifySemanticEvidence(TITLE_LABEL, {
      sourceType: "product_title",
      titleIdentityToken: true,
    });
    expect(c.primary).toBe("TITLE_LABEL");
    expect(c.blueprintType).toBe("series_or_event");
    expect(c.familyId).toMatch(/^TITLE_/);
    expect(c.primary).not.toBe("CHARACTER_TRAIT");
    expect(c.primary).not.toBe("PERFORMER_TRAIT");
  });

  it("product_description bare メスガキ → PRODUCT_PERSONA (not performer trait)", () => {
    const c = classifySemanticEvidence("メスガキ", {
      sourceType: "product_description",
    });
    expect(c.primary).toBe("PRODUCT_PERSONA");
    expect(c.blueprintType).toBe("series_or_event");
  });

  it("performer provenance bare メスガキ → PERFORMER_TRAIT", () => {
    const c = classifySemanticEvidence("メスガキ", {
      kind: "performer",
      sourceType: "performer_metadata",
    });
    expect(c.primary).toBe("PERFORMER_TRAIT");
    expect(c.blueprintType).toBe("body_trait");
  });

  it("mizd pack: TITLE_LABEL lands in contextFamilies, not characterTraitFamilies", () => {
    const pack = buildEvidencePack({ productTitle: MIZD, claims: [] });
    const profile = buildProductMaterialProfileFromPack(pack);
    expect(profile.contextFamilies.some((f) => f.includes("令和イチ") || f.startsWith("TITLE_"))).toBe(
      true,
    );
    expect(profile.characterTraitFamilies).not.toContain("CHARACTER_メスガキ");
  });

  it("TITLE_LABEL + PERFORMER wording: product-scoped PASS, reputation FAIL", () => {
    const pass = [
      `${PERFORMER}の『${TITLE_LABEL}』作品をまとめたベスト集。`,
      `『${TITLE_LABEL}』シリーズから10作品を収録。`,
      `メスガキをテーマにした${PERFORMER}出演作をまとめたベスト版。`,
      `${PERFORMER}が魅せる『${TITLE_LABEL}』ベスト集`,
    ];
    const fail = [
      `${TITLE_LABEL}として知られる${PERFORMER}のベスト作品集が登場。`,
      `${TITLE_LABEL}というキャラクター性が際立っています。`,
      `${PERFORMER}の代表的なメスガキキャラ`,
      `彼女の個性としてのメスガキ`,
    ];
    for (const t of pass) {
      expect(titleLabelAttributionAllowed(t)).toBe(true);
    }
    for (const t of fail) {
      expect(titleLabelAttributionAllowed(t)).toBe(false);
      expect(TITLE_SCOPE_ATTRIBUTION_FAIL_RE.test(t)).toBe(true);
    }
  });

  it("prompt keeps grounded promotion deleted; TITLE classification still separate; thin authority", () => {
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
    expect(all).not.toMatch(/として知られる/);
    expect(all).not.toMatch(/Shorter readable articles are SUCCESS/);
    expect(auth.GENERATOR_DUTY).toBeUndefined();
    expect(auth.generatorDuty).toHaveLength(1);
    expect(GROUNDED_PROMOTION_POLICY.seriesPersonaRule).toMatch(/product-scoped/i);
    expect(TITLE_SERIES_PERSONA_SCOPE.forbiddenMeanings.length).toBeGreaterThan(0);
  });
});
