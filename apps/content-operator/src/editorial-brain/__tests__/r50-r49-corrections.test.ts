/**
 * r50 — apply r49 CORRECTIONs (LLM=0).
 * duration Writer projection / source-supported eval / SOCIAL_PROOF scope.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  toOptionBWriterSourceMaterial,
} from "../../article-pattern/evidence-pack.js";
import {
  buildSemanticFamilyId,
  collapseEquivalentDurationSurfaces,
  collectPreferredDurationSurfaces,
} from "../../article-pattern/semantic-evidence.js";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import { SOCIAL_PROOF_RELATION_RE } from "../shadow/predicate-families.js";
import {
  fillOptionBArticleDefaults,
  parseBloggerArticle,
} from "../../generation/structured-article.js";

const R48_RESULT = "/tmp/prod-gen-20260820-r48-mizd00320/RESULT.json";
const R48_RAW = "/tmp/prod-gen-20260820-r48-mizd00320/PROVIDER_RAW.json";

const MIZD_TITLE =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";
const MIZD_DESC =
  "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！最強の天使な小悪魔、松本いちかの本気をみさらせや！";

const CLAIMS = [
  {
    id: "cmsy5nf95000cs79kum2etw5w",
    statement: MIZD_TITLE,
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

function loadR48Raw(): Record<string, unknown> {
  if (!existsSync(R48_RAW)) throw new Error(`missing ${R48_RAW}`);
  return JSON.parse(readFileSync(R48_RAW, "utf8")) as Record<string, unknown>;
}

function reviewR48(sourceTexts?: string[]) {
  const art = parseBloggerArticle(fillOptionBArticleDefaults(loadR48Raw()));
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
    availableClaims: CLAIMS,
    selectedClaims: CLAIMS,
    openingClaimIds: [CLAIMS[0]!.id],
    hookClaimIds: [CLAIMS[0]!.id],
    developmentClaimIds: CLAIMS.slice(1).map((c) => c.id),
    structurePatternId: null,
    editorialPatternId: null,
  });
  return reviewArtifactShadow({
    artifact,
    corePlan: core,
    claimStatements: CLAIMS,
    optionBNaturalIntro: true,
    sourceTexts,
  });
}

describe("r50 r49 corrections (LLM=0)", () => {
  it("A. duration family + Writer projection collapses 480分 when title has 8時間", () => {
    expect(buildSemanticFamilyId("DURATION", "8時間")).toBe("DURATION_480MIN");
    expect(buildSemanticFamilyId("DURATION", "480分")).toBe("DURATION_480MIN");
    const preferred = collectPreferredDurationSurfaces(MIZD_TITLE);
    expect(preferred.get(480)).toBe("8時間");
    const collapsed = collapseEquivalentDurationSurfaces(MIZD_DESC, preferred);
    expect(collapsed).toContain("8時間");
    expect(collapsed).not.toContain("480分");

    const projected = toOptionBWriterSourceMaterial({
      productTitle: MIZD_TITLE,
      claims: CLAIMS,
      officialDescription: MIZD_DESC,
    });
    const desc = String(projected.officialDescription ?? "");
    expect(desc).toContain("8時間");
    expect(desc).not.toContain("480分");
    expect(JSON.stringify(projected.supportedClaims)).not.toMatch(/480分/);
  });

  it("B/C. r48 RAW + officialDescription: no EVALUATIVE / SOCIAL_PROOF from 人気+魅力 paraphrase", () => {
    const review = reviewR48([MIZD_DESC]);
    const codes = review.failures.map((f) => f.code);
    expect(codes).not.toContain("EVALUATIVE_INFERENCE");
    expect(codes).not.toContain("SOCIAL_PROOF");
    expect(SOCIAL_PROOF_RELATION_RE.test("人気の松本いちか")).toBe(false);
    expect(review.decision).not.toBe("TARGETED_REPAIR");
  });

  it("D. genuine fabricated social proof still BLOCKING", () => {
    const claims = [
      { id: "c1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    const review = reviewArtifactShadow({
      corePlan: buildCoreEditorialPlan({
        channel: "BLOG",
        formatKey: "NEW_RELEASE_SINGLE",
        contentType: "blogger-article",
        availableClaims: claims,
        selectedClaims: claims,
        openingClaimIds: ["c1"],
        hookClaimIds: ["c1"],
        developmentClaimIds: [],
        structurePatternId: null,
        editorialPatternId: null,
      }),
      claimStatements: claims,
      artifact: {
        channel: "BLOG",
        title: "公開事実の整理",
        summary: "候補向けメモ。",
        lead: "出演者Alphaがクレジットされている。",
        sections: [
          {
            paragraphs: ["売上ランキング1位・累計100万人が購入した受賞作である。"],
            lists: [],
          },
        ],
        bodyText: "",
      },
    });
    expect(review.failures.map((f) => f.code)).toContain("SOCIAL_PROOF");
  });

  it("D2. genuine unsupported evaluation still BLOCKING without sourceTexts", () => {
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
  });

  it("r48 RESULT fixture presence (production path artifact)", () => {
    expect(existsSync(R48_RESULT) || existsSync(R48_RAW)).toBe(true);
  });
});
