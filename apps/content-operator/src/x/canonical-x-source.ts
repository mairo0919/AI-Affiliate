/**
 * Load Factory canonical article inputs for X social adaptation.
 * WordPress is destination-only — never scraped as copy SSOT.
 *
 * Prefers ARTICLE_PLAN facts + strategy Claims (same product understanding as the article).
 * Genre tags are loaded only as demoted taxonomy auxiliaries.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { resolvePublicationOffer } from "../publication/offer-resolution.js";
import { FANZA_PROVIDER_KEY } from "../publication/provider-registry-meta.js";
import {
  adaptCanonicalToXSocial,
  type XSocialAdaptationResult,
} from "./x-social-adaptation.js";
import {
  extractArticlePlanSocialFacts,
  type XSocialFact,
} from "./x-social-facts.js";
import { xPostRouteToLinkMode, type XPostRoute } from "../daily-ops/x-route.js";

export type CanonicalXSource = {
  cid: string;
  contentVersionId: string | null;
  contentId: string | null;
  canonicalTitle: string;
  wordpressTitle: string | null;
  wpStatus: string | null;
  publishedBlogUrl: string | null;
  affiliateUrl: string | null;
  affiliateLinkReady: boolean;
  performerNames: string[];
  seriesName: string | null;
  claimStatements: Array<{ id: string; statement: string }>;
  /** @deprecated genre tags — use taxonomyTags; kept for callers. */
  safeFacets: string[];
  taxonomyTags: string[];
  articlePlanFacts: XSocialFact[];
  productTitle: string | null;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Resolve ContentVersion + ARTICLE_PLAN + claims + WP publication for a CID.
 */
