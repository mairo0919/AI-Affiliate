import { PrismaClient } from "@prisma/client";
import { createLogger } from "@ai-affiliate/shared";

const logger = createLogger("info");

export type DatabaseClient = {
  prisma: PrismaClient;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  healthCheck: () => Promise<boolean>;
};

let singleton: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!singleton) {
    singleton = new PrismaClient();
  }
  return singleton;
}

/** Drop singleton so a new PrismaClient picks up updated DATABASE_URL (tests only). */
export async function resetPrismaClientForTests(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect().catch(() => undefined);
  }
  singleton = undefined;
}

export function createDatabaseClient(): DatabaseClient {
  const prisma = getPrismaClient();

  return {
    prisma,
    async connect(): Promise<void> {
      await prisma.$connect();
      logger.info("Database connected");
    },
    async disconnect(): Promise<void> {
      await prisma.$disconnect();
      logger.info("Database disconnected");
    },
    async healthCheck(): Promise<boolean> {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },
  };
}
