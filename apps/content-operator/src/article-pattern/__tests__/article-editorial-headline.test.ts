/**
 * Editorial headline route — not fact assembly.
 */
import { describe, expect, it } from "vitest";
import {
  classifyArticleHeadlineDefects,
  decideTitleRewriteAction,
  isLowValueArticleHeadline,
  parseEditorialDecisionJson,
  buildDeterministicEditorialDecisionFallback,
} from "../article-editorial-decision.js";
import { deriveExecutionMode } from "../plan-execution-contract.js";
import { ARTICLE_PLAN_JOBS } from "../article-plan.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";

describe("article editorial headline (not fact assembly)", () => {
  it("flags known mechanical performer+genre / unnatural glue titles", () => {
    const samples = [
      "響蓮に沼るのハイクオリティVR",
      "佐々木あきのキス・接吻",
      "小野坂ゆいかのローション・オイル",
      "黒島玲衣とハイクオリティVR",
      "北岡果林のハイクオリティVR作品",
      "椎名心春とハメ撮り",
      "ベストと総集編",
      "彩月七緒とお姉さん",
      "九井スナオとROCKET18周年記念ユーザーリクエスト祭り",
      "彩月七緒と七緒と初めて出会う",
      "ROCKET18周年記念ユーザーリクエスト祭りのリメイク作品",
    ];
    for (const title of samples) {
      expect(isLowValueArticleHeadline({ title }), title).toBe(true);
      const d = classifyArticleHeadlineDefects({ title });
      expect(d.length, title).toBeGreaterThan(0);
    }
  });

  it("does not over-reject strong editorial headlines", () => {
    const good = [
      "神業ハンドテクで絶対連続射精させてくれる追い手コキメンズエステ 八木奈々",
      "井上ももの性感リフレに堕ちた潮吹き絶頂フルコース",
      "百田光稀とM性感で会った女王様はまさかの地味メガネ爆乳社員",
      "漫画NTR実写化作品8時間の魅力を読み解く",
    ];
    for (const title of good) {
      const action = decideTitleRewriteAction({ title });
      expect(action.action).toBe("KEEP");
    }
  });

  it("does not over-reject strong editorial headlines even when close to product title", () => {
    const title =
      "神業ハンドテクで絶対連続射精させてくれる追い手コキメンズエステ 八木奈々";
    const action = decideTitleRewriteAction({
      title,
      productTitle: title,
    });
    expect(action.action).toBe("KEEP");
  });

  it("detects package-copy rephrase against product title", () => {
    const product =
      "ROCKET18周年記念ユーザーリクエスト祭り レズビアン・ラフファイト極";
    const defects = classifyArticleHeadlineDefects({
      title: "ROCKET18周年記念ユーザーリクエスト祭りのレズビアン・ラフファイト極",
      productTitle: product,
    });
    expect(defects).toContain("PACKAGE_COPY_REPHRASE");
  });

  it("detects fact assembly when title is particle-joined title.facts", () => {
    const defects = classifyArticleHeadlineDefects({
      title: "九井スナオとROCKET18周年記念ユーザーリクエスト祭り",
      titleFacts: ["九井スナオ", "ROCKET18周年記念ユーザーリクエスト祭り"],
    });
    expect(defects).toContain("FACT_ASSEMBLY");
  });

  it("title execution is SEMANTIC for descriptive facts (not blanket EXACT)", () => {
    expect(deriveExecutionMode("ハイクオリティVR", "title")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("キス・接吻", "title")).toBe("SEMANTIC_PRESERVE");
  });

  it("title job is editorial_headline", () => {
    expect(ARTICLE_PLAN_JOBS.titleEditorial).toBe("editorial_headline");
  });

  it("Writer system forbids assembling title.facts", () => {
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/editorialDecision/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/do NOT assemble|grounding hints only/i);
    expect(OPTION_B_WRITER_SYSTEM).not.toMatch(/only title\.facts as noun/);
  });

  it("Writer prompt uses editorialDecision for title, not fact compose", () => {
    const built = buildOptionBBloggerGeneratorPrompt({
      productTitle: "テスト作品",
      ctaUrl: "https://example.com",
      articleFormat: "blog",
      generationAuthority: {
        ARTICLE_PLAN: {
          schemaVersion: 1,
          materialDepth: "standard",
          productTitle: "テスト作品",
          editorialDecision: {
            angle: "想定外のシチュエーション展開を先に示す",
            readerHook: "一覧で差別化が伝わる切り口",
            whyThisWork: "公式に確認できる企画の面白さ",
            supportingEvidenceRefs: ["シチュエーションA"],
          },
          title: { job: "editorial_headline", facts: ["出演者A", "ジャンルB"] },
          body: [{ job: "body_facts", facts: ["シチュエーションA"], heading: null }],
        },
        ARTICLE_PLAN_EXECUTION: [
          {
            contributionId: "title::0",
            slot: "title",
            fact: "出演者A",
            executionMode: "SEMANTIC_PRESERVE",
            mustPreserve: [],
            allowed: [],
            notAllowed: [],
          },
        ],
      },
    });
    expect(built.userPrompt).toMatch(/editorialDecision/);
    expect(built.userPrompt).toMatch(/do not assemble/i);
    expect(built.userPrompt).not.toMatch(/compose one natural Japanese title from title\.facts only/);
  });

  it("parses free-form editorial decision JSON", () => {
    const d = parseEditorialDecisionJson(
      `{"angle":"再会からの温度差を軸に紹介する","readerHook":"関係性の変化が気になる","whyThisWork":"公式あらすじの再会設定","supportingEvidenceRefs":["再会"]}`,
    );
    expect(d?.angle).toContain("再会");
    expect(d?.supportingEvidenceRefs).toContain("再会");
  });

  it("fallback editorial decision is free-text cut, not a title phrase", () => {
    const d = buildDeterministicEditorialDecisionFallback({
      productTitle: "公式ロングタイトル",
      evidenceSurfaces: ["ハメ撮り", "椎名心春"],
      performers: ["椎名心春"],
    });
    expect(d.angle.length).toBeGreaterThan(10);
    expect(d.angle).not.toBe("椎名心春とハメ撮り");
    expect(isLowValueArticleHeadline({ title: d.angle })).toBe(false);
  });
});
