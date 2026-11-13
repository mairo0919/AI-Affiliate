/**
 * Bring published WordPress posts onto the current article layout (which prints the linked
 * official title), and give a new headline to posts whose headline copies the official title.
 * Only the post body and title change; dates, status, slug, and taxonomies stay as they are.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig, type AppConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  P6Repository,
  ResearchRepository,
  createDatabaseClient,
  type DatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import { bindLlmExecutionStore } from "../adapters/llm/llm-execution-binding.js";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { createPrismaLlmRunStore } from "../adapters/llm/llm-execution-prisma-store.js";
import { readLlmSafety, settleWpRuns } from "../adapters/llm/wp-article-safety.js";
import {
  createWordPressPublisherFromConfig,
  type WordPressApiPublisher,
} from "../adapters/publisher/wordpress-api-publisher.js";
import { ContentReviewService } from "../admin/content-review-service.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { BLOG_CTA_CLASS, BLOG_WORK_TITLE_CLASS, renderWorkTitleBlock } from "../generation/blogger-formatter.js";
import { auxiliaryFindingRationale, runCanonicalArticlePipeline } from "../generation/canonical-article-pipeline.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { extractItemListCatalogFacts } from "../stock/ensure-official-enrichment.js";
import { evaluateStockArticleQualityGate, WP_TITLE_OFFICIAL_RUN_LIMIT } from "../stock/stock-quality-gate.js";
import { longestTitleSliceInPost } from "../x/x-copy-quality.js";
import { renderCurrentWordPressBody, type WordPressPublishPathDeps } from "./wordpress-publish-path.js";
import { truncateMetaDescription, WP_SEO_META_KEYS } from "./wordpress-seo-attach.js";

/** What a reader sees in a body, to check a rebuild does not drop anything. */
export function bodyInventory(html: string) {
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  return {
    images: count(/<img\b/g),
    /** Links to the work page: the CTA buttons of older posts, the linked official title now. */
    links: count(/data-otonaselect-cta="1"/g),
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
  if (before.links > 0 && after.links === 0) losses.push(`links ${before.links}->0`);
  if (after.notes < before.notes) losses.push(`notes ${before.notes}->${after.notes}`);
  if (after.textLength < before.textLength * 0.8) losses.push(`text ${before.textLength}->${after.textLength}`);
  return losses;
}

export function liveCtaUrl(html: string): string | null {
  const match = /<a href="([^"]+)" data-otonaselect-cta="1"/.exec(html);
  return match ? match[1]!.replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&") : null;
}

/** The article prose (unclassed paragraphs), to tell a layout change from a text change. */
export function articleProse(html: string): string {
  return (html.match(/<p>[\s\S]*?<\/p>/g) ?? []).map((p) => p.replace(/<[^>]+>/g, "").trim()).join("\n");
}

/**
 * Keep the live text and bring only the layout in line: the linked official title takes the
 * place of the CTA buttons. Null when the post has neither.
 */
