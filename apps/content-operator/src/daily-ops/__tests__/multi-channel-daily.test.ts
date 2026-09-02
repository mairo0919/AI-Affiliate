/**
 * Multi-channel daily ops — LLM=0 (no Writer/Brain/publish).
 */
import { describe, expect, it } from "vitest";
import { isBlockedOnChannel } from "../channel-duplicate.js";
import { planDailyChannels } from "../channel-selection.js";
import { chooseContentMixSlot, normalizeMixSlot } from "../content-mix.js";
import { loadDailyMultiChannelConfig, minimumDailyPublications } from "../config.js";
import { runMultiChannelDailyDry } from "../orchestrator.js";
import { classifyReleaseAge, ageDaysFromPublishedAt } from "../release-age.js";
import { chooseXPostRoute } from "../x-route.js";
import type { ChannelCandidate } from "../channel-selection.js";

function cand(partial: Partial<ChannelCandidate> & Pick<ChannelCandidate, "canonicalId" | "title">): ChannelCandidate {
  return {
    researchItemId: partial.researchItemId ?? partial.canonicalId,
    canonicalId: partial.canonicalId,
    totalScore: partial.totalScore ?? 50,
    popularityScore: partial.popularityScore ?? 40,
    trendScore: partial.trendScore ?? 20,
    freshnessScore: partial.freshnessScore ?? 10,
    dataQualityScore: partial.dataQualityScore ?? 40,
    reviewScore: partial.reviewScore ?? 30,
    pageEvidenceRichness: partial.pageEvidenceRichness ?? 0.7,
    sampleImageCount: partial.sampleImageCount ?? 5,
    actressKey: partial.actressKey ?? null,
    makerKey: partial.makerKey ?? null,
    seriesKey: partial.seriesKey ?? null,
    affiliateUrl: partial.affiliateUrl ?? "https://al.fanza.co.jp/?af_id=1",
    title: partial.title,
    publishedAt: partial.publishedAt ?? null,
    releaseAgeBucket: partial.releaseAgeBucket,
    publishedBlogUrl: partial.publishedBlogUrl ?? null,
  };
}

const defaultWeights = {
  singleProduct: 0.25,
  popularRanking: 0.15,
  performerRanking: 0.15,
  newRelease: 0.25,
  olderTitle: 0.2,
};

