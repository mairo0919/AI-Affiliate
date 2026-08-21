import type { AppConfig } from "@ai-affiliate/config";
import type { ArticleStructureObservation } from "@ai-affiliate/database";
import { safeFetchText, SafeFetchError, SsrfBlockedError } from "@ai-affiliate/shared";
import { ArticlePatternError, ArticlePatternService } from "./article-pattern-service.js";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import {
  classifyAndPartitionHits,
  tallyClassifiedRejects,
  type ClassifiedDiscoveryHit,
} from "./discovery-classify.js";
import { listNewReleaseSingleQueries } from "./discovery-query-strategy.js";
import { extractIndividualArticleLinksFromSeedHtml } from "./discovery-seed-links.js";
import {
  evaluateSingleArticleLearningSuitability,
  readLearningSuitability,
} from "./learning-suitability.js";
import { prepareObservationsForLearning } from "./observation-dedupe.js";
import {
  qualifyCandidateUrl,
  type ArticlePatternSearchAdapter,
  type ArticlePatternSearchDiagnostic,
  type ArticlePatternSearchHit,
} from "./source-search.js";

export type DiscoveryCandidateResult = {
  url: string;
  domain: string;
  status: "observed" | "skipped" | "failed";
  reason?: string;
  observationId?: string;
  classification?: "A" | "B" | "C";
  score?: number;
  hitScore?: number;
  searchRound?: number;
  searchFamily?: string;
  /** article_serp | seed | drilldown */
  sourcePath?: "article_serp" | "discovery_seed" | "drilldown";
};

export type SourceDiscoveryResult = {
  targetFormatKey: string;
  targetA: number;
  minDomains: number;
  /** @deprecated Prefer newACount / totalEligibleACount */
  aCount: number;
  /** @deprecated Prefer newADomains / totalEligibleADomains */
  aDomains: string[];
  newACount: number;
  newADomains: string[];
  totalEligibleACount: number;
  totalEligibleADomains: string[];
  /** Same as totalEligibleA* — naming for Aggregate/classify alignment. */
  currentAnalysisEligibleACount: number;
  currentAnalysisEligibleADomains: string[];
  /** Eligible A count/domains from DB before this run's new observes. */
  existingCurrentAnalysisEligibleACount: number;
  existingCurrentAnalysisEligibleADomains: string[];
  goalMet: boolean;
  candidates: DiscoveryCandidateResult[];
  aObservationIds: string[];
  newAObservationIds: string[];
  searchDiagnostics: ArticlePatternSearchDiagnostic[];
  pipeline: {
    searchHitCount: number;
    qualifiedHitCount: number;
    skippedQualifyCount: number;
    hardRejectedHitCount: number;
    existingObservationUrlSkipped: number;
    duplicateContentHashSkipped: number;
    rootOrShallowPathRejected: number;
    offTopicHostRejected: number;
    listingOrRankingRejected: number;
    observedCount: number;
    failedObserveCount: number;
    duplicateUrlSkipped: number;
    searchRequestCount: number;
    searchRoundsCompleted: number;
    maxSearchRequests: number;
    estimatedSearchCostYen: number;
    seedAcceptedCount: number;
    seedRejectedCount: number;
    seedFetchCount: number;
    drilldownCandidateCount: number;
    drilldownFetchCount: number;
    individualArticleObservedCount: number;
    maxSeeds: number;
    maxLinksPerSeed: number;
    maxDrilldownFetches: number;
    stopReason: string | null;
    emptyBecause: string | null;
  };
  strategy: {
    roundsPlanned: number;
    familiesUsed: string[];
  };
  aggregated: false;
  approved: false;
  activated: false;
  generated: false;
};

type EligibleA = {
  id: string;
  domain: string;
  canonicalUrl: string;
};

