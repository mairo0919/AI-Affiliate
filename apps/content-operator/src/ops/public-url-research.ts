import type { AppConfig } from "@ai-affiliate/config";
import type { Claim, LifecycleRepository, SourceDocument } from "@ai-affiliate/database";
import {
  assertSafeOutboundUrl,
  hashNormalizedContent,
  safeFetchText,
  SafeFetchError,
  SsrfBlockedError,
} from "@ai-affiliate/shared";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import {
  claimsFromNormalizedPage,
  normalizePublicHtml,
  type NormalizedPublicPage,
} from "./page-normalize.js";

export interface PublicUrlResearchResult {
  seed: NormalizedPublicPage;
  documents: SourceDocument[];
  claims: Claim[];
  fetchedUrls: string[];
  skippedUrls: Array<{ url: string; reason: string }>;
  productHint: {
    title: string;
    url: string;
    providerKey: string;
  } | null;
}

export interface PublicUrlResearchOptions {
  url: string;
  /** Must be true together with config.researchAllowExternalRequests for live fetch */
  confirmExternal: boolean;
  /** Injected HTML for tests (skips network) */
  mockHtml?: string;
  strategyId?: string;
  maxAdditionalSources?: number;
  researchBudget?: number;
}

/**
 * Fetch + normalize a public URL into SourceDocument / Claim (no Affiliate API).
 * Full HTML is never persisted — only normalizedText + metadata fields.
 */
export async function researchPublicUrl(input: {
  config: AppConfig;
  repo: LifecycleRepository;
  lifecycle: ContentLifecycleService;
  options: PublicUrlResearchOptions;
}): Promise<PublicUrlResearchResult> {
  const { config, repo, lifecycle, options } = input;
  assertSafeOutboundUrl(options.url);

  const allow =
    options.confirmExternal &&
    (config.researchAllowExternalRequests || Boolean(options.mockHtml));
  if (!allow && !options.mockHtml) {
    throw new Error(
      "External research fetch denied — set RESEARCH_ALLOW_EXTERNAL_REQUESTS=true and pass --confirm-external (or use mockHtml in tests)",
    );
  }

  const seed = options.mockHtml
    ? normalizePublicHtml({ html: options.mockHtml, sourceUrl: options.url })
    : await fetchAndNormalize(options.url, config);

  const documents: SourceDocument[] = [];
  const claims: Claim[] = [];
  const fetchedUrls = [seed.sourceUrl];
  const skippedUrls: Array<{ url: string; reason: string }> = [];

  const seedDoc = await persistNormalized(repo, seed, "seed");
  documents.push(seedDoc);

  const seedClaims = claimsFromNormalizedPage(seed);
  for (const c of seedClaims) {
    const created = await lifecycle.registerFindingAndClaim({
      sourceKey: "public-url",
      documentType: seed.pageType,
      documentTitle: seed.title ?? seed.sourceUrl,
      documentText: seed.normalizedText,
      findingSummary: c.statement,
      claimStatement: c.statement,
      strategyId: options.strategyId,
      findingType: `observed:${c.field}`,
    });
    // registerFindingAndClaim creates its own document — we keep seedDoc for metadata URL
    claims.push(created.claim);
    documents.push(created.document);
  }

  // Bounded expansion from same-domain related links
  const budget = options.researchBudget ?? 3;
  const maxExtra = Math.min(options.maxAdditionalSources ?? 3, budget);
  let newFactCount = seedClaims.length;
  const seen = new Set(fetchedUrls);

  for (const related of seed.relatedPublicUrls) {
    if (fetchedUrls.length - 1 >= maxExtra) break;
    if (seen.has(related)) continue;
    seen.add(related);

    let page: NormalizedPublicPage;
    try {
      if (options.mockHtml) {
        // In mock mode, synthesize a short sibling page from seed facts (no network)
        page = {
          ...seed,
          sourceUrl: related,
          canonicalUrl: related,
          title: seed.title ? `${seed.title} (related)` : related,
          publicDescriptionSummary: seed.publicDescriptionSummary
            ? `Related page note: ${seed.publicDescriptionSummary}`
            : null,
          relatedPublicUrls: [],
          normalizedText: `related_of: ${seed.sourceUrl}\nurl: ${related}\n${seed.normalizedText}`,
          observedAt: new Date().toISOString(),
        };
      } else {
        page = await fetchAndNormalize(related, config);
      }
    } catch (error) {
      skippedUrls.push({
        url: related,
        reason: error instanceof Error ? error.message.slice(0, 120) : "fetch failed",
      });
      continue;
    }

    fetchedUrls.push(page.sourceUrl);
    const doc = await persistNormalized(repo, page, "related");
    documents.push(doc);

    const extraClaims = claimsFromNormalizedPage(page).filter(
      (c) => !claims.some((existing) => existing.statement === c.statement),
    );
    if (extraClaims.length === 0) {
      // Dynamic stop: no new facts
      skippedUrls.push({ url: related, reason: "no_new_facts" });
      if (newFactCount > 0) break;
      continue;
    }
    newFactCount += extraClaims.length;
    for (const c of extraClaims) {
      const created = await lifecycle.registerFindingAndClaim({
        sourceKey: "public-url",
        documentType: page.pageType,
        documentTitle: page.title ?? page.sourceUrl,
        documentText: page.normalizedText,
        findingSummary: c.statement,
        claimStatement: c.statement,
        strategyId: options.strategyId,
        findingType: `observed:${c.field}`,
      });
      claims.push(created.claim);
      documents.push(created.document);
    }
  }

  const productHint =
    seed.pageType === "product" || /fanza|dmm\.co\.jp/i.test(seed.sourceDomain)
      ? {
          title: seed.productOrTopicName ?? seed.title ?? "Public catalog item",
          url: seed.canonicalUrl ?? seed.sourceUrl,
          providerKey: "fanza",
        }
      : seed.productOrTopicName
        ? {
            title: seed.productOrTopicName,
            url: seed.canonicalUrl ?? seed.sourceUrl,
            providerKey: "manual-import",
          }
        : null;

  return {
    seed,
    documents,
    claims,
    fetchedUrls,
    skippedUrls,
    productHint,
  };
}

