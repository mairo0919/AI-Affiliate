import { describe, expect, it } from "vitest";
import { buildEditorialDecisionPlannerPrompt } from "../article-editorial-decision.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import { buildDeterministicPublicationMetadata } from "../../wordpress/publication-metadata.js";
import {
  buildSeoReviewPrompt,
  decideSeoSearchIntent,
  evaluateSeoIntentReview,
  groundSeoCopy,
  preserveSeoSearchIntentFields,
} from "../seo-search-intent.js";

describe("SEO search intent on the production article path", () => {
  it("does not target an ambiguous short title, a performer, a maker, or a genre alone", () => {
    const intent = decideSeoSearchIntent({
      productTitle: "禁断の夜",
      contentId: "mizd00400",
      performers: ["逢沢みゆ"],
      maker: "ムーディーズ",
      genres: ["ドラマ"],
      attestedFacts: ["禁断の夜", "逢沢みゆ"],
    });
    expect(intent.status).toBe("VALID");
    expect(intent.primaryQuery).toBe("禁断の夜 逢沢みゆ");
    expect(intent.searchIntent).toBe("作品名と出演者名で、この作品を特定して内容を確認したい");
    expect(intent.secondaryQueries).toEqual(["mizd00400"]);
    expect(intent.secondaryQueries).not.toContain("逢沢みゆ");
    expect(intent.secondaryQueries).not.toContain("ムーディーズ");
    expect(intent.secondaryQueries).not.toContain("ドラマ");
    expect(intent.primaryQuery.split(" ")).toHaveLength(2);
    expect(intent.queryRationale).toContain("単独では曖昧");
    expect(intent.queryRationale).toContain("品番mizd00400は作品を直接特定できる");
    expect(intent.queryRationale).toContain("出演者名だけでは");
    expect(intent.queryRationale).toContain("メーカー名だけでは");
    expect(intent.queryRationale).toContain("一般ジャンル名だけでは");
    expect(intent.queryRationale).not.toContain("高検索");
  });

  it("does not target a broad series alone, and compounds it with the performer", () => {
    const intent = decideSeoSearchIntent({
      productTitle:
        "松本いちかの人気作を8時間に収めたとても長い公式タイトルで、検索窓には入らない説明が続きます。",
      contentId: "ofje00311",
      performers: ["松本いちか"],
      series: "やっぱり女",
      genres: ["ベスト・総集編", "巨乳"],
    });
    expect(intent.primaryQuery).toBe("やっぱり女 松本いちか");
    expect(intent.searchIntent).toBe("シリーズ名と出演者名で、この作品を特定して内容を確認したい");
    expect(intent.secondaryQueries).toEqual(["ofje00311"]);
    expect(intent.secondaryQueries).not.toContain("松本いちか");
    expect(intent.secondaryQueries).not.toContain("やっぱり女");
    expect(intent.secondaryQueries.join(" ")).not.toContain("巨乳");
    expect(intent.queryRationale).toContain("広すぎるため");
    expect(intent.primaryQuery).not.toMatch(/巨乳|ムーディーズ|ベスト|8時間/);
  });

  it("keeps a work-specific official title and does not add broad names", () => {
    const intent = decideSeoSearchIntent({
      productTitle: "絶対空域プレミアム",
      contentId: "ssis00999",
      performers: ["奥田咲"],
      maker: "エスワン",
      series: "絶対空域",
      genres: ["巨乳"],
    });
    expect(intent.primaryQuery).toBe("絶対空域プレミアム");
    expect(intent.searchIntent).toBe("作品固有の正式作品名から、この作品の内容を確認したい");
    expect(intent.secondaryQueries).toEqual(["ssis00999", "絶対空域"]);
    expect(intent.secondaryQueries).not.toContain("奥田咲");
    expect(intent.secondaryQueries).not.toContain("エスワン");
    expect(intent.secondaryQueries).not.toContain("巨乳");
    expect(intent.queryRationale).toContain("作品固有性を持つ");
  });

  it("does not use a content id when there is no natural query", () => {
    const intent = decideSeoSearchIntent({
      productTitle:
        "とても長いパッケージコピーで、検索窓にそのまま入れるには長すぎる公式作品名の説明が続きます。",
      contentId: "ssis00123",
      performers: ["北野未奈", "二番手"],
      genres: ["企画"],
    });
    expect(intent.status).toBe("NO_NATURAL_QUERY");
    expect(intent.primaryQuery).toBe("");
    expect(intent.secondaryQueries).toEqual([]);
    expect(intent.queryRationale).toContain("品番をprimaryQueryにしていない");
    expect(intent.queryRationale).toContain("出演者名だけでは");
    expect(intent.queryRationale).toContain("一般ジャンル名だけでは");
    expect(intent.primaryQuery).not.toMatch(/240分|ssis00123|企画/);
  });

  it("passes the same intent to the planner prompt, writer prompt, and SEO review", () => {
    const intent = decideSeoSearchIntent({
      productTitle: "禁断の夜",
      contentId: "mizd00400",
      performers: ["逢沢みゆ"],
    });
    const planner = buildEditorialDecisionPlannerPrompt({
      productTitle: "禁断の夜",
      evidenceSurfaces: ["禁断の夜"],
      planBodyFacts: ["逢沢みゆ"],
      performers: ["逢沢みゆ"],
      seoSearchIntent: intent,
    });
    expect(planner.user).toContain(intent.primaryQuery);
    expect(planner.user).toContain(intent.searchIntent);
    expect(planner.system).toContain("primaryQueryを詰め込まない");
    expect(planner.system).toContain("評価語・宣伝語・ジャンル解釈をangleへ足さない");
    expect(planner.system).toContain("Search Intentはfact sourceではない");

    const writer = buildOptionBBloggerGeneratorPrompt({
      productTitle: "禁断の夜",
      ctaUrl: "https://example.invalid/mizd00400",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: {
        ARTICLE_PLAN: {
          productTitle: "禁断の夜",
          title: { facts: ["禁断の夜"] },
          body: [{ facts: ["逢沢みゆ"] }],
          seoSearchIntent: intent,
        },
      },
    });
    expect(writer.userPrompt).toContain("SEO_SEARCH_INTENT");
    expect(writer.userPrompt).toContain(intent.primaryQuery);
    expect(writer.userPrompt).toContain(intent.searchIntent);
    expect(writer.userPrompt).toContain("not a fact source");
    expect(writer.userPrompt).toContain("not title authority");

    const review = buildSeoReviewPrompt({
      intent,
      title: "逢沢みゆの禁断の夜",
      body: "逢沢みゆの作品について、公式情報の範囲で内容を整理する。",
      seoTitle: "逢沢みゆの禁断の夜｜オトナセレクト",
      metaDescription: "逢沢みゆの禁断の夜について、確認できる内容を短く整理した記事です。",
    });
    expect(review.user).toContain(intent.primaryQuery);
    expect(review.user).toContain(intent.searchIntent);
    expect(review.user).toContain("seoTitle");
    expect(review.user).toContain("metaDescription");
  });

  it("does not replace a locked intent when publication metadata rewrites the SEO title", () => {
    const previous = {
      title: "writer seo",
      metaDescription: "writer description",
      status: "VALID",
      primaryQuery: "禁断の夜",
      secondaryQueries: ["mizd00400"],
      searchIntent: "作品名から、この作品の内容を確認したい",
      queryRationale: "locked",
    };
    const next = preserveSeoSearchIntentFields(previous, {
      ...previous,
      title: "publication seo title",
      metaDescription: "publication description",
      primaryQuery: "別のクエリ",
      searchIntent: "別の意図",
      status: "NO_NATURAL_QUERY",
    });
    expect(next.primaryQuery).toBe("禁断の夜");
    expect(next.searchIntent).toBe("作品名から、この作品の内容を確認したい");
    expect(next.status).toBe("VALID");
    expect(next.title).toBe("publication seo title");
    expect(next.metaDescription).toBe("publication description");
  });

  it("does not treat a runtime attribute as a work-identifying query", () => {
    const intent = decideSeoSearchIntent({
      productTitle: "ギュっと！上戸まり2タイトル4時間",
      contentId: "ksbj00447",
      performers: ["上戸まり"],
      maker: "KSB企画",
      series: "ギュっと！",
      genres: ["スレンダー", "単体作品"],
      attestedFacts: [
        "2作品",
        "240分",
        "1980円",
        "2024年1月1日",
        "https://example.invalid/package.jpg",
        "ギュっと！",
        "再会した同級生の彼とのセックスが忘れられないまりは",
        "上戸まり",
      ],
    });
    expect(intent.status).toBe("VALID");
    expect(intent.primaryQuery).not.toBe("240分");
    expect(intent.primaryQuery).not.toMatch(/円|作品$|https?:|jpg|年|4時間|2タイトル|ksbj00447/);
    expect(intent.secondaryQueries).not.toContain("240分");
    expect(intent.primaryQuery).toBe("ギュっと！ 上戸まり");
    expect(intent.secondaryQueries).toEqual(["ksbj00447"]);
    expect(intent.searchIntent).toBe("シリーズ名と出演者名で、この作品を特定して内容を確認したい");
    expect(intent.queryRationale).toContain("属性値は作品を特定しない");
    expect(intent.queryRationale).toContain("広すぎるため");
  });

  it("keeps 55fays on an official premise plus the performer", () => {
    const intent = decideSeoSearchIntent({
      productTitle: "俺の教え子、セフレに変わる 松本彩花",
      contentId: "55fays00016",
      performers: ["松本彩花"],
      attestedFacts: ["俺の教え子、セフレに変わる", "松本彩花"],
    });
    expect(intent.status).toBe("VALID");
    expect(intent.primaryQuery).toBe("松本彩花 俺の教え子");
    expect(intent.primaryQuery).not.toMatch(/禁断|デビュー|人間ドラマ|リアル/);
    expect(intent.primaryQuery).not.toBe("俺の教え子、セフレに変わる 松本彩花");
    expect(intent.searchIntent).toContain("公式の前提");
    const writer = buildOptionBBloggerGeneratorPrompt({
      productTitle: "俺の教え子、セフレに変わる 松本彩花",
      ctaUrl: "https://example.invalid/55fays00016",
      articleFormat: "NEW_RELEASE_SINGLE",
      planViolationNote: "correction",
      generationAuthority: {
        ARTICLE_PLAN: {
          productTitle: "俺の教え子、セフレに変わる 松本彩花",
          title: { facts: ["松本彩花"] },
          body: [{ facts: ["セフレ"] }],
          seoSearchIntent: intent,
        },
        ARTICLE_PLAN_EXECUTION: [{ executionMode: "REALIZE", mustPreserve: ["松本彩花"] }],
      },
    });
    expect(writer.userPrompt).toContain("Do not change the locked primaryQuery");
    expect(writer.userPrompt).toContain("title authority");
    expect(writer.systemInstruction).toContain("one Japanese headline from performer");
    expect(writer.systemInstruction).not.toContain("write the headline from editorialDecision");
  });

  it("does not use an edition label or a long official sentence as the query", () => {
    const edition = decideSeoSearchIntent({
      productTitle: "【AIリマスター版】緊縛鬼イカセ 加瀬あゆむ",
      contentId: "172reca00044ai",
      performers: ["加瀬あゆむ"],
      attestedFacts: ["AIリマスター版", "緊縛鬼イカセ"],
    });
    expect(edition.primaryQuery).not.toMatch(/リマスター|172reca/);
    expect(edition.primaryQuery).toBe("加瀬あゆむ 緊縛鬼イカセ");

    const long = decideSeoSearchIntent({
      productTitle: "身体の隅々まで舐めるのが大好きな都合のいいタダマンギャル",
      performers: ["小野坂ゆいか"],
      attestedFacts: ["身体の隅々まで舐めるのが大好きな都合のいいタダマンギャル"],
    });
    expect(long.primaryQuery).not.toBe("身体の隅々まで舐めるのが大好きな都合のいいタダマンギャル");
    expect(long.primaryQuery).toBe("小野坂ゆいか タダマンギャル");

    const fragment = decideSeoSearchIntent({
      productTitle: "【AIリマスター版】イカセ鬼フィスト しかもニ穴同時性交スペシャル 秋月彩乃",
      performers: ["秋月彩乃"],
      attestedFacts: ["しかもニ穴同時性交スペシャル"],
    });
    expect(fragment.primaryQuery).not.toMatch(/^しかも|リマスター/);
  });

  it("does not promote format-only labels or a bare runtime to primary", () => {
    for (const productTitle of ["配信限定", "BEST", "VR", "8K", "240分", "4時間"]) {
      const intent = decideSeoSearchIntent({
        productTitle,
        contentId: "abcd00001",
        performers: ["松本彩花"],
      });
      expect(intent.primaryQuery).not.toBe(productTitle);
      expect(intent.primaryQuery).not.toMatch(/^(?:配信限定|BEST|VR|8K|240分|4時間|abcd00001)$/iu);
    }
  });

  it("fails keyword lists and unsupported SEO claims without requiring the query to be repeated", () => {
    const intent = decideSeoSearchIntent({
      productTitle: "禁断の夜",
      contentId: "mizd00400",
      performers: ["逢沢みゆ"],
    });
    const natural = evaluateSeoIntentReview({
      intent,
      title: "逢沢みゆの禁断の夜",
      body: "公式情報の範囲で、作品の設定を整理する。",
      seoTitle: "逢沢みゆの禁断の夜｜オトナセレクト",
      metaDescription: "確認できる設定を短くまとめた記事です。",
      allowedText: "禁断の夜 逢沢みゆ",
    });
    expect(natural.hardFail).toBe(false);

    const stuffed = evaluateSeoIntentReview({
      intent,
      title: "逢沢みゆ 巨乳 ドラマ",
      body: `${intent.primaryQuery} ${intent.primaryQuery} ${intent.primaryQuery} ${intent.primaryQuery}`,
      seoTitle: "大人気で高検索の禁断の夜",
      metaDescription: "検索ボリュームの高い作品です。",
    });
    expect(stuffed.hardFail).toBe(true);
    expect(stuffed.findings).toEqual(
      expect.arrayContaining(["SEO_UNSUPPORTED_CLAIM", "SEO_KEYWORD_LIST", "SEO_KEYWORD_STUFFING"]),
    );
  });

  it("replaces an invented meta description with a factual sentence", () => {
    const grounded = groundSeoCopy({
      seoTitle: "禁断の関係を描く——松本彩花デビュー作",
      metaDescription: "リアルな人間ドラマが楽しめるおすすめの一本です。",
      articleTitle: "松本彩花の俺の教え子",
      body: "松本彩花が出演し、教え子との関係がセフレへ変わる作品です。公式の題名にその前提がある。",
      allowedText: "俺の教え子、セフレに変わる 松本彩花",
    });
    expect(grounded.seoTitle).not.toMatch(/禁断|デビュー/);
    expect(grounded.metaDescription).not.toMatch(/おすすめ|楽しめる|リアルな|人間ドラマ/);
    expect(grounded.seoTitle).toContain("松本彩花の俺の教え子");
  });

  it("builds publication metadata from the locked intent without a runtime query", () => {
    const intent = decideSeoSearchIntent({
      productTitle: "ギュっと！上戸まり2タイトル4時間",
      contentId: "ksbj00447",
      performers: ["上戸まり"],
      series: "ギュっと！",
      attestedFacts: ["240分"],
    });
    const meta = buildDeterministicPublicationMetadata({
      productCanonicalId: "ksbj00447",
      officialTitle: "ギュっと！上戸まり2タイトル4時間",
      writerTitle: "上戸まりのギュっと！",
      performers: ["上戸まり"],
      seriesNames: ["ギュっと！"],
      bodySnippets: ["上戸まりが出演するギュっと！の作品について、公開情報の範囲で内容を整理する。"],
      lockedSeoSearchIntent: intent,
    });
    expect(meta.seoTitle).not.toMatch(/240分|4時間|ksbj00447/i);
    expect(meta.metaDescription).not.toMatch(/見どころ|おすすめ|240分|お届けします/);
    expect(meta.title).toBe("上戸まりのギュっと！");
  });
});
