import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { PrismaClient } from "@prisma/client";

export class TestDatabaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TestDatabaseError";
    this.code = code;
  }
}

export interface DatabaseIdentity {
  host: string;
  port: string;
  database: string;
  schema: string;
  normalizedKey: string;
}

const FORBIDDEN_DATABASE_NAMES = new Set([
  "ai_affiliate",
  "postgres",
  "template0",
  "template1",
]);

/** Parse connection identity without logging credentials. */
export function parseDatabaseIdentity(url: string): DatabaseIdentity {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TestDatabaseError("invalid_database_url", "Database URL could not be parsed");
  }
  const database = decodeURIComponent((parsed.pathname || "").replace(/^\//, "").split("/")[0] ?? "");
  const schema = parsed.searchParams.get("schema") ?? "public";
  const host = (parsed.hostname || "").toLowerCase();
  const port = parsed.port || (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:" ? "5432" : "");
  if (!database) {
    throw new TestDatabaseError("invalid_database_url", "Database name missing from URL");
  }
  return {
    host,
    port,
    database,
    schema,
    normalizedKey: `${host}:${port}/${database}?schema=${schema}`,
  };
}

function loadRootEnvFiles(): void {
  // Walk up from cwd so filter-package vitest finds monorepo root .env
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const path = resolve(dir, ".env");
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
      return;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
}

/**
 * Vitest / NODE_ENV=test must use TEST_DATABASE_URL exclusively.
 * Never falls back to development DATABASE_URL.
 *
 * When DATABASE_URL and TEST_DATABASE_URL already both point at the same
 * dedicated test DB (CI), that is allowed. Pointing either at a development
 * DB name (e.g. ai_affiliate without "test") is always refused.
 */
export function applyTestDatabaseUrlFromEnv(): DatabaseIdentity {
  loadRootEnvFiles();
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new TestDatabaseError(
      "not_test_env",
      "applyTestDatabaseUrlFromEnv requires NODE_ENV=test or VITEST=true",
    );
  }

  const testUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
  const priorUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!testUrl) {
    throw new TestDatabaseError(
      "test_database_url_missing",
      "TEST_DATABASE_URL is required for tests. Refusing to use development DATABASE_URL.",
    );
  }

  const testId = parseDatabaseIdentity(testUrl);
  assertAllowedTestDatabaseIdentity(testId);

  if (priorUrl) {
    const priorId = parseDatabaseIdentity(priorUrl);
    if (testId.normalizedKey === priorId.normalizedKey) {
      // CI often sets both to the dedicated test DB — allowed only if it is a test DB.
      assertAllowedTestDatabaseIdentity(priorId);
    }
    // Local: prior DATABASE_URL is development and TEST differs — OK; we overwrite below.
  }

  process.env.DATABASE_URL = testUrl;
  process.env.TEST_DATABASE_URL = testUrl;
  return testId;
}

export function assertAllowedTestDatabaseIdentity(identity: DatabaseIdentity): void {
  const db = identity.database.toLowerCase();
  if (FORBIDDEN_DATABASE_NAMES.has(db)) {
    throw new TestDatabaseError(
      "forbidden_database_name",
      `Refusing destructive/test use of database "${identity.database}". Use a dedicated test database (e.g. ai_affiliate_test).`,
    );
  }
  if (!db.includes("test")) {
    throw new TestDatabaseError(
      "database_name_must_include_test",
      `Test database name must include "test" (got "${identity.database}")`,
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new TestDatabaseError("production_forbidden", "Destructive DB ops forbidden in production");
  }
}

/**
 * Guard for deleteMany / truncate / reset. Call before any destructive cleanup.
 */
export function assertDestructiveTestDatabaseAllowed(prisma?: PrismaClient): DatabaseIdentity {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new TestDatabaseError(
      "destructive_requires_test_env",
      "Destructive DB operations require NODE_ENV=test (or VITEST=true)",
    );
  }
  const activeUrl = process.env.DATABASE_URL?.trim() ?? "";
  const testUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
  if (!testUrl) {
    throw new TestDatabaseError(
      "test_database_url_missing",
      "TEST_DATABASE_URL is required before destructive DB operations",
    );
  }
  if (!activeUrl) {
    throw new TestDatabaseError("database_url_missing", "DATABASE_URL is not set for tests");
  }
  const activeId = parseDatabaseIdentity(activeUrl);
  const testId = parseDatabaseIdentity(testUrl);
  if (activeId.normalizedKey !== testId.normalizedKey) {
    throw new TestDatabaseError(
      "active_db_is_not_test_db",
      `Active DATABASE_URL (${activeId.normalizedKey}) is not TEST_DATABASE_URL (${testId.normalizedKey})`,
    );
  }
  assertAllowedTestDatabaseIdentity(activeId);
  void prisma;
  return activeId;
}

/** Shared lifecycle cleanup for integration tests — guard then delete. */
export async function cleanupLifecycleTablesForTests(prisma: PrismaClient): Promise<void> {
  assertDestructiveTestDatabaseAllowed(prisma);
  await prisma.learningRuleApplication.deleteMany();
  await prisma.learningRuleConflict.deleteMany();
  await prisma.strategyFeedback.deleteMany();
  await prisma.learningRule.deleteMany();
  await prisma.editorialExperience.deleteMany();
  await prisma.editorialBrainRun.deleteMany();
  await prisma.articleStructureObservation.deleteMany();
  await prisma.articleFormatDefinition.deleteMany();
  await prisma.linkReplacementEvent.deleteMany();
  await prisma.productLinkUsage.deleteMany();
  await prisma.analyticsSnapshot.deleteMany();
  await prisma.publicationRecord.deleteMany();
  await prisma.publicationTarget.deleteMany();
  await prisma.revisionAction.deleteMany();
  await prisma.qualityReviewRecord.deleteMany();
  await prisma.policyEvaluation.deleteMany();
  await prisma.contentVersionClaim.deleteMany();
  await prisma.claimSource.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.contentVersion.deleteMany();
  await prisma.content.deleteMany();
  await prisma.contentStrategy.deleteMany();
  await prisma.topicCandidate.deleteMany();
  await prisma.researchFinding.deleteMany();
  await prisma.sourceDocument.deleteMany();
  await prisma.productLink.deleteMany();
  await prisma.productSnapshot.deleteMany();
  await prisma.affiliateProduct.deleteMany();
  await prisma.costRecord.deleteMany();
  await prisma.modelRun.deleteMany();
  await prisma.operatorJob.deleteMany();
}