describe("multi-channel daily (LLM=0)", () => {
  it("classifies release age without retro decade labels", () => {
    const now = new Date("2026-08-21T00:00:00Z");
    expect(classifyReleaseAge(ageDaysFromPublishedAt("2026-08-01", now), { recentMaxDays: 60, olderMinDays: 365 })).toBe("RECENT");
    expect(classifyReleaseAge(ageDaysFromPublishedAt("2025-12-01", now), { recentMaxDays: 60, olderMinDays: 365 })).toBe("MID");
    expect(classifyReleaseAge(ageDaysFromPublishedAt("2020-01-01", now), { recentMaxDays: 60, olderMinDays: 365 })).toBe("OLDER");
  });

  it("mix prefers under-represented older when recent history is new-heavy", () => {
    const slot = chooseContentMixSlot({
      weights: defaultWeights,
      recentSlots: ["NEW_RELEASE", "NEW_RELEASE", "NEW_RELEASE", "SINGLE_PRODUCT"],
      dayKey: "2026-08-21",
      channelSalt: "BLOG",
      randomUnit: 0,
    });
    expect(slot.slot).toBe("OLDER_TITLE");
  });

  it("normalizes legacy mix slots", () => {
    expect(normalizeMixSlot("RECENT_PRODUCT")).toBe("NEW_RELEASE");
    expect(normalizeMixSlot("OLDER_PRODUCT")).toBe("OLDER_TITLE");
    expect(normalizeMixSlot("RANKING")).toBe("POPULAR_RANKING");
  });

  it("Blog published does not block X same product", () => {
    const blockedBlog = isBlockedOnChannel({
      channel: "BLOG",
      canonicalId: "a1",
      history: [
        { channel: "BLOG", canonicalId: "a1", publishedAt: "2026-08-20T00:00:00Z" },
      ],
      config: { sameProductCooldownDays: 14, sameBodyCooldownDays: 7 },
      now: new Date("2026-08-21T00:00:00Z"),
    });
    expect(blockedBlog.blocked).toBe(true);
    const blockedX = isBlockedOnChannel({
      channel: "X",
      canonicalId: "a1",
      history: [
        { channel: "BLOG", canonicalId: "a1", publishedAt: "2026-08-20T00:00:00Z" },
      ],
      config: { sameProductCooldownDays: 14, sameBodyCooldownDays: 7 },
      now: new Date("2026-08-21T00:00:00Z"),
    });
    expect(blockedX.blocked).toBe(false);
  });

  it("X route does not force BLOG_TRAFFIC merely because blog exists", () => {
    const d = chooseXPostRoute({
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      publishedBlogUrl: "https://blog.example/p/1",
      recentRoutes: ["BLOG_TRAFFIC", "BLOG_TRAFFIC", "BLOG_TRAFFIC"],
    });
    expect(d.route).toBe("DIRECT_AFFILIATE");
  });

  it("X route can choose BLOG_TRAFFIC for ranking hint when URL exists", () => {
    const d = chooseXPostRoute({
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      publishedBlogUrl: "https://blog.example/ranking",
      preferBlogTrafficHint: true,
    });
    expect(d.route).toBe("BLOG_TRAFFIC");
    expect(d.destinationUrl).toContain("ranking");
  });

  it("selects Blog and X independently from mixed-age pool", () => {
    const pool = [
      cand({
        canonicalId: "new1",
        title: "new",
        releaseAgeBucket: "RECENT",
        freshnessScore: 90,
        totalScore: 90,
        popularityScore: 20,
        pageEvidenceRichness: 0.5,
      }),
      cand({
        canonicalId: "old1",
        title: "old",
        releaseAgeBucket: "OLDER",
        freshnessScore: 5,
        totalScore: 40,
        popularityScore: 70,
        pageEvidenceRichness: 0.9,
        sampleImageCount: 8,
        actressKey: "A",
      }),
      cand({
        canonicalId: "mid1",
        title: "mid",
        releaseAgeBucket: "MID",
        freshnessScore: 30,
        totalScore: 55,
        popularityScore: 50,
        pageEvidenceRichness: 0.8,
        actressKey: "B",
      }),
    ];
    const plan = planDailyChannels({
      pool,
      mixWeights: {
        singleProduct: 0.1,
        popularRanking: 0.05,
        performerRanking: 0.05,
        newRelease: 0.1,
        olderTitle: 0.7,
      },
      releaseAge: { recentMaxDays: 60, olderMinDays: 365 },
      recentBlogMix: [
        { slot: "NEW_RELEASE", at: "2026-08-18" },
        { slot: "NEW_RELEASE", at: "2026-08-19" },
        { slot: "SINGLE_PRODUCT", at: "2026-08-20" },
      ],
      channelHistory: [],
      channelDuplicate: { sameProductCooldownDays: 14, sameBodyCooldownDays: 7 },
      dayKey: "2026-08-21",
      minTotalScore: 20,
      minSampleImages: 3,
      minEvidenceRichness: 0.3,
    });
    expect(plan.blogMixSlot).toBe("OLDER_TITLE");
    expect(plan.blog.selection.selected?.canonicalId).toBe("old1");
    expect(plan.x.selection.selected).not.toBeNull();
    expect(plan.x.route?.route).toMatch(/DIRECT_AFFILIATE|BLOG_TRAFFIC/);
    // Soft: prefer different product than Blog
    expect(plan.x.sameProductAsBlog).toBe(false);
  });

  it("POPULAR_RANKING sorts by popularityScore deterministically", () => {
    const pool = [
      cand({
        canonicalId: "p-low",
        title: "low",
        popularityScore: 10,
        totalScore: 90,
        pageEvidenceRichness: 0.9,
        sampleImageCount: 8,
        releaseAgeBucket: "MID",
      }),
      cand({
        canonicalId: "p-high",
        title: "high",
        popularityScore: 95,
        totalScore: 40,
        pageEvidenceRichness: 0.85,
        sampleImageCount: 8,
        releaseAgeBucket: "MID",
      }),
    ];
    const plan = planDailyChannels({
      pool,
      mixWeights: {
        singleProduct: 0.01,
        popularRanking: 0.9,
        performerRanking: 0.01,
        newRelease: 0.01,
        olderTitle: 0.01,
      },
      releaseAge: { recentMaxDays: 60, olderMinDays: 365 },
      recentBlogMix: [],
      channelHistory: [],
      channelDuplicate: { sameProductCooldownDays: 14, sameBodyCooldownDays: 7 },
      dayKey: "2026-08-21",
      minTotalScore: 20,
      minSampleImages: 3,
      minEvidenceRichness: 0.3,
    });
    expect(plan.blogMixSlot).toBe("POPULAR_RANKING");
    expect(plan.blog.selection.selected?.canonicalId).toBe("p-high");
  });

  it("targets come from config (not scattered magic 1)", () => {
    const cfg = loadDailyMultiChannelConfig({
      DAILY_BLOG_ARTICLES: "1",
      DAILY_X_POSTS: "1",
    });
    expect(minimumDailyPublications(cfg)).toBe(2);
    expect(cfg.blogArticlesPerDay).toBe(1);
    expect(cfg.xPostsPerDay).toBe(1);
    expect(cfg.mixWeights.singleProduct).toBeGreaterThan(0);
  });

  it("dry orchestrator uses 0 LLM / 0 publish calls", () => {
    const result = runMultiChannelDailyDry({
      pool: [
        cand({ canonicalId: "a", title: "a", releaseAgeBucket: "RECENT" }),
        cand({ canonicalId: "b", title: "b", releaseAgeBucket: "OLDER", popularityScore: 80, pageEvidenceRichness: 0.95 }),
      ],
      recentMix: [
        { slot: "NEW_RELEASE", at: "x" },
        { slot: "NEW_RELEASE", at: "y" },
      ],
    });
    expect(result.llmCalls).toBe(0);
    expect(result.bloggerPublishCalls).toBe(0);
    expect(result.xPublishCalls).toBe(0);
    expect(result.targets.minimumTotal).toBe(2);
    expect(result.biasAudit.newnessBiasCorrected).toBe(true);
  });
});
