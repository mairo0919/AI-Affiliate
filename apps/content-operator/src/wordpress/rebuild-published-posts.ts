/**
 * Bring published WordPress posts onto the current article layout (which prints the linked
 * official title), and give a new headline to posts whose headline copies the official title.
 * Only the post body and title change; dates, status, slug, and taxonomies stay as they are.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig, type AppConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient, type DatabaseClient } from "@ai-affiliate/database";
import { bindLlmExecutionStore } from "../adapters/llm/llm-execution-binding.js";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { createPrismaLlmRunStore } from "../adapters/llm/llm-execution-prisma-store.js";
import { readLlmSafety, settleWpRuns } from "../adapters/llm/wp-article-safety.js";
import {
  createWordPressPublisherFromConfig,
  type WordPressApiPublisher,
} from "../adapters/publisher/wordpress-api-publisher.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { BLOG_CTA_CLASS, BLOG_WORK_TITLE_CLASS, renderCtaBlock, renderWorkTitleBlock } from "../generation/blogger-formatter.js";
import { auxiliaryFindingRationale } from "../generation/canonical-article-pipeline.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { extractItemListCatalogFacts } from "../stock/ensure-official-enrichment.js";
import { evaluateStockArticleQualityGate, WP_TITLE_OFFICIAL_RUN_LIMIT } from "../stock/stock-quality-gate.js";
import { longestTitleSliceInPost } from "../x/x-copy-quality.js";
import { renderCurrentWordPressBody, type WordPressPublishPathDeps } from "./wordpress-publish-path.js";

/** What a reader sees in a body, to check a rebuild does not drop anything. */
export function bodyInventory(html: string) {
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  return {
    images: count(/<img\b/g),
    ctas: count(new RegExp(`class="${BLOG_CTA_CLASS}"`, "g")),
    workTitle: count(/class="blog-work-title"/g),
    notes: count(/class="blog-meta-note"/g),
    headings: count(/<h[2-4]\b/g),
    textLength: html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length,
  };
}

export type BodyInventory = ReturnType<typeof bodyInventory>;

/** Reasons the rebuilt body would show the reader less than the live one. */
export function inventoryLosses(before: BodyInventory, after: BodyInventory): string[] {
  const losses: string[] = [];
  if (after.images < before.images) losses.push(`images ${before.images}->${after.images}`);
  if (after.ctas < before.ctas) losses.push(`ctas ${before.ctas}->${after.ctas}`);
  if (after.notes < before.notes) losses.push(`notes ${before.notes}->${after.notes}`);
  if (after.textLength < before.textLength * 0.8) losses.push(`text ${before.textLength}->${after.textLength}`);
  return losses;
}

export function liveCtaUrl(html: string): string | null {
  const match = new RegExp(`<p class="${BLOG_CTA_CLASS}"><a href="([^"]+)"`).exec(html);
  return match ? match[1]!.replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&") : null;
}

/** The article prose (unclassed paragraphs), to tell a layout change from a text change. */
export function articleProse(html: string): string {
  return (html.match(/<p>[\s\S]*?<\/p>/g) ?? []).map((p) => p.replace(/<[^>]+>/g, "").trim()).join("\n");
}

/**
 * Keep the live text and bring only the layout in line: the standard CTA markup and the
 * linked official title before the first CTA. Null when the post has no standard CTA.
 */
export function restyleLiveBody(html: string, workTitle: string, ctaUrl: string): string | null {
  const ctaRe = new RegExp(`<p class="${BLOG_CTA_CLASS}">([\\s\\S]*?)<\\/p>`, "g");
  if (!html.includes(`<p class="${BLOG_CTA_CLASS}">`)) return null;
  const withoutOldTitle = html.replace(new RegExp(`<p class="${BLOG_WORK_TITLE_CLASS}">[\\s\\S]*?<\\/p>\\n?`, "g"), "");
  let first = true;
  return withoutOldTitle.replace(ctaRe, (_whole, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, "").trim() || "詳細を確認";
    const cta = renderCtaBlock({ label, url: ctaUrl });
    if (!first) return cta;
    first = false;
    return `${renderWorkTitleBlock(workTitle, ctaUrl)}\n${cta}`;
  });
}

