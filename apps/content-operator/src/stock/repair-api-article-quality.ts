/**
 * Repair thin/misframed API-era WordPress futures/publishes in place.
 * Preserves post ID + scheduledAt.
 * Applies AFTER only when multi-axis quality clearly improves BEFORE.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { P6Repository, ResearchRepository } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { ContentReviewService } from "../admin/content-review-service.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { createWordPressPublisherFromConfig } from "../adapters/publisher/wordpress-api-publisher.js";
import { publishContentVersionToWordPress } from "../wordpress/wordpress-publish-path.js";
import { claimStatementsFromPageEvidence } from "../article-pattern/evidence-pack.js";
import type { PageEvidenceMetaShape } from "../article-pattern/official-page-evidence-atoms.js";
import {
  ensureOfficialEnrichmentForStockItem,
  extractItemListCatalogFacts,
} from "./ensure-official-enrichment.js";
import { evaluateStockArticleQualityGate } from "./stock-generation-worker.js";
import {
  buildEvidenceEditorialTitle,
  decideRepairApply,
  detectRepairScope,
  type ArticleSnapshot,
  type RepairScope,
} from "./repair-quality-guard.js";

function plainBody(body: unknown): string {
  return String(body ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function listApiEraWordPressProductCids(input: {
  database: DatabaseClient;
}): Promise<string[]> {
  const targets = await input.database.prisma.publicationTarget.findMany({
    where: {
      platform: "WORDPRESS",
      status: { in: ["SCHEDULED", "PUBLISHED"] },
      publishedExternalId: { not: null },
    },
    select: { platformMetadata: true, publishedExternalId: true },
  });
  const cids = new Set<string>();
  for (const t of targets) {
    const meta = (t.platformMetadata ?? {}) as Record<string, unknown>;
    const cid =
      (typeof meta.productCanonicalId === "string" && meta.productCanonicalId) ||
      (typeof meta.productKey === "string" && meta.productKey) ||
      (typeof meta.canonicalId === "string" && meta.canonicalId) ||
      null;
    if (!cid) continue;
    const wpId = Number(t.publishedExternalId);
    // API-era futures cluster around 200+; also include any FANZA ItemList row.
    if (Number.isFinite(wpId) && wpId >= 200) {
      cids.add(cid);
      continue;
    }
    const item = await input.database.prisma.researchItem.findFirst({
      where: { externalId: cid },
      include: { source: true },
    });
    if (item?.source?.name === "FANZA" && item.description == null) {
      cids.add(cid);
    }
  }
  return [...cids];
}

export async function repairApiArticleQualityInPlace(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  productCanonicalIds: string[];
  dryRun?: boolean;
}): Promise<{
  repaired: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
  failed: Array<Record<string, unknown>>;
  stats: {
    titleOnly: number;
    fullRegen: number;
    skippedNoIssue: number;
    skippedNoImprovement: number;
  };
}> {
  const logger = createLogger("info");
  const research = new ResearchRepository(input.database.prisma);
  await seedP45Prompts(input.lifecycle);
  const llm = requireApiLLMProvider(input.config);
  const generation = new ContentGenerationService(input.lifecycle, llm, {
    generation: input.config.llmModelGeneration,
    review: input.config.llmModelReview,
    revision: input.config.llmModelRevision,
  });
  const contentReview = new ContentReviewService(
    input.lifecycle,
    new P6Repository(input.database.prisma),
  );
  const publisher = createWordPressPublisherFromConfig(input.config);
  const repaired: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  const stats = {
    titleOnly: 0,
    fullRegen: 0,
    skippedNoIssue: 0,
    skippedNoImprovement: 0,
  };

  for (const cid of input.productCanonicalIds) {
    try {
      const item = await input.database.prisma.researchItem.findFirst({
        where: { externalId: cid },
      });
      if (!item) {
        failed.push({ cid, reason: "RESEARCH_ITEM_MISSING" });
        continue;
      }
      const target = await input.database.prisma.publicationTarget.findFirst({
        where: {
          platform: "WORDPRESS",
          status: { in: ["SCHEDULED", "PUBLISHED"] },
          OR: [
            { platformMetadata: { path: ["productCanonicalId"], equals: cid } },
            { platformMetadata: { path: ["productKey"], equals: cid } },
            { platformMetadata: { path: ["canonicalId"], equals: cid } },
          ],
        },
        orderBy: { updatedAt: "desc" },
      });
      if (!target?.publishedExternalId) {
        failed.push({ cid, reason: "WP_TARGET_MISSING" });
        continue;
      }
      const meta = (target.platformMetadata ?? {}) as Record<string, unknown>;
      const scheduledAtRaw =
        target.scheduledAt?.toISOString() ??
        (typeof meta.scheduledAt === "string" ? meta.scheduledAt : null) ??
        (typeof meta.publishSlotKey === "string" ? meta.publishSlotKey : null);
      const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
      const raw = item.rawData as Record<string, unknown> | null;
      const affiliateFromResearch =
        (typeof raw?.affiliateURL === "string" && raw.affiliateURL) ||
        (typeof raw?.affiliateUrl === "string" && raw.affiliateUrl) ||
        (typeof item.url === "string" && item.url.includes("al.fanza") ? item.url : null) ||
        null;
      const metaCta = typeof meta.ctaUrl === "string" ? meta.ctaUrl : null;
      const ctaCandidate =
        affiliateFromResearch ||
        (metaCta && /al\.fanza|af_id=|affiliate/i.test(metaCta) ? metaCta : null) ||
        metaCta ||
        buildFanzaCanonicalProductUrl(cid);
      const ctaUrl =
        validateFanzaAffiliateUrl(ctaCandidate).url || buildFanzaCanonicalProductUrl(cid);

      const beforeCv = target.contentVersionId
        ? await input.database.prisma.contentVersion.findUnique({
            where: { id: target.contentVersionId },
            select: { id: true, title: true, body: true, structuredContent: true },
          })
        : null;
      const beforeSnap: ArticleSnapshot = {
        title: beforeCv?.title ?? String(meta.title ?? item.title),
        bodyText: plainBody(beforeCv?.body),
        productTitle: item.title,
        rawData: item.rawData,
      };
      const scope = detectRepairScope(beforeSnap);
      if (scope === "NONE") {
        stats.skippedNoIssue += 1;
        skipped.push({
          cid,
          wpId: target.publishedExternalId,
          reason: "ALREADY_OK",
          title: beforeSnap.title,
        });
        continue;
      }

      const enrichment = await ensureOfficialEnrichmentForStockItem({
        lifecycle: input.lifecycle,
        research,
        config: input.config,
        logger,
        canonicalId: cid,
        productUrl: ctaUrl,
        researchItemId: item.id,
        productTitle: item.title,
        rawData: item.rawData,
      });

      if (input.dryRun) {
        repaired.push({
          cid,
          wpId: target.publishedExternalId,
          dryRun: true,
          scope,
          enrichment: enrichment.status,
          beforeTitle: beforeSnap.title,
          scheduledAt: scheduledAt?.toISOString() ?? null,
        });
        continue;
      }

      const catalog = extractItemListCatalogFacts(item.rawData);

      if (scope === "TITLE_ONLY" && beforeCv) {
        const editorialTitle = buildEvidenceEditorialTitle({
          officialTitle: item.title,
          performers: catalog.actors,
          genres: catalog.genres,
          makers: catalog.makers,
          series: catalog.series,
        });
        const afterSnap: ArticleSnapshot = {
          title: editorialTitle,
          bodyText: beforeSnap.bodyText,
          productTitle: item.title,
          rawData: item.rawData,
        };
        const decision = decideRepairApply({ before: beforeSnap, after: afterSnap, scope });
        if (!decision.apply) {
          stats.skippedNoImprovement += 1;
          skipped.push({
            cid,
            wpId: target.publishedExternalId,
            reason: decision.reason,
            scope,
            beforeTitle: beforeSnap.title,
            candidateTitle: editorialTitle,
          });
          continue;
        }

        const sc = {
          ...((beforeCv.structuredContent ?? {}) as Record<string, unknown>),
          title: editorialTitle,
          productCanonicalId: cid,
          canonicalId: cid,
          stockRoute: "API_QUALITY_REPAIR_TITLE_ONLY",
          repairedFromTitle: beforeSnap.title,
        };
        await input.lifecycle.updateContentVersionStructuredContent(beforeCv.id, sc);
        await input.database.prisma.contentVersion.update({
          where: { id: beforeCv.id },
          data: { title: editorialTitle },
        });

        const mode = target.status === "PUBLISHED" ? "publish" : "future";
        const wp = await publishContentVersionToWordPress(
          {
            config: input.config,
            lifecycle: input.lifecycle,
            prisma: input.database.prisma,
            publisher,
          },
          {
            contentVersionId: beforeCv.id,
            canonicalId: cid,
            productCanonicalId: cid,
            mode,
            scheduledAt: mode === "future" ? scheduledAt ?? undefined : undefined,
            updateExistingDraft: true,
            route: "API_QUALITY_REPAIR_TITLE_ONLY",
            idempotencyKey: `api-quality-repair-title:${cid}:${target.publishedExternalId}`,
            platformMetadata: {
              productKey: cid,
              productCanonicalId: cid,
              publishSlotKey: meta.publishSlotKey,
              scheduledAt: meta.scheduledAt ?? scheduledAt?.toISOString() ?? null,
              ctaUrl,
              affiliateLinkReady: /al\.fanza|af_id=/i.test(ctaUrl),
            },
          },
        );
        stats.titleOnly += 1;
        repaired.push({
          cid,
          wpId: target.publishedExternalId,
          scope: "TITLE_ONLY",
          beforeTitle: beforeSnap.title,
          title: editorialTitle,
          scheduledAt: scheduledAt?.toISOString() ?? null,
          wpOk: wp.ok,
          overallDelta: decision.overallDelta,
          ctaAffiliate: /al\.fanza|af_id=/i.test(ctaUrl),
          contentVersionId: beforeCv.id,
        });
        continue;
      }

      // FULL regeneration
      const doc = await input.lifecycle.findLatestSourceDocumentByUrlContains(cid);
      const pageEvidenceMeta =
        doc?.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
          ? ((doc.metadata as Record<string, unknown>).pageEvidence as
              | PageEvidenceMetaShape
              | undefined)
          : undefined;
      const topic = await input.lifecycle.createTopicCandidate({
        title: item.title,
        status: "READY",
        metadata: { source: "api-quality-repair", researchItemId: item.id, canonicalId: cid },
      });
      const strategy = await input.lifecycle.createStrategy({
        topicCandidateId: topic.id,
        objective: "stock_blog_option_b",
        targetAudience: "readers",
        userIntent: "product_intro",
        formatCategory: "ARTICLE",
        formatKey: "NEW_RELEASE_SINGLE",
        angle: "single_product",
        primaryChannel: "WORDPRESS",
        candidateChannels: ["WORDPRESS"],
        status: "READY",
      });
      const statements = pageEvidenceMeta?.description?.text
        ? claimStatementsFromPageEvidence({
            pageEvidenceMeta,
            productTitle: item.title,
            actors: pageEvidenceMeta.actors,
          })
        : [`${item.title} は公開カタログ上で確認できる。`];
      const claimIds: string[] = [];
      for (const statement of statements.slice(0, 4)) {
        const claim = await input.lifecycle.createClaim({
          statement,
          claimType: "FACT",
          status: "SUPPORTED",
          confidence: 0.8,
          strategyId: strategy.id,
          metadata: { researchItemId: item.id, source: "api-quality-repair" },
        });
        claimIds.push(claim.id);
      }

      const generated = await generation.generateBloggerArticle({
        topicId: topic.id,
        strategyId: strategy.id,
        productTitle: item.title,
        ctaUrl,
        productCanonicalId: cid,
        claimIds,
      });
      let finalTitle = generated.version.title;
      const sc = (generated.version.structuredContent ?? {}) as Record<string, unknown>;
      let bodyText = plainBody(generated.version.body ?? sc.bodyHtml ?? sc.body);

      // If Writer title still genre-lists while synopsis exists, salvage title only (keep body).
      const titleProbe: ArticleSnapshot = {
        title: finalTitle,
        bodyText,
        productTitle: item.title,
        rawData: item.rawData,
      };
      const titleScope = detectRepairScope(titleProbe);
      if (titleScope === "TITLE_ONLY" || titleScope === "FULL") {
        const editorial = buildEvidenceEditorialTitle({
          officialTitle: item.title,
          performers: catalog.actors,
          genres: catalog.genres,
          makers: catalog.makers,
          series: catalog.series,
        });
        const salvagedSnap: ArticleSnapshot = {
          title: editorial,
          bodyText,
          productTitle: item.title,
          rawData: item.rawData,
        };
        const salvageDecision = decideRepairApply({
          before: titleProbe,
          after: salvagedSnap,
          scope: "TITLE_ONLY",
        });
        if (salvageDecision.apply) {
          finalTitle = editorial;
        }
      }

      const afterSnap: ArticleSnapshot = {
        title: finalTitle,
        bodyText,
        productTitle: item.title,
        rawData: item.rawData,
      };
      const decision = decideRepairApply({
        before: beforeSnap,
        after: afterSnap,
        scope: "FULL" as RepairScope,
      });
      if (!decision.apply) {
        stats.skippedNoImprovement += 1;
        skipped.push({
          cid,
          wpId: target.publishedExternalId,
          reason: decision.reason,
          scope: "FULL",
          beforeTitle: beforeSnap.title,
          afterTitle: finalTitle,
          overallDelta: decision.overallDelta,
        });
        continue;
      }

      const quality = evaluateStockArticleQualityGate({
        productTitle: item.title,
        rawData: item.rawData,
        structuredContent: { ...sc, title: finalTitle, bodyHtml: generated.version.body },
        writerTitle: finalTitle,
      });
      if (!quality.ok) {
        failed.push({
          cid,
          wpId: target.publishedExternalId,
          reason: quality.reason,
          title: finalTitle,
        });
        continue;
      }

      await input.lifecycle.updateContentVersionStructuredContent(generated.version.id, {
        ...sc,
        title: finalTitle,
        productCanonicalId: cid,
        canonicalId: cid,
        stockRoute: "API_QUALITY_REPAIR",
        officialEnrichmentStatus: enrichment.status,
        officialActorCount: enrichment.actorCount,
        repairedWpPostId: target.publishedExternalId,
        repairedFromTitle: beforeSnap.title,
      });
      if (finalTitle !== generated.version.title) {
        await input.database.prisma.contentVersion.update({
          where: { id: generated.version.id },
          data: { title: finalTitle },
        });
      }

      await contentReview.decide({
        contentVersionId: generated.version.id,
        decision: "approve",
        actor: "api-quality-repair",
        reason: "Repair API-era article after guarded quality improvement",
        approvalPolicy: "auto",
      });

      const mode = target.status === "PUBLISHED" ? "publish" : "future";
      const wp = await publishContentVersionToWordPress(
        {
          config: input.config,
          lifecycle: input.lifecycle,
          prisma: input.database.prisma,
          publisher,
        },
        {
          contentVersionId: generated.version.id,
          canonicalId: cid,
          productCanonicalId: cid,
          mode,
          scheduledAt: mode === "future" ? scheduledAt ?? undefined : undefined,
          updateExistingDraft: true,
          route: "API_QUALITY_REPAIR",
          idempotencyKey: `api-quality-repair:${cid}:${target.publishedExternalId}:${generated.version.id}`,
          platformMetadata: {
            productKey: cid,
            productCanonicalId: cid,
            publishSlotKey: meta.publishSlotKey,
            scheduledAt: meta.scheduledAt ?? scheduledAt?.toISOString() ?? null,
            repairedFromContentVersionId: target.contentVersionId,
            ctaUrl,
            affiliateLinkReady: /al\.fanza|af_id=/i.test(ctaUrl),
          },
        },
      );

      stats.fullRegen += 1;
      repaired.push({
        cid,
        wpId: target.publishedExternalId,
        scope: "FULL",
        beforeTitle: beforeSnap.title,
        title: finalTitle,
        scheduledAt: scheduledAt?.toISOString() ?? null,
        wpOk: wp.ok,
        wpPublished: "published" in wp ? wp.published : false,
        contentVersionId: generated.version.id,
        overallDelta: decision.overallDelta,
        ctaAffiliate: /al\.fanza|af_id=/i.test(ctaUrl),
      });
    } catch (error) {
      failed.push({
        cid,
        reason: error instanceof Error ? error.message.slice(0, 200) : String(error),
      });
    }
  }

  return { repaired, skipped, failed, stats };
}
