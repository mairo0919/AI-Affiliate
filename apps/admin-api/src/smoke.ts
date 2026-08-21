import { loadConfig } from "@ai-affiliate/config";
import { createAdminStack } from "@ai-affiliate/content-operator/admin";
import { createAdminApp } from "./app.js";

async function main(): Promise<void> {
  loadConfig({ requireDatabaseUrl: false });
  const stack = await createAdminStack();
  const app = await createAdminApp(stack);
  const res = await app.request("/health");
  const body = (await res.json()) as { ok?: boolean };
  if (!res.ok || body.ok !== true) {
    throw new Error(`Smoke failed: ${res.status} ${JSON.stringify(body)}`);
  }
  console.log("admin-api smoke ok", body);
  await stack.disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
