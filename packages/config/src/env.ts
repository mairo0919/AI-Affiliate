import { config as loadDotenv } from "dotenv";
import type { LogLevel } from "@ai-affiliate/shared";

export interface AppConfig {
  nodeEnv: string;
  logLevel: LogLevel;
  databaseUrl: string | undefined;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

export function loadConfig(): AppConfig {
  loadDotenv();

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    databaseUrl: process.env.DATABASE_URL || undefined,
  };
}
