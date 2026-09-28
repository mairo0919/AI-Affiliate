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
  // X WP traffic requires a publicly reachable article — PUBLISHED only
  // (never DRAFT / SCHEDULED / future). Prefer WORDPRESS over BLOGGER.
  const publishedTargets = await prisma.publicationTarget.findMany({
    where: {
      platform: { in: ["WORDPRESS", "BLOGGER"] },
      status: "PUBLISHED",
      publishedUrl: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
    select: {
      publishedUrl: true,
      platform: true,
      platformMetadata: true,
    },
  });
  const blogUrlByCid = new Map<string, string>();
  // Two-pass: WORDPRESS wins when both exist for the same canonicalId.
  for (const prefer of ["WORDPRESS", "BLOGGER"] as const) {
    for (const t of publishedTargets) {
      if (t.platform !== prefer) continue;
      const meta = asRecord(t.platformMetadata);
      const cid =
        (typeof meta.canonicalId === "string" && meta.canonicalId) ||
        (typeof meta.externalId === "string" && meta.externalId) ||
        null;
      if (cid && t.publishedUrl && !blogUrlByCid.has(cid.toLowerCase())) {
        blogUrlByCid.set(cid.toLowerCase(), t.publishedUrl);
      }
    }
  }
  return blogUrlByCid;
}

/**
 * Seed / top-up pool with WordPress PUBLISHED rows that already have a linked
 * ContentVersion (Factory backfill / live publish). Analysis top-N alone often
 * omits these, which leaves X WP_TRAFFIC with zero PASS probes.
 */
export async function loadWordPressPublishedCandidates(
  prisma: DatabaseClient["prisma"],
  input: {
    releaseAge: ReleaseAgeThresholds;
    now?: Date;
    limit?: number;
  },
): Promise<ChannelCandidate[]> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 80, 200));
  const targets = await prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: "PUBLISHED",
      publishedUrl: { not: "" },
    },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
    take: limit * 2,
    select: {
      publishedUrl: true,
      platformMetadata: true,
      contentVersionId: true,
    },
  });

  const byCid = new Map<string, { url: string; contentVersionId: string }>();
  for (const t of targets) {
    if (!t.contentVersionId || !t.publishedUrl) continue;
    const meta = asRecord(t.platformMetadata);
    const rawCid =
      (typeof meta.canonicalId === "string" && meta.canonicalId) ||
      (typeof meta.externalId === "string" && meta.externalId) ||
      null;
    const cid = rawCid?.trim().toLowerCase();
    if (!cid || !t.publishedUrl || !t.contentVersionId) continue;
    if (!byCid.has(cid)) {
      byCid.set(cid, { url: t.publishedUrl, contentVersionId: t.contentVersionId });
    }
  }
  if (byCid.size === 0) return [];

  const items = await prisma.researchItem.findMany({
    where: { externalId: { in: [...byCid.keys()] } },
    include: {
      images: true,
      tags: { include: { researchTag: true } },
    },
  });
  const byExternal = new Map(items.map((i) => [i.externalId.trim().toLowerCase(), i] as const));

  const out: ChannelCandidate[] = [];
  for (const [cid, link] of byCid) {
    const item = byExternal.get(cid);
    if (!item) continue;
    const sampleImageCount = item.images.length;
    const publishedAt = item.publishedAt?.toISOString() ?? null;
    const ageDays =
      item.publishedAt != null
        ? (now.getTime() - item.publishedAt.getTime()) / 86400000
        : null;
    out.push({
      researchItemId: item.id,
      canonicalId: item.externalId,
      // Above default X minTotalScore (20) so WP-ready inventory is selectable.
      totalScore: 70 + Math.min(25, sampleImageCount * 2),
      popularityScore: null,
      trendScore: null,
      freshnessScore: null,
      dataQualityScore: sampleImageCount > 0 ? 60 : 40,
      reviewScore: null,
      pageEvidenceRichness: Math.min(1, Math.max(0.5, sampleImageCount / 8 + 0.35)),
      sampleImageCount,
      actressKey: tagName(item.tags, "actress"),
      makerKey: tagName(item.tags, "maker"),
      seriesKey: tagName(item.tags, "series"),
      affiliateUrl: extractAffiliateUrl(item.rawData, item.url),
      title: item.title,
      publishedAt,
      releaseAgeBucket: classifyReleaseAge(ageDays, input.releaseAge),
      publishedBlogUrl: link.url,
    });
  }
  return out;
}

function mergeCandidatePools(
  primary: ChannelCandidate[],
  extra: ChannelCandidate[],
  limit: number,
): ChannelCandidate[] {
  const seen = new Set<string>();
  const out: ChannelCandidate[] = [];
  for (const c of [...extra, ...primary]) {
    const cid = c.canonicalId.trim().toLowerCase();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build pool from the latest completed analysis run (or ResearchItem fallback),
 * topped up with WordPress-PUBLISHED Factory-linked inventory for X WP_TRAFFIC.
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
  const wpPublished = await loadWordPressPublishedCandidates(prisma, {
    releaseAge: input.releaseAge,
    now,
    limit,
  });

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

    const analysisPool: ChannelCandidate[] = analyses.map((a) => {
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

    return {
      pool: mergeCandidatePools(analysisPool, wpPublished, Math.max(limit, wpPublished.length + 20)),
      analysisRunId: latestRun.id,
    };
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

  const researchPool: ChannelCandidate[] = items.map((item) => {
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

  return {
    pool: mergeCandidatePools(researchPool, wpPublished, Math.max(limit, wpPublished.length + 20)),
    analysisRunId: null,
  };
}
