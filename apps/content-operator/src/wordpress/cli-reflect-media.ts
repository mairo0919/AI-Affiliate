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

function jetpackContactContent(toEmail: string): string {
  const options = [
    "サイトについて",
    "掲載内容について",
    "広告・提携について",
    "権利関係について",
    "その他",
  ];
  return `<!-- wp:heading {"level":1} --><h1 class="wp-block-heading">お問い合わせ</h1><!-- /wp:heading -->
<!-- wp:paragraph --><p>掲載内容に関するご連絡、削除・訂正のご依頼、広告・提携のご相談は以下のフォームよりご連絡ください。</p><!-- /wp:paragraph -->
<!-- wp:paragraph --><p>※返信には数営業日いただく場合があります。アフィリエイト成果や個人の購入サポートには回答できないことがあります。</p><!-- /wp:paragraph -->
<!-- wp:jetpack/contact-form {"subject":"[オトナセレクト] お問い合わせ","to":${JSON.stringify(toEmail)},"customThankyou":"message","customThankyouMessage":"お問い合わせを受け付けました。"} -->
<div class="wp-block-jetpack-contact-form">
<!-- wp:jetpack/field-name {"required":true,"label":"お名前"} /-->
<!-- wp:jetpack/field-email {"required":true,"label":"メールアドレス"} /-->
<!-- wp:jetpack/field-select {"required":true,"label":"お問い合わせ種別","options":${JSON.stringify(options)}} /-->
<!-- wp:jetpack/field-textarea {"required":true,"label":"本文"} /-->
<!-- wp:jetpack/button {"element":"button","text":"送信する"} /-->
</div>
<!-- /wp:jetpack/contact-form -->
<!-- wp:paragraph {"fontSize":"small","textColor":"muted"} --><p class="has-muted-color has-text-color has-small-font-size">送信できない場合は時間をおいて再度お試しください。</p><!-- /wp:paragraph -->`;
}

function footerWithEnhance(): string {
  const baseFooter = readFileSync(resolve(THEME, "parts/footer.html"), "utf8");
  const js = readFileSync(resolve(THEME, "assets/front-enhance.js"), "utf8");
  const css = `
.otonaselect-entity-label{color:#666;margin:0 0.35rem 0 0;font-size:0.8125rem}
.otonaselect-article-taxonomy .otonaselect-entity-row{display:flex;flex-wrap:wrap;gap:0.25rem 0.5rem;align-items:baseline;margin:0.15rem 0}
.otonaselect-card .wp-block-post-featured-image img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.otonaselect-card-grid{gap:1.5rem}
@media (max-width:781px){.otonaselect-card-grid{grid-template-columns:1fr!important}}
`;
  const inject = `
<!-- wp:html -->
<style>${css.replace(/\n/g, " ")}</style>
<script>${js}</script>
<!-- /wp:html -->
`;
  return baseFooter.replace(
    "<!-- wp:site-title",
    `${inject}\n\t<!-- wp:site-title`,
  );
}

export async function runWpReflectMediaCli(argv: string[]): Promise<void> {
  const apply = argv.includes("--apply");
  const config = loadConfig();
  const { base, headers } = authHeaders(config);
  const toEmail =
    process.env.WORDPRESS_CONTACT_NOTIFY_EMAIL?.trim() || "kesha.tiktok.m@gmail.com";

  const single = readFileSync(resolve(THEME, "templates/single.html"), "utf8");
  const front = readFileSync(resolve(THEME, "templates/front-page.html"), "utf8");
  const footer = footerWithEnhance();

  if (!apply) {
    console.log(JSON.stringify({ ok: true, apply: false, toEmailSetViaPage: toEmail }, null, 2));
    return;
  }

  const templateResults = [];
  templateResults.push(await pushTemplate(base, headers, "single", single));
  templateResults.push(await pushTemplate(base, headers, "front-page", front));
  const footerResult = await pushTemplatePart(base, headers, "footer", footer);

  const pages = await fetch(`${base}/wp-json/wp/v2/pages?slug=contact&context=edit`, { headers }).then(
    (r) => r.json(),
  );
  const contact = Array.isArray(pages) ? pages[0] : null;
  let contactUpdate: Record<string, unknown> = { ok: false };
  if (contact?.id) {
    const res = await fetch(`${base}/wp-json/wp/v2/pages/${contact.id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: jetpackContactContent(toEmail),
        status: contact.status || "publish",
      }),
    });
    contactUpdate = { ok: res.ok, status: res.status, id: contact.id };
  }

  const database = createDatabaseClient();
  const lifecycle = new LifecycleRepository(database.prisma);
  let categories: unknown = null;
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
        contactUpdate,
        contactNotifyTo: toEmail,
        categories: {
          scanned: (categories as { scanned?: number })?.scanned,
          changed: (categories as { changed?: number })?.changed,
          stillFallback: (categories as { stillFallback?: number })?.stillFallback,
        },
        themeVersion: theme?.version ?? null,
        note: "Theme PHP 1.6 zip remains for manual/plugin sync (analytics admin + custom form). FSE+Jetpack path is live.",
      },
      null,
      2,
    ),
  );
}
