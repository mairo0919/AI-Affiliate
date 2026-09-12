/**
 * Repair API-era WordPress articles via canonical pipeline only.
 * Preserves post ID + scheduledAt. Apply only when after improves before.
 * TITLE_ONLY / BODY_ONLY scopes protect the healthy half.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { P6Repository, ResearchRepository } from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { ContentReviewService } from "../admin/content-review-service.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { runCanonicalArticlePipeline } from "../generation/canonical-article-pipeline.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { createWordPressPublisherFromConfig } from "../adapters/publisher/wordpress-api-publisher.js";
import { publishContentVersionToWordPress } from "../wordpress/wordpress-publish-path.js";
import { ensureOfficialEnrichmentForStockItem } from "./ensure-official-enrichment.js";
import { evaluateStockArticleQualityGate } from "./stock-quality-gate.js";
import {
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

function mergeByScope(input: {
  scope: RepairScope;
  before: ArticleSnapshot;
  after: ArticleSnapshot;
}): ArticleSnapshot {
  if (input.scope === "TITLE_ONLY") {
    return {
      title: input.after.title,
      bodyText: input.before.bodyText,
      productTitle: input.before.productTitle,
      rawData: input.before.rawData,
    };
  }
  if (input.scope === "BODY_ONLY") {
    return {
      title: input.before.title,
      bodyText: input.after.bodyText,
      productTitle: input.before.productTitle,
      rawData: input.before.rawData,
    };
  }
  return input.after;
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
  applyRejected: Array<Record<string, unknown>>;
  needsEnrichment: Array<Record<string, unknown>>;
  stats: {
    titleOnly: number;
    bodyOnly: number;
    fullRegen: number;
    skippedNoIssue: number;
    skippedNoImprovement: number;
    publishUpdated: number;
    futureUpdated: number;
    approvedUnscheduledUpdated: number;
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
  const applyRejected: Array<Record<string, unknown>> = [];
  const needsEnrichment: Array<Record<string, unknown>> = [];
  const stats = {
    titleOnly: 0,
    bodyOnly: 0,
    fullRegen: 0,
    skippedNoIssue: 0,
    skippedNoImprovement: 0,
    publishUpdated: 0,
    futureUpdated: 0,
    approvedUnscheduledUpdated: 0,
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

      let contentVersionId = target?.contentVersionId ?? null;
      let wpBucket: "publish" | "future" | "approved_unscheduled" | "none" = "none";
      if (target?.publishedExternalId) {
        wpBucket = target.status === "PUBLISHED" ? "publish" : "future";
      } else {
        const approvedCv = await input.database.prisma.contentVersion.findFirst({
          where: {
            status: "APPROVED",
            OR: [
              { structuredContent: { path: ["productCanonicalId"], equals: cid } },
              { structuredContent: { path: ["canonicalId"], equals: cid } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });
        if (approvedCv) {
          contentVersionId = approvedCv.id;
          wpBucket = "approved_unscheduled";
        }
      }

      if (!contentVersionId && !target?.publishedExternalId) {
        failed.push({ cid, reason: "CONTENT_OR_WP_TARGET_MISSING" });
        continue;
      }

      const meta = (target?.platformMetadata ?? {}) as Record<string, unknown>;
      const scheduledAtRaw =
        target?.scheduledAt?.toISOString() ??
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

      const beforeCv = contentVersionId
        ? await input.database.prisma.contentVersion.findUnique({
            where: { id: contentVersionId },
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
          wpId: target?.publishedExternalId ?? null,
          reason: "ALREADY_OK",
          title: beforeSnap.title,
          finalClass: "NORMAL",
        });
        continue;
      }

      const enrichment = await ensureOfficialEnrichmentForStockItem({
        lifecycle: input.lifecycle,
        research,
        config: input.config,
        logger,
        canonicalId: cid,
        // Always enrich from the official product page (never affiliate wrapper).
        productUrl: buildFanzaCanonicalProductUrl(cid),
        researchItemId: item.id,
        productTitle: item.title,
        rawData: item.rawData,
      });

      if (input.dryRun) {
        repaired.push({
          cid,
          wpId: target?.publishedExternalId ?? null,
          dryRun: true,
          scope,
          enrichment: enrichment.status,
          beforeTitle: beforeSnap.title,
          scheduledAt: scheduledAt?.toISOString() ?? null,
          pipeline: "CANONICAL",
          wpBucket,
        });
        continue;
      }

      if (enrichment.status === "NEEDS_ENRICHMENT") {
        needsEnrichment.push({
          cid,
          wpId: target?.publishedExternalId ?? null,
          reason: "NEEDS_ENRICHMENT:official_page_evidence_required",
          enrichment: enrichment.status,
          finalClass: "NEEDS_ENRICHMENT",
        });
        continue;
      }

      const pipeline = await runCanonicalArticlePipeline({
        lifecycle: input.lifecycle,
        research,
        generation,
        contentReview,
        config: input.config,
        logger,
        researchItemId: item.id,
        productTitle: item.title,
        productCanonicalId: cid,
        productUrl: buildFanzaCanonicalProductUrl(cid),
        rawData: item.rawData,
        ctaUrl,
        route: "REPAIR",
        objective: "stock_blog_option_b",
        autoApprove: false,
        approveActor: "api-quality-repair",
        auxiliarySafetyOk: ({ title, structuredContent }) =>
          evaluateStockArticleQualityGate({
            productTitle: item.title,
            rawData: item.rawData,
            structuredContent: { ...structuredContent, title },
            writerTitle: title,
          }),
      });

      if (!pipeline.ok) {
        if (pipeline.reason.startsWith("NEEDS_ENRICHMENT")) {
          needsEnrichment.push({
            cid,
            wpId: target?.publishedExternalId ?? null,
            reason: pipeline.reason,
            finalClass: "NEEDS_ENRICHMENT",
          });
        } else {
          failed.push({
            cid,
            wpId: target?.publishedExternalId ?? null,
            reason: pipeline.reason,
            reviewOverall: pipeline.reviewOverall,
          });
        }
        continue;
      }
      if (!pipeline.contentVersionId) {
        failed.push({
          cid,
          wpId: target?.publishedExternalId ?? null,
          reason: "CANONICAL_PIPELINE_FAILED",
        });
        continue;
      }

      const generatedCv = await input.database.prisma.contentVersion.findUnique({
        where: { id: pipeline.contentVersionId },
        select: { id: true, title: true, body: true, structuredContent: true },
      });
      if (!generatedCv) {
        failed.push({ cid, reason: "GENERATED_VERSION_MISSING" });
        continue;
      }

      const afterRaw: ArticleSnapshot = {
        title: generatedCv.title,
        bodyText: plainBody(generatedCv.body),
        productTitle: item.title,
        rawData: item.rawData,
      };
      const merged = mergeByScope({ scope, before: beforeSnap, after: afterRaw });
      const decision = decideRepairApply({
        before: beforeSnap,
        after: merged,
        scope,
      });
      if (!decision.apply) {
        stats.skippedNoImprovement += 1;
        applyRejected.push({
          cid,
          wpId: target?.publishedExternalId ?? null,
          reason: decision.reason,
          scope,
          beforeTitle: beforeSnap.title,
          afterTitle: merged.title,
          overallDelta: decision.overallDelta,
          finalClass: "APPLY_REJECTED",
        });
        continue;
      }

      const sc: Record<string, unknown> = {
        ...((generatedCv.structuredContent ?? {}) as Record<string, unknown>),
        title: merged.title,
        productCanonicalId: cid,
        canonicalId: cid,
        pipelineRoute: "CANONICAL",
        generationRoute: "REPAIR",
        repairScope: scope,
        officialEnrichmentStatus: enrichment.status,
        officialActorCount: enrichment.actorCount,
        repairedWpPostId: target?.publishedExternalId ?? null,
        repairedFromTitle: beforeSnap.title,
      };
      if (scope === "TITLE_ONLY" && beforeCv?.body) {
        sc.bodyHtml = beforeCv.body;
      } else if (scope === "BODY_ONLY") {
        sc.title = beforeSnap.title;
      }

      await input.lifecycle.updateContentVersionStructuredContent(generatedCv.id, sc);
      await input.database.prisma.contentVersion.update({
        where: { id: generatedCv.id },
        data: {
          title: merged.title,
          ...(scope === "TITLE_ONLY" && beforeCv?.body ? { body: beforeCv.body } : {}),
        },
      });

      await contentReview.decide({
        contentVersionId: generatedCv.id,
        decision: "approve",
        actor: "api-quality-repair",
        reason: `Canonical repair (${scope}) after guarded quality improvement`,
        approvalPolicy: "auto",
      });

      if (wpBucket === "publish" || wpBucket === "future") {
        const mode = wpBucket === "publish" ? "publish" : "future";
        const wp = await publishContentVersionToWordPress(
          {
            config: input.config,
            lifecycle: input.lifecycle,
            prisma: input.database.prisma,
            publisher,
          },
          {
            contentVersionId: generatedCv.id,
            canonicalId: cid,
            productCanonicalId: cid,
            mode,
            scheduledAt: mode === "future" ? scheduledAt ?? undefined : undefined,
            updateExistingDraft: true,
            route: "API_QUALITY_REPAIR_CANONICAL",
            idempotencyKey: `api-quality-repair:${cid}:${target!.publishedExternalId}:${generatedCv.id}`,
            platformMetadata: {
              productKey: cid,
              productCanonicalId: cid,
              publishSlotKey: meta.publishSlotKey,
              scheduledAt: meta.scheduledAt ?? scheduledAt?.toISOString() ?? null,
              repairedFromContentVersionId: target!.contentVersionId,
              ctaUrl,
              affiliateLinkReady: /al\.fanza|af_id=/i.test(ctaUrl),
              pipelineRoute: "CANONICAL",
              repairScope: scope,
            },
          },
        );
        if (wpBucket === "publish") stats.publishUpdated += 1;
        else stats.futureUpdated += 1;
        repaired.push({
          cid,
          wpId: target!.publishedExternalId,
          scope,
          beforeTitle: beforeSnap.title,
          title: merged.title,
          scheduledAt: scheduledAt?.toISOString() ?? null,
          wpOk: wp.ok,
          wpPublished: "published" in wp ? wp.published : false,
          contentVersionId: generatedCv.id,
          overallDelta: decision.overallDelta,
          ctaAffiliate: /al\.fanza|af_id=/i.test(ctaUrl),
          pipeline: "CANONICAL",
          finalClass: "REPAIRED",
          wpBucket,
        });
      } else {
        stats.approvedUnscheduledUpdated += 1;
        repaired.push({
          cid,
          wpId: null,
          scope,
          beforeTitle: beforeSnap.title,
          title: merged.title,
          contentVersionId: generatedCv.id,
          overallDelta: decision.overallDelta,
          pipeline: "CANONICAL",
          finalClass: "REPAIRED",
          wpBucket,
        });
      }

      if (scope === "TITLE_ONLY") stats.titleOnly += 1;
      else if (scope === "BODY_ONLY") stats.bodyOnly += 1;
      else stats.fullRegen += 1;
    } catch (error) {
      failed.push({
        cid,
        reason: error instanceof Error ? error.message.slice(0, 240) : String(error),
      });
    }
  }

  return { repaired, skipped, failed, applyRejected, needsEnrichment, stats };
}
