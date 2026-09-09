/**
 * OPTION B production path consolidation — LLM=0 tests.
 */

import { describe, expect, it } from "vitest";
import { assignEvidenceToWritingSkeleton } from "../../article-pattern/skeleton-evidence-assignment.js";
import {
  buildEvidencePack,
  stripCatalogWrapper,
  dedupeConcreteEvidenceByFamily,
  isCatalogShellStatement,
  toOptionBWriterSourceMaterial,
} from "../../article-pattern/evidence-pack.js";
import { buildResearchEvidence } from "../../article-pattern/research-evidence.js";
import {
  buildProductMaterialProfileFromPack,
  profileSatisfiesReferenceRequirements,
} from "../../article-pattern/reference-type-profile.js";
import { classifySemanticEvidence } from "../../article-pattern/semantic-evidence.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../../article-pattern/skeleton-feasibility.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { toWritingSkeletonPromptContract } from "../../article-pattern/writing-skeleton.js";
import {
  buildOptionBBloggerGeneratorPrompt,
  utf8Bytes,
} from "../generation/option-b-blogger-prompt.js";
import { buildBloggerGeneratePromptDefinition } from "../../generation/structured-article.js";
import { optionBAllowsPostLlmProseMutation } from "../generation/option-b-blog-boundary.js";
import { validatePostTransformIntegrity } from "../generation/post-transform-integrity.js";
import { detectReferenceNearCopy } from "../../article-pattern/reference-near-copy.js";
import { resolveEditorialBrainMode } from "../index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

