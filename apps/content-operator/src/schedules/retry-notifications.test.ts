import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  JobRepository,
  NotificationRepository,
  ScheduleRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { TimeoutError, ValidationError } from "../providers/fanza/dmm-api-error.js";
import { MockPaginatedProvider, buildMockItem } from "../providers/mock/paginated.js";
import { NotificationService } from "../notifications/notification-service.js";
import { ConsoleNotificationProvider } from "../notifications/console-provider.js";
import { WebhookNotificationProvider } from "../notifications/webhook-provider.js";
import { ScheduleRunner } from "./schedule-runner.js";
import { RetryRunner } from "./retry-runner.js";
import { SchedulerPipeline } from "./scheduler-pipeline.js";
import type { PageCollectionProvider } from "../jobs/collection-job-runner.js";
import { isNonRetryableError, isRetryableError } from "../jobs/errors.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const schedules = new ScheduleRepository(database.prisma);
const jobs = new JobRepository(database.prisma);
const notificationRepo = new NotificationRepository(database.prisma);
const logger = createLogger("error");
const baseConfig = loadConfig({ requireDatabaseUrl: false });

async function cleanup(): Promise<void> {
  await database.prisma.researchNotificationAttempt.deleteMany();
  await database.prisma.researchNotification.deleteMany();
  await database.prisma.researchScheduleLock.deleteMany();
  await database.prisma.researchScheduleRun.deleteMany();
  await database.prisma.researchSchedule.deleteMany({
    where: { name: { startsWith: "retry-test-" } },
  });
  await database.prisma.researchJobError.deleteMany();
  await database.prisma.researchJobLock.deleteMany();
  await database.prisma.researchJob.deleteMany({ where: { providerName: "mock" } });
  await database.prisma.researchItem.deleteMany({
    where: { externalId: { startsWith: "sched-mock-" } },
  });
}

function okProvider(): PageCollectionProvider {
  return new MockPaginatedProvider([
    { offset: 1, items: [buildMockItem("sched-mock-ok")], nextOffset: null },
  ]);
}

function failingProvider(error: Error): PageCollectionProvider {
  return {
    providerName: "mock",
    async collectPage() {
      throw error;
    },
  };
}

function partialProvider(): PageCollectionProvider {
  return new MockPaginatedProvider([
    {
      offset: 1,
      items: [buildMockItem("sched-mock-partial")],
      nextOffset: null,
      errorCount: 1,
    },
  ]);
}

