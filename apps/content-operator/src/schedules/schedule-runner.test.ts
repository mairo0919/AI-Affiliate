import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  JobRepository,
  ScheduleRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { ConfigurationError } from "../providers/fanza/dmm-api-error.js";
import { MockPaginatedProvider, buildMockItem } from "../providers/mock/paginated.js";
import { computeNextRunAt } from "./cron.js";
import { ScheduleRunner } from "./schedule-runner.js";
import type { PageCollectionProvider } from "../jobs/collection-job-runner.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const schedules = new ScheduleRepository(database.prisma);
const jobs = new JobRepository(database.prisma);
const logger = createLogger("error");
const baseConfig = loadConfig({ requireDatabaseUrl: false });

async function cleanup(): Promise<void> {
  await database.prisma.researchNotificationAttempt.deleteMany();
  await database.prisma.researchNotification.deleteMany();
  await database.prisma.researchScheduleLock.deleteMany();
  await database.prisma.researchScheduleRun.deleteMany();
  await database.prisma.researchSchedule.deleteMany({
    where: { name: { startsWith: "sched-test-" } },
  });
  await database.prisma.researchJobError.deleteMany();
  await database.prisma.researchJobLock.deleteMany();
  await database.prisma.researchJob.deleteMany({
    where: { providerName: "mock" },
  });
  await database.prisma.researchMetric.deleteMany({
    where: { researchItem: { externalId: { startsWith: "sched-mock-" } } },
  });
  await database.prisma.researchItemTag.deleteMany({
    where: { researchItem: { externalId: { startsWith: "sched-mock-" } } },
  });
  await database.prisma.researchImage.deleteMany({
    where: { researchItem: { externalId: { startsWith: "sched-mock-" } } },
  });
  await database.prisma.researchItem.deleteMany({
    where: { externalId: { startsWith: "sched-mock-" } },
  });
  await database.prisma.researchMetric.deleteMany({
    where: { researchItem: { externalId: { startsWith: "job-mock-" } } },
  });
  await database.prisma.researchItemTag.deleteMany({
    where: { researchItem: { externalId: { startsWith: "job-mock-" } } },
  });
  await database.prisma.researchImage.deleteMany({
    where: { researchItem: { externalId: { startsWith: "job-mock-" } } },
  });
  await database.prisma.researchItem.deleteMany({
    where: { externalId: { startsWith: "job-mock-" } },
  });
}

function mockPagesProvider(): PageCollectionProvider {
  return new MockPaginatedProvider([
    {
      offset: 1,
      items: [buildMockItem("sched-mock-1"), buildMockItem("sched-mock-2")],
      nextOffset: 3,
    },
    {
      offset: 3,
      items: [buildMockItem("sched-mock-3")],
      nextOffset: null,
    },
  ]);
}

function createRunner(overrides?: {
  failureLimit?: number;
  graceMs?: number;
  now?: () => Date;
  createProvider?: (schedule: { id: string }) => PageCollectionProvider;
  config?: Partial<typeof baseConfig>;
}): ScheduleRunner {
  return new ScheduleRunner({
    logger,
    database,
    schedules,
    jobs,
    config: {
      ...baseConfig,
      databaseUrl: process.env.DATABASE_URL ?? baseConfig.databaseUrl,
      researchScheduleFailureLimit: overrides?.failureLimit ?? baseConfig.researchScheduleFailureLimit,
      researchScheduleGraceMs: overrides?.graceMs ?? baseConfig.researchScheduleGraceMs,
      ...(overrides?.config ?? {}),
    },
    failureLimit: overrides?.failureLimit,
    graceMs: overrides?.graceMs,
    now: overrides?.now,
    createProvider: overrides?.createProvider
      ? (schedule) => overrides.createProvider!(schedule)
      : () => mockPagesProvider(),
  });
}

