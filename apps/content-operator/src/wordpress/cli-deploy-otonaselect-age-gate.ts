/**
 * Build + upload OtonaSelect Age Gate plugin (works even when theme PHP sync lags).
 *
 *   wp-deploy-otonaselect-age-gate --apply
 *   wp-deploy-otonaselect-age-gate --dry-run
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@ai-affiliate/config";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_SRC = resolve(HERE, "../../../wordpress-plugins/otonaselect-age-gate");

function wpAuth(config: ReturnType<typeof loadConfig>): { base: string; auth: string } {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) {
    throw new Error("WORDPRESS_* credentials missing");
  }
  return { base, auth: Buffer.from(`${user}:${pass}`).toString("base64") };
}

function buildPluginZip(): { zipPath: string; workDir: string } {
  if (!existsSync(PLUGIN_SRC)) {
    throw new Error(`plugin source missing: ${PLUGIN_SRC}`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "otonaselect-age-gate-"));
  const pluginDir = join(workDir, "otonaselect-age-gate");
  mkdirSync(pluginDir, { recursive: true });
  cpSync(PLUGIN_SRC, pluginDir, { recursive: true });
  const zipPath = join(workDir, "otonaselect-age-gate.zip");
  execFileSync("zip", ["-r", "-q", zipPath, "otonaselect-age-gate"], { cwd: workDir });
  return { zipPath, workDir };
}

async function installPluginFromZip(
  base: string,
  auth: string,
  zipPath: string,
): Promise<{ ok: boolean; detail: string; status: number }> {
  const zip = readFileSync(zipPath);
  const boundary = "----OtonaSelectAgeGate" + Date.now();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="pluginzip"; filename="otonaselect-age-gate.zip"\r\n` +
        `Content-Type: application/zip\r\n\r\n`,
    ),
    zip,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="install-plugin-submit"\r\n\r\nInstall Now\r\n`,
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  const upload = await fetch(`${base}/wp-admin/update.php?action=upload-plugin`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    redirect: "manual",
  });
  const text = await upload.text();
  const ok =
    upload.status >= 200 &&
    upload.status < 400 &&
    /Plugin installed successfully|プラグインをインストールしました|successfully/i.test(text);
  return {
    ok,
    status: upload.status,
    detail: ok
      ? `upload_status_${upload.status}`
      : `upload_status_${upload.status}; snip=${text.slice(0, 240).replace(/\s+/g, " ")}`,
  };
}

export async function runWpDeployOtonaselectAgeGateCli(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const config = loadConfig();
  const { zipPath, workDir } = buildPluginZip();
  const outDir = resolve(HERE, "../../tmp-artifacts");
  mkdirSync(outDir, { recursive: true });
  const savedZip = join(outDir, "otonaselect-age-gate-1.0.3.zip");
  writeFileSync(savedZip, readFileSync(zipPath));

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          apply: false,
          pluginZip: savedZip,
          note: "Pass --apply to upload/activate on production WordPress.",
        },
        null,
        2,
      ),
    );
    rmSync(workDir, { recursive: true, force: true });
    return;
  }

  const { base, auth } = wpAuth(config);
  const installed = await installPluginFromZip(base, auth, zipPath);

  const activate = await fetch(
    `${base}/wp-json/wp/v2/plugins/otonaselect-age-gate%2Fotonaselect-age-gate`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "active" }),
    },
  );
  const activateJson = await activate.json().catch(() => null);

  // Verify gate HTML without age cookie.
  const gateRes = await fetch(`${base}/?age_gate_verify=${Date.now()}`, {
    headers: {
      "cache-control": "no-cache",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
    redirect: "manual",
  });
  const gateHtml = await gateRes.text();
  const verify = {
    activateStatus: activate.status,
    activate: activateJson,
    gateStatus: gateRes.status,
    hasBrand: gateHtml.includes("オトナセレクト"),
    hasAccept: gateHtml.includes("18歳以上です"),
    hasDeny: gateHtml.includes("18歳未満です"),
    hasAdultImg: /awsimgsrc\.dmm\.co\.jp|otonaselect-card-image/i.test(gateHtml),
    hasForm: /name="otonaselect_age"/.test(gateHtml),
  };

  console.log(
    JSON.stringify(
      {
        ok: Boolean(verify.hasAccept && verify.hasDeny && !verify.hasAdultImg),
        apply: true,
        pluginZip: savedZip,
        install: installed,
        verify,
      },
      null,
      2,
    ),
  );
  rmSync(workDir, { recursive: true, force: true });
}
