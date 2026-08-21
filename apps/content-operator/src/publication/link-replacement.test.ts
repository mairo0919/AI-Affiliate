import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import { MockPublisher } from "../adapters/index.js";
import { LinkReplacementService } from "./link-replacement-service.js";
import { containsInternalLinkMarkers } from "./public-body-sanitizer.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const repo = new LifecycleRepository(database.prisma);

describe("LinkReplacementService published flow", () => {
  beforeAll(async () => {
    await database.connect();
  });

  afterAll(async () => {
    await database.disconnect();
  });

  beforeEach(async () => {
    await database.prisma.linkReplacementEvent.deleteMany();
    await database.prisma.productLinkUsage.deleteMany();
    await database.prisma.publicationRecord.deleteMany();
    await database.prisma.publicationTarget.deleteMany();
    await database.prisma.contentVersion.deleteMany();
    await database.prisma.content.deleteMany();
    await database.prisma.productLink.deleteMany();
    await database.prisma.affiliateProduct.deleteMany();
    await database.prisma.affiliateProviderRegistry.upsert({
      where: { providerKey: "fanza" },
      create: {
        providerKey: "fanza",
        displayName: "FANZA (DMM Adult)",
        capabilities: { apiSearch: true },
        metadata: { family: "dmm", site: "fanza", adultCatalog: true },
      },
      update: {},
    });
  });

  it("proposes, approves, creates new version/target, and records history without mutating source body", async () => {
    const product = await repo.upsertAffiliateProduct({
      providerKey: "fanza",
      externalProductId: "repl-1",
      title: "Sample Catalog Item Replace",
      url: "https://example.invalid/fanza/repl-1",
      affiliateUrl: null,
      availability: "AVAILABLE",
      normalized: { title: "Sample Catalog Item Replace" },
      metadata: { productMatchKey: "fanza:repl-1" },
    });

    const [productLink] = await repo.replaceProductLinksForProduct(product.id, [
      {
        affiliateProductId: product.id,
        productMatchKey: "fanza:repl-1",
        url: "https://example.invalid/fanza/repl-1",
        preferredAffiliateProvider: "fanza",
        currentLinkProvider: "fanza",
        currentLinkType: "PROVIDER_PRODUCT",
        replacePriority: 2,
        availability: "AVAILABLE",
        isSelected: true,
        replacementStatus: "AWAITING_PROVIDER",
        matchReason: "awaiting-affiliate-api",
      },
    ]);

    const content = await repo.createContent({
      status: "APPROVED",
      primaryLanguage: "ja",
      contentPurpose: "article",
    });
    const sourceBody = [
      "本記事はサンプルです。",
      "詳細は https://example.invalid/fanza/repl-1 を参照。",
      "アフィリエイトリンクを含む場合があります。",
    ].join("\n");
    const sourceVersion = await repo.createContentVersion({
      contentId: content.id,
      versionNumber: 1,
      title: "Replace test",
      body: sourceBody,
      status: "APPROVED",
    });
    const sourceTarget = await repo.createPublicationTarget({
      contentId: content.id,
      contentVersionId: sourceVersion.id,
      platform: "BLOGGER",
      status: "PUBLISHED",
      publishedExternalId: "mock-blogger-existing",
      publishedUrl: "https://example.invalid/blogger/posts/mock-blogger-existing",
      platformMetadata: { selectedProductLinkId: productLink!.id },
    });
    await repo.createPublicationRecord({
      publicationTargetId: sourceTarget.id,
      platform: "BLOGGER",
      status: "PUBLISHED",
      externalId: "mock-blogger-existing",
      url: sourceTarget.publishedUrl,
    });

    const service = new LinkReplacementService(repo);
    const proposed = await service.propose({
      productLinkId: productLink!.id,
      contentId: content.id,
      sourceContentVersionId: sourceVersion.id,
      sourcePublicationTargetId: sourceTarget.id,
      previousUrl: "https://example.invalid/fanza/repl-1",
      nextUrl: "https://example.invalid/aff/repl-1",
      changeReason: "affiliate-api-available",
      matchedProvider: "fanza",
      matchConfidence: 0.99,
      candidateAffiliateProductId: product.id,
    });
    expect(proposed.status).toBe("AWAITING_APPROVAL");
    expect(proposed.previousUrl).toBe("https://example.invalid/fanza/repl-1");
    expect(proposed.nextUrl).toBe("https://example.invalid/aff/repl-1");

    await service.approve(proposed.id, "reviewer-1");
    const applied = await service.apply({
      eventId: proposed.id,
      approvedBy: "reviewer-1",
      publishers: { BLOGGER: new MockPublisher("BLOGGER") },
    });

    const sourceAfter = await repo.findContentVersion(sourceVersion.id);
    expect(sourceAfter?.body).toBe(sourceBody);

    expect(applied.newVersion.body).toContain("https://example.invalid/aff/repl-1");
    expect(applied.newVersion.body).not.toContain("https://example.invalid/fanza/repl-1");
    expect(containsInternalLinkMarkers(applied.newVersion.body)).toBe(false);
    expect(applied.newVersion.parentVersionId).toBe(sourceVersion.id);
    expect(applied.event.status).toBe("APPLIED");
    expect(applied.event.approvedBy).toBe("reviewer-1");
    expect(applied.event.replacedAt).toBeTruthy();

    const records = await database.prisma.publicationRecord.findMany({
      where: { publicationTargetId: applied.newTarget.id },
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("UPDATED");
    const summary = records[0]?.responseSummary as Record<string, unknown>;
    expect(summary.previousUrl).toBe("https://example.invalid/fanza/repl-1");
    expect(summary.nextUrl).toBe("https://example.invalid/aff/repl-1");
    expect(summary.approvedBy).toBe("reviewer-1");

    const usages = await database.prisma.productLinkUsage.findMany({
      where: { productLinkId: productLink!.id },
    });
    expect(usages.some((u) => u.contentVersionId === applied.newVersion.id)).toBe(true);
    expect(usages.some((u) => u.publicationRecordId === records[0]?.id)).toBe(true);
  });
});