describe("retry + notifications", () => {
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

  it("classifies retryable and non-retryable errors", () => {
    expect(isRetryableError(new TimeoutError("timeout"))).toBe(true);
    expect(isRetryableError(Object.assign(new Error("x"), { name: "RateLimitError" }))).toBe(true);
    expect(isRetryableError(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(isNonRetryableError(new ValidationError("bad"))).toBe(true);
    expect(isRetryableError(new ValidationError("bad"))).toBe(false);
  });

  it("schedules retry for retryable errors and preserves original run", async () => {
    const now = new Date("2026-07-28T10:00:00.000Z");
    const schedule = await schedules.createSchedule({
      name: "retry-test-schedule",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T09:55:00.000Z"),
    });

    const notifications = new NotificationService({
      logger,
      config: { ...baseConfig, researchNotificationChannel: "console", researchRetryMaxAttempts: 3 },
      notifications: notificationRepo,
      now: () => now,
      random: () => 0.5,
    });

    const runner = new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: {
        ...baseConfig,
        researchRetryEnabled: true,
        researchRetryMaxAttempts: 3,
        researchRetryBaseDelaySeconds: 300,
        researchRetryMaxDelaySeconds: 3600,
      },
      notifications,
      now: () => now,
      random: () => 0.5,
      createProvider: () => failingProvider(new TimeoutError("timed out")),
    });

    const [outcome] = await runner.runDueSchedules();
    expect(outcome.status).toBe("FAILED");

    const runs = await schedules.listRunsForSchedule(schedule.id);
    expect(runs).toHaveLength(1);
    const original = runs[0]!;
    expect(original.status).toBe("FAILED");
    expect(original.nextRetryAt?.toISOString()).toBe("2026-07-28T10:05:00.000Z");
    expect(original.retryAttempt).toBe(0);
    expect(original.rootRunId).toBe(original.id);

    const events = await notificationRepo.listNotifications({});
    expect(events.some((e) => e.eventType === "RETRY_SCHEDULED")).toBe(true);
    expect(events.some((e) => e.eventType === "SCHEDULE_FAILED")).toBe(false);
  });

  it("does not schedule retry for non-retryable errors", async () => {
    const now = new Date("2026-07-28T11:00:00.000Z");
    await schedules.createSchedule({
      name: "retry-test-nonretry",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T10:55:00.000Z"),
    });

    const notifications = new NotificationService({
      logger,
      config: { ...baseConfig, researchNotificationChannel: "console" },
      notifications: notificationRepo,
      now: () => now,
    });

    const runner = new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: { ...baseConfig, researchRetryEnabled: true },
      notifications,
      now: () => now,
      createProvider: () => failingProvider(new ValidationError("bad query")),
    });

    const [outcome] = await runner.runDueSchedules();
    expect(outcome.status).toBe("FAILED");
    const runs = await schedules.listRunsForSchedule(outcome.scheduleId);
    expect(runs[0]?.nextRetryAt).toBeNull();
    const events = await notificationRepo.listNotifications({});
    expect(events.some((e) => e.eventType === "SCHEDULE_FAILED")).toBe(true);
    expect(events.some((e) => e.eventType === "RETRY_SCHEDULED")).toBe(false);
  });

  it("executes RETRY trigger, increments attempt, and can succeed", async () => {
    const t0 = new Date("2026-07-28T12:00:00.000Z");
    const schedule = await schedules.createSchedule({
      name: "retry-test-exec",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T11:55:00.000Z"),
    });

    let calls = 0;
    const flaky: PageCollectionProvider = {
      providerName: "mock",
      async collectPage(options) {
        calls += 1;
        if (calls === 1) {
          throw new TimeoutError("temp");
        }
        return okProvider().collectPage(options);
      },
    };

    const notifications = new NotificationService({
      logger,
      config: { ...baseConfig, researchNotificationChannel: "console" },
      notifications: notificationRepo,
      now: () => t0,
      random: () => 0.5,
    });

    const scheduleRunner = new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: {
        ...baseConfig,
        researchRetryEnabled: true,
        researchRetryBaseDelaySeconds: 60,
        researchRetryMaxAttempts: 3,
      },
      notifications,
      now: () => t0,
      random: () => 0.5,
      createProvider: () => flaky,
    });
    await scheduleRunner.runDueSchedules();

    const original = (await schedules.listRunsForSchedule(schedule.id))[0]!;
    expect(original.nextRetryAt).not.toBeNull();
    const originalSnapshot = { ...original };

    const t1 = original.nextRetryAt!;
    const retryRunner = new RetryRunner({
      logger,
      database,
      schedules,
      jobs,
      config: {
        ...baseConfig,
        researchRetryEnabled: true,
        researchRetryBaseDelaySeconds: 60,
        researchRetryMaxAttempts: 3,
      },
      notifications,
      now: () => t1,
      random: () => 0.5,
      createProvider: () => flaky,
    });
    const [retryOutcome] = await retryRunner.runDueRetries();
    expect(retryOutcome.status).toBe("COMPLETED");
    expect(retryOutcome.retryAttempt).toBe(1);
    expect(retryOutcome.retryRunId).toBeTruthy();

    const unchanged = await schedules.findRunById(original.id);
    expect(unchanged?.status).toBe(originalSnapshot.status);
    expect(unchanged?.errorMessage).toBe(originalSnapshot.errorMessage);
    expect(unchanged?.completedAt?.toISOString()).toBe(originalSnapshot.completedAt?.toISOString());

    const retryRun = await schedules.findRunById(retryOutcome.retryRunId!);
    expect(retryRun?.triggerType).toBe("RETRY");
    expect(retryRun?.retryOfRunId).toBe(original.id);
    expect(retryRun?.rootRunId).toBe(original.rootRunId ?? original.id);
  });

  it("stops after max attempts with RETRY_EXHAUSTED and limited mid notifications", async () => {
    const schedule = await schedules.createSchedule({
      name: "retry-test-exhaust",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T13:00:00.000Z"),
    });

    const notifications = new NotificationService({
      logger,
      config: { ...baseConfig, researchNotificationChannel: "console" },
      notifications: notificationRepo,
      random: () => 0.5,
    });

    let now = new Date("2026-07-28T13:05:00.000Z");
    const alwaysFail = failingProvider(new TimeoutError("still failing"));

    const scheduleRunner = new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: {
        ...baseConfig,
        researchRetryEnabled: true,
        researchRetryMaxAttempts: 2,
        researchRetryBaseDelaySeconds: 60,
        researchScheduleFailureLimit: 100,
      },
      notifications,
      now: () => now,
      random: () => 0.5,
      createProvider: () => alwaysFail,
    });
    await scheduleRunner.runDueSchedules();

    const retryRunner = new RetryRunner({
      logger,
      database,
      schedules,
      jobs,
      config: {
        ...baseConfig,
        researchRetryEnabled: true,
        researchRetryMaxAttempts: 2,
        researchRetryBaseDelaySeconds: 60,
        researchScheduleFailureLimit: 100,
      },
      notifications,
      now: () => now,
      random: () => 0.5,
      createProvider: () => alwaysFail,
    });

    for (let i = 0; i < 3; i += 1) {
      const pending = await schedules.listPendingRetries();
      const target = pending.find((r) => r.scheduleId === schedule.id);
      if (!target?.nextRetryAt) break;
      now = new Date(target.nextRetryAt.getTime() + 1000);
      await retryRunner.runDueRetries();
    }

    const events = await notificationRepo.listNotifications({});
    const scheduled = events.filter((e) => e.eventType === "RETRY_SCHEDULED");
    const exhausted = events.filter((e) => e.eventType === "RETRY_EXHAUSTED");
    expect(scheduled.length).toBe(1);
    expect(exhausted.length).toBe(1);
  });

  it("creates partial success, auto-pause, and recovery notifications", async () => {
    const now = new Date("2026-07-28T14:05:00.000Z");
    const schedule = await schedules.createSchedule({
      name: "retry-test-notify",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1, continueOnItemError: true },
      nextRunAt: new Date("2026-07-28T14:00:00.000Z"),
    });

    const notifications = new NotificationService({
      logger,
      config: { ...baseConfig, researchNotificationChannel: "console" },
      notifications: notificationRepo,
      now: () => now,
    });

    // Partial
    await new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: { ...baseConfig, researchRetryEnabled: false },
      notifications,
      now: () => now,
      createProvider: () => partialProvider(),
    }).runDueSchedules();

    expect(
      (await notificationRepo.listNotifications({})).some(
        (e) => e.eventType === "SCHEDULE_PARTIALLY_COMPLETED",
      ),
    ).toBe(true);

    // Auto pause via consecutive failures
    await schedules.resetFailureCount(schedule.id);
    await schedules.updateNextRunAt(schedule.id, new Date("2026-07-28T15:00:00.000Z"));
    for (let i = 0; i < 5; i += 1) {
      const dueAt = new Date(Date.UTC(2026, 6, 28, 15 + i, 0, 0));
      await schedules.updateNextRunAt(schedule.id, dueAt);
      await new ScheduleRunner({
        logger,
        database,
        schedules,
        jobs,
        config: {
          ...baseConfig,
          researchRetryEnabled: false,
          researchScheduleFailureLimit: 5,
        },
        notifications,
        now: () => new Date(dueAt.getTime() + 60_000),
        createProvider: () => failingProvider(new ValidationError("bad")),
      }).runDueSchedules();
    }
    const paused = await schedules.findScheduleById(schedule.id);
    expect(paused?.isActive).toBe(false);
    expect(
      (await notificationRepo.listNotifications({})).some(
        (e) => e.eventType === "SCHEDULE_AUTO_PAUSED",
      ),
    ).toBe(true);

    // Recovery
    await schedules.resumeSchedule(schedule.id, new Date("2026-07-28T20:00:00.000Z"));
    await new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: { ...baseConfig, researchRetryEnabled: false },
      notifications,
      now: () => new Date("2026-07-28T20:05:00.000Z"),
      createProvider: () => okProvider(),
    }).runDueSchedules();
    expect(
      (await notificationRepo.listNotifications({})).some((e) => e.eventType === "SCHEDULE_RECOVERED"),
    ).toBe(true);
  });

  it("does not create recovery notification on first success", async () => {
    await schedules.createSchedule({
      name: "retry-test-first-ok",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T21:00:00.000Z"),
    });
    const notifications = new NotificationService({
      logger,
      config: { ...baseConfig, researchNotificationChannel: "console" },
      notifications: notificationRepo,
    });
    await new ScheduleRunner({
      logger,
      database,
      schedules,
      jobs,
      config: { ...baseConfig, researchRetryEnabled: false },
      notifications,
      now: () => new Date("2026-07-28T21:05:00.000Z"),
      createProvider: () => okProvider(),
    }).runDueSchedules();
    expect(
      (await notificationRepo.listNotifications({})).some((e) => e.eventType === "SCHEDULE_RECOVERED"),
    ).toBe(false);
  });

  it("deduplicates notifications and supports console + webhook providers", async () => {
    const schedule = await schedules.createSchedule({
      name: "retry-test-dedupe",
      providerName: "mock",
      scheduleType: "MANUAL_ONLY",
      parameters: {},
    });
    const run = await schedules.recordScheduleRun({
      scheduleId: schedule.id,
      triggerType: "MANUAL",
      status: "FAILED",
      retryAttempt: 0,
    });

    const notifications = new NotificationService({
      logger,
      config: { ...baseConfig, researchNotificationChannel: "console" },
      notifications: notificationRepo,
      providers: [new ConsoleNotificationProvider(logger)],
    });

    const first = await notifications.emitEvent("SCHEDULE_FAILED", {
      schedule,
      run,
      errorType: "Timeout",
      errorMessage: "timed out",
    });
    const second = await notifications.emitEvent("SCHEDULE_FAILED", {
      schedule,
      run,
      errorType: "Timeout",
      errorMessage: "timed out",
    });
    expect(first?.id).toBe(second?.id);
    expect(await notificationRepo.listNotifications({})).toHaveLength(1);

    const dispatch = await notifications.dispatchPendingNotifications();
    expect(dispatch.sent).toBe(1);

    const posts: { url: string; body: string }[] = [];
    const webhook = new WebhookNotificationProvider({
      webhookUrl: "https://example.test/hooks/research",
      timeoutMs: 1000,
      maxAttempts: 3,
      sleepImpl: async () => undefined,
      random: () => 0.5,
      fetchImpl: async (input, init) => {
        posts.push({ url: String(input), body: String(init?.body ?? "") });
        return new Response("ok", { status: 200 });
      },
    });
    const webhookService = new NotificationService({
      logger,
      config: {
        ...baseConfig,
        researchNotificationChannel: "webhook",
        researchNotificationWebhookUrl: "https://example.test/hooks/research",
      },
      notifications: notificationRepo,
      providers: [webhook],
    });
    const wh = await webhookService.emitEvent("SCHEDULE_PARTIALLY_COMPLETED", {
      schedule,
      run,
      job: { fetchedCount: 1, savedCount: 1, updatedCount: 0, errorCount: 1 },
    });
    expect(wh).toBeTruthy();
    await webhookService.dispatchPendingNotifications();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toContain("SCHEDULE_PARTIALLY_COMPLETED");
    expect(posts[0]?.body).not.toContain("DMM_API");
    expect(JSON.stringify(posts)).not.toMatch(/api_id|affiliate/i);
  });

  it("retries webhook on 429/500 but not on 400", async () => {
    let calls429 = 0;
    const provider429 = new WebhookNotificationProvider({
      webhookUrl: "https://example.test/hook",
      timeoutMs: 1000,
      maxAttempts: 3,
      sleepImpl: async () => undefined,
      random: () => 0.5,
      fetchImpl: async () => {
        calls429 += 1;
        return new Response("no", { status: calls429 < 3 ? 429 : 200 });
      },
    });
    const ok = await provider429.send({
      id: "n1",
      eventType: "SCHEDULE_FAILED",
      channelType: "WEBHOOK",
      title: "t",
      message: "m",
      payload: { eventType: "SCHEDULE_FAILED" },
    });
    expect(ok.ok).toBe(true);
    expect(calls429).toBe(3);

    let calls400 = 0;
    const provider400 = new WebhookNotificationProvider({
      webhookUrl: "https://example.test/hook",
      timeoutMs: 1000,
      maxAttempts: 3,
      sleepImpl: async () => undefined,
      fetchImpl: async () => {
        calls400 += 1;
        return new Response("bad", { status: 400 });
      },
    });
    const bad = await provider400.send({
      id: "n2",
      eventType: "SCHEDULE_FAILED",
      channelType: "WEBHOOK",
      title: "t",
      message: "m",
      payload: { eventType: "SCHEDULE_FAILED" },
    });
    expect(bad.ok).toBe(false);
    expect(bad.retryable).toBe(false);
    expect(calls400).toBe(1);

    let calls500 = 0;
    const provider500 = new WebhookNotificationProvider({
      webhookUrl: "https://example.test/hook",
      timeoutMs: 1000,
      maxAttempts: 2,
      sleepImpl: async () => undefined,
      random: () => 0.5,
      fetchImpl: async () => {
        calls500 += 1;
        return new Response("err", { status: 500 });
      },
    });
    const serverErr = await provider500.send({
      id: "n3",
      eventType: "SCHEDULE_FAILED",
      channelType: "WEBHOOK",
      title: "t",
      message: "m",
      payload: { eventType: "SCHEDULE_FAILED" },
    });
    expect(serverErr.ok).toBe(false);
    expect(calls500).toBe(2);
  });

  it("prevents concurrent SENDING and reclaims stale SENDING", async () => {
    const schedule = await schedules.createSchedule({
      name: "retry-test-sending",
      providerName: "mock",
      scheduleType: "MANUAL_ONLY",
      parameters: {},
    });
    const { notification } = await notificationRepo.createNotificationIfAbsent({
      eventType: "SCHEDULE_FAILED",
      scheduleId: schedule.id,
      channelType: "CONSOLE",
      deduplicationKey: `sending-test-${schedule.id}`,
      title: "t",
      message: "m",
      payload: { eventType: "SCHEDULE_FAILED" },
    });

    const first = await notificationRepo.markSending(notification.id);
    const second = await notificationRepo.markSending(notification.id);
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    await database.prisma.researchNotification.update({
      where: { id: notification.id },
      data: { status: "SENDING", lastAttemptAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    const reclaimed = await notificationRepo.markSending(notification.id);
    expect(reclaimed).not.toBeNull();
  });

  it("pipeline runs schedules, retries, and notifications without stopping on one failure", async () => {
    const now = new Date("2026-07-28T22:05:00.000Z");
    await schedules.createSchedule({
      name: "retry-test-pipeline",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      timezone: "UTC",
      parameters: { maxPages: 1 },
      nextRunAt: new Date("2026-07-28T22:00:00.000Z"),
    });

    const pipeline = new SchedulerPipeline({
      logger,
      database,
      config: {
        ...baseConfig,
        researchRetryEnabled: true,
        researchNotificationChannel: "console",
        researchNotificationEnabled: true,
      },
      now: () => now,
      random: () => 0.5,
      scheduleRunner: new ScheduleRunner({
        logger,
        database,
        schedules,
        jobs,
        config: { ...baseConfig, researchRetryEnabled: false },
        notifications: new NotificationService({
          logger,
          config: { ...baseConfig, researchNotificationChannel: "console" },
          notifications: notificationRepo,
        }),
        now: () => now,
        createProvider: () => okProvider(),
      }),
    });

    const result = await pipeline.run();
    expect(result.schedules.length).toBeGreaterThanOrEqual(1);
    expect(result.notifications.processed).toBeGreaterThanOrEqual(0);
  });

  it("skips webhook when URL missing without failing hard", async () => {
    const service = new NotificationService({
      logger,
      config: {
        ...baseConfig,
        researchNotificationChannel: "webhook",
        researchNotificationWebhookUrl: undefined,
      },
      notifications: notificationRepo,
    });
    const schedule = await schedules.createSchedule({
      name: "retry-test-webhook-skip",
      providerName: "mock",
      scheduleType: "MANUAL_ONLY",
      parameters: {},
    });
    const run = await schedules.recordScheduleRun({
      scheduleId: schedule.id,
      triggerType: "MANUAL",
      status: "FAILED",
    });
    await service.emitEvent("SCHEDULE_FAILED", { schedule, run, errorType: "Timeout" });
    const result = await service.dispatchPendingNotifications();
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });
});