export function restyleLiveBody(html: string, workTitle: string, ctaUrl: string): string | null {
  const linkRe = new RegExp(`<p class="(?:${BLOG_CTA_CLASS}|${BLOG_WORK_TITLE_CLASS})">[\\s\\S]*?<\\/p>\\n?`, "g");
  let first = true;
  const restyled = html.replace(linkRe, () => {
    if (!first) return "";
    first = false;
    return `${renderWorkTitleBlock(workTitle, ctaUrl)}\n`;
  });
  return first ? null : restyled;
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
  /**
   * REWRITTEN: new article from the production writer route. RENDERED: rebuilt from the stored
   * article. KEPT_TEXT: live text kept, layout aligned.
   */
  mode?: "REWRITTEN" | "RENDERED" | "KEPT_TEXT";
  /** Why the article could not be rewritten; the post then only gets the layout change. */
  rewriteError?: string;
  /** The ContentVersion the post now shows, when it was rewritten. */
  contentVersionAfter?: string;
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
  /** Write each article again through the production route (writer, gate, reviews). Apply only. */
  rewriteArticles?: boolean;
  /** With rewriteArticles: keep the live body and only propose the new article's headline. */
  headlineOnly?: boolean;
  /** Only point the search title and description at the live headline and opening paragraph. */
  seoMetaOnly?: boolean;
  externalIds?: string[];
  limit?: number;
  /** Headlines already proposed by an earlier run (externalId → title), used instead of asking again. */
  titleMap?: Record<string, string>;
  /** Called after each post, so a run that dies midway still leaves its backups behind. */
  onRow?: (rows: RebuildRow[]) => void;
}): Promise<RebuildRow[]> {
  const prisma = deps.database.prisma;
  const lifecycle = new LifecycleRepository(prisma);
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const pathDeps: WordPressPublishPathDeps = {
    config: deps.config,
    lifecycle,
    prisma: prisma as unknown as WordPressPublishPathDeps["prisma"],
  };
  if (deps.rewriteArticles && !deps.headlineOnly && !deps.apply) {
    // A rewrite pays for the writer and reviews; a dry run would pay again when applied.
    throw new Error("rewriteArticles needs apply");
  }
  let generation: ContentGenerationService | null = null;
  if (deps.rewriteTitles || deps.rewriteArticles) {
    await seedP45Prompts(lifecycle);
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
      // Scheduled posts already exist in WordPress as future posts; updating keeps their date and status.
      status: { in: ["PUBLISHED", "SCHEDULED"] },
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
            select: { id: true, title: true, rawData: true },
          })
        : null;
      if (!item) {
        row.reason = "RESEARCH_ITEM_MISSING";
        continue;
      }

      const live = await publisher.getRawContent(externalId);
      row.before = bodyInventory(live);
      if (deps.seoMetaOnly) {
        if (deps.apply) await publisher.updateMetadataOnly({ externalId, ...seoMetaFor(version.title, live) });
        row.result = deps.apply ? "UPDATED" : "WOULD_UPDATE";
        continue;
      }
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

      let proposedTitle: string | null = null;
      if (deps.rewriteArticles && generation) {
        const rewritten = await rewriteArticle({
          database: deps.database,
          config: deps.config,
          lifecycle,
          generation,
          pathDeps,
          item,
          cid: row.cid!,
          ctaUrl,
        });
        if (rewritten.ok && deps.headlineOnly) {
          // Only the headline is proposed; the generated article is never published.
          await lifecycle.updateContentVersionStatus(rewritten.versionId, "ARCHIVED");
          proposedTitle = rewritten.title;
        } else if (rewritten.ok) {
          const losses = inventoryLosses(row.before, bodyInventory(rewritten.html)).filter((loss) => !loss.startsWith("text "));
          if (losses.length) {
            await lifecycle.updateContentVersionStatus(rewritten.versionId, "ARCHIVED");
            row.rewriteError = `WOULD_LOSE:${losses.join(";")}`;
          } else {
            row.mode = "REWRITTEN";
            row.after = bodyInventory(rewritten.html);
            row.titleAfter = rewritten.title;
            row.backup = live;
            await publisher.updateBodyAndTitle({ externalId, content: rewritten.html, title: rewritten.title });
            await publisher.updateMetadataOnly({ externalId, ...seoMetaFor(rewritten.title, rewritten.html) });
            // The post now shows the new version; it becomes the post_title source of truth.
            await prisma.publicationTarget.updateMany({
              where: { platform: "WORDPRESS", publishedExternalId: externalId, contentVersionId: version.id },
              data: { contentVersionId: rewritten.versionId },
            });
            await lifecycle.updateContentVersionStatus(version.id, "ARCHIVED");
            row.contentVersionAfter = rewritten.versionId;
            row.result = "UPDATED";
            continue;
          }
        } else {
          row.rewriteError = rewritten.reason;
        }
      }

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
      let newTitle: string | null = deps.titleMap?.[externalId]?.trim() || proposedTitle;
      if (newTitle) {
        row.titleAfter = newTitle;
      } else if (row.titleCopyRun >= WP_TITLE_OFFICIAL_RUN_LIMIT && generation && !deps.rewriteArticles) {
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
      await publisher.updateMetadataOnly({ externalId, ...seoMetaFor(newTitle ?? version.title, html) });
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
    } finally {
      deps.onRow?.(rows);
    }
  }
  return rows;
}

/** A new article for a published work, written, gated, and reviewed like a new stock article. */
/**
 * Search title and description follow the post itself: its headline and opening paragraph. Rewrites
 * left the old 「シリーズ『…』作品情報」 title and a catalog description in search results (2026-11-14).
 */
