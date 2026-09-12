import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  JobRepository,
  ResearchRepository,
  ScheduleRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { MockPaginatedProvider, buildMockItem } from "../providers/mock/paginated.js";
import type { PageCollectionProvider } from "../jobs/collection-job-runner.js";
import { ScheduleRunner } from "../schedules/schedule-runner.js";
import { ensureResearchCollectionSchedules } from "./ensure-collection-schedules.js";
import { systemResearchScheduleName } from "./provider-readiness.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const schedules = new ScheduleRepository(database.prisma);
const jobs = new JobRepository(database.prisma);
const research = new ResearchRepository(database.prisma);
const logger = createLogger("error");
const baseConfig = loadConfig({ requireDatabaseUrl: false });

async function cleanup(): Promise<void> {
  await database.prisma.researchScheduleLock.deleteMany();
  await database.prisma.researchScheduleRun.deleteMany();
  await database.prisma.researchSchedule.deleteMany({
    where: {
      OR: [
        { name: { startsWith: "system:auto-research:" } },
        { name: { startsWith: "sched-iso-" } },
      ],
    },
  });
  await database.prisma.researchJobError.deleteMany();
  await database.prisma.researchJobLock.deleteMany();
  await database.prisma.researchJob.deleteMany({
    where: { providerName: { in: ["mock", "fanza"] } },
  });
  await database.prisma.researchMetric.deleteMany({
    where: { researchItem: { externalId: { startsWith: "iso-mock-" } } },
  });
  await database.prisma.researchItemTag.deleteMany({
    where: { researchItem: { externalId: { startsWith: "iso-mock-" } } },
  });
  await database.prisma.researchImage.deleteMany({
    where: { researchItem: { externalId: { startsWith: "iso-mock-" } } },
  });
  await database.prisma.researchItem.deleteMany({
    where: { externalId: { startsWith: "iso-mock-" } },
  });
}

beforeAll(async () => {
  await database.connect();
});

afterAll(async () => {
  await cleanup();
  await database.disconnect();
});

beforeEach(async () => {
  await cleanup();
});

