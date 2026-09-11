/**
 * Build + upload OtonaSelect theme via a one-shot sync plugin.
 *
 *   wp-deploy-otonaselect-theme --apply
 *   wp-deploy-otonaselect-theme --dry-run
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
const THEME_SRC = resolve(HERE, "../../../wordpress-theme/otonaselect");

function wpAuth(config: ReturnType<typeof loadConfig>): { base: string; auth: string } {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) {
    throw new Error("WORDPRESS_* credentials missing");
  }
  return { base, auth: Buffer.from(`${user}:${pass}`).toString("base64") };
}

function buildSyncPluginZip(): { zipPath: string; workDir: string } {
  if (!existsSync(THEME_SRC)) {
    throw new Error(`theme source missing: ${THEME_SRC}`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "otonaselect-theme-sync-"));
  const pluginDir = join(workDir, "otonaselect-theme-sync");
  mkdirSync(pluginDir, { recursive: true });
  cpSync(THEME_SRC, join(pluginDir, "theme-payload"), { recursive: true });

  const pluginPhp = `<?php
/**
 * Plugin Name: OtonaSelect Theme Sync
 * Description: One-shot sync of otonaselect block theme files (v1.6). Safe to deactivate after sync.
 * Version: 1.6.6
 */
declare(strict_types=1);
if (!defined('ABSPATH')) { exit; }

register_activation_hook(__FILE__, static function (): void {
  require_once ABSPATH . 'wp-admin/includes/file.php';
  $src = trailingslashit(plugin_dir_path(__FILE__)) . 'theme-payload';
  $dest = trailingslashit(get_theme_root()) . 'otonaselect';
  if (!is_dir($src)) {
    return;
  }
  if (!is_dir($dest)) {
    wp_mkdir_p($dest);
  }
  $iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::SELF_FIRST
  );
  foreach ($iterator as $item) {
    $target = $dest . DIRECTORY_SEPARATOR . $iterator->getSubPathName();
    if ($item->isDir()) {
      if (!is_dir($target)) {
        wp_mkdir_p($target);
      }
    } else {
      $dir = dirname($target);
      if (!is_dir($dir)) {
        wp_mkdir_p($dir);
      }
      copy($item->getPathname(), $target);
    }
  }
  flush_rewrite_rules(false);
  update_option('otonaselect_tax_rewrite_version', 'otonaselect-tax-rewrite-1.6.4', true);
});
`;
  writeFileSync(join(pluginDir, "otonaselect-theme-sync.php"), pluginPhp, "utf8");

  const zipPath = join(workDir, "otonaselect-theme-sync.zip");
  execFileSync("zip", ["-r", "-q", zipPath, "otonaselect-theme-sync"], { cwd: workDir });
  return { zipPath, workDir };
}

async function installPluginFromZip(
  base: string,
  auth: string,
  zipPath: string,
): Promise<{ ok: boolean; detail: string }> {
  const zip = readFileSync(zipPath);
  const boundary = "----OtonaSelectBoundary" + Date.now();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="pluginzip"; filename="otonaselect-theme-sync.zip"\r\n` +
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
  if (
    upload.status >= 200 &&
    upload.status < 400 &&
    /Plugin installed successfully|プラグインをインストールしました|successfully/i.test(text)
  ) {
    return { ok: true, detail: `upload_status_${upload.status}` };
  }

  return {
    ok: false,
    detail: `upload_status_${upload.status}; snip=${text.slice(0, 240).replace(/\s+/g, " ")}`,
  };
}

async function deleteSyncPlugin(base: string, auth: string): Promise<{ status: number; ok: boolean }> {
  const res = await fetch(
    `${base}/wp-json/wp/v2/plugins/otonaselect-theme-sync%2Fotonaselect-theme-sync?force=true`,
    {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  return { status: res.status, ok: res.status === 200 || res.status === 404 };
}

async function activateAndVerify(base: string, auth: string): Promise<Record<string, unknown>> {
  const activate = await fetch(
    `${base}/wp-json/wp/v2/plugins/otonaselect-theme-sync%2Fotonaselect-theme-sync`,
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

  const contactEmail =
    process.env.WORDPRESS_CONTACT_NOTIFY_EMAIL?.trim() || "kesha.tiktok.m@gmail.com";
  const contactRes = await fetch(`${base}/wp-json/otonaselect/v1/contact-settings`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: contactEmail }),
  });
  const contactSet = {
    status: contactRes.status,
    body: await contactRes.json().catch(() => null),
  };

  const theme = await fetch(`${base}/wp-json/wp/v2/themes/otonaselect?context=edit`, {
    headers: { Authorization: `Basic ${auth}` },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  // Best-effort: push critical HTML templates into FSE customizations if theme files lagged.
  const templatePush: Record<string, unknown> = {};
  for (const slug of ["single", "front-page"] as const) {
    const file = join(THEME_SRC, "templates", `${slug}.html`);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const existing = await fetch(`${base}/wp-json/wp/v2/templates/otonaselect//${slug}?context=edit`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const method = existing.status === 200 ? "POST" : "POST";
    const endpoint =
      existing.status === 200
        ? `${base}/wp-json/wp/v2/templates/otonaselect//${slug}`
        : `${base}/wp-json/wp/v2/templates`;
    const body =
      existing.status === 200
        ? { content, status: "publish" }
        : {
            slug,
            theme: "otonaselect",
            type: "wp_template",
            status: "publish",
            content,
          };
    const res = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    templatePush[slug] = { status: res.status, ok: res.ok };
  }

  return {
    activateStatus: activate.status,
    activate: activateJson,
    contactSet,
    themeVersion: (theme.body as { version?: string } | null)?.version ?? null,
    themeStatus: theme.status,
    templatePush,
  };
}

export async function runWpDeployOtonaselectThemeCli(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const config = loadConfig();
  const { zipPath, workDir } = buildSyncPluginZip();
  const outDir = resolve(HERE, "../../tmp-artifacts");
  mkdirSync(outDir, { recursive: true });
  const savedZip = join(outDir, "otonaselect-theme-sync-1.6.6.zip");
  writeFileSync(savedZip, readFileSync(zipPath));
  const themeZip = join(outDir, "otonaselect-theme-1.6.6.zip");
  execFileSync("zip", ["-r", "-q", themeZip, "otonaselect", "-x", "*.DS_Store"], {
    cwd: resolve(THEME_SRC, ".."),
  });

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          apply: false,
          syncPluginZip: savedZip,
          themeZip,
          note: "Pass --apply to upload/activate sync plugin on production WordPress.",
        },
        null,
        2,
      ),
    );
    rmSync(workDir, { recursive: true, force: true });
    return;
  }

  const { base, auth } = wpAuth(config);
  const deleted = await deleteSyncPlugin(base, auth);
  const installed = await installPluginFromZip(base, auth, zipPath);
  const verify = await activateAndVerify(base, auth);

  // Prefer REST flush after theme files land (also covered by sync activation).
  const flush = await fetch(`${base}/wp-json/otonaselect/v1/flush-rewrites`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));

  console.log(
    JSON.stringify(
      {
        ok: Boolean(verify.themeVersion === "1.6.6" || installed.ok || flush.status === 200),
        apply: true,
        syncPluginZip: savedZip,
        themeZip,
        deleted,
        install: installed,
        verify,
        flush,
      },
      null,
      2,
    ),
  );
  rmSync(workDir, { recursive: true, force: true });
}
