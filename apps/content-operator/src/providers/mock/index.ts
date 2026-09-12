import type { CollectedResearchItem, CollectionResult } from "@ai-affiliate/shared";
import type { ResearchProvider } from "../types.js";

const recordedAt = new Date("2026-07-27T12:00:00.000Z");
const collectedAt = new Date("2026-07-27T12:05:00.000Z");

function fanzaMockItem(): CollectedResearchItem {
  return {
    sourceName: "FANZA",
    sourceType: "FANZA",
    sourceBaseUrl: "https://www.dmm.co.jp",
    externalId: "fanza-mock-product-001",
    itemType: "product",
    title: "【モック】人気シリーズ最新作",
    description: null,
    url: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=mock001/",
    publishedAt: new Date("2026-07-01T00:00:00.000Z"),
    collectedAt,
    rawData: {
      contentId: "mock001",
      maker: "Mock Studio",
      price: 1980,
    },
    metrics: [
      { metricType: "review_count", value: 128, recordedAt },
      { metricType: "ranking", value: 12, recordedAt },
    ],
    tags: [
      { name: "ドラマ", type: "genre" },
      { name: "Mock Studio", type: "maker" },
    ],
    images: [],
  };
}

function multiSourceExtraItems(): CollectedResearchItem[] {
  return [
    {
      sourceName: "TikTok",
      sourceType: "TIKTOK",
      sourceBaseUrl: "https://www.tiktok.com",
      externalId: "tiktok-mock-video-001",
      itemType: "video",
      title: "モック短尺動画フック検証",
      description: null,
      url: "https://www.tiktok.com/@mock_creator/video/7000000000000000001",
      publishedAt: new Date("2026-07-20T08:30:00.000Z"),
      collectedAt,
      rawData: {
        author: "mock_creator",
        durationSec: 18,
        language: "ja",
      },
      metrics: [
        { metricType: "view_count", value: 152340, recordedAt },
        { metricType: "like_count", value: 8421, recordedAt },
      ],
      tags: [
        { name: "アフィリエイト", type: "hashtag" },
        { name: "ショート動画", type: "hashtag" },
      ],
      images: [],
    },
    {
      sourceName: "X",
      sourceType: "X",
      sourceBaseUrl: "https://x.com",
      externalId: "x-mock-post-001",
      itemType: "post",
      title: "モック投稿: リサーチ対象の反応確認",
      description: null,
      url: "https://x.com/mock_account/status/1900000000000000001",
      publishedAt: new Date("2026-07-22T15:00:00.000Z"),
      collectedAt,
      rawData: {
        author: "mock_account",
        lang: "ja",
        conversationId: "1900000000000000001",
      },
      metrics: [
        { metricType: "like_count", value: 356, recordedAt },
        { metricType: "repost_count", value: 42, recordedAt },
      ],
      tags: [
        { name: "リサーチ", type: "hashtag" },
        { name: "mock_account", type: "author" },
      ],
      images: [],
    },
  ];
}

export class MockResearchProvider implements ResearchProvider {
  readonly providerName = "mock";

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async collect(): Promise<CollectionResult> {
    const items = [fanzaMockItem()];
    // TikTok/X mock sources are opt-in only — never default for production diagnostics.
    if (process.env.RESEARCH_MOCK_MULTI_SOURCE === "true") {
      items.push(...multiSourceExtraItems());
    }
    return {
      providerName: this.providerName,
      collectedAt,
      items,
    };
  }
}
