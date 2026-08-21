import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import {
  MockAffiliateProvider,
  MockLLMProvider,
  MockPublisher,
  NoopNotificationAdapter,
} from "../adapters/index.js";
import { ContentLifecycleService } from "./lifecycle-service.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const repo = new LifecycleRepository(database.prisma);

async function cleanupLifecycleTables(): Promise<void> {
  await database.prisma.linkReplacementEvent.deleteMany();
  await database.prisma.productLinkUsage.deleteMany();
  await database.prisma.publicationRecord.deleteMany();
  await database.prisma.publicationTarget.deleteMany();
  await database.prisma.revisionAction.deleteMany();
  await database.prisma.qualityReviewRecord.deleteMany();
  await database.prisma.policyEvaluation.deleteMany();
  await database.prisma.contentVersionClaim.deleteMany();
  await database.prisma.claimSource.deleteMany();
  await database.prisma.claim.deleteMany();
  await database.prisma.contentVersion.deleteMany();
  await database.prisma.content.deleteMany();
  await database.prisma.contentStrategy.deleteMany();
  await database.prisma.topicCandidate.deleteMany();
  await database.prisma.researchFinding.deleteMany();
  await database.prisma.sourceDocument.deleteMany();
  await database.prisma.productLink.deleteMany();
  await database.prisma.productSnapshot.deleteMany();
  await database.prisma.affiliateProduct.deleteMany();
  await database.prisma.costRecord.deleteMany();
  await database.prisma.modelRun.deleteMany();
  await database.prisma.operatorJob.deleteMany();
  await database.prisma.policyRule.deleteMany();
  await database.prisma.budgetSetting.deleteMany();
}

async function seedPolicies(): Promise<void> {
  await repo.createPolicyRule({
    policyType: "adult",
    scope: "content",
    ruleIdentifier: "adult-flag-required",
    severity: "BLOCKING",
    condition: { check: "adultFlag", requireAdultFlag: true },
    resultOnMatch: "BLOCKED",
    message: "Adult catalog content requires adultFlag=true",
  });
  await repo.createPolicyRule({
    policyType: "disclosure",
    scope: "content",
    ruleIdentifier: "affiliate-disclosure-required",
    severity: "WARNING",
    condition: { check: "disclosure" },
    resultOnMatch: "WARNING",
    message: "Affiliate disclosure should be present",
  });
  await repo.createPolicyRule({
    policyType: "language",
    scope: "content",
    ruleIdentifier: "primary-language-ja",
    severity: "WARNING",
    condition: { check: "language", expected: "ja" },
    resultOnMatch: "WARNING",
    message: "Primary language should be Japanese (ja)",
  });
  await repo.createPolicyRule({
    policyType: "adult",
    scope: "content",
    ruleIdentifier: "no-minor-keywords",
    severity: "BLOCKING",
    condition: { check: "noMinorKeywords" },
    resultOnMatch: "BLOCKED",
    message: "Title/body must not contain minor-related keywords",
  });
}

describe("content lifecycle vertical slice", () => {
  beforeAll(async () => {
    await database.connect();
  });

  afterAll(async () => {
    await database.disconnect();
  });

  beforeEach(async () => {
    await cleanupLifecycleTables();
    await seedPolicies();
  });

  it("runs full vertical slice to PUBLISHED with model runs, costs, and jobs", async () => {
    const service = new ContentLifecycleService({
      repo,
      affiliate: new MockAffiliateProvider(),
      llm: new MockLLMProvider(),
      publishers: {
        BLOGGER: new MockPublisher("BLOGGER"),
        X: new MockPublisher("X"),
      },
      notifications: new NoopNotificationAdapter(),
      linkPolicy: {
        preferredAffiliateProvider: "fanza",
        futureAspProviders: ["mock-affiliate"],
      },
    });

    const summary = await service.runVerticalSlice();

    expect(summary.published.status).toBe("PUBLISHED");
    expect(summary.published.publishedExternalId).toBeTruthy();
    expect(summary.published.publishedUrl).toContain("example.invalid");
    expect(summary.policy.overall).not.toBe("BLOCKED");
    expect(summary.products.length).toBeGreaterThanOrEqual(1);
    expect(summary.version.title).toContain("Sample Catalog Item");

    const meta = summary.publicationTarget.platformMetadata as Record<string, unknown>;
    const selected = meta.selectedLink as Record<string, unknown>;
    expect(selected.preferredAffiliateProvider).toBe("fanza");
    expect(selected.currentLinkType).toBe("AFFILIATE");
    expect(selected.replacementStatus).toBe("REPLACED");
    const linkCandidates = meta.linkCandidates as Array<Record<string, unknown>>;
    const providerProduct = linkCandidates.find((c) => c.currentLinkType === "PROVIDER_PRODUCT");
    const official = linkCandidates.find((c) => c.currentLinkType === "OFFICIAL");
    expect(providerProduct?.replacePriority).toBe(4); // future ASP product (mock-affiliate)
    expect(official?.replacePriority).toBe(5);
    expect(Number(providerProduct?.replacePriority)).toBeLessThan(Number(official?.replacePriority));

    const storedLinks = await database.prisma.productLink.findMany({
      where: { affiliateProductId: summary.products[0]!.id },
      orderBy: { replacePriority: "asc" },
    });
    expect(storedLinks.length).toBeGreaterThanOrEqual(2);
    expect(storedLinks.every((l) => l.preferredAffiliateProvider === "fanza")).toBe(true);
    expect(
      storedLinks.some(
        (l) =>
          l.replacementStatus === "AWAITING_PROVIDER" || l.replacementStatus === "REPLACED",
      ),
    ).toBe(true);

    const usages = await database.prisma.productLinkUsage.findMany({
      where: { publicationTargetId: summary.publicationTarget.id },
    });
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages.some((u) => u.contentVersionId === summary.version.id)).toBe(true);
    const modelRuns = await database.prisma.modelRun.findMany();
    expect(modelRuns.length).toBeGreaterThanOrEqual(2);
    expect(modelRuns.every((r) => r.status === "COMPLETED")).toBe(true);

    const costs = await database.prisma.costRecord.findMany();
    expect(costs.length).toBeGreaterThanOrEqual(2);

    const jobs = await database.prisma.operatorJob.findMany();
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    expect(jobs.every((j) => j.status === "COMPLETED")).toBe(true);

    const records = await database.prisma.publicationRecord.findMany({
      where: { publicationTargetId: summary.published.id },
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("PUBLISHED");
  });
});
