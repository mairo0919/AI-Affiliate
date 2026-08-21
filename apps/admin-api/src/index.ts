import { serve } from "@hono/node-server";
import { loadConfig, validateProductionConfig } from "@ai-affiliate/config";
import { createAdminStack } from "@ai-affiliate/content-operator/admin";
import { createAdminApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  validateProductionConfig(config, { throwOnError: true });
  const stack = await createAdminStack({ config });
  const app = await createAdminApp(stack);
  serve(
    {
      fetch: app.fetch,
      hostname: config.adminApiHost,
      port: config.adminApiPort,
    },
    (info) => {
      console.log(`Admin API listening on http://${info.address}:${info.port}`);
    },
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
