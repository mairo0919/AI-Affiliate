/**
 * Load Factory canonical article inputs for X social adaptation.
 * WordPress is destination-only — never scraped as copy SSOT.
 *
 * Prefers ARTICLE_PLAN facts + strategy Claims (same product understanding as the article).
 * Genre tags are loaded only as demoted taxonomy auxiliaries.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import {
  parseArticleImages,
  selectArticleImages,
  type ArticleImage,
  type RawResearchImageRow,
} from "../generation/article-images.js";
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
  /** Official product-page description from SourceDocument.pageEvidence. */
  officialDescription: string | null;
  /** Same resolved images as WP (structuredContent.images). */
  articleImages: ArticleImage[];
};

/**
 * Article images for X.
 * Prefer structuredContent.images. When that list is empty, use the same
 * ResearchImage rows the article selector would have written there.
 * Only ALLOWED rows are returned.
 */
export function resolveCanonicalArticleImages(input: {
  structuredImages: unknown;
  researchImages?: RawResearchImageRow[] | null;
  altBase?: string | null;
}): ArticleImage[] {
  const fromStructured = parseArticleImages(input.structuredImages);
  if (fromStructured.length > 0) return fromStructured;
  const rows = input.researchImages ?? [];
  if (rows.length === 0) return [];
  return selectArticleImages({
    researchImages: rows,
    options: {
      altBase: input.altBase?.trim() || "商品画像",
      allowRequiresConfirmationForDisplay: false,
    },
  }).filter((img) => img.usageStatus === "ALLOWED");
}

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

  const metaCidOr = [
    { platformMetadata: { path: ["canonicalId"], equals: key } },
    { platformMetadata: { path: ["canonicalId"], equals: cid.trim() } },
    { platformMetadata: { path: ["productCanonicalId"], equals: key } },
    { platformMetadata: { path: ["productCanonicalId"], equals: cid.trim() } },
    { platformMetadata: { path: ["productKey"], equals: key } },
    { platformMetadata: { path: ["productKey"], equals: cid.trim() } },
    { platformMetadata: { path: ["contentId"], equals: key } },
    { platformMetadata: { path: ["contentId"], equals: cid.trim() } },
  ] as const;

  // Prefer PUBLISHED explicitly — a take:N over all statuses can bury the live
  // public target under newer SCHEDULED/DRAFT rows for the same CID.
  const published = await prisma.publicationTarget.findFirst({
    where: {
      platform: "WORDPRESS",
      status: "PUBLISHED",
      OR: [...metaCidOr],
    },
    orderBy: { updatedAt: "desc" },
  });
  const fallback = published
    ? null
    : await prisma.publicationTarget.findFirst({
        where: {
          platform: "WORDPRESS",
          OR: [...metaCidOr],
        },
        orderBy: { updatedAt: "desc" },
      });
  const any = published ?? fallback;

  const researchItem = await prisma.researchItem.findFirst({
    where: {
      OR: [
        { externalId: key },
        { externalId: cid.trim() },
        { externalId: { equals: key, mode: "insensitive" } },
      ],
    },
    include: {
      tags: { include: { researchTag: true } },
      images: true,
    },
  });

  // Production WP targets often store CID only in ctaUrl (?id=...).
  let resolvedTarget: {
    status: string;
    contentVersionId: string;
    platformMetadata: unknown;
    publishedUrl: string | null;
  } | null = any;
  if (!resolvedTarget) {
    const recent = await prisma.publicationTarget.findMany({
      where: {
        platform: "WORDPRESS",
        status: { in: ["PUBLISHED", "SCHEDULED"] },
        publishedExternalId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 120,
      select: {
        contentVersionId: true,
        platformMetadata: true,
        publishedUrl: true,
        status: true,
      },
    });
    resolvedTarget =
      recent.find((t) => {
        const m = asRecord(t.platformMetadata);
        const cta = String(m.ctaUrl || m.offerUrl || "");
        const id = cta.match(/[?&]id=([a-z0-9_]+)/i)?.[1]?.toLowerCase();
        return id === key;
      }) ?? null;
  }
  let version =
    resolvedTarget?.contentVersionId != null
      ? await prisma.contentVersion.findUnique({ where: { id: resolvedTarget.contentVersionId } })
      : null;
  if (!version && researchItem) {
    const fallbackPt = await prisma.publicationTarget.findFirst({
      where: {
        OR: [
          { platformMetadata: { path: ["canonicalId"], equals: researchItem.externalId } },
          {
            platformMetadata: {
              path: ["productCanonicalId"],
              equals: researchItem.externalId,
            },
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    version = fallbackPt?.contentVersionId
      ? await prisma.contentVersion.findUnique({ where: { id: fallbackPt.contentVersionId } })
      : null;
  }

  if (!version && !researchItem) {
    return null;
  }

  const meta = asRecord(resolvedTarget?.platformMetadata);
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
  const articleImages = resolveCanonicalArticleImages({
    structuredImages: sc.images,
    researchImages: researchItem?.images,
    altBase: researchItem?.title ?? null,
  });

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
    resolvedTarget?.status === "PUBLISHED"
      ? "publish"
      : resolvedTarget?.status === "SCHEDULED"
        ? "future"
        : resolvedTarget?.status === "DRAFT"
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
    publishedBlogUrl: resolvedTarget?.publishedUrl ?? published?.publishedUrl ?? null,
    affiliateUrl: offer.url,
    affiliateLinkReady: offer.affiliateLinkReady && affiliateCheck.ok,
    performerNames: performers,
    seriesName: series,
    claimStatements,
    safeFacets: taxonomyTags,
    taxonomyTags,
    articlePlanFacts,
    productTitle: researchItem?.title ?? null,
    officialDescription: await loadOfficialDescription(prisma, key, cid.trim()),
    articleImages,
  };
}

async function loadOfficialDescription(
  prisma: DatabaseClient["prisma"],
  key: string,
  rawCid: string,
): Promise<string | null> {
  const byId = await prisma.sourceDocument.findFirst({
    where: { externalId: { equals: rawCid, mode: "insensitive" } },
    orderBy: { retrievedAt: "desc" },
    select: { metadata: true },
  });
  const byUrl =
    byId ??
    (await prisma.sourceDocument.findFirst({
      where: { url: { contains: key, mode: "insensitive" } },
      orderBy: { retrievedAt: "desc" },
      select: { metadata: true },
    }));
  return readOfficialDescription(byUrl?.metadata);
}

function readOfficialDescription(metadata: unknown): string | null {
  const meta = asRecord(metadata);
  const page = asRecord(meta.pageEvidence);
  const description = asRecord(page.description);
  const text = typeof description.text === "string" ? description.text.trim() : "";
  return text || null;
}

export async function adaptLoadedCanonicalToX(
  source: CanonicalXSource,
  opts?: {
    preferredRoute?: XPostRoute | null;
    /** Composer does not inject disclosure; leave unset/empty. */
    disclosure?: string | null;
    preferWpTraffic?: boolean;
    allowDirectAffiliate?: boolean;
    allowCombined?: boolean;
    affiliateThreadMode?: boolean;
    llm?: import("../adapters/types.js").LLMProvider | null;
    llmModel?: string;
  },
): Promise<XSocialAdaptationResult> {
  const preferredLinkMode = opts?.preferredRoute
    ? xPostRouteToLinkMode(opts.preferredRoute)
    : "WP_TRAFFIC";
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
    officialDescription: source.officialDescription,
    articleImages: source.articleImages,
    publishedBlogUrl: source.publishedBlogUrl,
    wpStatus: source.wpStatus,
    affiliateUrl: source.affiliateUrl,
    affiliateLinkReady: source.affiliateLinkReady,
    preferredLinkMode,
    disclosure: opts?.disclosure ?? "",
    preferWpTraffic: opts?.preferWpTraffic ?? true,
    allowDirectAffiliate: opts?.allowDirectAffiliate ?? false,
    allowCombined: opts?.allowCombined ?? false,
    affiliateThreadMode: opts?.affiliateThreadMode ?? false,
    llm: opts?.llm,
    llmModel: opts?.llmModel,
  });
}
