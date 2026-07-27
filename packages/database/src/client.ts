import { createLogger } from "@ai-affiliate/shared";

const logger = createLogger("info");

export interface DatabaseClient {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function createDatabaseClient(databaseUrl: string | undefined): DatabaseClient {
  let connected = false;

  return {
    async connect(): Promise<void> {
      if (connected) {
        return;
      }

      if (!databaseUrl) {
        logger.warn("DATABASE_URL is not set; database client remains a stub");
      } else {
        logger.info("Database client stub ready (connection not implemented yet)");
      }

      connected = true;
    },

    async disconnect(): Promise<void> {
      if (!connected) {
        return;
      }
      connected = false;
      logger.info("Database client disconnected");
    },
  };
}
