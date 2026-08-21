/**
 * r47 — equivalent duration quantity + Brain FP audit (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { buildSemanticFamilyId } from "../../article-pattern/semantic-evidence.js";
import {
  facetsSemanticallyEquivalent,
  runtimeDurationMinutes,
} from "../generation/contribution-family.js";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import {
  fillOptionBArticleDefaults,
  parseBloggerArticle,
} from "../../generation/structured-article.js";

const R46_RAW = "/tmp/prod-gen-20260820-r46-mizd00320/PROVIDER_RAW.json";
const R46_DESC =
  "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！最強の天使な小悪魔、松本いちかの本気をみさらせや！";

const MIZD_CLAIMS = [
  {
    id: "cmsy5nf95000cs79kum2etw5w",
    statement: "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
    kind: "identity_name",
  },
  {
    id: "cmsy5nf99000es79k4purbek2",
    statement: "10作品が収録規模として記載されている。",
    kind: "trait_or_scene",
  },
  {
    id: "cmsy5nf99000gs79kuwqi64ju",
    statement: "時間ベストが公開情報として記載されている。",
    kind: "trait_or_scene",
  },
];

function loadR46() {
  if (!existsSync(R46_RAW)) throw new Error(`missing ${R46_RAW}`);
  return JSON.parse(readFileSync(R46_RAW, "utf8")) as Record<string, unknown>;
}

function r46Review(sourceTexts?: string[]) {
  const art = parseBloggerArticle(fillOptionBArticleDefaults(loadR46()));
  const claims = MIZD_CLAIMS;
  const artifact = {
    channel: "BLOG" as const,
    title: art.title,
    summary: art.summary,
    lead: art.lead,
    sections: art.sections.map((s) => ({ paragraphs: s.paragraphs, lists: s.lists })),
    bodyText: "",
  };
  const core = buildCoreEditorialPlan({
    channel: "BLOG",
    formatKey: "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    availableClaims: claims,
    selectedClaims: claims,
    openingClaimIds: [claims[0]!.id],
    hookClaimIds: [claims[0]!.id],
    developmentClaimIds: claims.slice(1).map((c) => c.id),
    structurePatternId: null,
    editorialPatternId: null,
  });
  return reviewArtifactShadow({
    artifact,
    corePlan: core,
    claimStatements: claims,
    optionBNaturalIntro: true,
    sourceTexts,
  });
}

describe("r47 equivalent duration + Brain FP (LLM=0)", () => {
  it("duration minutes normalization: 8時間 ≡ 480分 same family", () => {
    expect(runtimeDurationMinutes("8時間")).toBe(480);
    expect(runtimeDurationMinutes("480分")).toBe(480);
    expect(facetsSemanticallyEquivalent("8時間", "480分")).toBe(true);
    expect(facetsSemanticallyEquivalent("8時間", "481分")).toBe(false);
    expect(buildSemanticFamilyId("DURATION", "8時間")).toBe("DURATION_480MIN");
    expect(buildSemanticFamilyId("DURATION", "480分")).toBe("DURATION_480MIN");
  });

  it("r46 WITHOUT sourceTexts: EVALUATIVE still fires (Writer↔Brain asymmetry baseline)", () => {
    const review = r46Review(undefined);
    expect(review.failures.map((f) => f.code)).toContain("EVALUATIVE_INFERENCE");
    expect(review.decision).toBe("TARGETED_REPAIR");
  });

  it("r46 WITH officialDescription sourceTexts: promo paraphrase not BLOCKING", () => {
    const review = r46Review([R46_DESC]);
    const codes = review.failures.map((f) => f.code);
    expect(codes).not.toContain("EVALUATIVE_INFERENCE");
    expect(codes).not.toContain("REPETITION");
    expect(review.decision).not.toBe("TARGETED_REPAIR");
  });

  it("genuine unsupported evaluation still BLOCKING (no sourceTexts)", () => {
    const claims = [
      {
        id: "p1",
        statement: "出演者／クリエイターとして「PerformerDelta」が記載されている。",
        kind: "performer",
      },
    ];
    const review = reviewArtifactShadow({
      corePlan: buildCoreEditorialPlan({
        channel: "BLOG",
        formatKey: "NEW_RELEASE_SINGLE",
        contentType: "blogger-article",
        availableClaims: claims,
        selectedClaims: claims,
        openingClaimIds: ["p1"],
        hookClaimIds: ["p1"],
        developmentClaimIds: [],
        structurePatternId: null,
        editorialPatternId: null,
      }),
      claimStatements: claims,
      artifact: {
        channel: "BLOG",
        title: "公開事実の整理",
        summary: "候補向けメモ。",
        lead: "PerformerDeltaがクレジットされている。",
        sections: [
          {
            paragraphs: [
              "PerformerDeltaという出演者が起用されており、その存在感が作品の魅力を高めています。",
            ],
            lists: [],
          },
        ],
        bodyText: "",
      },
    });
    expect(review.failures.map((f) => f.code)).toContain("EVALUATIVE_INFERENCE");
    expect(review.decision).not.toBe("PASS");
  });

  it("genuine lead/body full restatement still REPETITION", () => {
    const claims = [
      { id: "t1", statement: "顔面ビンタと連続展開が公開されている。", kind: "trait_or_scene" },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: buildCoreEditorialPlan({
        channel: "BLOG",
        formatKey: "NEW_RELEASE_SINGLE",
        contentType: "blogger-article",
        availableClaims: claims,
        selectedClaims: claims,
        openingClaimIds: ["t1"],
        hookClaimIds: ["t1"],
        developmentClaimIds: ["p1"],
        structurePatternId: null,
        editorialPatternId: null,
      }),
      claimStatements: claims,
      artifact: {
        channel: "BLOG",
        title: "公開事実の整理",
        summary: "候補向けメモ。",
        lead: "顔面ビンタと連続展開が公開されている。",
        sections: [
          {
            paragraphs: [
              "顔面ビンタと連続展開が公開されている点を改めて述べる。出演者Alphaがクレジットされている。",
            ],
            lists: [],
          },
        ],
        bodyText: "",
      },
    });
    expect(review.failures.map((f) => f.code)).toContain("REPETITION");
  });
});