/** A body published as unconverted markdown: image syntax and a bare "label: URL" CTA shown as text. */
export function isUnrenderedMarkdownBody(html: string): boolean {
  // WordPress stores such a body without <p> tags; the theme adds them when rendering.
  return /^(?:<p>)?!\[[^\]]*\]\(https?:/m.test(html) || /^(?:<p>)?詳細を確認: https?:/m.test(html);
}

export type RebuildRow = {
  externalId: string;
  cid: string | null;
  result: "UPDATED" | "WOULD_UPDATE" | "UNCHANGED" | "SKIPPED" | "FAILED";
  reason?: string;
  titleBefore: string;
  titleAfter?: string;
  titleCopyRun?: number;
  /** Why a copied headline was left as it is. */
  titleError?: string;
  ctaBefore?: string | null;
  ctaAfter?: string;
  /** RENDERED: rebuilt from the stored article. KEPT_TEXT: live text kept, layout aligned. */
  mode?: "RENDERED" | "KEPT_TEXT";
  keptTextBecause?: string;
  /** The live body was unconverted markdown; the rebuild replaces it whole. */
  repairsMarkdown?: boolean;
  before?: BodyInventory;
  after?: BodyInventory;
  /** Live body before the change, kept so an update can be undone. */
  backup?: string;
};

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function rebuildPublishedPosts(deps: {
  database: DatabaseClient;
  config: AppConfig;
  apply: boolean;
  /** Ask the writer for a new headline when the current one copies the official title. */
  rewriteTitles: boolean;
  externalIds?: string[];
  limit?: number;
  /** Headlines already proposed by an earlier run (externalId → title), used instead of asking again. */
  titleMap?: Record<string, string>;
}): Promise<RebuildRow[]> {
  const prisma = deps.database.prisma;
  const lifecycle = new LifecycleRepository(prisma);
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const pathDeps: WordPressPublishPathDeps = {
    config: deps.config,
    lifecycle,
    prisma: prisma as unknown as WordPressPublishPathDeps["prisma"],
  };
  let generation: ContentGenerationService | null = null;
  if (deps.rewriteTitles) {
    bindLlmExecutionStore(createPrismaLlmRunStore(prisma));
    generation = new ContentGenerationService(lifecycle, requireApiLLMProvider(deps.config), {
      generation: deps.config.llmModelGeneration,
      writer: deps.config.llmModelWriter,
      review: deps.config.llmModelReview,
      revision: deps.config.llmModelRevision,
    });
  }

  const targets = await prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: "PUBLISHED",
      publishedExternalId: deps.externalIds?.length ? { in: deps.externalIds } : { not: null },
    },
    select: { publishedExternalId: true, platformMetadata: true, contentVersionId: true },
    orderBy: { createdAt: "asc" },
    ...(deps.limit ? { take: deps.limit } : {}),
  });

  const rows: RebuildRow[] = [];
  for (const target of targets) {
    const externalId = String(target.publishedExternalId);
    const version = await prisma.contentVersion.findUnique({
      where: { id: target.contentVersionId },
      select: { id: true, title: true, summary: true, structuredContent: true },
    });
    const row: RebuildRow = { externalId, cid: null, result: "SKIPPED", titleBefore: version?.title ?? "" };
    rows.push(row);
    try {
      if (!version) {
        row.reason = "CONTENT_VERSION_MISSING";
        continue;
      }
      const meta = rec(target.platformMetadata);
      const sc = rec(version.structuredContent);
      const cidRaw = meta.productCanonicalId ?? meta.canonicalId ?? meta.productKey ?? sc.productCanonicalId ?? sc.canonicalId;
      row.cid = typeof cidRaw === "string" && cidRaw.trim() ? cidRaw.trim().toLowerCase() : null;
      const item = row.cid
        ? await prisma.researchItem.findFirst({
            where: { externalId: { equals: row.cid, mode: "insensitive" } },
            orderBy: { collectedAt: "desc" },
            select: { title: true, rawData: true },
          })
        : null;
      if (!item) {
        row.reason = "RESEARCH_ITEM_MISSING";
        continue;
      }

      const live = await publisher.getRawContent(externalId);
      row.before = bodyInventory(live);
      row.ctaBefore = liveCtaUrl(live);
      const raw = rec(item.rawData);
      const affiliate = validateFanzaAffiliateUrl(
        (typeof raw.affiliateURL === "string" && raw.affiliateURL) || row.ctaBefore,
      );
      const ctaUrl = affiliate.url ?? row.ctaBefore;
      if (!ctaUrl) {
        row.reason = "CTA_URL_MISSING";
        continue;
      }
      row.ctaAfter = ctaUrl;

      const rendered = await renderCurrentWordPressBody({
        deps: pathDeps,
        version,
        productCanonicalId: row.cid,
        ctaUrl,
        workTitle: item.title,
      });
      // A post whose live text differs from the stored article keeps its text: the rebuild
      // aligns the layout, it does not swap what readers already see.
      let html: string | null = null;
      row.repairsMarkdown = isUnrenderedMarkdownBody(live);
      if (!rendered.ok) {
        row.keptTextBecause = rendered.reason;
      } else if (row.repairsMarkdown) {
        html = rendered.html;
      } else if (articleProse(rendered.html) !== articleProse(live)) {
        row.keptTextBecause = "LIVE_TEXT_DIFFERS";
      } else {
        const losses = inventoryLosses(row.before, bodyInventory(rendered.html));
        if (losses.length) row.keptTextBecause = `WOULD_LOSE:${losses.join(";")}`;
        else html = rendered.html;
      }
      row.mode = html ? "RENDERED" : "KEPT_TEXT";
      html ??= restyleLiveBody(live, item.title, ctaUrl);
      if (!html) {
        row.reason = "NO_STANDARD_CTA";
        continue;
      }
      row.after = bodyInventory(html);
      // Markdown junk inflates the live text length, so only images, buttons, and notes count there.
      const losses = inventoryLosses(row.before, row.after).filter(
        (loss) => !(row.repairsMarkdown && loss.startsWith("text ")),
      );
      if (losses.length) {
        row.reason = `WOULD_LOSE:${losses.join(";")}`;
        continue;
      }

      const actors = extractItemListCatalogFacts(item.rawData).actors;
      row.titleCopyRun = longestTitleSliceInPost(version.title, item.title, actors);
      let newTitle: string | null = deps.titleMap?.[externalId]?.trim() || null;
      if (newTitle) {
        row.titleAfter = newTitle;
      } else if (row.titleCopyRun >= WP_TITLE_OFFICIAL_RUN_LIMIT && generation) {
        // A headline that cannot be written now (budget, missing topic) keeps the old one;
        // the body is still brought onto the current layout.
        try {
          newTitle = await proposeTitle({
            generation,
            lifecycle,
            versionId: version.id,
            productTitle: item.title,
            rawData: item.rawData,
            body: html,
            ctaUrl,
            copyRun: row.titleCopyRun,
          });
          if (newTitle) row.titleAfter = newTitle;
          else row.titleError = "PROPOSAL_FAILED_GATE";
        } catch (error) {
          row.titleError = error instanceof Error ? error.message.slice(0, 200) : String(error);
        }
      }

      if (html === live && !newTitle) {
        row.result = "UNCHANGED";
        continue;
      }
      if (!deps.apply) {
        row.result = "WOULD_UPDATE";
        continue;
      }
      row.backup = live;
      await publisher.updateBodyAndTitle({ externalId, content: html, title: newTitle });
      if (newTitle) {
        // ContentVersion.title is the post_title source of truth; keep it in step with WordPress.
        await prisma.contentVersion.update({
          where: { id: version.id },
          data: {
            title: newTitle,
            structuredContent: {
              ...sc,
              article: { ...rec(sc.article), title: newTitle },
              retitledFrom: version.title,
            } as object,
          },
        });
      }
      row.result = "UPDATED";
    } catch (error) {
      row.result = "FAILED";
      row.reason = error instanceof Error ? error.message.slice(0, 200) : String(error);
    }
  }
  return rows;
}