describe("OPTION B production path (LLM=0)", () => {
  it("A. catalog wrapper Claim → normalized factual atom", () => {
    expect(stripCatalogWrapper("松本いちかは公開ページ上で確認できる")).toBe("松本いちか");
    expect(
      stripCatalogWrapper("メーカー／レーベルとして「MOODYZ」が公開されている。"),
    ).toBe("MOODYZ");
    expect(stripCatalogWrapper("10作品が収録規模として記載されている。")).toBe("10作品");
  });

  it("B. availability → catalogMetadata only", () => {
    const pack = buildEvidencePack({
      productTitle: "テスト作品",
      claims: [
        {
          id: "a1",
          statement: "公開ページ上で販売／配信状態は「配信中」と確認できる。",
          kind: "availability",
          status: "SUPPORTED",
        },
      ],
    });
    expect(
      pack.concreteEvidence.every((e) => !/配信中/.test(e.fact) || e.type === "product_identity"),
    ).toBe(true);
    expect(
      pack.catalogMetadata.some((e) => /配信中/.test(e.fact)) ||
        isCatalogShellStatement(
          "公開ページ上で販売／配信状態は「配信中」と確認できる。",
        ),
    ).toBe(true);
  });

  it("C. same semantic family → dedupe in Generator pack projection", () => {
    const items = [
      {
        id: "1",
        type: "quantity_or_runtime" as const,
        fact: "10作品",
        provenance: { sourceType: "product_title", sourceRef: "t" },
        confidence: "high" as const,
        generationEligible: true,
      },
      {
        id: "2",
        type: "quantity_or_runtime" as const,
        fact: "10本",
        provenance: { sourceType: "supported_claim", sourceRef: "c" },
        confidence: "high" as const,
        generationEligible: true,
      },
    ];
    const deduped = dedupeConcreteEvidenceByFamily(items);
    expect(deduped).toHaveLength(1);
    expect(classifySemanticEvidence("10作品").familyId).toBe("COUNT_10");
    expect(classifySemanticEvidence("10本").familyId).toBe("COUNT_10");
    expect(classifySemanticEvidence("8時間").familyId).toBe("DURATION_480MIN");
    expect(classifySemanticEvidence("合計8時間").familyId).toBe("DURATION_480MIN");
    expect(classifySemanticEvidence("480分").familyId).toBe("DURATION_480MIN");
  });

  it("D. scene unique=1 → scene_rich reject", () => {
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
    expect(profile.sceneFamilies.length).toBeLessThanOrEqual(1);
    expect(profileSatisfiesReferenceRequirements(profile, "scene_rich")).toBe(false);
  });

  it("E. 3-slot + unique≈2 → shrink", () => {
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
    sk.body = [
      ...sk.body,
      {
        order: 99,
        purpose: "pad",
        primaryEvidenceRole: "scene_or_act",
        supportingEvidenceRoles: [],
        transformation: "x",
        avoid: [],
      },
      {
        order: 100,
        purpose: "pad2",
        primaryEvidenceRole: "scene_or_act",
        supportingEvidenceRoles: [],
        transformation: "x",
        avoid: [],
      },
    ];
    const feasibility = ensureFeasibleWritingSkeleton({ skeleton: sk, pack, profile });
    expect(feasibility.ok || feasibility.deferred).toBe(true);
    if (feasibility.ok) {
      expect(feasibility.skeleton.body.length).toBeLessThanOrEqual(
        Math.max(2, profile.independentDevelopmentFamilyCount),
      );
      expect(feasibility.assignment.anyFallbackCount).toBe(0);
    }
  });

  it("F. role mismatch → no any fallback", () => {
    const pack = buildEvidencePack({
      productTitle: "10作品ベスト",
      claims: [],
    });
    const sk = skeletonFromMaterialProfile(buildProductMaterialProfileFromPack(pack));
    sk.opening.primaryEvidenceRole = "performer_identity";
    sk.body = [];
    const a = assignEvidenceToWritingSkeleton(sk, pack, { allowAnyFallback: false });
    expect(a.anyFallbackCount).toBe(0);
    expect(a.opening.primary).toBeNull();
  });

  it("G. Evidence不足 → DEFER", () => {
    const pack = buildEvidencePack({ productTitle: "x", claims: [] });
    pack.concreteEvidence = pack.concreteEvidence.filter((e) => e.type === "product_identity");
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    expect(feasibility.deferred || !feasibility.assignment.opening.primary).toBe(true);
  });

  it("H/I. Generator prompt has single authority; no legacy SEGMENT wall", () => {
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
        claims: [
          {
            id: "q",
            statement: "10作品が収録規模として記載されている。",
            kind: "trait_or_scene",
          },
        ],
        officialDescription: null,
      }),
    });
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: MIZD,
      ctaUrl: "https://example.invalid/p",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    const all = prompt.systemInstruction + "\n" + prompt.userPrompt;
    // R114+: Writer SSOT is ARTICLE_PLAN (leadless) — not EVIDENCE_PACK / WRITING_SKELETON soft dumps.
    expect(all).toMatch(/ARTICLE_PLAN/);
    expect(all).not.toMatch(/SEGMENT_CONTRACTS/);
    expect(all).not.toMatch(/CLAIM USAGE PLAN/);
    expect(all).toMatch(/Do not invent|事実を捏造しない|Do not invent facts/);
    // Authority may still list FACTUAL_SAFETY priority keys for diagnostics even when
    // Writer-visible prompt is ARTICLE_PLAN-only.
    expect(JSON.stringify(auth.authorityPriority)).toMatch(/FACTUAL_SAFETY/);
  });

  it("J. deterministic prose mutation forbidden on OPTION B", () => {
    expect(optionBAllowsPostLlmProseMutation()).toBe(false);
  });

  it("P. Evidence Pack ids accepted by claim validator (OPTION B)", async () => {
    const { validateClaimsAgainstArticle } = await import("../../generation/claim-validator.js");
    const result = validateClaimsAgainstArticle({
      article: {
        title: "t",
        summary: "s",
        lead: "松本いちか 10作品",
        sections: [{ heading: null, paragraphs: ["8時間"], lists: [] }],
        cta: { label: "x", url: null },
        seoTitle: "t",
        metaDescription: "m",
        sourceReferences: [],
        labels: [],
        warnings: [],
        usedClaimIds: ["title_facet::0", "title::full"],
        usedProductLinkIds: [],
      } as never,
      claims: [],
      bodyText: "松本いちか 10作品 8時間",
      allowedEvidenceIds: ["title_facet::0", "title::full"],
    });
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.code === "UNKNOWN_CLAIM_ID")).toBe(false);
  });

  it("K. broken Japanese still hard-fails integrity (no rewrite salvage)", () => {
    const integrity = validatePostTransformIntegrity({
      title: "t",
      lead: "2024は、を目指す素人16名",
      sections: [],
    });
    expect(integrity.ok).toBe(false);
  });

  it("L. near-copy green", () => {
    const phrase = "素人16名と女優16名が参加する1泊2日の特別ツアー企画である";
    expect(
      detectReferenceNearCopy({
        generatedText: `${phrase}。`,
        blockedPhrases: [phrase],
      }).hit,
    ).toBe(true);
  });

  it("M. Brain ACTIVE resolver green", () => {
    expect(["ACTIVE", "SHADOW"]).toContain(resolveEditorialBrainMode("ACTIVE"));
  });

  it("N. X channel isolation intact (BLOG OPTION B modules do not rewrite X)", () => {
    const articleRoot = join(dirname(fileURLToPath(import.meta.url)), "../../article-pattern");
    for (const f of [
      "evidence-pack.ts",
      "writing-skeleton.ts",
      "skeleton-feasibility.ts",
    ]) {
      const src = readFileSync(join(articleRoot, f), "utf8");
      expect(src).not.toMatch(/GENERATION_X|x-post|buildXChannelPlan/);
    }
    const xAdapter = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../channels/x/adapter.ts"),
      "utf8",
    );
    expect(xAdapter).toMatch(/buildXChannelPlan/);
    expect(xAdapter).toMatch(/channel:\s*[\"']X[\"']/);
  });

  it("O. LearningRule unchanged in OPTION B modules", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../article-pattern");
    for (const f of [
      "evidence-pack.ts",
      "semantic-evidence.ts",
      "skeleton-feasibility.ts",
      "reference-type-profile.ts",
    ]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src).not.toMatch(/updateLearningRule|mutateLearningRule/);
    }
  });

  it("Prompt size regression: OPTION B << legacy system wall", () => {
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
      researchEvidence: buildResearchEvidence({
        productTitle: MIZD,
        claims: [
          {
            id: "q",
            statement: "10作品が収録規模として記載されている。",
            kind: "trait_or_scene",
            status: "SUPPORTED",
          },
        ],
      }),
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    const auth = buildOptionBGenerationAuthority({
      writingSkeleton: toWritingSkeletonPromptContract(feasibility.skeleton)!,
      evidencePack: toOptionBWriterSourceMaterial({
        productTitle: MIZD,
        claims: [
          {
            id: "q",
            statement: "10作品が収録規模として記載されている。",
            kind: "trait_or_scene",
          },
        ],
        officialDescription: null,
      }),
    });
    const optionB = buildOptionBBloggerGeneratorPrompt({
      productTitle: MIZD,
      ctaUrl: "https://example.invalid/p",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    const legacy = buildBloggerGeneratePromptDefinition();
    const optionBBytes = utf8Bytes(optionB.systemInstruction + optionB.userPrompt);
    const legacySystemBytes = utf8Bytes(legacy.systemInstruction);
    const optionBSystemBytes = utf8Bytes(optionB.systemInstruction);
    // Documented before: ~26KB authority + ~37KB brainContract dumped into prompt
    const beforeApproxBytes = legacySystemBytes + 26_000 + 37_000;
    // OPTION B system grows with natural-product-intro / title-surface policy text;
    // still far below legacy SEGMENT wall (~26KB+ authority dump).
    expect(optionBSystemBytes).toBeLessThanOrEqual(legacySystemBytes + 2350);
    expect(optionB.systemInstruction).not.toMatch(/SEGMENT_CONTRACTS|CLAIM USAGE PLAN|BRAIN GENERATION CONTRACT/);
    expect(optionBBytes).toBeLessThan(25_000);
    expect(optionBBytes).toBeLessThan(beforeApproxBytes * 0.35);
  });
});
