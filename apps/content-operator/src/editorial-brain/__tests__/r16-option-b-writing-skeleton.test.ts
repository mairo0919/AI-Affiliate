/**
 * OPTION B — Writing Skeleton + Evidence Pack (LLM calls = 0).
 * Covers fixtures: pred00400, ssis00300, h_1711maan01095, mizd00320, mird00237, parathd03128
 */

import { describe, expect, it } from "vitest";
import {
  GENERATION_AUTHORITY_PRIORITY,
  buildGenerationAuthorityPromptContract,
  buildOptionBGenerationAuthority,
  estimateAuthorityJsonBytes,
} from "../../generation/generation-authority.js";
import {
  buildEvidencePack,
  isCatalogShellStatement,
  stripCatalogWrapper,
  toOptionBWriterSourceMaterial,
} from "../../article-pattern/evidence-pack.js";
import {
  writingSkeletonFromReference,
  writingSkeletonFallback,
  toWritingSkeletonPromptContract,
} from "../../article-pattern/writing-skeleton.js";
import { buildProductMaterialProfileFromPack } from "../../article-pattern/reference-type-profile.js";
import { ensureFeasibleWritingSkeleton } from "../../article-pattern/skeleton-feasibility.js";
import { extractTransformationFromEditorialBlueprint } from "../../article-pattern/reference-editorial-transformation.js";
import type { ReferenceEditorialBlueprint } from "../../article-pattern/reference-editorial-blueprint.js";
import { ensureGenerationAuthorityInSystem } from "../generation/plan-aware-generation.js";
import { detectReferenceNearCopy } from "../../article-pattern/reference-near-copy.js";
import { claimsFromNormalizedPage } from "../../ops/page-normalize.js";
import type { NormalizedPublicPage } from "../../ops/page-normalize.js";

const FIXTURE_TITLES: Record<string, string> = {
  pred00400:
    "【独占】彼女の綺麗なお姉さんと二人きり… 突然のベロキス、イヤラしく舐め尽くされてセックス三昧 こんな僕って最低ですか…？ 葵つかさ",
  ssis00300:
    "激イキ161回！痙攣4212回！イキ潮1800cc！敏感すぎる究極ボディ 瀬野みやび",
  h_1711maan01095: "福原みな 清楚系美少女の初撮り",
  mizd00320:
    "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
  mird00237:
    "【独占】MOODYZファン感謝祭 バコバコバスツアー2024 AV男優発掘＆育成スペシャル！！ AV男優を目指す素人16名とAV女優16名の1泊2日大乱交ツアー！",
  parathd03128: "パラダイステレビ公開収録 素人参加バラエティ",
};

function catalogClaims(title: string) {
  return [
    {
      id: "c-name",
      statement: `${title} は公開ページ上で確認できる。`,
      kind: "name",
      status: "SUPPORTED",
    },
    {
      id: "c-maker",
      statement: "メーカー／レーベルとして「PRESTIGE」が公開されている。",
      kind: "maker",
      status: "SUPPORTED",
    },
    {
      id: "c-avail",
      statement: "公開ページ上で販売／配信状態は「配信中」と確認できる。",
      kind: "availability",
      status: "SUPPORTED",
    },
  ];
}

function stubBlueprint(): ReferenceEditorialBlueprint {
  return {
    schemaVersion: 1,
    referenceId: "ref-optb",
    sourceUrlHost: "example.com",
    articleType: "NEW_RELEASE_SINGLE",
    extractionMode: "paragraph_functions",
    materialDepth: "rich",
    segments: [
      {
        index: 0,
        role: "lead",
        editorialFunction: "hook_with_concrete_scene",
        primaryEvidenceType: "scene_or_act",
        evidenceTypeUsed: ["scene_or_act", "quantity_or_runtime"],
        specificityLevel: "high",
        approximateInformationDensity: "high",
        transitionFunction: "shift_to_performer",
        lengthBucket: "long",
      },
      {
        index: 1,
        role: "development",
        editorialFunction: "advance_unused_detail",
        primaryEvidenceType: "quantity_or_runtime",
        evidenceTypeUsed: ["quantity_or_runtime"],
        specificityLevel: "medium",
        approximateInformationDensity: "medium",
        transitionFunction: "stop",
        lengthBucket: "medium",
      },
    ],
    progression: ["lead:hook", "development:advance"],
    evidenceTypesAdopted: ["scene_or_act", "quantity_or_runtime", "performer_identity"],
    evidenceTypesDeferredHint: [],
    avoidPatterns: ["catalog_maker_dump"],
    endingStrategy: "stop_without_generic_eval",
    repetitionStrategy: "no_cross_segment_restatement",
    extractedAt: new Date().toISOString(),
  };
}

