import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.E2E_ADMIN_WEB_URL ?? "http://127.0.0.1:3001",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @ai-affiliate/admin-api start",
      url: "http://127.0.0.1:8788/health",
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: "../..",
      env: {
        ...process.env,
        NODE_ENV: "test",
        ADMIN_FORCE_MOCK_ADAPTERS: "true",
        ADMIN_BOOTSTRAP_EMAIL: "admin@localhost",
        ADMIN_BOOTSTRAP_PASSWORD: "change-me-admin",
        ADMIN_API_HOST: "127.0.0.1",
        ADMIN_API_PORT: "8788",
        ADMIN_CORS_ORIGIN: "http://127.0.0.1:3001",
        LLM_MODE: "mock",
        BLOGGER_MODE: "mock",
        PRODUCTION_OPERATION_MODE: "ASSISTED",
      },
    },
    {
      command: "pnpm --filter @ai-affiliate/admin-web start",
      url: "http://127.0.0.1:3001",
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: "../..",
      env: {
        ...process.env,
        PORT: "3001",
        HOSTNAME: "127.0.0.1",
        NEXT_PUBLIC_ADMIN_API_URL: "http://127.0.0.1:8788",
      },
    },
  ],
});