function collectEligibleA(
  observations: ArticleStructureObservation[],
): EligibleA[] {
  // Same SSOT order as Aggregate (live NEW_RELEASE_SINGLE):
  // live_url → canonical latest → contentHash → current analysis versions → suitability=A
  const prepared = prepareObservationsForLearning(observations, {
    suitabilityAOnly: true,
    targetFormatKey: "NEW_RELEASE_SINGLE",
    sourceKind: "live_url",
    requireCurrentAnalysisVersions: true,
  });
  return prepared.selected.map((o) => ({
    id: o.id,
    domain: o.sourceDomain,
    canonicalUrl: canonicalizeArticlePatternUrl(o.sourceUrl) ?? o.sourceUrl,
  }));
}

/** Exported for unit tests — Discovery goal counting SSOT. */
export function collectEligibleAForDiscoveryGoal(
  observations: ArticleStructureObservation[],
): EligibleA[] {
  return collectEligibleA(observations);
}

function selectBoundedSeeds(
  seeds: ClassifiedDiscoveryHit[],
  maxSeeds: number,
): ClassifiedDiscoveryHit[] {
  const byDomain = new Map<string, ClassifiedDiscoveryHit>();
  for (const s of [...seeds].sort((a, b) => b.seedScore - a.seedScore)) {
    if (!byDomain.has(s.domain)) byDomain.set(s.domain, s);
  }
  return [...byDomain.values()]
    .sort((a, b) => b.seedScore - a.seedScore)
    .slice(0, Math.max(0, maxSeeds));
}

/**
 * Discover → observe → suitability classify.
 * Never aggregates / approves / activates / generates.
 * Hub pages become DISCOVERY_SEED (link discovery only), not Observations.
 */
export class ArticlePatternSourceDiscoveryService {
  constructor(
    private readonly patterns: ArticlePatternService,
    private readonly search: ArticlePatternSearchAdapter,
  ) {}

