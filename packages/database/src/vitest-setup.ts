import { applyTestDatabaseUrlFromEnv } from "./test-database.js";
import { resetPrismaClientForTests } from "./client.js";

process.env.NODE_ENV = "test";
process.env.VITEST = "true";

// Production may set EDITORIAL_BRAIN_MODE=ACTIVE in .env; unit tests default to SHADOW.
// ACTIVE behavior is covered via withEditorialBrainModeOverride("ACTIVE", ...).
process.env.EDITORIAL_BRAIN_MODE = "SHADOW";

const identity = applyTestDatabaseUrlFromEnv();
await resetPrismaClientForTests();

if (process.env.LOG_LEVEL === "debug") {
  console.info(`[vitest] using test database ${identity.normalizedKey}`);
}