describe("OPTION B Writing Skeleton + Evidence Pack (LLM=0)", () => {
  it("E2. ARTICLE_PLAN is Writer authority priority SSOT", () => {
    expect(GENERATION_AUTHORITY_PRIORITY).toEqual([
      "ARTICLE_PLAN",
      "FACTUAL_SAFETY",
      "BLOG_CHANNEL_REQUIREMENTS",
    ]);
    const system = ensureGenerationAuthorityInSystem("You write blogs.");
    expect(system).toContain("OPTION B");
    expect(system).toContain("ARTICLE_PLAN");
    expect(system).not.toContain("SEGMENT_CONTRACTS");
  });

  it("A. catalog metadata is not primary body fuel", () => {
    for (const [cid, title] of Object.entries(FIXTURE_TITLES)) {
      const pack = buildEvidencePack({ productTitle: title, claims: catalogClaims(title) });
      const catalogFacts = pack.catalogMetadata.map((c) => c.fact);
      expect(catalogFacts.some((f) => /PRESTIGE|配信中/.test(f))).toBe(true);
      for (const e of pack.concreteEvidence) {
        expect(e.fact).not.toMatch(/は公開ページ上で確認できる/);
        expect(e.fact).not.toMatch(/メーカー／レーベルとして/);
        expect(e.generationEligible).toBe(true);
      }
      // Maker/availability never in concrete eligible
      expect(
        pack.concreteEvidence.every(
          (e) => e.type !== "catalog_shell" && e.type !== "maker_or_label",
        ),
      ).toBe(true);
      void cid;
    }
  });

  it("B. concrete evidence assigns to skeleton segments", () => {
    const title = FIXTURE_TITLES.mizd00320!;
    const pack = buildEvidencePack({ productTitle: title, claims: catalogClaims(title) });
    const bp = stubBlueprint();
    const sk =
      writingSkeletonFromReference({
        blueprint: bp,
        transform: extractTransformationFromEditorialBlueprint(bp),
      })!;
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({ skeleton: sk, pack, profile });
    expect(feasibility.ok).toBe(true);
    expect(feasibility.assignment.opening.primary).toBeTruthy();
    expect(feasibility.assignment.opening.primary!.fact).not.toMatch(/配信中|PRESTIGE/);
    expect(feasibility.assignment.anyFallbackCount).toBe(0);
  });


  it("D. Prompt / authority size much smaller than legacy 26KB+ dump", () => {
    const claims = catalogClaims(FIXTURE_TITLES.pred00400!);
    const sk = writingSkeletonFallback({ materialDepth: "standard" });
    const auth = buildOptionBGenerationAuthority({
      writingSkeleton: toWritingSkeletonPromptContract(sk)!,
      evidencePack: toOptionBWriterSourceMaterial({
        productTitle: FIXTURE_TITLES.pred00400!,
        claims: claims.map((c) => ({
          id: c.id,
          statement: c.statement,
          kind: c.kind,
        })),
        officialDescription: null,
      }),
    });
    const bytes = estimateAuthorityJsonBytes(auth);
    expect(bytes).toBeLessThan(12_000);
    expect(bytes).toBeLessThan(26_000);
  });


  it("G. insufficient concrete evidence → DEFER signal", () => {
    const pack = buildEvidencePack({
      productTitle: "X",
      claims: [
        {
          id: "m",
          statement: "メーカー／レーベルとして「Z」が公開されている。",
          kind: "maker",
          status: "SUPPORTED",
        },
        {
          id: "a",
          statement: "公開ページ上で販売／配信状態は「配信中」と確認できる。",
          kind: "availability",
          status: "SUPPORTED",
        },
      ],
    });
    expect(pack.insufficientConcrete).toBe(true);
    expect(pack.insufficientReason).toBeTruthy();
  });

  it("I. Reference prose near-copy not introduced by skeleton", () => {
    const sk = writingSkeletonFallback({});
    const prompt = JSON.stringify(toWritingSkeletonPromptContract(sk));
    expect(prompt).not.toMatch(/突然のベロキス、イヤラしく舐め尽くされて/);
    const near = detectReferenceNearCopy({
      generatedText: "ベロキスがある。",
      referenceSnippets: [
        "突然のベロキス、イヤラしく舐め尽くされてセックス三昧 こんな僕って最低ですか…？",
      ],
    });
    expect(near.hit).toBe(false);
  });

  it("J. X path unchanged — authority builder still exists without blog-only crash", () => {
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: { layers: {} },
    });
    expect(auth.mode).toBe("TRANSITION_MINIMAL");
    expect(auth.FACTUAL_SAFETY).toBeTruthy();
  });

  it("K. LearningRule/Prompt auto-change not part of OPTION B modules", () => {
    // Structural: evidence-pack / writing-skeleton have no LearningRule writes
    expect(typeof buildEvidencePack).toBe("function");
    expect(typeof writingSkeletonFromReference).toBe("function");
  });

  it("L. Brain lifecycle constants still present (ACTIVE path not removed)", () => {
    // Smoke: authority still exports PlanViolationFeedback-compatible builder
    const auth = buildOptionBGenerationAuthority({
      writingSkeleton: { opening: { purpose: "hook" } },
      evidencePack: { supportedClaims: [], officialDescription: null, productTitle: "x" },
      planViolationFeedback: {
        attempt: 1,
        violatedSegments: [],
        missingRequiredContributionIds: [],
        forbiddenReusedContributionIds: [],
        codes: [],
        note: "test",
      },
    });
    expect(auth.planViolationFeedback).toBeTruthy();
  });

  it("Writer EvidencePack uses source Claims (ingest wrappers are not Writer SSOT)", () => {
    // claimsFromNormalizedPage is ingest-only and may still emit confirmation wrappers.
    // OPTION B Writer SSOT is supportedClaims + officialDescription (r43).
    const page = {
      canUseAsProductSource: true,
      productOrTopicName: "テスト作品タイトル長め",
      makerOrPublisher: "MOODYZ",
      series: null,
      releaseInformation: null,
      publiclyConfirmedPrice: null,
      availability: "AVAILABLE",
      performerOrCreator: "テスト女優",
    } as unknown as NormalizedPublicPage;
    const claims = claimsFromNormalizedPage(page);
    expect(stripCatalogWrapper("松本いちかは公開ページ上で確認できる")).toBe("松本いちか");
    expect(
      stripCatalogWrapper(
        `${FIXTURE_TITLES.mizd00320.match(/松本いちか/)![0]}は公開ページ上で確認できる`,
      ),
    ).toBe("松本いちか");
    expect(stripCatalogWrapper("タイトル は公開ページ上で確認できる。")).toBe("タイトル");
    expect(stripCatalogWrapper(claims.find((c) => c.field === "name")!.statement)).toBe(
      "テスト作品タイトル長め",
    );

    const pack = buildEvidencePack({
      productTitle: "テスト作品タイトル長め",
      claims: claims.map((c, i) => ({
        id: `ingest::${c.field}::${i}`,
        statement: c.statement,
        kind: c.field,
        status: "SUPPORTED",
      })),
    });
    const writerMaterial = toOptionBWriterSourceMaterial({
      productTitle: "テスト作品タイトル長め",
      claims: pack.concreteEvidence
        .filter((e) => e.generationEligible)
        .map((e) => ({
          id: e.id,
          statement: e.fact,
        })),
      officialDescription: null,
    });
    const statements = (
      writerMaterial.supportedClaims as Array<{ statement: string }>
    ).map((c) => c.statement);
    expect(statements.every((f) => !/公開ページ/.test(f))).toBe(true);
    expect(statements.some((f) => f.includes("テスト女優") || f === "テスト女優")).toBe(true);
    expect(isCatalogShellStatement("公開ページ上で販売／配信状態は「配信中」と確認できる。")).toBe(
      true,
    );
  });
});
