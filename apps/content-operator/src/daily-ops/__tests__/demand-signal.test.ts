import { describe, expect, it } from "vitest";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";
import {
  explainArticleCandidateOrder,
  selectDailyProductCandidate,
  type DailyCandidateScore,
  type DailySelectionConfig,
} from "../../daily-blog/selection.js";
import { planDailyChannels } from "../channel-selection.js";
import { noteInternalDemandMatch } from "../../article-pattern/seo-search-intent.js";
import {
  FANZA_API_NEW,
  FANZA_API_POPULAR,
  FANZA_API_PERFORMER_POPULAR,
  FANZA_INTERNAL_SEARCH,
  FANZA_RECOMMENDED_PRODUCT,
  buildWorkEvidenceSurface,
  keywordMatchesEvidence,
  demandAdjustedScore,
  parseDemandIngest,
  priorityFieldsForWork,
  selectLatestDemandSnapshot,
} from "../demand-signal.js";

function work(
  partial: Partial<DailyCandidateScore> & Pick<DailyCandidateScore, "canonicalId">,
): DailyCandidateScore {
  return {
    researchItemId: partial.researchItemId ?? partial.canonicalId,
    canonicalId: partial.canonicalId,
    totalScore: partial.totalScore ?? 40,
    popularityScore: partial.popularityScore ?? 10,
    trendScore: partial.trendScore ?? 10,
    freshnessScore: partial.freshnessScore ?? 10,
    dataQualityScore: partial.dataQualityScore ?? 10,
    reviewScore: partial.reviewScore ?? 10,
    pageEvidenceRichness: partial.pageEvidenceRichness ?? 0.8,
    sampleImageCount: partial.sampleImageCount ?? 5,
    actressKey: partial.actressKey ?? null,
    makerKey: partial.makerKey ?? null,
    seriesKey: partial.seriesKey ?? null,
    affiliateUrl: partial.affiliateUrl ?? "https://al.fanza.co.jp/?af_id=1",
    title: partial.title ?? partial.canonicalId,
    releaseAgeBucket: partial.releaseAgeBucket ?? "MID",
    recommendedRank: partial.recommendedRank,
    popularRank: partial.popularRank,
    matchedDemandKeywords: partial.matchedDemandKeywords,
    bestInternalSearchRank: partial.bestInternalSearchRank,
    segmentSignals: partial.segmentSignals,
    bestSegmentRank: partial.bestSegmentRank,
    seoQueryStatus: partial.seoQueryStatus,
  };
}

const demandConfig: DailySelectionConfig = {
  articlesPerRun: 1,
  minTotalScore: 20,
  minSampleImages: 3,
  minEvidenceRichness: 0.25,
  recentActressKeys: [],
  recentMakerKeys: [],
  recentSeriesKeys: [],
  applyDemandPriority: true,
};

