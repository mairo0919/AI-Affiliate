/**
 * Reflect theme presentation + contact + categories on live WordPress via REST
 * (no wp-admin zip upload required for FSE/content paths).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { refreshWordPressCategories } from "./refresh-wp-categories.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, "../../../wordpress-theme/otonaselect");

function authHeaders(config: ReturnType<typeof loadConfig>) {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) throw new Error("WORDPRESS_* missing");
  return {
    base,
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  };
}

async function pushTemplate(
  base: string,
  headers: Record<string, string>,
  slug: string,
  content: string,
) {
  const id = `otonaselect//${slug}`;
  const res = await fetch(`${base}/wp-json/wp/v2/templates/${encodeURIComponent(id)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content, status: "publish" }),
  });
  return { slug, status: res.status, ok: res.ok };
}

async function pushTemplatePart(
  base: string,
  headers: Record<string, string>,
  slug: string,
  content: string,
) {
  const id = `otonaselect//${slug}`;
  const get = await fetch(`${base}/wp-json/wp/v2/template-parts/${encodeURIComponent(id)}?context=edit`, {
    headers,
  });
  if (get.status === 200) {
    const res = await fetch(`${base}/wp-json/wp/v2/template-parts/${encodeURIComponent(id)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content, status: "publish" }),
    });
    return { slug, status: res.status, ok: res.ok, mode: "update" };
  }
  const res = await fetch(`${base}/wp-json/wp/v2/template-parts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      slug,
      theme: "otonaselect",
      type: "wp_template_part",
      area: slug === "footer" ? "footer" : "uncategorized",
      status: "publish",
      content,
    }),
  });
  return { slug, status: res.status, ok: res.ok, mode: "create" };
}

function footerWithEnhance(): string {
  const baseFooter = readFileSync(resolve(THEME, "parts/footer.html"), "utf8");
  // Defensive CSS only — card images/empty-state are handled server-side in theme 1.6.1+.
  // front-enhance.js is enqueued from functions.php (taxonomy cleanup + analytics).
  const css = `
.otonaselect-home-query:has(.wp-block-post) .wp-block-query-no-results,
.otonaselect-home-query:has(.otonaselect-card) .otonaselect-home-no-results{display:none!important}
.otonaselect-card .wp-block-post-featured-image{aspect-ratio:16/9;width:100%;overflow:hidden}
.otonaselect-card .wp-block-post-featured-image img{width:100%;height:100%;aspect-ratio:16/9;object-fit:contain;object-position:center;display:block;background:#f3f3f3}
`;
  const inject = `
<!-- wp:html -->
<style id="otonaselect-top-fix">${css.replace(/\n/g, " ")}</style>
<!-- /wp:html -->
`;
  return baseFooter.replace(
    "<!-- wp:site-title",
    `${inject}\n\t<!-- wp:site-title`,
  );
}

function preferMaxOfficialVariant(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").pop() || "";
    let next = file;
    if (/^[a-z0-9_]+(ps|pt)\.(jpe?g|webp|png)$/i.test(file)) {
      next = file.replace(/(ps|pt)\./i, "pl.");
    } else if (/^[a-z0-9_]+js-\d+\.(jpe?g|webp|png)$/i.test(file)) {
      next = file.replace(/js-/i, "jp-");
    } else if (/^[a-z0-9_]+-\d+\.(jpe?g|webp|png)$/i.test(file) && !/j[ps]-\d+\./i.test(file)) {
      next = file.replace(/^([a-z0-9_]+)-(\d+)\./i, "$1jp-$2.");
    }
    if (next === file) return url;
    u.pathname = u.pathname.replace(new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), next);
    return u.toString();
  } catch {
    return url;
  }
}

function pickBestCardImage(html: string): string | null {
  const urls = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]!);
  let best: string | null = null;
  let bestScore = -1;
  for (const raw of urls) {
    let url = raw;
    try {
      url = preferMaxOfficialVariant(raw);
      const host = new URL(url).hostname.toLowerCase();
      if (!/(^|\.)dmm\.co\.jp$|(^|\.)dmm\.com$/i.test(host)) continue;
    } catch {
      continue;
    }
    const file = (url.split("?")[0] || "").split("/").pop() || "";
    let score = 10;
    if (/pl\./i.test(file)) score = 100;
    else if (/jp-\d+\./i.test(file)) score = 80;
    else if (/ps\.|pt\./i.test(file)) score = 50;
    else if (/-\d+\./i.test(file)) score = 30;
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return best;
}

async function backfillCardImages(
  base: string,
  headers: Record<string, string>,
): Promise<{ scanned: number; updated: number }> {
  let updated = 0;
  let scanned = 0;
  for (const status of ["publish", "future"] as const) {
    let page = 1;
    for (;;) {
      const rows = await fetch(
        `${base}/wp-json/wp/v2/posts?status=${status}&per_page=50&page=${page}&context=edit&_fields=id,content,meta`,
        { headers },
      ).then((r) => r.json());
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const post of rows) {
        scanned += 1;
        const existing = post.meta?.otonaselect_card_image;
        const raw = post.content?.raw || "";
        const best = pickBestCardImage(raw);
        if (!best) continue;
        if (typeof existing === "string" && existing === best) continue;
        const res = await fetch(`${base}/wp-json/wp/v2/posts/${post.id}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            meta: { otonaselect_card_image: best },
          }),
        });
        if (res.ok) updated += 1;
      }
      if (rows.length < 50) break;
      page += 1;
      if (page > 20) break;
    }
  }
  return { scanned, updated };
}

export async function runWpReflectMediaCli(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const withCategories = argv.includes("--categories");
  const config = loadConfig();
  const { base, headers } = authHeaders(config);

  const single = readFileSync(resolve(THEME, "templates/single.html"), "utf8");
  const front = readFileSync(resolve(THEME, "templates/front-page.html"), "utf8");
  const footer = footerWithEnhance();

  if (!apply) {
    console.log(JSON.stringify({ ok: true, apply: false }, null, 2));
    return;
  }

  const templateResults = [];
  templateResults.push(await pushTemplate(base, headers, "single", single));
  templateResults.push(await pushTemplate(base, headers, "front-page", front));
  const footerResult = await pushTemplatePart(base, headers, "footer", footer);

  const cardBackfill = await backfillCardImages(base, headers);

  let categories: unknown = null;
  if (withCategories) {
    const database = createDatabaseClient();
    const lifecycle = new LifecycleRepository(database.prisma);
    try {
      categories = await refreshWordPressCategories({
        database,
        lifecycle,
        config,
        apply: true,
      });
    } finally {
      await database.prisma.$disconnect();
    }
  }

  const theme = await fetch(`${base}/wp-json/wp/v2/themes/otonaselect?context=edit`, {
    headers,
  }).then((r) => r.json());

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: true,
        templates: templateResults,
        footer: footerResult,
        cardBackfill,
        categories: categories
          ? {
              scanned: (categories as { scanned?: number })?.scanned,
              changed: (categories as { changed?: number })?.changed,
            }
          : null,
        themeVersion: theme?.version ?? null,
        note: "TOP card images SSR via theme presentation.php; empty-state suppressed when publish>0.",
      },
      null,
      2,
    ),
  );
}
