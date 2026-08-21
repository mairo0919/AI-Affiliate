import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  ArticlePatternRepository,
  LifecycleRepository,
  P5Repository,
  P6Repository,
  cleanupLifecycleTablesForTests,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { ArticlePatternService } from "./article-pattern-service.js";
import { ArticlePatternSourceDiscoveryService } from "./source-discovery.js";
import { MockArticlePatternSearchAdapter } from "./source-search.js";
import { readLearningSuitability } from "./learning-suitability.js";
import type { ArticleFormatSpec } from "./types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

loadConfig({ requireDatabaseUrl: false });
const database = createDatabaseClient();
const lifecycleRepo = new LifecycleRepository(database.prisma);
const p5 = new P5Repository(database.prisma);
const p6 = new P6Repository(database.prisma);
const patterns = new ArticlePatternRepository(database.prisma);

describe("Source Discovery (mock search — no live network)", () => {
  beforeAll(async () => {
    await database.connect();
  });
  afterAll(async () => {
    await database.disconnect();
  });
  beforeEach(async () => {
    await cleanupLifecycleTablesForTests(database.prisma);
  });

  function service() {
    return new ArticlePatternService(patterns, lifecycleRepo, p5, p6, {
      minimumSampleCount: 3,
      minimumDomainDiversity: 3,
    });
  }

  it("discovers via mock search, observes with mockHtml, classifies A/B/C, never aggregates", async () => {
    const svc = service();
    const search = new MockArticlePatternSearchAdapter();
    search.setHits("q1", [
      { url: "https://review-a.example.test/a", title: "single a" },
      { url: "https://blog-b.example.test/b", title: "single b" },
      { url: "https://media-c.example.test/c", title: "single c" },
      { url: "https://twitter.com/x/status/1", title: "sns" },
      { url: "https://multi.example.test/best-10", title: "ranking path" },
    ]);
    const discovery = new ArticlePatternSourceDiscoveryService(svc, search);
    const config = loadConfig({ requireDatabaseUrl: false });
    const htmlMap = new Map([
      [
        "https://review-a.example.test/articles/a",
        loadFixture("discovery-a.html").replace("Sample Solo", "Sample Solo A"),
      ],
      [
        "https://blog-b.example.test/articles/b",
        loadFixture("discovery-a.html").replace("Sample Solo", "Sample Solo B"),
      ],
      [
        "https://media-c.example.test/articles/c",
        loadFixture("discovery-a.html").replace("Sample Solo", "Sample Solo C"),
      ],
    ]);

    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 3,
      minDomains: 3,
      maxPerDomain: 1,
      queries: ["q1"],
      mockHtmlByUrl: htmlMap,
      existingObservations: [],
      seedHits: [
        { url: "https://twitter.com/x/status/1", title: "sns" },
        {
          url: "https://review-a.example.test/articles/a",
          title: "AV 作品レビュー 感想 見どころ",
        },
        {
          url: "https://blog-b.example.test/articles/b",
          title: "AV 作品レビュー 感想 見どころ",
        },
        {
          url: "https://media-c.example.test/articles/c",
          title: "AV 作品レビュー 感想 見どころ",
        },
      ],
    });

    expect(result.aggregated).toBe(false);
    expect(result.approved).toBe(false);
    expect(result.activated).toBe(false);
    expect(result.generated).toBe(false);
    expect(result.totalEligibleACount).toBeGreaterThanOrEqual(3);
    expect(result.totalEligibleADomains.length).toBeGreaterThanOrEqual(3);
    expect(result.goalMet).toBe(true);
    expect(result.candidates.some((c) => c.reason === "sns_or_video_host")).toBe(true);
    expect(result.pipeline.searchHitCount).toBeGreaterThan(0);
    expect(result.searchDiagnostics).toEqual([]); // seedHits path skips live search

    for (const id of result.aObservationIds) {
      const row = await database.prisma.articleStructureObservation.findUnique({ where: { id } });
      expect(row).toBeTruthy();
      expect(JSON.stringify(row)).not.toMatch(/向いている人の材料として/);
      const source = await database.prisma.sourceDocument.findUnique({
        where: { id: row!.sourceDocumentId! },
      });
      expect(source?.normalizedText).toBeNull();
      expect(readLearningSuitability(row!.metadata)?.classification).toBe("A");
      expect((row!.metadata as { sourceKind?: string }).sourceKind).toBe("live_url");
      expect((row!.metadata as { discoverySource?: string }).discoverySource).toBe(
        "mock-article-pattern-search",
      );
    }
  });

  it("live NEW_RELEASE_SINGLE aggregate uses A only and keeps targetProductCount=1", async () => {
    const svc = service();
    const config = loadConfig({ requireDatabaseUrl: false });

    // A candidates (3 domains) — unique body hashes per URL
    for (const [url, label] of [
      ["https://review-a.example.test/a", "Alpha"],
      ["https://blog-b.example.test/b", "Beta"],
      ["https://media-c.example.test/c", "Gamma"],
    ] as const) {
      await svc.observeFromUrl({
        sourceUrl: url,
        confirmExternal: true,
        config,
        mockHtml: loadFixture("discovery-a.html").replace("Sample Solo", `Sample Solo ${label}`),
        discovery: { discoverySource: "test", targetFormatKey: "NEW_RELEASE_SINGLE" },
      });
    }

    // B/C multi comparison-like (should not enter A-only aggregate)
    await svc.observeFromHtml({
      sourceUrl: "https://multi.example.test/list",
      html: `<html><body><h2>1</h2><h2>2</h2><h2>3</h2><h2>4</h2><h2>5</h2><table></table>
        <p>ランキング ベスト5 まとめ おすすめ</p></body></html>`,
      sourceKind: "live_url",
      discovery: { discoverySource: "test", targetFormatKey: "NEW_RELEASE_SINGLE" },
    });

    const { aggregation, format } = await svc.aggregateAndProposeFormat({
      formatKey: "NEW_RELEASE_SINGLE",
      sourceKind: "live_url",
    });
    expect(aggregation.sampleCount).toBe(3);
    expect(aggregation.domainDiversity).toBe(3);
    expect(aggregation.observationIds).toHaveLength(3);
    expect(aggregation.proposedSpec.targetProductCount).toEqual({ min: 1, max: 1 });
    expect(format?.status).toBe("PROPOSED");
    const spec = format!.spec as ArticleFormatSpec;
    expect(spec.targetProductCount).toEqual({ min: 1, max: 1 });

    // Domain-skew alone cannot propose when A domains < min (fail-fast; no old Observation fill)
    await cleanupLifecycleTablesForTests(database.prisma);
    const svc2 = service();
    for (let i = 0; i < 3; i++) {
      await svc2.observeFromUrl({
        sourceUrl: `https://only-one.example.test/a${i}`,
        confirmExternal: true,
        config,
        mockHtml: loadFixture("discovery-a.html").replace("Sample Solo", `Sample Solo D${i}`),
        discovery: { discoverySource: "test", targetFormatKey: "NEW_RELEASE_SINGLE" },
      });
    }
    await expect(
      svc2.aggregateAndProposeFormat({
        formatKey: "NEW_RELEASE_SINGLE",
        sourceKind: "live_url",
      }),
    ).rejects.toMatchObject({ code: "pattern_validation_failed" });
  });

  it("surfaces search_challenge emptyBecause when adapter returns challenge diagnostics", async () => {
    const svc = service();
    const search: import("./source-search.js").ArticlePatternSearchAdapter = {
      providerKey: "fake-ddg",
      async search() {
        return [];
      },
      async searchWithDiagnostics({ query }) {
        return {
          hits: [],
          diagnostic: {
            query,
            provider: "fake-ddg",
            fetched: true,
            status: 200,
            finalUrl: "https://html.duckduckgo.com/html/?q=x",
            contentType: "text/html",
            bytes: 14000,
            parsedHitCount: 0,
            challengeDetected: true,
            challengeKind: "anomaly_modal",
            errorCode: "search_challenge",
            errorMessage: "DuckDuckGo returned bot/anomaly challenge page (no SERP links)",
          },
        };
      },
    };
    const discovery = new ArticlePatternSourceDiscoveryService(svc, search);
    const config = loadConfig({ requireDatabaseUrl: false });
    const result = await discovery.discoverForNewReleaseSingle({
      config,
      confirmExternal: true,
      targetA: 5,
      minDomains: 3,
      queries: ["q-challenge"],
    });
    expect(result.candidates).toEqual([]);
    expect(result.pipeline.searchHitCount).toBe(0);
    expect(result.pipeline.emptyBecause).toBe("search_challenge_no_serp_links");
    expect(result.searchDiagnostics[0]?.challengeDetected).toBe(true);
    expect(result.aggregated).toBe(false);
  });

  it("classifyObservations updates metadata without body", async () => {
    const svc = service();
    const config = loadConfig({ requireDatabaseUrl: false });
    const obs = await svc.observeFromUrl({
      sourceUrl: "https://review-a.example.test/reclass",
      confirmExternal: true,
      config,
      mockHtml: loadFixture("single-a.html"),
    });
    // Strip suitability then reclassify
    await patterns.updateObservationMetadata(obs.id, {
      sourceKind: "live_url",
      storesFullBody: false,
    });
    const classified = await svc.classifyObservations({
      sourceKind: "live_url",
      formatKey: "NEW_RELEASE_SINGLE",
    });
    expect(classified.items.length).toBeGreaterThanOrEqual(1);
    expect(classified.summary.latestObservationCount).toBeGreaterThanOrEqual(1);
    const again = await database.prisma.articleStructureObservation.findUnique({
      where: { id: obs.id },
    });
    expect(readLearningSuitability(again!.metadata)?.classification).toMatch(/A|B|C/);
    expect(JSON.stringify(again)).not.toMatch(/向いている人の材料として/);
  });
});
