import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  JobRepository,
  JobStateError,
  LockError,
  buildLockKey,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { CollectionJobRunner } from "./collection-job-runner.js";
import { ConfigurationError } from "../providers/fanza/dmm-api-error.js";
import { MockPaginatedProvider, buildMockItem } from "../providers/mock/paginated.js";

loadConfig({ requireDatabaseUrl: false });

const database = createDatabaseClient();
const jobs = new JobRepository(database.prisma);
const logger = createLogger("error");

async function cleanup(): Promise<void> {
  await database.prisma.researchNotificationAttempt.deleteMany();
  await database.prisma.researchNotification.deleteMany();
  await database.prisma.researchJobError.deleteMany();
  await database.prisma.researchJobLock.deleteMany();
  await database.prisma.researchJob.deleteMany({
    where: { providerName: "mock" },
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

function createRunner(intervalMs = 0): CollectionJobRunner {
  return new CollectionJobRunner({
    logger,
    database,
    jobs,
    requestIntervalMs: intervalMs,
    sleepImpl: async () => undefined,
    lockTtlMs: 60_000,
  });
}

describe("CollectionJobRunner", () => {
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

  it("completes a single page collection", async () => {
    const provider = new MockPaginatedProvider([
      {
        offset: 1,
        items: [buildMockItem("job-mock-1")],
        nextOffset: null,
      },
    ]);
    const result = await createRunner().run(provider, {
      floor: "videoa",
      hits: 100,
      maxPages: 1,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.pagesProcessed).toBe(1);
    expect(result.fetchedCount).toBe(1);
    expect(result.savedCount).toBe(1);
  });

  it("paginates with nextOffset across 3 pages", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-p1")], nextOffset: 2 },
      { offset: 2, items: [buildMockItem("job-mock-p2")], nextOffset: 3 },
      { offset: 3, items: [buildMockItem("job-mock-p3")], nextOffset: null },
    ]);
    const result = await createRunner().run(provider, {
      floor: "videoa",
      hits: 1,
      maxPages: 10,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.pagesProcessed).toBe(3);
    expect(result.fetchedCount).toBe(3);
  });

  it("stops at maxPages", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-m1")], nextOffset: 2 },
      { offset: 2, items: [buildMockItem("job-mock-m2")], nextOffset: 3 },
      { offset: 3, items: [buildMockItem("job-mock-m3")], nextOffset: 4 },
    ]);
    const result = await createRunner().run(provider, {
      floor: "videoa",
      hits: 1,
      maxPages: 2,
    });
    expect(result.pagesProcessed).toBe(2);
    expect(result.nextOffset).toBe(3);
  });

  it("stops at maxItems", async () => {
    const provider = new MockPaginatedProvider([
      {
        offset: 1,
        items: [buildMockItem("job-mock-i1"), buildMockItem("job-mock-i2")],
        nextOffset: 3,
      },
      {
        offset: 3,
        items: [buildMockItem("job-mock-i3")],
        nextOffset: null,
      },
    ]);
    const result = await createRunner().run(provider, {
      floor: "videoa",
      hits: 2,
      maxPages: 10,
      maxItems: 2,
    });
    expect(result.pagesProcessed).toBe(1);
    expect(result.fetchedCount).toBe(2);
  });

  it("stops when nextOffset is null", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-n1")], nextOffset: null },
    ]);
    const result = await createRunner().run(provider, { maxPages: 5, hits: 1 });
    expect(result.pagesProcessed).toBe(1);
    expect(result.nextOffset).toBeNull();
  });

  it("stops when fetched count is 0", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [], nextOffset: 2 },
    ]);
    const result = await createRunner().run(provider, { maxPages: 5, hits: 10 });
    expect(result.pagesProcessed).toBe(1);
    expect(result.fetchedCount).toBe(0);
  });

  it("stops when nextOffset repeats", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-loop")], nextOffset: 1 },
    ]);
    const result = await createRunner().run(provider, { maxPages: 5, hits: 1 });
    expect(result.pagesProcessed).toBe(1);
  });

  it("does not duplicate items and appends metrics on re-run", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-dup")], nextOffset: null },
    ]);
    const runner = createRunner();
    await runner.run(provider, { floor: "dup", maxPages: 1, hits: 1 });
    await runner.run(provider, { floor: "dup-2", maxPages: 1, hits: 1 });

    const items = await database.prisma.researchItem.findMany({
      where: { externalId: "job-mock-dup" },
      include: { metrics: true },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.metrics.length).toBeGreaterThanOrEqual(2);
  });

  it("dryRun does not save ResearchItems but keeps job history", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-dry")], nextOffset: null },
    ]);
    const result = await createRunner().run(provider, {
      floor: "dry",
      dryRun: true,
      maxPages: 1,
      hits: 1,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.savedCount).toBe(0);
    const items = await database.prisma.researchItem.findMany({
      where: { externalId: "job-mock-dry" },
    });
    expect(items).toHaveLength(0);
    const job = await jobs.findJobById(result.jobId);
    expect(job?.status).toBe("COMPLETED");
    expect((job?.parameters as { dryRun?: boolean }).dryRun).toBe(true);
  });

  it("records item errors and becomes PARTIALLY_COMPLETED", async () => {
    const provider = new MockPaginatedProvider([
      {
        offset: 1,
        items: [buildMockItem("job-mock-partial")],
        nextOffset: null,
        errorCount: 2,
      },
    ]);
    const result = await createRunner().run(provider, {
      floor: "partial",
      maxPages: 1,
      hits: 1,
      continueOnItemError: true,
    });
    expect(result.status).toBe("PARTIALLY_COMPLETED");
    expect(result.errorCount).toBe(2);
  });

  it("fails with FAILED when first page has fatal error", async () => {
    const provider = new MockPaginatedProvider([
      {
        offset: 1,
        items: [],
        nextOffset: null,
        throwError: new ConfigurationError("configuration incomplete"),
      },
    ]);
    const result = await createRunner().run(provider, { floor: "fail", maxPages: 1 });
    expect(result.status).toBe("FAILED");
    const job = await jobs.findJobById(result.jobId);
    expect(job?.errorMessage).not.toContain("api_id");
    expect(job?.errorMessage).not.toContain("affiliate");
  });

  it("becomes PARTIALLY_COMPLETED after a successful page then a later error", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-ok")], nextOffset: 2 },
      {
        offset: 2,
        items: [],
        nextOffset: null,
        throwError: new Error("temporary page failure"),
      },
    ]);
    const result = await createRunner().run(provider, { floor: "half", maxPages: 5, hits: 1 });
    expect(result.status).toBe("PARTIALLY_COMPLETED");
    expect(result.pagesProcessed).toBe(1);
  });

  it("prevents concurrent jobs with the same lock key", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-lock")], nextOffset: null },
    ]);
    const key = buildLockKey({ providerName: "mock", floor: "lock-test" });
    const blocker = await jobs.createJob({
      providerName: "mock",
      jobType: "SINGLE_PAGE",
      parameters: {},
    });
    await jobs.acquireLock(key, blocker.id, 60_000);

    await expect(
      createRunner().run(provider, { floor: "lock-test", maxPages: 1, hits: 1 }),
    ).rejects.toBeInstanceOf(LockError);

    await jobs.releaseLock(key, blocker.id);
  });

  it("can cancel a running job between pages", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-c1")], nextOffset: 2 },
      { offset: 2, items: [buildMockItem("job-mock-c2")], nextOffset: null },
    ]);

    let jobId: string | undefined;
    const result = await new CollectionJobRunner({
      logger,
      database,
      jobs,
      requestIntervalMs: 1,
      sleepImpl: async () => {
        if (!jobId) {
          const recent = await jobs.listRecentJobs(5);
          jobId = recent.find((job) => job.status === "RUNNING")?.id;
        }
        if (jobId) {
          await jobs.cancelJob(jobId);
        }
      },
      lockTtlMs: 60_000,
    }).run(provider, { floor: "cancel-unique", maxPages: 5, hits: 1 });

    expect(result.status).toBe("CANCELLED");
    expect(result.pagesProcessed).toBe(1);
    await expect(jobs.cancelJob(result.jobId)).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("cannot cancel a completed job", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-done")], nextOffset: null },
    ]);
    const result = await createRunner().run(provider, { floor: "done", maxPages: 1, hits: 1 });
    expect(result.status).toBe("COMPLETED");
    await expect(jobs.cancelJob(result.jobId)).rejects.toBeInstanceOf(JobStateError);
  });

  it("resumes from saved nextOffset without rewriting source job", async () => {
    const provider = new MockPaginatedProvider([
      { offset: 1, items: [buildMockItem("job-mock-r1")], nextOffset: 2 },
      { offset: 2, items: [buildMockItem("job-mock-r2")], nextOffset: null },
    ]);

    // Create a failed/partial source job with nextOffset=2
    const source = await jobs.createJob({
      providerName: "mock",
      jobType: "PAGINATED_COLLECTION",
      parameters: { floor: "resume", hits: 1, maxPages: 5 },
      currentOffset: 1,
      nextOffset: 2,
    });
    await jobs.startJob(source.id);
    await jobs.partiallyCompleteJob(source.id, "stopped");

    const result = await createRunner().resume(provider, source.id);
    expect(result.jobId).not.toBe(source.id);
    expect(result.fetchedCount).toBeGreaterThanOrEqual(1);
    const sourceAfter = await jobs.findJobById(source.id);
    expect(sourceAfter?.status).toBe("PARTIALLY_COMPLETED");
    const resumed = await jobs.findJobById(result.jobId);
    expect(resumed?.resumedFromJobId).toBe(source.id);
  });
});