export function seoMetaFor(title: string, html: string): { excerpt?: string; wpSeoMeta: Record<string, string> } {
  const lead = articleProse(html).split("\n").find((p) => p.length >= 28);
  const description = lead ? truncateMetaDescription(lead, 120) : "";
  return {
    ...(description ? { excerpt: description } : {}),
    wpSeoMeta: {
      [WP_SEO_META_KEYS.seoTitle]: title,
      ...(description ? { [WP_SEO_META_KEYS.seoDescription]: description } : {}),
    },
  };
}

async function rewriteArticle(input: {
  database: DatabaseClient;
  config: AppConfig;
  lifecycle: LifecycleRepository;
  generation: ContentGenerationService;
  pathDeps: WordPressPublishPathDeps;
  item: { id: string; title: string; rawData: unknown };
  cid: string;
  ctaUrl: string;
}): Promise<{ ok: true; versionId: string; title: string; html: string } | { ok: false; reason: string }> {
  const prisma = input.database.prisma;
  const contentReview = new ContentReviewService(input.lifecycle, new P6Repository(prisma));
  let pipeline: Awaited<ReturnType<typeof runCanonicalArticlePipeline>>;
  try {
    pipeline = await runCanonicalArticlePipeline({
      lifecycle: input.lifecycle,
      research: new ResearchRepository(prisma),
      generation: input.generation,
      contentReview,
      config: input.config,
      logger: createLogger("info"),
      researchItemId: input.item.id,
      productTitle: input.item.title,
      productCanonicalId: input.cid,
      productUrl: buildFanzaCanonicalProductUrl(input.cid),
      rawData: input.item.rawData,
      ctaUrl: input.ctaUrl,
      route: "REPAIR",
      objective: "stock_blog_option_b",
      autoApprove: true,
      approveActor: "wp-rebuild-published",
      auxiliarySafetyOk: ({ title, structuredContent }) =>
        evaluateStockArticleQualityGate({
          productTitle: input.item.title,
          rawData: input.item.rawData,
          structuredContent: { ...structuredContent, title },
          writerTitle: title,
        }),
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
  if (!pipeline.ok) return { ok: false, reason: pipeline.reason };
  if (!pipeline.approved) return { ok: false, reason: "NOT_APPROVED" };
  const version = await prisma.contentVersion.findUnique({
    where: { id: pipeline.contentVersionId },
    select: { id: true, title: true, summary: true, structuredContent: true },
  });
  if (!version) return { ok: false, reason: "GENERATED_VERSION_MISSING" };
  const rendered = await renderCurrentWordPressBody({
    deps: input.pathDeps,
    version,
    productCanonicalId: input.cid,
    ctaUrl: input.ctaUrl,
    workTitle: input.item.title,
  });
  if (!rendered.ok) {
    await input.lifecycle.updateContentVersionStatus(version.id, "ARCHIVED");
    return { ok: false, reason: rendered.reason };
  }
  return { ok: true, versionId: version.id, title: version.title, html: rendered.html };
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
 *   wp-rebuild-published --rewrite --apply --backup=...  (writes each article again; calls the LLM)
 *   wp-rebuild-published --rewrite --headline-only --ids=...  (proposes headlines from the new-article route; calls the LLM)
 *   wp-rebuild-published --apply --backup=/path/backup.json
 *   wp-rebuild-published --seo-meta --apply --backup=...  (search title/description from the live headline and opening; no LLM)
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
  const writeBackup = (rows: RebuildRow[]) => {
    if (!backupPath) return;
    writeFileSync(
      backupPath,
      JSON.stringify(rows.filter((r) => r.backup).map((r) => ({ externalId: r.externalId, title: r.titleBefore, content: r.backup })), null, 2),
    );
  };
  const config = loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const rows = await rebuildPublishedPosts({
      database,
      config,
      apply,
      rewriteTitles: argv.includes("--titles"),
      rewriteArticles: argv.includes("--rewrite"),
      headlineOnly: argv.includes("--headline-only"),
      seoMetaOnly: argv.includes("--seo-meta"),
      externalIds,
      limit,
      titleMap,
      onRow: writeBackup,
    });
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