describe("FANZA demand candidate priority", () => {
  it("matches exact, normalized, and delimited evidence tokens only", () => {
    const surface = buildWorkEvidenceSurface({
      contentId: "55fays00016",
      performers: ["松本彩花"],
      genres: ["巨乳"],
      series: ["ギュっと！"],
      campaigns: ["春のまとめ"],
      titles: ["俺の教え子、セフレに変わる 松本彩花"],
      descriptions: ["公式では教え子との関係が変わる。"],
      features: ["スペクタクル巨乳"],
    });
    expect(keywordMatchesEvidence("松本彩花", surface)).toBe(true);
    expect(keywordMatchesEvidence("巨 乳", surface)).toBe(true);
    expect(keywordMatchesEvidence("ギュっと！", surface)).toBe(true);
    expect(keywordMatchesEvidence("春のまとめ", surface)).toBe(true);
    expect(keywordMatchesEvidence("スペクタクル巨乳", surface)).toBe(true);
    expect(keywordMatchesEvidence("教え子", surface)).toBe(false);
    expect(keywordMatchesEvidence("レズ", surface)).toBe(false);
    expect(keywordMatchesEvidence("需要専用語", surface)).toBe(false);
  });

  it("keeps observation history and uses the latest rank", () => {
    const parsed = parseDemandIngest([
      {
        source: FANZA_RECOMMENDED_PRODUCT,
        scope: "video",
        contentId: "rec-01",
        rank: 10,
        observedAt: "2026-09-01T00:00:00.000Z",
        provenance: "fixture-older",
      },
      {
        source: FANZA_RECOMMENDED_PRODUCT,
        scope: "video",
        contentId: "rec-01",
        rank: 2,
        observedAt: "2026-09-28T00:00:00.000Z",
        provenance: "fixture-newer",
      },
      {
        source: FANZA_INTERNAL_SEARCH,
        scope: "video",
        keyword: "松本彩花",
        rank: 4,
        semanticType: "PERFORMER",
        observedAt: "2026-09-28T00:00:00.000Z",
        provenance: "fixture-search",
      },
      {
        source: FANZA_INTERNAL_SEARCH,
        scope: "video",
        keyword: "需要専用語",
        rank: 1,
        observedAt: "2026-09-28T00:00:00.000Z",
        provenance: "fixture-unrelated",
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(4);
    const latest = selectLatestDemandSnapshot(parsed.rows);
    const surface = buildWorkEvidenceSurface({
      contentId: "rec-01",
      performers: ["松本彩花"],
      titles: ["松本彩花の作品"],
    });
    const fields = priorityFieldsForWork("REC-01", latest, surface);
    expect(fields.recommendedRank).toBe(2);
    expect(fields.matchedDemandKeywords).toEqual(["松本彩花"]);
    expect(fields.bestInternalSearchRank).toBe(4);
    expect(parseDemandIngest([{ source: FANZA_RECOMMENDED_PRODUCT, scope: "video", contentId: "x", rank: 11, observedAt: "2026-09-28T00:00:00.000Z", provenance: "bad" }]).ok).toBe(false);
    expect(parseDemandIngest([{ source: FANZA_INTERNAL_SEARCH, scope: "video", keyword: "巨乳", rank: 1, observedAt: "2026-09-28T00:00:00.000Z", provenance: "" }]).ok).toBe(false);
  });

  it("orders 30 or more candidates with recommended first and evidence gates intact", () => {
    const pool: DailyCandidateScore[] = [
      work({ canonicalId: "rec-01", recommendedRank: 1, totalScore: 21, seoQueryStatus: "NO_NATURAL_QUERY" }),
      work({ canonicalId: "rec-02", recommendedRank: 2, totalScore: 22, matchedDemandKeywords: ["松本彩花"], bestInternalSearchRank: 8 }),
      work({ canonicalId: "rec-03", recommendedRank: 3, totalScore: 40 }),
      work({ canonicalId: "rec-04", recommendedRank: 4, totalScore: 23, matchedDemandKeywords: ["ギュっと！"], bestInternalSearchRank: 1 }),
      work({ canonicalId: "rec-05", recommendedRank: 5, totalScore: 90, sampleImageCount: 0, pageEvidenceRichness: 0.1 }),
      work({ canonicalId: "rec-06", recommendedRank: 6, totalScore: 24 }),
      work({ canonicalId: "rec-07a", recommendedRank: 7, totalScore: 25, matchedDemandKeywords: ["集団痴女"], bestInternalSearchRank: 2 }),
      work({ canonicalId: "rec-07b", recommendedRank: 7, totalScore: 80, matchedDemandKeywords: ["アナル"], bestInternalSearchRank: 9 }),
      work({ canonicalId: "rec-08", recommendedRank: 8, totalScore: 26 }),
      work({ canonicalId: "rec-09", recommendedRank: 9, totalScore: 27 }),
      work({ canonicalId: "rec-10", recommendedRank: 10, totalScore: 28 }),
      work({ canonicalId: "srch-01", totalScore: 30, matchedDemandKeywords: ["スペクタクル巨乳"], bestInternalSearchRank: 1 }),
      work({ canonicalId: "srch-nq", totalScore: 31, matchedDemandKeywords: ["俺の教え子"], bestInternalSearchRank: 2, seoQueryStatus: "NO_NATURAL_QUERY" }),
      work({ canonicalId: "srch-03", totalScore: 98, matchedDemandKeywords: ["巨乳"], bestInternalSearchRank: 3 }),
      work({ canonicalId: "srch-20", totalScore: 97, matchedDemandKeywords: ["人妻"], bestInternalSearchRank: 20 }),
      work({ canonicalId: "unrel-01", totalScore: 96 }),
      work({ canonicalId: "normal-01", totalScore: 100 }),
      work({ canonicalId: "popular-top", totalScore: 40, popularRank: 1 }),
      ...Array.from({ length: 15 }, (_, index) =>
        work({
          canonicalId: `normal-${String(index + 2).padStart(2, "0")}`,
          totalScore: 70 - index,
        }),
      ),
    ];
    expect(pool.length).toBeGreaterThanOrEqual(30);

    const explained = explainArticleCandidateOrder(pool, demandConfig);
    const eligible = explained.rows.filter((row) => row.generationOrder != null);
    const byAdjusted = [...eligible].sort(
      (a, b) => demandAdjustedScore(b.candidate) - demandAdjustedScore(a.candidate),
    );
    expect(eligible.map((row) => row.candidate.canonicalId)).toEqual(
      byAdjusted.map((row) => row.candidate.canonicalId),
    );
    const popularIndex = eligible.findIndex((row) => row.candidate.canonicalId === "popular-top");
    const normalIndex = eligible.findIndex((row) => row.candidate.canonicalId === "normal-01");
    expect(popularIndex).toBeGreaterThanOrEqual(0);
    expect(normalIndex).toBeGreaterThan(popularIndex);
    expect(eligible.length).toBeGreaterThan(3);
    const thin = explained.rows.find((row) => row.candidate.canonicalId === "rec-05");
    expect(thin?.evidenceEligible).toBe(false);
    expect(thin?.generationOrder).toBeNull();
    expect(explained.rows.find((row) => row.candidate.canonicalId === "rec-01")?.candidate.seoQueryStatus).toBe(
      "NO_NATURAL_QUERY",
    );
    expect(explained.rows.find((row) => row.candidate.canonicalId === "srch-nq")?.generationOrder).not.toBeNull();
    expect(explained.rows.map((row) => row.priorityReason).join("\n")).not.toMatch(/検索数|検索ボリューム/);
    expect(explained.rows.find((row) => row.candidate.canonicalId === "unrel-01")?.priorityReason).toBe("NORMAL");

    const withoutDemand = selectDailyProductCandidate(pool, { ...demandConfig, applyDemandPriority: false });
    expect(withoutDemand.selected?.canonicalId).toBe("normal-01");
    const withDemand = selectDailyProductCandidate(pool, demandConfig);
    const best = [...pool]
      .filter((candidate) => candidate.sampleImageCount >= 3 && candidate.pageEvidenceRichness >= 0.25 && candidate.totalScore >= 20)
      .sort((a, b) => demandAdjustedScore(b) - demandAdjustedScore(a))[0];
    expect(withDemand.selected?.canonicalId).toBe(best?.canonicalId);
  });

  it("uses demand for blog order only and keeps already articled products out", () => {
    const pool = [
      work({ canonicalId: "rec-a", recommendedRank: 1, totalScore: 25 }),
      work({ canonicalId: "rec-b", recommendedRank: 2, totalScore: 25 }),
      work({ canonicalId: "score-high", totalScore: 99, popularityScore: 99 }),
    ];
    const shared = {
      pool,
      mixWeights: {
        singleProduct: 0.25,
        popularRanking: 0.15,
        performerRanking: 0.15,
        newRelease: 0.25,
        olderTitle: 0.2,
      },
      releaseAge: { recentMaxDays: 60, olderMinDays: 365 },
      channelDuplicate: { sameProductCooldownDays: 14, sameBodyCooldownDays: 7 },
      dayKey: "2026-09-29",
      minTotalScore: 20,
      minSampleImages: 3,
      minEvidenceRichness: 0.25,
      now: new Date("2026-09-29T03:00:00Z"),
    };
    const open = planDailyChannels({ ...shared, channelHistory: [] });
    expect(open.blog.selection.selected?.canonicalId).toBe("rec-a");
    expect(open.x.selection.selected?.canonicalId).toBe("score-high");

    const published = planDailyChannels({
      ...shared,
      channelHistory: [{ channel: "BLOG", canonicalId: "rec-a", publishedAt: "2026-09-01T00:00:00Z" }],
    });
    expect(published.blog.selection.selected?.canonicalId).toBe("rec-b");
  });

  it("does not put an unmatched demand keyword into the writer prompt", () => {
    const intent = noteInternalDemandMatch(
      {
        status: "VALID",
        primaryQuery: "松本彩花 俺の教え子",
        secondaryQueries: [],
        searchIntent: "出演者名と公式の前提で、この作品を特定して内容を確認したい",
        queryRationale: "公式の前提に基づく。",
      },
      ["俺の教え子"],
    );
    const writer = buildOptionBBloggerGeneratorPrompt({
      productTitle: "俺の教え子、セフレに変わる 松本彩花",
      ctaUrl: "https://example.invalid/55fays00016",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: {
        ARTICLE_PLAN: {
          productTitle: "俺の教え子、セフレに変わる 松本彩花",
          title: { facts: ["松本彩花"] },
          body: [{ facts: ["俺の教え子、セフレに変わる"] }],
          seoSearchIntent: intent,
        },
      },
    });
    expect(writer.userPrompt).toContain("FANZA internal demand matchあり");
    expect(writer.userPrompt).not.toContain("需要専用語");
    expect(writer.userPrompt).toContain("not a fact source");
  });

  it("ranks API popular above internal search and keeps every matched signal in the reason", () => {
    const observedAt = "2026-09-30T00:00:00.000Z";
    const parsed = parseDemandIngest([
      {
        source: FANZA_API_POPULAR,
        scope: "video",
        contentId: "pop-1",
        rank: 4,
        observedAt,
        provenance: "DMM ItemList sort=rank",
      },
      {
        source: FANZA_API_NEW,
        scope: "video",
        contentId: "new-only",
        rank: 1,
        observedAt,
        provenance: "DMM ItemList sort=date",
      },
      {
        source: FANZA_API_PERFORMER_POPULAR,
        scope: "video",
        contentId: "seg-1",
        keyword: "松本彩花",
        semanticType: "PERFORMER",
        rank: 2,
        observedAt,
        provenance: "DMM ItemList article=actress",
      },
      {
        source: FANZA_INTERNAL_SEARCH,
        scope: "video",
        keyword: "松本彩花",
        semanticType: "PERFORMER",
        rank: 6,
        observedAt,
        provenance: "dashboard",
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const surface = buildWorkEvidenceSurface({
      contentId: "pop-1",
      performers: ["松本彩花"],
      titles: ["松本彩花の作品"],
    });
    const fields = priorityFieldsForWork("pop-1", parsed.rows, surface);
    expect(fields.popularRank).toBe(4);
    expect(fields.bestInternalSearchRank).toBe(6);
    expect(fields.recommendedRank).toBeNull();
    const newOnly = priorityFieldsForWork(
      "new-only",
      parsed.rows,
      buildWorkEvidenceSurface({ contentId: "new-only", titles: ["新しい作品"] }),
    );
    expect(newOnly.popularRank).toBeNull();
    expect(newOnly.bestSegmentRank).toBeNull();

    const pool = [
      work({ canonicalId: "pop-1", totalScore: 30, popularRank: 4, matchedDemandKeywords: ["松本彩花"], bestInternalSearchRank: 6 }),
      work({ canonicalId: "search-only", totalScore: 99, matchedDemandKeywords: ["松本彩花"], bestInternalSearchRank: 1 }),
      work({ canonicalId: "seg-1", totalScore: 90, segmentSignals: [{ kind: "performer", name: "松本彩花", rank: 2 }], bestSegmentRank: 2 }),
      work({ canonicalId: "new-only", totalScore: 100 }),
    ];
    const order = explainArticleCandidateOrder(pool, demandConfig);
    const pop = order.rows.find((row) => row.candidate.canonicalId === "pop-1");
    const fresh = order.rows.find((row) => row.candidate.canonicalId === "new-only");
    expect(pop?.priorityReason).toContain("FANZA_API_POPULAR rank=4");
    expect(pop?.priorityReason).toContain("FANZA_INTERNAL_SEARCH_MATCH rank=6");
    expect(fresh?.priorityReason).toBe("NORMAL");
    expect(demandAdjustedScore(pop!.candidate)).toBeGreaterThan(demandAdjustedScore(fresh!.candidate));
  });

  it("drops a popular rank that is absent from the newest snapshot", () => {
    const parsed = parseDemandIngest([
      {
        source: FANZA_API_POPULAR,
        scope: "video",
        contentId: "old-pop",
        rank: 1,
        observedAt: "2026-09-29T00:00:00.000Z",
        provenance: "older",
      },
      {
        source: FANZA_API_POPULAR,
        scope: "video",
        contentId: "new-pop",
        rank: 1,
        observedAt: "2026-09-30T00:00:00.000Z",
        provenance: "newer",
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const latest = selectLatestDemandSnapshot(parsed.rows);
    expect(latest.map((row) => row.contentId)).toEqual(["new-pop"]);
  });

  it("rejects a duplicate rank inside one API snapshot", () => {
    const parsed = parseDemandIngest([
      {
        source: FANZA_API_POPULAR,
        scope: "video",
        contentId: "a",
        rank: 1,
        observedAt: "2026-09-30T00:00:00.000Z",
        provenance: "dup",
      },
      {
        source: FANZA_API_POPULAR,
        scope: "video",
        contentId: "b",
        rank: 1,
        observedAt: "2026-09-30T00:00:00.000Z",
        provenance: "dup",
      },
    ]);
    expect(parsed.ok).toBe(false);
  });
});