async function fetchAndNormalize(url: string, config: AppConfig): Promise<NormalizedPublicPage> {
  try {
    const fetched = await safeFetchText(url, {
      timeoutMs: config.researchFetchTimeoutMs ?? 15_000,
      maxBytes: config.researchFetchMaxBytes ?? 512_000,
    });
    return normalizePublicHtml({
      html: fetched.text,
      sourceUrl: url,
      finalUrl: fetched.finalUrl,
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError || error instanceof SafeFetchError) throw error;
    throw new SafeFetchError(
      "FETCH_FAILED",
      error instanceof Error ? error.message.slice(0, 200) : "fetch failed",
    );
  }
}

async function persistNormalized(
  repo: LifecycleRepository,
  page: NormalizedPublicPage,
  role: "seed" | "related",
): Promise<SourceDocument> {
  return repo.createSourceDocument({
    sourceKey: "public-url",
    externalId: hashNormalizedContent(page.sourceUrl).slice(0, 24),
    url: page.sourceUrl,
    title: page.title,
    documentType: page.pageType,
    contentHash: hashNormalizedContent(page.normalizedText),
    normalizedText: page.normalizedText,
    freshnessScore: 0.8,
    robotsAllowed: true,
    metadata: {
      role,
      canonicalUrl: page.canonicalUrl,
      sourceDomain: page.sourceDomain,
      pageType: page.pageType,
      publicDescriptionSummary: page.publicDescriptionSummary,
      performerOrCreator: page.performerOrCreator,
      makerOrPublisher: page.makerOrPublisher,
      series: page.series,
      genre: page.genre,
      releaseInformation: page.releaseInformation,
      publiclyConfirmedPrice: page.publiclyConfirmedPrice,
      availability: page.availability,
      imageReferences: page.imageReferences,
      observedAt: page.observedAt,
      // Explicitly do not store raw HTML
      rawHtmlStored: false,
    },
  });
}