describe("ensureResearchCollectionSchedules", () => {
  it("creates system FANZA schedule when collection enabled", async () => {
    const result = await ensureResearchCollectionSchedules({
      schedules,
      logger,
      config: {
        ...baseConfig,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza"],
        researchCollectionCron: "0 */6 * * *",
        researchCollectionTimezone: "UTC",
      },
      now: () => new Date("2026-09-09T00:00:00.000Z"),
    });
    expect(result.ensured).toContain("fanza");
    const row = await schedules.findScheduleByName(systemResearchScheduleName("fanza"));
    expect(row?.providerName).toBe("fanza");
    expect(row?.isActive).toBe(true);
    expect(row?.cronExpression).toBe("0 */6 * * *");
    // New schedules are due immediately (catch-up), not deferred to next cron wall-clock.
    expect(row?.nextRunAt?.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });

  it("catch-up sets nextRunAt=now when system schedule never ran", async () => {
    await schedules.createSchedule({
      name: systemResearchScheduleName("fanza"),
      providerName: "fanza",
      scheduleType: "CRON",
      cronExpression: "0 */6 * * *",
      timezone: "UTC",
      parameters: { maxPages: 1, maxItems: 10, hits: 10, startOffset: 1, continueOnItemError: true },
      isActive: true,
      nextRunAt: new Date("2026-09-12T09:00:00.000Z"),
      // lastRunAt null implied
    });
    await ensureResearchCollectionSchedules({
      schedules,
      logger,
      config: {
        ...baseConfig,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza"],
        researchCollectionCron: "0 */6 * * *",
        researchCollectionTimezone: "UTC",
      },
      now: () => new Date("2026-09-12T06:00:00.000Z"),
    });
    const row = await schedules.findScheduleByName(systemResearchScheduleName("fanza"));
    expect(row?.lastRunAt).toBeNull();
    expect(row?.nextRunAt?.toISOString()).toBe("2026-09-12T06:00:00.000Z");
  });

  it("pauses system schedule when collection disabled", async () => {
    await ensureResearchCollectionSchedules({
      schedules,
      logger,
      config: {
        ...baseConfig,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza"],
      },
    });
    const paused = await ensureResearchCollectionSchedules({
      schedules,
      logger,
      config: {
        ...baseConfig,
        researchCollectionEnabled: false,
        researchEnabledProviders: ["fanza"],
      },
    });
    expect(paused.paused).toContain("fanza");
    const row = await schedules.findScheduleByName(systemResearchScheduleName("fanza"));
    expect(row?.isActive).toBe(false);
  });
});

describe("provider failure isolation + duplicates", () => {
  it("skips FANZA credentials while completing mock provider in same tick", async () => {
    const due = new Date("2026-09-09T10:00:00.000Z");
    await schedules.createSchedule({
      name: "sched-iso-fanza",
      providerName: "fanza",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: due,
    });
    await schedules.createSchedule({
      name: "sched-iso-mock",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: due,
    });

    const provider: PageCollectionProvider = new MockPaginatedProvider([
      {
        offset: 1,
        items: [buildMockItem("iso-mock-1"), buildMockItem("iso-mock-2")],
        nextOffset: null,
      },
    ]);

    const outcomes = await new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: {
        ...baseConfig,
        dmmApiId: undefined,
        dmmAffiliateId: undefined,
        dmmApiApprovalPending: false,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza", "mock"],
      },
      now: () => new Date("2026-09-09T10:05:00.000Z"),
      createProvider: (schedule) => {
        if (schedule.providerName === "fanza") {
          throw new Error("FANZA provider must not be constructed without credentials");
        }
        return provider;
      },
    }).runDueSchedules();

    const byName = Object.fromEntries(outcomes.map((o) => [o.scheduleName, o]));
    expect(byName["sched-iso-fanza"]?.status).toBe("SKIPPED");
    expect(byName["sched-iso-fanza"]?.errorMessage).toMatch(/CREDENTIAL_MISSING/);
    expect(byName["sched-iso-mock"]?.status).toBe("COMPLETED");
    expect(byName["sched-iso-mock"]?.savedCount).toBeGreaterThan(0);
  });

  it("skips FANZA when API approval pending even with credentials", async () => {
    const due = new Date("2026-09-09T11:00:00.000Z");
    await schedules.createSchedule({
      name: "sched-iso-pending",
      providerName: "fanza",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: due,
    });

    const [outcome] = await new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: {
        ...baseConfig,
        dmmApiId: "present",
        dmmAffiliateId: "affiliate-990",
        dmmApiApprovalPending: true,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza"],
      },
      now: () => new Date("2026-09-09T11:05:00.000Z"),
      createProvider: () => {
        throw new Error("must not create");
      },
    }).runDueSchedules();

    expect(outcome.status).toBe("SKIPPED");
    expect(outcome.errorMessage).toMatch(/API_APPROVAL_PENDING/);
  });

  it("upserts duplicate product instead of proliferating ResearchItems", async () => {
    const item = buildMockItem("iso-mock-dup", {
      sourceName: "mock",
      sourceType: "OTHER",
    });
    const first = await research.saveCollection({
      providerName: "mock",
      collectedAt: new Date("2026-09-09T12:00:00.000Z"),
      items: [item],
    });
    const second = await research.saveCollection({
      providerName: "mock",
      collectedAt: new Date("2026-09-09T12:10:00.000Z"),
      items: [{ ...item, title: "updated title" }],
    });
    expect(first.createdCount).toBe(1);
    expect(second.updatedCount).toBe(1);
    expect(second.createdCount).toBe(0);
    const rows = await database.prisma.researchItem.findMany({
      where: { externalId: "iso-mock-dup" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("updated title");
  });
});
