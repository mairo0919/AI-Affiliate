import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  JobRepository,
  JobStateError,
  LockError,
  buildLockKey,
} from "./job-repository.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(rootDir, ".env") });

const prisma = new PrismaClient();
const jobs = new JobRepository(prisma);

async function cleanupJobs(): Promise<void> {
  await prisma.researchNotificationAttempt.deleteMany();
  await prisma.researchNotification.deleteMany();
  await prisma.researchScheduleLock.deleteMany();
  await prisma.researchScheduleRun.deleteMany();
  await prisma.researchSchedule.deleteMany();
  await prisma.researchJobError.deleteMany();
  await prisma.researchJobLock.deleteMany();
  await prisma.researchJob.deleteMany();
}

describe("JobRepository", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await cleanupJobs();
  });

  afterAll(async () => {
    await cleanupJobs();
    await prisma.$disconnect();
  });

  it("rejects invalid state transitions", async () => {
    const job = await jobs.createJob({
      providerName: "mock",
      jobType: "SINGLE_PAGE",
      parameters: { floor: "videoa" },
    });
    await jobs.startJob(job.id);
    await jobs.completeJob(job.id);
    await expect(jobs.startJob(job.id)).rejects.toBeInstanceOf(JobStateError);
    await expect(jobs.updateProgress(job.id, { fetchedCount: 1 })).rejects.toBeInstanceOf(
      JobStateError,
    );
  });

  it("cannot cancel completed jobs", async () => {
    const job = await jobs.createJob({
      providerName: "mock",
      jobType: "SINGLE_PAGE",
      parameters: {},
    });
    await jobs.startJob(job.id);
    await jobs.completeJob(job.id);
    await expect(jobs.cancelJob(job.id)).rejects.toBeInstanceOf(JobStateError);
  });

  it("acquires expired locks and blocks active locks", async () => {
    const key = buildLockKey({ providerName: "mock", floor: "videoa" });
    const job1 = await jobs.createJob({
      providerName: "mock",
      jobType: "SINGLE_PAGE",
      parameters: {},
    });
    const job2 = await jobs.createJob({
      providerName: "mock",
      jobType: "SINGLE_PAGE",
      parameters: {},
    });

    await jobs.acquireLock(key, job1.id, 60_000);
    await expect(jobs.acquireLock(key, job2.id, 60_000)).rejects.toBeInstanceOf(LockError);

    await prisma.researchJobLock.update({
      where: { lockKey: key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(jobs.acquireLock(key, job2.id, 60_000)).resolves.toBeUndefined();
  });

  it("refreshes lock expiry via heartbeat", async () => {
    const key = buildLockKey({ providerName: "mock", floor: "a" });
    const job = await jobs.createJob({
      providerName: "mock",
      jobType: "SINGLE_PAGE",
      parameters: {},
    });
    await jobs.acquireLock(key, job.id, 1000);
    const before = await prisma.researchJobLock.findUniqueOrThrow({ where: { lockKey: key } });
    await jobs.refreshLock(key, job.id, 60_000);
    const after = await prisma.researchJobLock.findUniqueOrThrow({ where: { lockKey: key } });
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it("builds stable lock keys regardless of object insertion order", () => {
    const a = buildLockKey({
      providerName: "fanza",
      keyword: "x",
      service: "digital",
      floor: "videoa",
    });
    const b = buildLockKey({
      floor: "videoa",
      providerName: "fanza",
      service: "digital",
      keyword: "x",
    });
    expect(a).toBe(b);
  });

  it("sanitized fail messages are stored as provided", async () => {
    const job = await jobs.createJob({
      providerName: "mock",
      jobType: "SINGLE_PAGE",
      parameters: {},
    });
    await jobs.startJob(job.id);
    await jobs.failJob(job.id, "configuration incomplete");
    const saved = await jobs.findJobById(job.id);
    expect(saved?.errorMessage).toBe("configuration incomplete");
    expect(saved?.errorMessage).not.toContain("api_id");
  });
});