/** One partial revision for the headline; returns it only when it passes the same gate as new articles. */
async function proposeTitle(input: {
  generation: ContentGenerationService;
  lifecycle: LifecycleRepository;
  versionId: string;
  productTitle: string;
  rawData: unknown;
  body: string;
  ctaUrl: string;
  copyRun: number;
}): Promise<string | null> {
  const revised = await input.generation.reviseContentVersion({
    contentVersionId: input.versionId,
    mode: "partial_revision",
    rationale: auxiliaryFindingRationale(`TITLE_COPIES_OFFICIAL:run=${input.copyRun}`),
    productTitle: input.productTitle,
    ctaUrl: input.ctaUrl,
  });
  // The revision only lends its headline; the draft itself is never published.
  await input.lifecycle.updateContentVersionStatus(revised.version.id, "ARCHIVED");
  const title = revised.version.title.trim();
  const gate = evaluateStockArticleQualityGate({
    productTitle: input.productTitle,
    rawData: input.rawData,
    structuredContent: { bodyHtml: input.body },
    writerTitle: title,
  });
  const writers = readLlmSafety(revised.version.structuredContent).runs.filter((run) => run.operation === "WP_REWRITE");
  await settleWpRuns(writers, () => (gate.ok ? "ADOPTED" : "DISCARDED_POLICY"), {
    contentVersionId: revised.version.id,
  });
  return gate.ok && title ? title : null;
}

