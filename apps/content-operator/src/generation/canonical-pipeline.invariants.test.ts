/**
 * Canonical pipeline invariants — static + unit guards against route divergence.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContentReviewError, ContentReviewService } from "../admin/content-review-service.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith("tmp")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(p, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("canonical pipeline invariants — source structure", () => {
  it("1+2: ItemList alone cannot feed Writer; enrichment yields NEEDS_ENRICHMENT", () => {
    const enrich = readSrc("stock/ensure-official-enrichment.ts");
    expect(enrich).not.toMatch(/ITEMLIST_SYNTHESIZED/);
    expect(enrich).not.toMatch(/synthesizeItemListDescription/);
    expect(enrich).toMatch(/status:\s*"NEEDS_ENRICHMENT"/);
    expect(enrich).toMatch(/ItemList metadata alone is never enough/);

    const canonical = readSrc("generation/canonical-article-pipeline.ts");
    expect(canonical).toMatch(/NEEDS_ENRICHMENT/);
    expect(canonical).toMatch(/claimStatementsFromPageEvidence/);
    expect(canonical).not.toMatch(/公開カタログ上で確認できる/);
  });

  it("3+4: stock uses canonical Review (no heuristic-only APPROVED)", () => {
    const stock = readSrc("stock/stock-generation-worker.ts");
    expect(stock).toMatch(/runCanonicalArticlePipeline/);
    expect(stock).toMatch(/runQualityReviews|canonical-article-pipeline/);
    expect(stock).not.toMatch(/bootstrapLifecycleForResearchItem/);
    expect(stock).not.toMatch(/公開カタログ上で確認できる/);
    // Must not approve without going through ContentReviewService via pipeline.
    expect(stock).not.toMatch(
      /updateContentVersionStatus\(\s*[^,]+,\s*["']APPROVED["']\s*\)/,
    );
  });

  it("4: daily-ops uses canonical Review", () => {
    const daily = readSrc("daily-ops/live-orchestrator.ts");
    expect(daily).toMatch(/runCanonicalArticlePipeline/);
    expect(daily).not.toMatch(/bootstrapLifecycleForResearchItem/);
    expect(daily).not.toMatch(/公開カタログ上で確認できる/);
    expect(daily).toMatch(/ContentReviewService/);
    expect(daily).toMatch(/decision:\s*"approve"/);
  });

  it("7-9+11: Mock/FANZA share Planner/Writer/Review via generateBloggerArticle + runQualityReviews", () => {
    const canonical = readSrc("generation/canonical-article-pipeline.ts");
    expect(canonical).toMatch(/generateBloggerArticle/);
    expect(canonical).toMatch(/runQualityReviews/);
    expect(canonical).not.toMatch(/fanza-only|FANZA_WRITER|stockWriter/i);
  });

  it("10: no FANZA-dedicated Writer entry point", () => {
    const files = walkTsFiles(srcRoot);
    for (const file of files) {
      const rel = file.slice(srcRoot.length + 1);
      if (rel.includes("__tests__") || rel.endsWith(".test.ts")) continue;
      const src = readFileSync(file, "utf8");
      expect(src, rel).not.toMatch(/generateFanzaArticle|fanzaGenerateBlogger|FANZA_WRITER/i);
    }
  });

  it("11: no stock-dedicated Writer entry (must call canonical orchestration)", () => {
    const stock = readSrc("stock/stock-generation-worker.ts");
    expect(stock).toMatch(/runCanonicalArticlePipeline/);
    // Direct generateBloggerArticle from stock worker is forbidden.
    expect(stock).not.toMatch(/generation\.generateBloggerArticle/);
  });

  it("12: no repair TITLE_ONLY / mechanical low-quality generation route", () => {
    const repair = readSrc("stock/repair-api-article-quality.ts");
    expect(repair).toMatch(/runCanonicalArticlePipeline/);
    expect(repair).not.toMatch(/API_QUALITY_REPAIR_TITLE_ONLY/);
    expect(repair).not.toMatch(/buildEvidenceEditorialTitle/);
    expect(repair).not.toMatch(/公開カタログ上で確認できる/);
    const guard = readSrc("stock/repair-quality-guard.ts");
    expect(guard).not.toMatch(/export function buildEvidenceEditorialTitle/);
  });

  it("13: Provider adapters do not call Writer/Review/Approve", () => {
    const providerFiles = walkTsFiles(join(srcRoot, "adapters/affiliate")).concat(
      walkTsFiles(join(srcRoot, "providers")),
    );
    for (const file of providerFiles) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/generateBloggerArticle/);
      expect(src).not.toMatch(/runQualityReviews/);
      expect(src).not.toMatch(/runCanonicalArticlePipeline/);
      expect(src).not.toMatch(/ContentReviewService/);
    }
  });
});

describe("canonical pipeline invariants — approve gates", () => {
  it("5+6: Review未実行 and Review FAIL cannot APPROVE", async () => {
    const version = {
      id: "cv1",
      contentId: "c1",
      status: "REVIEWING",
      versionNumber: 1,
    };
    const repo = {
      findContentVersion: async () => version,
      findLatestContentVersion: async () => version,
      inspectContentLifecycle: async () => ({
        versions: [{ id: "cv1", reviews: [], versionClaims: [] }],
      }),
      updateContentVersionStatus: async () => {
        throw new Error("should not approve");
      },
    };
    const p6 = { createAuditEvent: async () => ({}) };
    const svc = new ContentReviewService(repo as never, p6 as never);

    await expect(
      svc.decide({
        contentVersionId: "cv1",
        decision: "approve",
        actor: "test",
        approvalPolicy: "auto",
      }),
    ).rejects.toBeInstanceOf(ContentReviewError);

    const repoFail = {
      ...repo,
      inspectContentLifecycle: async () => ({
        versions: [
          {
            id: "cv1",
            reviews: [{ result: "FAILED", reviewType: "claim" }],
            versionClaims: [],
          },
        ],
      }),
    };
    const svcFail = new ContentReviewService(repoFail as never, p6 as never);
    await expect(
      svcFail.decide({
        contentVersionId: "cv1",
        decision: "approve",
        actor: "test",
        approvalPolicy: "auto",
      }),
    ).rejects.toMatchObject({ code: "review_failed" });
  });

  it("14: ContentReviewService requires executed PASS/WARNING reviews", async () => {
    const version = {
      id: "cv1",
      contentId: "c1",
      status: "REVIEWING",
      versionNumber: 1,
    };
    let approved = false;
    const repo = {
      findContentVersion: async () => version,
      findLatestContentVersion: async () => version,
      inspectContentLifecycle: async () => ({
        versions: [
          {
            id: "cv1",
            reviews: [{ result: "PASSED", reviewType: "claim" }],
            versionClaims: [],
          },
        ],
      }),
      updateContentVersionStatus: async () => {
        approved = true;
        return { ...version, status: "APPROVED" };
      },
    };
    const p6 = { createAuditEvent: async () => ({}) };
    const svc = new ContentReviewService(repo as never, p6 as never);
    await svc.decide({
      contentVersionId: "cv1",
      decision: "approve",
      actor: "test",
      approvalPolicy: "auto",
    });
    expect(approved).toBe(true);
  });
});

describe("canonical orchestration SSOT exports", () => {
  it("exports runCanonicalArticlePipeline as sole production orchestration", async () => {
    const mod = await import("../generation/canonical-article-pipeline.js");
    expect(typeof mod.runCanonicalArticlePipeline).toBe("function");
    expect(typeof mod.bootstrapCanonicalClaims).toBe("function");
  });
});
