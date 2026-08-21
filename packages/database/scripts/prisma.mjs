import { config as loadDotenv } from "dotenv";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");

loadDotenv({ path: resolve(repoRoot, ".env") });
loadDotenv({ path: resolve(packageRoot, ".env"), override: true });

const args = process.argv.slice(2);
const result = spawnSync("prisma", args, {
  cwd: packageRoot,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