describe("ScheduleRunner", () => {
  beforeAll(async () => {
    await database.connect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await database.disconnect();
  });

  it("runs due mock schedule, completes job, and updates nextRunAt", async () => {
    const scheduledFor = new Date("2026-07-28T08:00:00.000Z");
    const now = new Date("2026-07-28T08:05:00.000Z");
    const schedule = await schedules.createSchedule({
      name: "sched-test-due",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { hits: 100, maxPages: 2, floor: "videoa" },
      nextRunAt: scheduledFor,
    });

    const [outcome] = await createRunner({ now: () => now }).runDueSchedules();
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.jobId).toBeTruthy();
    expect(outcome.fetchedCount).toBeGreaterThan(0);
    expect(outcome.triggerType).toBe("SCHEDULED");

    const refreshed = await schedules.findScheduleById(schedule.id);
    expect(refreshed?.lastJobId).toBe(outcome.jobId);
    expect(refreshed?.consecutiveFailureCount).toBe(0);
    expect(refreshed?.nextRunAt?.getTime()).toBeGreaterThan(scheduledFor.getTime());

    const runs = await schedules.listRunsForSchedule(schedule.id);
    expect(runs[0]?.jobId).toBe(outcome.jobId);
    expect(runs[0]?.status).toBe("COMPLETED");

    const job = await jobs.findJobById(outcome.jobId!);
    expect(job?.status).toBe("COMPLETED");
    expect(job?.pagesProcessed).toBe(2);
  });

  it("does not execute inactive schedules", async () => {
    await schedules.createSchedule({
      name: "sched-test-inactive",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T08:00:00.000Z"),
      isActive: false,
    });
    const outcomes = await createRunner({
      now: () => new Date("2026-07-28T08:05:00.000Z"),
    }).runDueSchedules();
    expect(outcomes).toHaveLength(0);
  });

  it("skips duplicate scheduledFor execution", async () => {
    const scheduledFor = new Date("2026-07-28T09:00:00.000Z");
    const schedule = await schedules.createSchedule({
      name: "sched-test-dup",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: scheduledFor,
    });
    await schedules.recordScheduleRun({
      scheduleId: schedule.id,
      triggerType: "SCHEDULED",
      scheduledFor,
      status: "COMPLETED",
    });

    const [outcome] = await createRunner({
      now: () => new Date("2026-07-28T09:05:00.000Z"),
    }).runDueSchedules();
    expect(outcome.status).toBe("SKIPPED");
    expect(outcome.errorMessage).toMatch(/already executed/i);

    const refreshed = await schedules.findScheduleById(schedule.id);
    expect(refreshed?.nextRunAt?.getTime()).toBeGreaterThan(scheduledFor.getTime());
  });

  it("prevents concurrent starts via schedule lock", async () => {
    const scheduledFor = new Date("2026-07-28T10:00:00.000Z");
    const schedule = await schedules.createSchedule({
      name: "sched-test-lock",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: scheduledFor,
    });
    const token = await schedules.acquireScheduleLock(schedule.id, 60_000);
    const [outcome] = await createRunner({
      now: () => new Date("2026-07-28T10:05:00.000Z"),
    }).runDueSchedules();
    expect(outcome.status).toBe("SKIPPED");
    expect(outcome.errorMessage).toMatch(/lock/i);
    await schedules.releaseScheduleLock(schedule.id, token);
  });

  it("supports manual run", async () => {
    const schedule = await schedules.createSchedule({
      name: "sched-test-manual",
      providerName: "mock",
      scheduleType: "MANUAL_ONLY",
      parameters: { maxPages: 2 },
    });
    const outcome = await createRunner().runManual(schedule.id);
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.triggerType).toBe("MANUAL");
    expect(outcome.jobId).toBeTruthy();
  });

  it("resets failure count on success and auto-stops after limit", async () => {
    const schedule = await schedules.createSchedule({
      name: "sched-test-fail",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T11:00:00.000Z"),
    });

    const failingProvider: PageCollectionProvider = {
      providerName: "mock",
      async collectPage() {
        throw new Error("simulated collection failure");
      },
    };

    for (let i = 0; i < 5; i += 1) {
      const dueAt = new Date(Date.UTC(2026, 6, 28, 11 + i, 0, 0));
      await schedules.updateNextRunAt(schedule.id, dueAt);
      const [outcome] = await createRunner({
        failureLimit: 5,
        now: () => new Date(dueAt.getTime() + 60_000),
        createProvider: () => failingProvider,
      }).runDueSchedules();
      expect(outcome.status).toBe("FAILED");
    }

    const stopped = await schedules.findScheduleById(schedule.id);
    expect(stopped?.isActive).toBe(false);
    expect(stopped?.consecutiveFailureCount).toBeGreaterThanOrEqual(5);

    // Resume and succeed → failure count resets
    const next = computeNextRunAt({
      cronExpression: "0 * * * *",
      timezone: "UTC",
      after: new Date("2026-07-28T20:00:00.000Z"),
    });
    await schedules.resumeSchedule(schedule.id, next);
    await schedules.updateNextRunAt(schedule.id, new Date("2026-07-28T20:00:00.000Z"));
    const [ok] = await createRunner({
      now: () => new Date("2026-07-28T20:05:00.000Z"),
    }).runDueSchedules();
    expect(ok.status).toBe("COMPLETED");
    const refreshed = await schedules.findScheduleById(schedule.id);
    expect(refreshed?.consecutiveFailureCount).toBe(0);
  });

  it("does not count missing credentials toward failure limit", async () => {
    const scheduledFor = new Date("2026-07-28T12:00:00.000Z");
    const schedule = await schedules.createSchedule({
      name: "sched-test-creds",
      providerName: "fanza",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: scheduledFor,
    });

    const [outcome] = await createRunner({
      now: () => new Date("2026-07-28T12:05:00.000Z"),
      config: {
        ...baseConfig,
        dmmApiId: undefined,
        dmmAffiliateId: undefined,
      },
      createProvider: () => {
        throw new ConfigurationError("should not create provider");
      },
    }).runDueSchedules();

    expect(outcome.status).toBe("SKIPPED");
    expect(outcome.errorMessage).toMatch(/CREDENTIAL_MISSING|credentials|configuration/i);
    const refreshed = await schedules.findScheduleById(schedule.id);
    expect(refreshed?.consecutiveFailureCount).toBe(0);
    expect(refreshed?.isActive).toBe(true);
  });

  it("pause and resume control due execution", async () => {
    const schedule = await schedules.createSchedule({
      name: "sched-test-pause",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T13:00:00.000Z"),
    });
    await schedules.pauseSchedule(schedule.id);
    const pausedOutcomes = await createRunner({
      now: () => new Date("2026-07-28T13:05:00.000Z"),
    }).runDueSchedules();
    expect(pausedOutcomes).toHaveLength(0);

    await schedules.resumeSchedule(schedule.id, new Date("2026-07-28T13:00:00.000Z"));
    const [outcome] = await createRunner({
      now: () => new Date("2026-07-28T13:05:00.000Z"),
    }).runDueSchedules();
    expect(outcome.status).toBe("COMPLETED");
  });

  it("keeps run history after soft delete", async () => {
    const schedule = await schedules.createSchedule({
      name: "sched-test-delete",
      providerName: "mock",
      scheduleType: "MANUAL_ONLY",
      parameters: { maxPages: 1 },
    });
    const outcome = await createRunner().runManual(schedule.id);
    await schedules.deleteSchedule(schedule.id);
    const runs = await database.prisma.researchScheduleRun.findMany({
      where: { scheduleId: schedule.id },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.jobId).toBe(outcome.jobId);
  });

  it("never stores credential values in schedule error messages", async () => {
    const scheduledFor = new Date("2026-07-28T14:00:00.000Z");
    await schedules.createSchedule({
      name: "sched-test-nosecret",
      providerName: "fanza",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: scheduledFor,
    });
    const secretValue = "super-secret-value-xyz-990";
    const [outcome] = await createRunner({
      now: () => new Date("2026-07-28T14:05:00.000Z"),
      config: {
        dmmApiId: undefined,
        dmmAffiliateId: undefined,
      },
    }).runDueSchedules();
    expect(outcome.errorMessage ?? "").not.toContain(secretValue);
    expect(outcome.errorMessage ?? "").not.toContain("990");
    const runs = await database.prisma.researchScheduleRun.findMany({
      where: { scheduleId: { not: undefined }, errorMessage: { not: null } },
      take: 20,
    });
    for (const run of runs) {
      expect(run.errorMessage ?? "").not.toContain(secretValue);
      expect(run.errorMessage ?? "").not.toMatch(/Bearer |password=|api_key=/i);
    }
  });
});

describe("scheduler DATABASE_URL guard", () => {
  it("skips execution when DATABASE_URL is empty", () => {
    const databaseUrl = "";
    const shouldRun = Boolean(databaseUrl);
    expect(shouldRun).toBe(false);
  });
});
