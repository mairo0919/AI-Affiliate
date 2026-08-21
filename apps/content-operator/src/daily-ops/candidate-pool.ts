/**
 * Load DailyCandidateScore pool from latest Analysis + ResearchItem.
 * No parallel candidate system — reuses Analysis ProductAnalysis scores.
 * Fallback: ResearchItems when no COMPLETED analysis run exists.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import type { ChannelCandidate } from "./channel-selection.js";
import { classifyReleaseAge, type ReleaseAgeThresholds } from "./release-age.js";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function extractAffiliateUrl(rawData: unknown, itemUrl: string | null): string | null {
  const raw = asRecord(rawData);
  const fromRaw =
    (typeof raw.affiliateURL === "string" && raw.affiliateURL.trim()) ||
    (typeof raw.affiliateUrl === "string" && raw.affiliateUrl.trim()) ||
    "";
  if (fromRaw) return fromRaw;
  if (itemUrl?.trim()) return itemUrl.trim();
  return null;
}

function tagName(
  tags: Array<{ researchTag: { type: string; name: string } }>,
  type: string,
): string | null {
  const hit = tags.find((t) => t.researchTag.type.toLowerCase() === type.toLowerCase());
  return hit?.researchTag.name ?? null;
}

async function loadPublishedBlogUrls(
  prisma: DatabaseClient["prisma"],
): Promise<Map<string, string>> {
  const publishedTargets = await prisma.publicationTarget.findMany({
    where: {
      platform: "BLOGGER",
      status: "PUBLISHED",
      publishedUrl: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
    select: {
      publishedUrl: true,
      platformMetadata: true,
    },
  });
  const blogUrlByCid = new Map<string, string>();
  for (const t of publishedTargets) {
    const meta = asRecord(t.platformMetadata);
    const cid =
      (typeof meta.canonicalId === "string" && meta.canonicalId) ||
      (typeof meta.externalId === "string" && meta.externalId) ||
      null;
    if (cid && t.publishedUrl && !blogUrlByCid.has(cid)) {
      blogUrlByCid.set(cid.toLowerCase(), t.publishedUrl);
    }
  }
  return blogUrlByCid;
}

/**
 * Build pool from the latest completed analysis run (or ResearchItem fallback).
 */
export async function loadDailyCandidatePool(
  prisma: DatabaseClient["prisma"],
  input: {
    releaseAge: ReleaseAgeThresholds;
    limit?: number;
    now?: Date;
  },
): Promise<{ pool: ChannelCandidate[]; analysisRunId: string | null }> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 80, 200));
  const blogUrlByCid = await loadPublishedBlogUrls(prisma);

  const latestRun = await prisma.analysisRun.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });

  if (latestRun) {
    const analyses = await prisma.productAnalysis.findMany({
      where: {
        analysisRunId: latestRun.id,
        eligibilityStatus: { in: ["ELIGIBLE", "REQUIRES_CONFIRMATION"] },
      },
      orderBy: { totalScore: "desc" },
      take: limit,
      include: {
        researchItem: {
          include: {
            images: true,
            tags: { include: { researchTag: true } },
          },
        },
      },
    });

    const pool: ChannelCandidate[] = analyses.map((a) => {
      const item = a.researchItem;
      const externalId = item.externalId;
      const sampleImageCount = item.images.length;
      const breakdown = asRecord(a.scoreBreakdown);
      const richnessRaw = breakdown.pageEvidenceRichness ?? breakdown.evidenceRichness;
      const pageEvidenceRichness =
        typeof richnessRaw === "number" && Number.isFinite(richnessRaw)
          ? Math.max(0, Math.min(1, richnessRaw))
          : Math.min(1, sampleImageCount / 8 + (item.description ? 0.2 : 0));

      const publishedAt = item.publishedAt?.toISOString() ?? null;
      const ageDays =
        item.publishedAt != null
          ? (now.getTime() - item.publishedAt.getTime()) / 86400000
          : null;

      return {
        researchItemId: item.id,
        canonicalId: externalId,
        totalScore: a.totalScore,
        popularityScore: a.popularityScore,
        trendScore: a.trendScore,
        freshnessScore: a.freshnessScore,
        dataQualityScore: a.dataQualityScore,
        reviewScore: a.reviewScore,
        pageEvidenceRichness,
        sampleImageCount,
        actressKey: tagName(item.tags, "actress"),
        makerKey: tagName(item.tags, "maker"),
        seriesKey: tagName(item.tags, "series"),
        affiliateUrl: extractAffiliateUrl(item.rawData, item.url),
        title: item.title,
        publishedAt,
        releaseAgeBucket: classifyReleaseAge(ageDays, input.releaseAge),
        publishedBlogUrl: blogUrlByCid.get(externalId.toLowerCase()) ?? null,
      };
    });

    return { pool, analysisRunId: latestRun.id };
  }

  // Fallback: ResearchItems without Analysis (selection still requires evidence thresholds)
  const items = await prisma.researchItem.findMany({
    orderBy: { collectedAt: "desc" },
    take: limit,
    include: {
      images: true,
      tags: { include: { researchTag: true } },
    },
  });

  const pool: ChannelCandidate[] = items.map((item) => {
    const sampleImageCount = item.images.length;
    const publishedAt = item.publishedAt?.toISOString() ?? null;
    const ageDays =
      item.publishedAt != null
        ? (now.getTime() - item.publishedAt.getTime()) / 86400000
        : null;
    return {
      researchItemId: item.id,
      canonicalId: item.externalId,
      totalScore: 40 + Math.min(40, sampleImageCount * 4),
      popularityScore: null,
      trendScore: null,
      freshnessScore: null,
      dataQualityScore: sampleImageCount > 0 ? 50 : 20,
      reviewScore: null,
      pageEvidenceRichness: Math.min(1, sampleImageCount / 8 + (item.description ? 0.25 : 0)),
      sampleImageCount,
      actressKey: tagName(item.tags, "actress"),
      makerKey: tagName(item.tags, "maker"),
      seriesKey: tagName(item.tags, "series"),
      affiliateUrl: extractAffiliateUrl(item.rawData, item.url),
      title: item.title,
      publishedAt,
      releaseAgeBucket: classifyReleaseAge(ageDays, input.releaseAge),
      publishedBlogUrl: blogUrlByCid.get(item.externalId.toLowerCase()) ?? null,
    };
  });

  return { pool, analysisRunId: null };
}
