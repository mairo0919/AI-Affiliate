/**
 * Repair thin/misframed API-era WordPress futures/publishes in place.
 * Preserves post ID + scheduledAt; regenerates via official enrichment → Writer.
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
import { ensureOfficialEnrichmentForStockItem } from "./ensure-official-enrichment.js";
import { evaluateStockArticleQualityGate } from "./stock-generation-worker.js";

export async function repairApiArticleQualityInPlace(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  productCanonicalIds: string[];
  dryRun?: boolean;
}): Promise<{
  repaired: Array<Record<string, unknown>>;
  failed: Array<Record<string, unknown>>;
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
  const failed: Array<Record<string, unknown>> = [];

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
      const ctaUrl =
        (typeof meta.ctaUrl === "string" && meta.ctaUrl) ||
        validateFanzaAffiliateUrl(
          // prefer stored affiliate when present in rawData
          (() => {
            const raw = item.rawData as Record<string, unknown> | null;
            const aff =
              typeof raw?.affiliateURL === "string"
                ? raw.affiliateURL
                : typeof raw?.affiliateUrl === "string"
                  ? raw.affiliateUrl
                  : null;
            return aff || buildFanzaCanonicalProductUrl(cid);
          })(),
        ).url ||
        buildFanzaCanonicalProductUrl(cid);

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
          enrichment: enrichment.status,
          actorCount: enrichment.actorCount,
          scheduledAt: scheduledAt?.toISOString() ?? null,
        });
        continue;
      }

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
        claimIds,
      });
      const sc = (generated.version.structuredContent ?? {}) as Record<string, unknown>;
      await input.lifecycle.updateContentVersionStructuredContent(generated.version.id, {
        ...sc,
        productCanonicalId: cid,
        canonicalId: cid,
        stockRoute: "API_QUALITY_REPAIR",
        officialEnrichmentStatus: enrichment.status,
        officialActorCount: enrichment.actorCount,
        repairedWpPostId: target.publishedExternalId,
      });

      const quality = evaluateStockArticleQualityGate({
        productTitle: item.title,
        rawData: item.rawData,
        structuredContent: {
          ...sc,
          title: generated.version.title,
        },
        writerTitle: generated.version.title,
      });
      if (!quality.ok) {
        failed.push({
          cid,
          wpId: target.publishedExternalId,
          reason: quality.reason,
          enrichment: enrichment.status,
          title: generated.version.title,
        });
        continue;
      }

      await contentReview.decide({
        contentVersionId: generated.version.id,
        decision: "approve",
        actor: "api-quality-repair",
        reason: "Repair API-era article after official enrichment",
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
          idempotencyKey: `api-quality-repair:${cid}:${target.publishedExternalId}`,
          platformMetadata: {
            productKey: cid,
            productCanonicalId: cid,
            publishSlotKey: meta.publishSlotKey,
            scheduledAt: meta.scheduledAt ?? scheduledAt?.toISOString() ?? null,
            repairedFromContentVersionId: target.contentVersionId,
          },
        },
      );

      repaired.push({
        cid,
        wpId: target.publishedExternalId,
        status: target.status,
        enrichment: enrichment.status,
        actorCount: enrichment.actorCount,
        title: generated.version.title,
        scheduledAt: scheduledAt?.toISOString() ?? null,
        wpOk: wp.ok,
        wpPublished: "published" in wp ? wp.published : false,
        contentVersionId: generated.version.id,
      });
    } catch (error) {
      failed.push({
        cid,
        reason: error instanceof Error ? error.message.slice(0, 200) : String(error),
      });
    }
  }

  return { repaired, failed };
}
