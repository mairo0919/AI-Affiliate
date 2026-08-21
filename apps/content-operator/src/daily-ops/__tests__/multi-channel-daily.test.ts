/**
 * Multi-channel daily ops — LLM=0 (no Writer/Brain/publish).
 */
import { describe, expect, it } from "vitest";
import { isBlockedOnChannel } from "../channel-duplicate.js";
import { planDailyChannels } from "../channel-selection.js";
import { chooseContentMixSlot } from "../content-mix.js";
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

describe("multi-channel daily (LLM=0)", () => {
  it("classifies release age without retro decade labels", () => {
    const now = new Date("2026-08-21T00:00:00Z");
    expect(classifyReleaseAge(ageDaysFromPublishedAt("2026-08-01", now), { recentMaxDays: 60, olderMinDays: 365 })).toBe("RECENT");
    expect(classifyReleaseAge(ageDaysFromPublishedAt("2025-12-01", now), { recentMaxDays: 60, olderMinDays: 365 })).toBe("MID");
    expect(classifyReleaseAge(ageDaysFromPublishedAt("2020-01-01", now), { recentMaxDays: 60, olderMinDays: 365 })).toBe("OLDER");
  });

  it("mix prefers under-represented older when recent history is new-heavy", () => {
    const slot = chooseContentMixSlot({
      weights: { recent: 0.3, mid: 0.3, older: 0.3, ranking: 0.1 },
      recentSlots: ["RECENT_PRODUCT", "RECENT_PRODUCT", "RECENT_PRODUCT", "MID_PRODUCT"],
      rankingAllowed: false,
      rankingDue: false,
      dayKey: "2026-08-21",
    });
    expect(slot.slot).toBe("OLDER_PRODUCT");
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
      mixWeights: { recent: 0.2, mid: 0.2, older: 0.5, ranking: 0.1 },
      releaseAge: { recentMaxDays: 60, olderMinDays: 365 },
      recentMix: [
        { slot: "RECENT_PRODUCT", at: "2026-08-18" },
        { slot: "RECENT_PRODUCT", at: "2026-08-19" },
        { slot: "MID_PRODUCT", at: "2026-08-20" },
      ],
      channelHistory: [],
      channelDuplicate: { sameProductCooldownDays: 14, sameBodyCooldownDays: 7 },
      dayKey: "2026-08-21",
      rankingAllowed: false,
      rankingDue: false,
      minTotalScore: 20,
      minSampleImages: 3,
      minEvidenceRichness: 0.3,
    });
    expect(plan.mixSlot).toBe("OLDER_PRODUCT");
    expect(plan.blog.selection.selected?.canonicalId).toBe("old1");
    // X may differ; must not be blocked by blog pick
    expect(plan.x.selection.selected).not.toBeNull();
    expect(plan.x.route?.route).toMatch(/DIRECT_AFFILIATE|BLOG_TRAFFIC/);
  });

  it("targets come from config (not scattered magic 1)", () => {
    const cfg = loadDailyMultiChannelConfig({
      DAILY_BLOG_ARTICLES: "1",
      DAILY_X_POSTS: "1",
    });
    expect(minimumDailyPublications(cfg)).toBe(2);
    expect(cfg.blogArticlesPerDay).toBe(1);
    expect(cfg.xPostsPerDay).toBe(1);
  });

  it("dry orchestrator uses 0 LLM / 0 publish calls", () => {
    const result = runMultiChannelDailyDry({
      pool: [
        cand({ canonicalId: "a", title: "a", releaseAgeBucket: "RECENT" }),
        cand({ canonicalId: "b", title: "b", releaseAgeBucket: "OLDER", popularityScore: 80, pageEvidenceRichness: 0.95 }),
      ],
      recentMix: [{ slot: "RECENT_PRODUCT", at: "x" }, { slot: "RECENT_PRODUCT", at: "y" }],
    });
    expect(result.llmCalls).toBe(0);
    expect(result.bloggerPublishCalls).toBe(0);
    expect(result.xPublishCalls).toBe(0);
    expect(result.targets.minimumTotal).toBe(2);
    expect(result.biasAudit.newnessBiasCorrected).toBe(true);
  });
});