/**
 * Usage:
 *   wp-rebuild-published                      (dry run: lists what would change)
 *   wp-rebuild-published --titles             (also asks for new headlines; calls the LLM)
 *   wp-rebuild-published --apply --backup=/path/backup.json
 *   wp-rebuild-published --ids=43,47 --limit=10
 *   wp-rebuild-published --apply --backup=... --title-map=<earlier --titles output>
 */
export async function runWpRebuildPublishedCli(argv: string[]): Promise<void> {
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const apply = argv.includes("--apply");
  const backupPath = flag("backup");
  if (apply && !backupPath) {
    console.error("--apply needs --backup=<file> so every change can be undone");
    process.exitCode = 1;
    return;
  }
  const externalIds = flag("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = flag("limit") ? Number(flag("limit")) : undefined;
  // A previous run's output: its proposed headlines are applied as-is.
  const titleMapPath = flag("title-map");
  const titleMap = titleMapPath
    ? Object.fromEntries(
        (JSON.parse(readFileSync(titleMapPath, "utf8")) as { rows: RebuildRow[] }).rows
          .filter((r) => r.titleAfter)
          .map((r) => [r.externalId, r.titleAfter!]),
      )
    : undefined;
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const rows = await rebuildPublishedPosts({
      database,
      config,
      apply,
      rewriteTitles: argv.includes("--titles"),
      externalIds,
      limit,
      titleMap,
    });
    if (backupPath) {
      writeFileSync(
        backupPath,
        JSON.stringify(rows.filter((r) => r.backup).map((r) => ({ externalId: r.externalId, title: r.titleBefore, content: r.backup })), null, 2),
      );
    }
    const count = (result: RebuildRow["result"]) => rows.filter((r) => r.result === result).length;
    console.log(
      JSON.stringify(
        {
          apply,
          total: rows.length,
          updated: count("UPDATED"),
          wouldUpdate: count("WOULD_UPDATE"),
          unchanged: count("UNCHANGED"),
          skipped: count("SKIPPED"),
          failed: count("FAILED"),
          rows: rows.map((row) => ({ ...row, backup: undefined })),
        },
        null,
        2,
      ),
    );
    if (count("FAILED") > 0) process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}
