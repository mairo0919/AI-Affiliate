import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  ScheduleRepository,
} from "./schedule-repository.js";
import { LockError } from "./job-repository.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(rootDir, ".env") });

const prisma = new PrismaClient();
const schedules = new ScheduleRepository(prisma);

async function cleanup(): Promise<void> {
  await prisma.researchNotificationAttempt.deleteMany();
  await prisma.researchNotification.deleteMany();
  await prisma.researchScheduleLock.deleteMany();
  await prisma.researchScheduleRun.deleteMany();
  await prisma.researchSchedule.deleteMany();
}

describe("ScheduleRepository", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates, pauses, resumes, and soft-deletes schedules without breaking runs", async () => {
    const schedule = await schedules.createSchedule({
      name: "repo-test",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 8 * * *",
      timezone: "Asia/Tokyo",
      parameters: { maxPages: 2 },
      nextRunAt: new Date("2026-07-28T00:00:00.000Z"),
    });

    const run = await schedules.recordScheduleRun({
      scheduleId: schedule.id,
      triggerType: "SCHEDULED",
      scheduledFor: schedule.nextRunAt,
      status: "COMPLETED",
    });

    const paused = await schedules.pauseSchedule(schedule.id);
    expect(paused.isActive).toBe(false);

    await schedules.incrementFailureCount(schedule.id);
    const resumed = await schedules.resumeSchedule(schedule.id, new Date("2026-07-29T00:00:00.000Z"));
    expect(resumed.isActive).toBe(true);
    expect(resumed.consecutiveFailureCount).toBeGreaterThanOrEqual(1);

    await schedules.deleteSchedule(schedule.id);
    expect(await schedules.findScheduleById(schedule.id)).toBeNull();

    const kept = await prisma.researchScheduleRun.findUnique({ where: { id: run.id } });
    expect(kept).not.toBeNull();
    expect(kept?.scheduleId).toBe(schedule.id);
  });

  it("finds only due active cron schedules", async () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    await schedules.createSchedule({
      name: "due",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      parameters: {},
      nextRunAt: new Date("2026-07-28T11:55:00.000Z"),
    });
    await schedules.createSchedule({
      name: "future",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      parameters: {},
      nextRunAt: new Date("2026-07-28T13:00:00.000Z"),
    });
    const inactive = await schedules.createSchedule({
      name: "inactive",
      providerName: "mock",
      scheduleType: "CRON",
      cronExpression: "0 * * * *",
      parameters: {},
      nextRunAt: new Date("2026-07-28T11:00:00.000Z"),
      isActive: false,
    });
    expect(inactive.isActive).toBe(false);

    const due = await schedules.findDueSchedules(now, 20);
    expect(due.map((s) => s.name)).toEqual(["due"]);
  });

  it("increments and resets failure counts", async () => {
    const schedule = await schedules.createSchedule({
      name: "fail-count",
      providerName: "mock",
      scheduleType: "MANUAL_ONLY",
      parameters: {},
    });
    await schedules.incrementFailureCount(schedule.id);
    await schedules.incrementFailureCount(schedule.id);
    const mid = await schedules.findScheduleById(schedule.id);
    expect(mid?.consecutiveFailureCount).toBe(2);
    await schedules.resetFailureCount(schedule.id);
    const reset = await schedules.findScheduleById(schedule.id);
    expect(reset?.consecutiveFailureCount).toBe(0);
  });

  it("prevents concurrent schedule locks", async () => {
    const schedule = await schedules.createSchedule({
      name: "lock-test",
      providerName: "mock",
      scheduleType: "MANUAL_ONLY",
      parameters: {},
    });
    const token = await schedules.acquireScheduleLock(schedule.id, 60_000);
    await expect(schedules.acquireScheduleLock(schedule.id, 60_000)).rejects.toBeInstanceOf(
      LockError,
    );
    await schedules.releaseScheduleLock(schedule.id, token);
    const again = await schedules.acquireScheduleLock(schedule.id, 60_000);
    expect(again).toBeTruthy();
    await schedules.releaseScheduleLock(schedule.id, again);
  });
});
