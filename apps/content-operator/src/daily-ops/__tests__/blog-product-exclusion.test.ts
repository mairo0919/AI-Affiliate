import { describe, expect, it } from "vitest";
import {
  baseProductCid,
  filterPoolExcludingArticledBlogProducts,
  isProductAlreadyArticledForDailyBlog,
} from "../blog-product-exclusion.js";
import { planDailyChannels } from "../channel-selection.js";
import type { ChannelCandidate } from "../channel-selection.js";

function cand(
  partial: Partial<ChannelCandidate> & Pick<ChannelCandidate, "canonicalId" | "title">,
): ChannelCandidate {
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
    publishedAt: partial.publishedAt ?? "2020-01-01T00:00:00Z",
    releaseAgeBucket: partial.releaseAgeBucket ?? "OLDER",
    publishedBlogUrl: partial.publishedBlogUrl ?? null,
  };
}

const weights = {
  singleProduct: 0.25,
  popularRanking: 0.15,
  performerRanking: 0.15,
  newRelease: 0.25,
  olderTitle: 0.2,
};

describe("blog-product-exclusion", () => {
  it("normalizes base FANZA cid across suffix variants", () => {
    expect(baseProductCid("ofje00230")).toBe("ofje00230");
    expect(baseProductCid("OFJE00230-genreauth-v1")).toBe("ofje00230");
  });

  it("excludes already articled products from daily blog pool forever (not cooldown-only)", () => {
    const history = [
      {
        channel: "BLOG" as const,
        canonicalId: "ofje00230",
        publishedAt: "2020-01-01T00:00:00Z", // older than any cooldown
      },
    ];
    expect(
      isProductAlreadyArticledForDailyBlog({
        canonicalId: "ofje00230",
        history,
      }).excluded,
    ).toBe(true);

    const { eligible, excluded } = filterPoolExcludingArticledBlogProducts(
      [
        cand({ canonicalId: "ofje00230", title: "old articled" }),
        cand({ canonicalId: "ssis00999", title: "fresh" }),
      ],
      history,
    );
    expect(excluded.map((e) => e.canonicalId)).toEqual(["ofje00230"]);
    expect(eligible.map((c) => c.canonicalId)).toEqual(["ssis00999"]);
  });

  it("planDailyChannels prefers unarticled product even when articled scores higher", () => {
    const plan = planDailyChannels({
      pool: [
        cand({
          canonicalId: "ofje00230",
          title: "already drafted",
          totalScore: 99,
          popularityScore: 99,
          pageEvidenceRichness: 1,
        }),
        cand({
          canonicalId: "ssis00999",
          title: "new",
          totalScore: 55,
          popularityScore: 40,
          pageEvidenceRichness: 0.8,
        }),
      ],
      mixWeights: weights,
      releaseAge: { recentMaxDays: 60, olderMinDays: 365 },
      channelHistory: [
        {
          channel: "BLOG",
          canonicalId: "ofje00230",
          publishedAt: "2020-01-01T00:00:00Z",
        },
      ],
      channelDuplicate: { sameProductCooldownDays: 14, sameBodyCooldownDays: 7 },
      dayKey: "2026-09-09",
      minTotalScore: 20,
      minSampleImages: 3,
      minEvidenceRichness: 0.25,
      now: new Date("2026-09-09T00:00:00Z"),
    });
    expect(plan.blog.selection.selected?.canonicalId).toBe("ssis00999");
  });
});
