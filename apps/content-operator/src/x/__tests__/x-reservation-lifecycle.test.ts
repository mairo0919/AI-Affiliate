/**
 * Reservation lifecycle regression (A–G) against DB + PrePublishGuard.
 * Does not touch Social Writer / WP / SEO paths.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  ResearchRepository,
  AnalysisRepository,
  XOpsRepository,
  XPublicationRepository,
  computeXProductReservationExpiresAt,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import type { CollectedResearchItem, CollectionResult } from "@ai-affiliate/shared";
import { AnalysisEngine } from "../../analysis/analysis-engine.js";
import { ContentEngine } from "../../content/content-engine.js";
import { MockContentGenerationProvider } from "../../content/index.js";
import { XPublicationService } from "../publication-service.js";
import { MockXPublishingProvider } from "../providers/mock-provider.js";
import { XPrePublishGuard } from "../ops/pre-publish-guard.js";
import { buildProductKey, extractProviderProductId } from "../ops/product-key.js";

const database = createDatabaseClient();
const logger = createLogger({ name: "x-reservation-lifecycle-test" });
const research = new ResearchRepository(database.prisma);
const analysis = new AnalysisRepository(database.prisma);
const contents = new ContentRepository(database.prisma);
const publications = new XPublicationRepository(database.prisma);
const ops = new XOpsRepository(database.prisma);
const base = loadConfig({ requireDatabaseUrl: false });
const PREFIX = "xresv-lc-";

function safeConfig(overrides: Partial<typeof base> = {}) {
  return {
    ...base,
    xGlobalKillSwitch: false,
    xReleaseMode: "FULL" as const,
    xReleaseDailyPostLimit: 100,
    xReleaseHourlyPostLimit: 100,
    xReleaseAllowedStartHourJst: 0,
    xReleaseAllowedEndHourJst: 23,
    xReleaseAllowedStrategies: [
      "CONTROL",
      "SINGLE_POST",
      "ROOT_WITH_REPLY",
      "RELATED_POST_LINK",
    ],
    xProductCooldownHours: 168,
    xProductReservationTtlMinutes: 30,
    xProductReservationPublishGraceMinutes: 180,
    ...overrides,
  };
}

function item(
  overrides: Partial<CollectedResearchItem> & { externalId: string },
): CollectedResearchItem {
  const collectedAt = overrides.collectedAt ?? new Date("2026-07-01T00:00:00.000Z");
  return {
    sourceName: "FANZA",
    sourceType: "FANZA",
    sourceBaseUrl: "https://www.dmm.co.jp",
    externalId: overrides.externalId,
    itemType: "PRODUCT",
    title: overrides.title ?? `Title ${overrides.externalId}`,
    description: null,
    url: overrides.url ?? `https://al.fanza.co.jp/?lurl=${overrides.externalId}`,
    publishedAt: overrides.publishedAt ?? collectedAt,
    collectedAt,
    rawData: { id: overrides.externalId },
    metrics: [
      { metricType: "rankingPosition", value: 1, recordedAt: collectedAt },
      { metricType: "reviewAverage", value: 4.5, recordedAt: collectedAt },
      { metricType: "reviewCount", value: 100, recordedAt: collectedAt },
      { metricType: "price", value: 1980, recordedAt: collectedAt },
    ],
    tags: [
      { name: "女優X", type: "actress" },
      { name: "ジャンルX", type: "genre" },
    ],
    images: [
      {
        imageType: "package",
        sourceUrl: `https://pics.example/${overrides.externalId}.jpg`,
        usageStatus: "ALLOWED",
      },
    ],
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await database.prisma.xOperationalAuditLog.deleteMany();
  await database.prisma.xProductPublicationReservation.deleteMany();
  await database.prisma.xProductPublicationState.deleteMany();
  await database.prisma.xRuntimeControl.deleteMany();
  await database.prisma.xPublicationLock.deleteMany();
  await database.prisma.xPublicationPost.deleteMany();
  await database.prisma.xPublication.deleteMany();
  await database.prisma.contentReview.deleteMany();
  await database.prisma.contentValidationIssue.deleteMany();
  await database.prisma.generatedContent.deleteMany();
  await database.prisma.contentGenerationRun.deleteMany();
  await database.prisma.contentCandidate.deleteMany();
  await database.prisma.productAnalysis.deleteMany();
  await database.prisma.analysisRun.deleteMany();
  await database.prisma.researchMetric.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.researchItemTag.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.researchImage.deleteMany({
    where: { researchItem: { externalId: { startsWith: PREFIX } } },
  });
  await database.prisma.researchItem.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
}

async function seedReadyContent(externalId: string): Promise<string> {
  await research.saveCollection({
    providerName: "mock",
    collectedAt: new Date(),
    items: [item({ externalId, title: "reservation lifecycle 商品" })],
  } as CollectionResult);
  await new AnalysisEngine({
    logger,
    research,
    analysis,
    config: safeConfig(),
  }).run({ source: "mock", limit: 20, candidateLimit: 5, force: true });
  const candidates = await analysis.listContentCandidates({ limit: 20 });
  const itemRow = await database.prisma.researchItem.findFirst({ where: { externalId } });
  expect(itemRow).toBeTruthy();
  const candidate = candidates.find((c) => c.researchItemId === itemRow!.id);
  expect(candidate).toBeTruthy();
  const engine = new ContentEngine({
    logger,
    config: safeConfig(),
    contents,
    provider: new MockContentGenerationProvider(),
  });
  const generated = await engine.generate({
    candidateId: candidate.id,
    contentType: "X_POST",
    force: true,
    skipExistingSameType: false,
  });
  let contentId = generated.items[0]!.contentId!;
  let row = await contents.findGeneratedContentById(contentId);
  for (let i = 0; i < 3 && row && row.status !== "REVIEW_REQUIRED"; i += 1) {
    if (row.status === "VALIDATION_FAILED" || row.status === "DRAFT") {
      const regen = await engine.regenerate({
        contentId: row.id,
        instruction: `ready-${externalId}-${i}`,
      });
      contentId = regen.items[0]!.contentId!;
      row = await contents.findGeneratedContentById(contentId);
    } else break;
  }
  if (row && row.status !== "REVIEW_REQUIRED" && row.status !== "APPROVED") {
    await database.prisma.generatedContent.update({
      where: { id: row.id },
      data: { status: "REVIEW_REQUIRED" },
    });
    row = await contents.findGeneratedContentById(row.id);
  }
  if (row?.status === "REVIEW_REQUIRED") await contents.approveContent(row.id, "admin");
  const approved = await contents.findGeneratedContentById(row!.id);
  if (approved?.status === "APPROVED") await contents.markReadyToPublish(approved.id);
  const ready = await contents.findGeneratedContentById(row!.id);
  expect(ready?.status).toBe("READY_TO_PUBLISH");
  return ready!.id;
}

function svc(now: () => Date) {
  return new XPublicationService({
    logger,
    config: safeConfig(),
    contents,
    publications,
    ops,
    provider: new MockXPublishingProvider({ username: "mockuser" }),
    now,
  });
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await database.prisma.$disconnect();
});

beforeEach(async () => {
  await cleanup();
});

describe("reservation lifecycle create + expire (A–G)", () => {
  it("A/B/G: STANDARD and EXTRA scheduled creates keep expiresAt > scheduledAt", async () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const standardAt = new Date("2026-09-16T06:00:00.000Z"); // 15:00 JST STANDARD
    const extraAt = new Date("2026-09-16T09:00:00.000Z"); // EXTRA later same day
    const lateAt = new Date("2026-09-17T12:00:00.000Z"); // 21:00 JST

    for (const [label, scheduledAt, ext] of [
      ["STANDARD-0916-15", standardAt, "a"],
      ["EXTRA-0916", extraAt, "b"],
      ["STANDARD-0917-21", lateAt, "c"],
    ] as const) {
      const contentId = await seedReadyContent(`${PREFIX}${ext}`);
      const pub = await svc(() => createdAt).createFromContent({
        contentId,
        strategy: "SINGLE_POST",
        scheduledAt,
        cooldownOverrideReason: `test-${label}`,
        actorId: "test",
      });
      const reservation = await ops.findReservationByPublication(pub.id);
      expect(reservation?.status).toBe("ACTIVE");
      expect(reservation!.expiresAt.getTime()).toBeGreaterThan(scheduledAt.getTime());
      expect(pub.status).toBe("SCHEDULED");
      // Simulate the bad Sep-15 flat repair window — expireDue must not kill.
      await database.prisma.xProductPublicationReservation.update({
        where: { publicationId: pub.id },
        data: { expiresAt: new Date("2026-09-16T00:35:00.000Z") },
      });
    }

    // C: expire before any slot due — future STANDARD/EXTRA pubs stay ACTIVE
    const expiredCount = await ops.expireDueReservations(
      new Date("2026-09-16T01:00:00.000Z"),
      { publishGraceMinutes: 180 },
    );
    expect(expiredCount).toBe(0);
    const rows = await database.prisma.xProductPublicationReservation.findMany({
      where: { status: "ACTIVE" },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const pub = await publications.findById(row.publicationId);
      expect(row.expiresAt.getTime()).toBeGreaterThan(pub!.scheduledAt!.getTime());
    }
  });

  it("D: after scheduledAt+grace, unused reservation expires", async () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const scheduledAt = new Date("2026-09-15T06:00:00.000Z");
    const contentId = await seedReadyContent(`${PREFIX}d`);
    const pub = await svc(() => createdAt).createFromContent({
      contentId,
      strategy: "SINGLE_POST",
      scheduledAt,
      cooldownOverrideReason: "test-d",
      actorId: "test",
    });
    await database.prisma.xProductPublicationReservation.update({
      where: { publicationId: pub.id },
      data: { expiresAt: new Date("2026-09-15T06:30:00.000Z") },
    });
    const n = await ops.expireDueReservations(new Date("2026-09-15T10:00:00.000Z"), {
      publishGraceMinutes: 180,
    });
    expect(n).toBe(1);
    expect((await ops.findReservationByPublication(pub.id))?.status).toBe("EXPIRED");
  });

  it("E: terminal publication reservation can be cleaned up", async () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const scheduledAt = new Date("2026-09-20T06:00:00.000Z");
    const contentId = await seedReadyContent(`${PREFIX}e`);
    const pub = await svc(() => createdAt).createFromContent({
      contentId,
      strategy: "SINGLE_POST",
      scheduledAt,
      cooldownOverrideReason: "test-e",
      actorId: "test",
    });
    await database.prisma.xPublication.update({
      where: { id: pub.id },
      data: { status: "CANCELLED" },
    });
    await database.prisma.xProductPublicationReservation.update({
      where: { publicationId: pub.id },
      data: { expiresAt: new Date("2026-09-14T04:00:00.000Z") },
    });
    const n = await ops.expireDueReservations(new Date("2026-09-16T01:00:00.000Z"), {
      publishGraceMinutes: 180,
    });
    expect(n).toBe(1);
    expect((await ops.findReservationByPublication(pub.id))?.status).toBe("EXPIRED");
  });

  it("F: PrePublishGuard ACTIVE=PASS, EXPIRED=BLOCK RESERVATION_INACTIVE", async () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const scheduledAt = new Date("2026-09-16T06:00:00.000Z");
    const contentId = await seedReadyContent(`${PREFIX}f`);
    const service = svc(() => createdAt);
    const pub = await service.createFromContent({
      contentId,
      strategy: "SINGLE_POST",
      scheduledAt,
      cooldownOverrideReason: "test-f",
      actorId: "test",
    });
    const content = await contents.findGeneratedContentById(contentId);
    const externalId = (
      await database.prisma.researchItem.findUnique({
        where: { id: content!.researchItemId },
      })
    )?.externalId;
    const productKey = buildProductKey({
      provider: "fanza",
      providerProductId: extractProviderProductId({
        externalId,
        affiliateUrl: content!.affiliateUrl,
      }),
      contentId: content!.id,
      affiliateUrl: content!.affiliateUrl,
      researchItemId: content!.researchItemId,
      externalId,
    });
    const guard = new XPrePublishGuard({
      config: safeConfig(),
      ops,
      publications,
      contents,
      now: () => new Date("2026-09-16T06:01:00.000Z"),
    });
    const full = await publications.findById(pub.id);
    const pass = await guard.evaluate({
      publication: full!,
      productKey,
      phase: "publish",
      actorType: "SCHEDULER",
    });
    expect(pass.ok).toBe(true);

    await ops.releaseReservation(pub.id, "EXPIRED");
    const blocked = await guard.evaluate({
      publication: (await publications.findById(pub.id))!,
      productKey,
      phase: "publish",
      actorType: "SCHEDULER",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.issues.some((i) => i.code === "RESERVATION_INACTIVE")).toBe(true);
  });

  it("restoreReservationForPublication rejects expiresAt <= scheduledAt", async () => {
    const createdAt = new Date("2026-09-14T03:00:00.000Z");
    const scheduledAt = new Date("2026-09-17T12:00:00.000Z");
    const contentId = await seedReadyContent(`${PREFIX}restore`);
    const pub = await svc(() => createdAt).createFromContent({
      contentId,
      strategy: "SINGLE_POST",
      scheduledAt,
      cooldownOverrideReason: "test-restore",
      actorId: "test",
    });
    await ops.releaseReservation(pub.id, "EXPIRED");
    await expect(
      ops.restoreReservationForPublication({
        publicationId: pub.id,
        expiresAt: new Date("2026-09-16T00:35:00.000Z"),
        scheduledAt,
        reason: "bad-flat-repair",
      }),
    ).rejects.toThrow(/expiresAt invariant violated/);

    const goodExpires = computeXProductReservationExpiresAt({
      now: new Date("2026-09-16T12:00:00.000Z"),
      scheduledAt,
      ttlMinutes: 30,
      publishGraceMinutes: 180,
    });
    const restored = await ops.restoreReservationForPublication({
      publicationId: pub.id,
      expiresAt: goodExpires,
      scheduledAt,
      reason: "scoped-lifecycle-repair",
    });
    expect(restored.status).toBe("ACTIVE");
    expect(restored.expiresAt.getTime()).toBeGreaterThan(scheduledAt.getTime());
  });
});