export async function loadCanonicalXSource(
  prisma: DatabaseClient["prisma"],
  cid: string,
): Promise<CanonicalXSource | null> {
  const key = cid.trim().toLowerCase();
  if (!key) return null;

  const targets = await prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      OR: [
        { platformMetadata: { path: ["canonicalId"], equals: key } },
        { platformMetadata: { path: ["canonicalId"], equals: cid.trim() } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });

  const published = targets.find((t) => t.status === "PUBLISHED");
  const any = published ?? targets[0] ?? null;

  const researchItem = await prisma.researchItem.findFirst({
    where: {
      OR: [{ externalId: key }, { externalId: cid.trim() }],
    },
    include: {
      tags: { include: { researchTag: true } },
    },
  });

  let version =
    any?.contentVersionId != null
      ? await prisma.contentVersion.findUnique({ where: { id: any.contentVersionId } })
      : null;
  if (!version && researchItem) {
    const fallback = await prisma.publicationTarget.findFirst({
      where: {
        platformMetadata: { path: ["canonicalId"], equals: researchItem.externalId },
      },
      orderBy: { updatedAt: "desc" },
    });
    version = fallback?.contentVersionId
      ? await prisma.contentVersion.findUnique({ where: { id: fallback.contentVersionId } })
      : null;
  }

  if (!version && !researchItem) {
    return null;
  }

  const meta = asRecord(any?.platformMetadata);
  const sc = asRecord(version?.structuredContent);
  const article = asRecord(sc.article);
  const canonicalTitle =
    (typeof version?.title === "string" && version.title.trim()) ||
    (typeof article.title === "string" && article.title.trim()) ||
    researchItem?.title ||
    key;

  const performers = (researchItem?.tags ?? [])
    .filter((t) => t.researchTag.type.toLowerCase() === "actress")
    .map((t) => t.researchTag.name);
  const series =
    (researchItem?.tags ?? []).find((t) => t.researchTag.type.toLowerCase() === "series")
      ?.researchTag.name ?? null;

  const articlePlanFacts = extractArticlePlanSocialFacts(version?.structuredContent ?? null);

  let claimStatements: Array<{ id: string; statement: string }> = [];
  if (version?.id) {
    const linked = await prisma.contentVersionClaim.findMany({
      where: { contentVersionId: version.id },
      take: 40,
      include: { claim: { select: { id: true, statement: true, status: true } } },
    });
    claimStatements = linked
      .filter((row) => row.claim.status === "SUPPORTED")
      .map((row) => ({ id: row.claim.id, statement: row.claim.statement }));
  }

  // Fallback: strategy-scoped Claims (same understanding as article generation)
  if (claimStatements.length === 0 && version?.contentId) {
    const content = await prisma.content.findUnique({
      where: { id: version.contentId },
      select: { strategyId: true },
    });
    if (content?.strategyId) {
      const strategyClaims = await prisma.claim.findMany({
        where: { strategyId: content.strategyId, status: "SUPPORTED" },
        take: 20,
        orderBy: { createdAt: "desc" },
        select: { id: true, statement: true },
      });
      claimStatements = strategyClaims.map((c) => ({ id: c.id, statement: c.statement }));
    }
  }

  const raw = asRecord(researchItem?.rawData);
  const affiliateFromItem =
    (typeof raw.affiliateURL === "string" && raw.affiliateURL.trim()) ||
    (typeof raw.affiliateUrl === "string" && raw.affiliateUrl.trim()) ||
    researchItem?.url?.trim() ||
    null;
  const offer = resolvePublicationOffer({
    providerKey: FANZA_PROVIDER_KEY,
    productId: key,
    affiliateUrl: affiliateFromItem,
  });
  const affiliateCheck = validateFanzaAffiliateUrl(offer.url ?? "");

  const wpStatusFromMeta =
    (typeof meta.wpStatus === "string" && meta.wpStatus) ||
    (typeof meta.wordpressStatus === "string" && meta.wordpressStatus) ||
    null;
  const wpStatus =
    any?.status === "PUBLISHED"
      ? "publish"
      : any?.status === "SCHEDULED"
        ? "future"
        : any?.status === "DRAFT"
          ? "draft"
          : wpStatusFromMeta;

  const taxonomyTags: string[] = [];
  for (const g of (researchItem?.tags ?? []).filter(
    (t) => t.researchTag.type.toLowerCase() === "genre",
  )) {
    taxonomyTags.push(g.researchTag.name);
  }

  return {
    cid: researchItem?.externalId ?? key,
    contentVersionId: version?.id ?? null,
    contentId: version?.contentId ?? null,
    canonicalTitle,
    wordpressTitle: typeof meta.wordpressTitle === "string" ? meta.wordpressTitle : null,
    wpStatus,
    publishedBlogUrl: published?.publishedUrl ?? null,
    affiliateUrl: offer.url,
    affiliateLinkReady: offer.affiliateLinkReady && affiliateCheck.ok,
    performerNames: performers,
    seriesName: series,
    claimStatements,
    safeFacets: taxonomyTags,
    taxonomyTags,
    articlePlanFacts,
    productTitle: researchItem?.title ?? null,
  };
}

export function adaptLoadedCanonicalToX(
  source: CanonicalXSource,
  opts?: {
    preferredRoute?: XPostRoute | null;
    disclosure?: string | null;
    preferWpTraffic?: boolean;
  },
): XSocialAdaptationResult {
  const preferredLinkMode = opts?.preferredRoute
    ? xPostRouteToLinkMode(opts.preferredRoute)
    : null;
  return adaptCanonicalToXSocial({
    canonicalTitle: source.canonicalTitle,
    wordpressTitle: source.wordpressTitle,
    productTitle: source.productTitle,
    cid: source.cid,
    performerNames: source.performerNames,
    seriesName: source.seriesName,
    claimStatements: source.claimStatements,
    taxonomyTags: source.taxonomyTags,
    articlePlanFacts: source.articlePlanFacts,
    publishedBlogUrl: source.publishedBlogUrl,
    wpStatus: source.wpStatus,
    affiliateUrl: source.affiliateUrl,
    affiliateLinkReady: source.affiliateLinkReady,
    preferredLinkMode,
    disclosure: opts?.disclosure ?? "#PR",
    preferWpTraffic: opts?.preferWpTraffic,
  });
}