  async discoverForNewReleaseSingle(input: {
    config: AppConfig;
    confirmExternal: boolean;
    targetA?: number;
    minDomains?: number;
    maxPerDomain?: number;
    maxCandidates?: number;
    queries?: string[];
    allowedDomains?: string[];
    excludedDomains?: string[];
    mockHtmlByUrl?: Map<string, string>;
    seedHits?: ArticlePatternSearchHit[];
    /** Test: skip loading existing observations */
    existingObservations?: ArticleStructureObservation[];
  }): Promise<SourceDiscoveryResult> {
    const targetFormatKey = "NEW_RELEASE_SINGLE";
    const targetA = input.targetA ?? 5;
    const minDomains = input.minDomains ?? 3;
    const maxPerDomain = input.maxPerDomain ?? 2;
    const maxObservedUrls =
      input.maxCandidates ??
      input.config.articlePatternDiscoveryMaxObservedUrls ??
      30;
    const maxSearchRequests = input.config.articlePatternDiscoveryMaxSearchRequests ?? 12;
    const maxRounds = input.config.articlePatternDiscoveryMaxSearchRounds ?? 4;
    const maxQueries = input.config.articlePatternDiscoveryMaxQueries ?? 12;
    const yenPer1k = input.config.articlePatternDiscoveryYenPer1kSearches ?? 750;
    const maxSeeds = input.config.articlePatternDiscoveryMaxSeeds ?? 5;
    const maxLinksPerSeed = input.config.articlePatternDiscoveryMaxLinksPerSeed ?? 10;
    const maxDrilldownFetches = input.config.articlePatternDiscoveryMaxDrilldownFetches ?? 15;

    const { rounds } = listNewReleaseSingleQueries({
      maxRounds,
      maxQueries,
      overrideQueries: input.queries,
    });

    const existingRows =
      input.existingObservations ??
      (await this.patterns.listLiveObservations(200));
    let eligibleA = collectEligibleA(existingRows);
    const domainsWithA = new Set(eligibleA.map((e) => e.domain));
    const existingCurrentAnalysisEligibleACount = eligibleA.length;
    const existingCurrentAnalysisEligibleADomains = [...domainsWithA].sort();

    /** All live_url canonical URLs (A/B/C) — skip before fetch/LLM/create */
    const existingCanonicalUrls = new Set<string>();
    for (const row of existingRows) {
      const c = canonicalizeArticlePatternUrl(row.sourceUrl) ?? row.sourceUrl;
      existingCanonicalUrls.add(c);
    }

    const candidates: DiscoveryCandidateResult[] = [];
    const newAIds: string[] = [];
    const aDomainCounts = new Map<string, number>();
    for (const e of eligibleA) {
      aDomainCounts.set(e.domain, (aDomainCounts.get(e.domain) ?? 0) + 1);
    }
    /** Within-run URL set (also seeded with existing to short-circuit) */
    const seenUrlsThisRun = new Set<string>();
    const seenHashes = new Set<string>();
    for (const row of existingRows) {
      if (row.contentHash) seenHashes.add(row.contentHash);
    }
    const searchDiagnostics: ArticlePatternSearchDiagnostic[] = [];
    const familiesUsed: string[] = [];
    let skippedQualifyCount = 0;
    let hardRejectedHitCount = 0;
    let existingObservationUrlSkipped = 0;
    let duplicateContentHashSkipped = 0;
    let rootOrShallowPathRejected = 0;
    let offTopicHostRejected = 0;
    let listingOrRankingRejected = 0;
    let observedCount = 0;
    let failedObserveCount = 0;
    let searchRequestCount = 0;
    let searchRoundsCompleted = 0;
    let searchHitCount = 0;
    let stopReason: string | null = null;
    let seedAcceptedCount = 0;
    let seedRejectedCount = 0;
    let seedFetchCount = 0;
    let drilldownCandidateCount = 0;
    let drilldownFetchCount = 0;
    let individualArticleObservedCount = 0;
    const domainObserveCounts = new Map<string, number>();
    const collectedSeeds: ClassifiedDiscoveryHit[] = [];
    const seenSeedCanonicals = new Set<string>();

    const recordRejected = (
      rejected: ClassifiedDiscoveryHit[],
      meta?: { round?: number; family?: string },
    ) => {
      hardRejectedHitCount += rejected.length;
      seedRejectedCount += rejected.length;
      const tallied = tallyClassifiedRejects(rejected);
      rootOrShallowPathRejected += tallied.rootOrShallowPathRejected;
      offTopicHostRejected += tallied.offTopicHostRejected;
      listingOrRankingRejected += tallied.listingOrRankingRejected;
      for (const rej of rejected) {
        candidates.push({
          url: rej.url,
          domain: rej.domain,
          status: "skipped",
          reason: rej.rejectReason ?? "hard_rejected",
          hitScore: rej.score,
          searchRound: meta?.round,
          searchFamily: meta?.family,
          sourcePath: "article_serp",
        });
      }
    };

    const recordSeeds = (
      seeds: ClassifiedDiscoveryHit[],
      meta?: { round?: number; family?: string },
    ) => {
      for (const seed of seeds) {
        if (!seenSeedCanonicals.has(seed.canonicalUrl)) {
          seenSeedCanonicals.add(seed.canonicalUrl);
          collectedSeeds.push(seed);
          seedAcceptedCount += 1;
        }
        candidates.push({
          url: seed.url,
          domain: seed.domain,
          status: "skipped",
          reason: "discovery_seed",
          hitScore: seed.seedScore,
          searchRound: meta?.round,
          searchFamily: meta?.family,
          sourcePath: "discovery_seed",
        });
      }
    };

    const goalReached = () =>
      eligibleA.length >= targetA && new Set(eligibleA.map((e) => e.domain)).size >= minDomains;

    const observeArticle = async (
      hit: {
        url: string;
        title?: string;
        domain: string;
        canonicalUrl: string;
        score: number;
      },
      meta: {
        round: number;
        family: string;
        query: string;
        sourcePath: "article_serp" | "drilldown";
      },
    ): Promise<boolean> => {
      if (observedCount >= maxObservedUrls) {
        stopReason = "max_observed_urls";
        return false;
      }
      if (goalReached()) {
        stopReason = "goal_met";
        return false;
      }
      if (meta.sourcePath === "drilldown" && drilldownFetchCount >= maxDrilldownFetches) {
        stopReason = "max_drilldown_fetches";
        return false;
      }

      const qualified = qualifyCandidateUrl(hit.url, {
        allowedDomains: input.allowedDomains,
        excludedDomains: input.excludedDomains,
      });
      if (!qualified.ok || !qualified.domain) {
        skippedQualifyCount += 1;
        candidates.push({
          url: hit.url,
          domain: qualified.domain ?? hit.domain,
          status: "skipped",
          reason: qualified.reason ?? "unqualified",
          hitScore: hit.score,
          searchRound: meta.round,
          searchFamily: meta.family,
          sourcePath: meta.sourcePath,
        });
        return true;
      }

      if (existingCanonicalUrls.has(hit.canonicalUrl)) {
        existingObservationUrlSkipped += 1;
        candidates.push({
          url: hit.url,
          domain: qualified.domain,
          status: "skipped",
          reason: "existing_observation_url",
          hitScore: hit.score,
          searchRound: meta.round,
          searchFamily: meta.family,
          sourcePath: meta.sourcePath,
        });
        return true;
      }

      if (seenUrlsThisRun.has(hit.canonicalUrl)) {
        candidates.push({
          url: hit.url,
          domain: qualified.domain,
          status: "skipped",
          reason: "duplicate_url",
          hitScore: hit.score,
          searchRound: meta.round,
          searchFamily: meta.family,
          sourcePath: meta.sourcePath,
        });
        return true;
      }

      const domainACount = aDomainCounts.get(qualified.domain) ?? 0;
      if (domainACount >= maxPerDomain) {
        candidates.push({
          url: hit.url,
          domain: qualified.domain,
          status: "skipped",
          reason: "domain_cap",
          hitScore: hit.score,
          searchRound: meta.round,
          searchFamily: meta.family,
          sourcePath: meta.sourcePath,
        });
        return true;
      }

      const needMoreDomains =
        new Set(eligibleA.map((e) => e.domain)).size < minDomains;
      if (needMoreDomains && domainsWithA.has(qualified.domain) && hit.score < 15) {
        candidates.push({
          url: hit.url,
          domain: qualified.domain,
          status: "skipped",
          reason: "domain_diversity_deprioritized",
          hitScore: hit.score,
          searchRound: meta.round,
          searchFamily: meta.family,
          sourcePath: meta.sourcePath,
        });
        return true;
      }

      seenUrlsThisRun.add(hit.canonicalUrl);
      if (meta.sourcePath === "drilldown") {
        drilldownFetchCount += 1;
      }

      try {
        const mockHtml =
          input.mockHtmlByUrl?.get(hit.canonicalUrl) ?? input.mockHtmlByUrl?.get(hit.url);
        const observation = await this.patterns.observeFromUrl({
          sourceUrl: hit.url,
          confirmExternal: input.confirmExternal,
          config: input.config,
          title: hit.title ?? null,
          mockHtml,
          discovery: {
            discoverySource: this.search.providerKey,
            targetFormatKey,
            searchQuery: meta.query.slice(0, 120),
          },
        });

        if (seenHashes.has(observation.contentHash)) {
          duplicateContentHashSkipped += 1;
          candidates.push({
            url: hit.url,
            domain: qualified.domain,
            status: "skipped",
            reason: "duplicate_content_hash",
            observationId: observation.id,
            hitScore: hit.score,
            searchRound: meta.round,
            searchFamily: meta.family,
            sourcePath: meta.sourcePath,
          });
          return true;
        }
        seenHashes.add(observation.contentHash);

        const suitability =
          readLearningSuitability(observation.metadata) ??
          evaluateSingleArticleLearningSuitability(observation, { targetFormatKey });

        candidates.push({
          url: hit.url,
          domain: qualified.domain,
          status: "observed",
          observationId: observation.id,
          classification: suitability.classification,
          score: suitability.score,
          hitScore: hit.score,
          searchRound: meta.round,
          searchFamily: meta.family,
          sourcePath: meta.sourcePath,
        });
        observedCount += 1;
        if (meta.sourcePath === "drilldown") {
          individualArticleObservedCount += 1;
        }
        domainObserveCounts.set(
          qualified.domain,
          (domainObserveCounts.get(qualified.domain) ?? 0) + 1,
        );

        if (suitability.classification === "A") {
          newAIds.push(observation.id);
          eligibleA = [
            ...eligibleA.filter((e) => e.canonicalUrl !== hit.canonicalUrl),
            {
              id: observation.id,
              domain: qualified.domain,
              canonicalUrl: hit.canonicalUrl,
            },
          ];
          domainsWithA.add(qualified.domain);
          aDomainCounts.set(qualified.domain, (aDomainCounts.get(qualified.domain) ?? 0) + 1);
        }
      } catch (error) {
        failedObserveCount += 1;
        const reason =
          error instanceof ArticlePatternError
            ? error.code
            : error instanceof Error
              ? error.message.slice(0, 120)
              : "observe_failed";
        candidates.push({
          url: hit.url,
          domain: qualified.domain,
          status: "failed",
          reason,
          hitScore: hit.score,
          searchRound: meta.round,
          searchFamily: meta.family,
          sourcePath: meta.sourcePath,
        });
      }
      return true;
    };

    const processHitBatch = async (
      hits: Array<{ url: string; title?: string }>,
      meta: { round: number; family: string; query: string },
    ) => {
      const { articles, seeds, rejected } = classifyAndPartitionHits(hits, {
        domainsWithA,
        domainObserveCounts,
      });
      recordRejected(rejected, meta);
      recordSeeds(seeds, meta);
      for (const hit of articles) {
        const ok = await observeArticle(hit, {
          ...meta,
          sourcePath: "article_serp",
        });
        if (!ok) break;
        if (goalReached()) {
          stopReason = "goal_met";
          break;
        }
      }
    };

    const fetchSeedHtml = async (seedUrl: string, canonicalUrl: string): Promise<string | null> => {
      const mock =
        input.mockHtmlByUrl?.get(canonicalUrl) ??
        input.mockHtmlByUrl?.get(seedUrl);
      if (mock !== undefined) return mock;
      const allow =
        input.confirmExternal && input.config.researchAllowExternalRequests;
      if (!allow) return null;
      try {
        const fetched = await safeFetchText(seedUrl, {
          timeoutMs: input.config.researchFetchTimeoutMs,
          maxBytes: input.config.researchFetchMaxBytes,
        });
        return fetched.text;
      } catch (error) {
        if (error instanceof SsrfBlockedError || error instanceof SafeFetchError) {
          return null;
        }
        return null;
      }
    };

    const runDrilldown = async (meta: { round: number; family: string; query: string }) => {
      const selected = selectBoundedSeeds(collectedSeeds, maxSeeds);
      for (const seed of selected) {
        if (goalReached()) {
          stopReason = "goal_met";
          return;
        }
        if (drilldownFetchCount >= maxDrilldownFetches) {
          stopReason = "max_drilldown_fetches";
          return;
        }
        if (observedCount >= maxObservedUrls) {
          stopReason = "max_observed_urls";
          return;
        }

        seedFetchCount += 1;
        const html = await fetchSeedHtml(seed.url, seed.canonicalUrl);
        if (!html) {
          candidates.push({
            url: seed.url,
            domain: seed.domain,
            status: "skipped",
            reason: "seed_fetch_failed",
            hitScore: seed.seedScore,
            searchRound: meta.round,
            searchFamily: meta.family,
            sourcePath: "discovery_seed",
          });
          continue;
        }

        const links = extractIndividualArticleLinksFromSeedHtml({
          html,
          seedUrl: seed.url,
          limit: maxLinksPerSeed,
        });
        drilldownCandidateCount += links.length;

        for (const link of links) {
          if (goalReached()) {
            stopReason = "goal_met";
            return;
          }
          if (drilldownFetchCount >= maxDrilldownFetches) {
            stopReason = "max_drilldown_fetches";
            return;
          }
          const ok = await observeArticle(
            {
              url: link.url,
              title: link.positives.join(" "),
              domain: link.domain,
              canonicalUrl: link.canonicalUrl,
              score: link.score,
            },
            {
              round: meta.round,
              family: meta.family,
              query: meta.query,
              sourcePath: "drilldown",
            },
          );
          if (!ok) return;
        }
      }
    };

    // Auxiliary SERP-like hits (CLI --seed-urls / tests) — no Brave search API
    if (input.seedHits?.length) {
      searchHitCount += input.seedHits.length;
      await processHitBatch(
        input.seedHits.map((h) => ({ url: h.url, title: h.title })),
        { round: 0, family: "seed", query: "seed" },
      );
      if (!goalReached()) {
        await runDrilldown({ round: 0, family: "seed_drilldown", query: "seed" });
      }
      if (goalReached()) stopReason = "goal_met";
    } else {
      for (const round of rounds) {
        if (goalReached()) {
          stopReason = "goal_met";
          break;
        }
        if (searchRequestCount >= maxSearchRequests) {
          stopReason = "max_search_requests";
          break;
        }
        if (observedCount >= maxObservedUrls) {
          stopReason = "max_observed_urls";
          break;
        }

        familiesUsed.push(round.family);
        let roundHadWork = false;

        for (const query of round.queries) {
          if (goalReached()) {
            stopReason = "goal_met";
            break;
          }
          if (searchRequestCount >= maxSearchRequests) {
            stopReason = "max_search_requests";
            break;
          }
          if (observedCount >= maxObservedUrls) {
            stopReason = "max_observed_urls";
            break;
          }

          searchRequestCount += 1;
          roundHadWork = true;
          let batch: ArticlePatternSearchHit[] = [];
          if (this.search.searchWithDiagnostics) {
            const { hits, diagnostic } = await this.search.searchWithDiagnostics({
              query,
              limit: 12,
            });
            searchDiagnostics.push({ ...diagnostic, query });
            batch = hits;
          } else {
            batch = await this.search.search({ query, limit: 12 });
            searchDiagnostics.push({
              query,
              provider: this.search.providerKey,
              fetched: true,
              status: null,
              finalUrl: null,
              contentType: null,
              bytes: null,
              parsedHitCount: batch.length,
              challengeDetected: false,
              challengeKind: null,
              errorCode: null,
              errorMessage: null,
            });
          }
          searchHitCount += batch.length;

          await processHitBatch(
            batch.map((h) => ({ url: h.url, title: h.title ?? query.slice(0, 40) })),
            { round: round.round, family: round.family, query },
          );
        }

        if (roundHadWork) searchRoundsCompleted += 1;
        if (goalReached()) {
          stopReason = "goal_met";
          break;
        }
      }

      // After SERP article observes: bounded hub → article drill-down (depth 1)
      if (!goalReached() && collectedSeeds.length > 0) {
        await runDrilldown({
          round: searchRoundsCompleted,
          family: "site_drilldown",
          query: "drilldown",
        });
      }

      if (!stopReason && goalReached()) {
        stopReason = "goal_met";
      } else if (!stopReason && searchRequestCount >= maxSearchRequests) {
        stopReason = "max_search_requests";
      } else if (!stopReason && drilldownFetchCount >= maxDrilldownFetches) {
        stopReason = "max_drilldown_fetches";
      } else if (!stopReason && !goalReached()) {
        stopReason = "queries_exhausted";
      }
    }

    const totalEligibleADomains = [...new Set(eligibleA.map((e) => e.domain))];
    const newADomains = [
      ...new Set(
        candidates
          .filter((c) => c.status === "observed" && c.classification === "A")
          .map((c) => c.domain),
      ),
    ];
    const goalMet = eligibleA.length >= targetA && totalEligibleADomains.length >= minDomains;

    let emptyBecause: string | null = null;
    if (searchHitCount === 0 && !input.seedHits?.length) {
      if (searchDiagnostics.some((d) => d.errorCode === "missing_api_key")) {
        emptyBecause = "missing_search_api_key";
      } else if (searchDiagnostics.some((d) => d.challengeDetected)) {
        emptyBecause = "search_challenge_no_serp_links";
      } else if (searchDiagnostics.some((d) => d.errorCode === "external_fetch_denied")) {
        emptyBecause = "external_fetch_denied";
      } else if (
        searchDiagnostics.some((d) =>
          ["unauthorized", "forbidden", "rate_limited", "upstream_5xx", "http_error"].includes(
            d.errorCode ?? "",
          ),
        )
      ) {
        emptyBecause = "search_api_http_error";
      } else if (searchDiagnostics.some((d) => d.errorCode === "empty_results")) {
        emptyBecause = "search_api_empty_results";
      } else if (searchDiagnostics.every((d) => d.fetched && d.parsedHitCount === 0)) {
        emptyBecause = "search_parsed_zero_hits";
      } else if (searchDiagnostics.some((d) => !d.fetched)) {
        emptyBecause = "search_fetch_failed";
      } else {
        emptyBecause = "no_search_hits";
      }
    }

    const estimatedSearchCostYen = Number(
      ((searchRequestCount / 1000) * yenPer1k).toFixed(4),
    );

    return {
      targetFormatKey,
      targetA,
      minDomains,
      aCount: eligibleA.length,
      aDomains: totalEligibleADomains,
      newACount: newAIds.length,
      newADomains,
      totalEligibleACount: eligibleA.length,
      totalEligibleADomains,
      /** Alias: existing+new eligible A after current analysis filter (goal basis). */
      currentAnalysisEligibleACount: eligibleA.length,
      currentAnalysisEligibleADomains: totalEligibleADomains,
      /** Snapshot of eligible A before this Discovery run observed anything. */
      existingCurrentAnalysisEligibleACount,
      existingCurrentAnalysisEligibleADomains,
      goalMet,
      candidates,
      aObservationIds: eligibleA.map((e) => e.id),
      newAObservationIds: newAIds,
      searchDiagnostics,
      pipeline: {
        searchHitCount,
        qualifiedHitCount: Math.max(0, searchHitCount - skippedQualifyCount - hardRejectedHitCount),
        skippedQualifyCount,
        hardRejectedHitCount,
        existingObservationUrlSkipped,
        duplicateContentHashSkipped,
        rootOrShallowPathRejected,
        offTopicHostRejected,
        listingOrRankingRejected,
        observedCount,
        failedObserveCount,
        duplicateUrlSkipped: candidates.filter((c) => c.reason === "duplicate_url").length,
        searchRequestCount,
        searchRoundsCompleted,
        maxSearchRequests,
        estimatedSearchCostYen,
        seedAcceptedCount,
        seedRejectedCount,
        seedFetchCount,
        drilldownCandidateCount,
        drilldownFetchCount,
        individualArticleObservedCount,
        maxSeeds,
        maxLinksPerSeed,
        maxDrilldownFetches,
        stopReason,
        emptyBecause,
      },
      strategy: {
        roundsPlanned: rounds.length,
        familiesUsed: [...new Set(familiesUsed)],
      },
      aggregated: false,
      approved: false,
      activated: false,
      generated: false,
    };
  }
}

export type { ArticleStructureObservation };
