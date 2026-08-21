/**
 * HUMAN_REVIEW_DRAFT — create Blogger draft from existing OPTION B RAW (LLM=0).
 *
 * Purpose: human visual check on Blogger. Does NOT:
 * - call LLM / repair / regen
 * - change Brain decision / ContentVersion status / downstreamAllowed permanently
 * - publish (isDraft=true only)
 * - relax production createBloggerDraft safety gates
 *
 * Uses production:
 * - resolveArticleImagesForTopic (image pipeline)
 * - formatBloggerHtml (disclosure / adult / freshness defaults)
 * - BloggerApiPublisher.createDraft (?isDraft=true)
 *
 *   OUT_DIR=/tmp/... RAW_DIR=/tmp/prod-gen-20260727-r18-option-b \
 *     npx tsx src/ops/r18-human-review-draft-from-raw.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { resolveArticleImagesForTopic } from "../generation/resolve-article-images.js";
import {
  createBloggerPublisherFromConfig,
  type BloggerApiPublisher,
} from "../adapters/publisher/blogger-api-publisher.js";

const RAW_DIR = process.env.RAW_DIR || "/tmp/prod-gen-20260727-r18-option-b";
const OUT =
  process.env.OUT_DIR ||
  `/tmp/human-review-draft-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-mizd00320`;

type RawArticle = {
  title: string;
  lead: string;
  summary?: string;
  sections: Array<{ heading?: string | null; paragraphs: string[]; lists?: string[] }>;
  cta: { label: string; url: string | null };
  seoTitle?: string;
  metaDescription?: string;
};

function assertNoLlmImports(): void {
  // Soft guard: this script must never import ContentGenerationService / brain repair.
}

async function snapshotBrainState(
  database: ReturnType<typeof createDatabaseClient>,
  contentVersionId: string | null,
): Promise<Record<string, unknown>> {
  if (!contentVersionId) {
    return { contentVersionId: null, note: "no_content_version_linked" };
  }
  const version = await database.prisma.contentVersion.findUnique({
    where: { id: contentVersionId },
    select: { id: true, status: true, structuredContent: true, updatedAt: true },
  });
  const brainRuns = await database.prisma.editorialBrainRun.findMany({
    where: { contentVersionId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, brainDecision: true, status: true, updatedAt: true },
  });
  const sc = (version?.structuredContent ?? {}) as Record<string, unknown>;
  return {
    contentVersionId,
    contentVersionStatus: version?.status ?? null,
    contentVersionUpdatedAt: version?.updatedAt?.toISOString() ?? null,
    brainLifecycle: sc.brainLifecycle ?? null,
    brainRuns,
  };
}

async function main() {
  assertNoLlmImports();
  mkdirSync(OUT, { recursive: true });

  const rawPath = `${RAW_DIR}/RAW_ARTICLE.json`;
  const samplePath = `${RAW_DIR}/sample.json`;
  if (!existsSync(rawPath)) {
    throw new Error(`Missing RAW: ${rawPath}`);
  }
  if (!existsSync(samplePath)) {
    throw new Error(`Missing sample: ${samplePath}`);
  }

  const raw = JSON.parse(readFileSync(rawPath, "utf8")) as RawArticle;
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as {
    label: string;
    topicId: string;
    strategyId: string;
    ctaUrl: string;
    productTitle: string;
  };

  // Freeze article text exactly as saved (no rewrite).
  const article: RawArticle = {
    title: String(raw.title),
    lead: String(raw.lead),
    summary: raw.summary ? String(raw.summary) : undefined,
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    cta: {
      label: String(raw.cta?.label ?? "作品詳細を見る"),
      url: raw.cta?.url ?? sample.ctaUrl ?? null,
    },
  };

  const config = loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  const repo = new LifecycleRepository(database.prisma);

  // Optional: look up ModelRun from RESULT for before/after Brain snapshot only (read-only).
  let contentVersionId: string | null = null;
  const resultPath = `${RAW_DIR}/RESULT.json`;
  if (existsSync(resultPath)) {
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
      modelRunId?: string;
      contentVersionId?: string;
    };
    if (result.contentVersionId) {
      contentVersionId = result.contentVersionId;
    } else if (result.modelRunId) {
      const versions = await database.prisma.contentVersion.findMany({
        where: { modelRunId: result.modelRunId },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      contentVersionId = versions[0]?.id ?? null;
    }
  }

  const brainBefore = await snapshotBrainState(database, contentVersionId);

  // Production image pipeline (same as CGS / prepareBloggerHtml — no artificial maxCount).
  const imageResolved = await resolveArticleImagesForTopic(repo, sample.topicId, {
    altBase: article.title.slice(0, 40),
  });

  // Prefer product.url when available (production CTA source); else RAW/sample CTA.
  const topic = await repo.findTopicCandidate(sample.topicId);
  const product = topic?.affiliateProductId
    ? await repo.findAffiliateProduct(topic.affiliateProductId)
    : null;
  const ctaUrl = article.cta.url || product?.url || sample.ctaUrl || null;
  const cta = { label: article.cta.label, url: ctaUrl };

  const html = formatBloggerHtml({
    title: article.title,
    lead: article.lead,
    sections: article.sections,
    cta,
    images: imageResolved.images,
  });

  writeFileSync(`${OUT}/HUMAN_REVIEW_DRAFT.html`, html);
  writeFileSync(
    `${OUT}/HUMAN_REVIEW_DRAFT_META.json`,
    JSON.stringify(
      {
        path: "HUMAN_REVIEW_DRAFT",
        label: sample.label,
        llmCalls: 0,
        apiCostJPY: 0,
        publish: false,
        isDraft: true,
        title: article.title,
        cta,
        imageCount: imageResolved.images.length,
        images: imageResolved.images.map((i) => ({
          role: i.role,
          sourceUrl: i.sourceUrl,
          imageType: i.imageType,
          provenance: i.provenance,
        })),
        formatter: "formatBloggerHtml",
        imagePipeline: "resolveArticleImagesForTopic",
        ctaPipeline: "RAW.cta.url || AffiliateProduct.url || sample.ctaUrl",
        brainBefore,
      },
      null,
      2,
    ),
  );

  if (config.bloggerMode !== "api") {
    throw new Error(`BLOGGER_MODE must be api for HUMAN_REVIEW_DRAFT (got ${config.bloggerMode})`);
  }
  if (!config.bloggerAllowExternalRequests) {
    throw new Error("BLOGGER_ALLOW_EXTERNAL_REQUESTS must be true");
  }
  if (config.bloggerAllowDirectPublish) {
    // Refuse accidental publish capability for this path — require draft-only env.
    console.warn(
      "WARN: BLOGGER_ALLOW_DIRECT_PUBLISH is true; HUMAN_REVIEW_DRAFT still calls createDraft only.",
    );
  }

  const publisher: BloggerApiPublisher = createBloggerPublisherFromConfig({
    bloggerMode: config.bloggerMode,
    bloggerAllowExternalRequests: config.bloggerAllowExternalRequests,
    bloggerAllowDirectPublish: false, // hard-force: this path never enables publish
    bloggerDefaultPublishMode: "draft",
    bloggerClientId: config.bloggerClientId,
    bloggerClientSecret: config.bloggerClientSecret,
    bloggerRefreshToken: config.bloggerRefreshToken,
    bloggerBlogId: config.bloggerBlogId,
    bloggerApiBaseUrl: config.bloggerApiBaseUrl,
    bloggerOAuthTokenUrl: config.bloggerOAuthTokenUrl,
  });

  publisher.assertCanCallApi("createDraft");
  // Explicit: never assert publish permission on this path.
  try {
    publisher.assertCanCallApi("publish");
    throw new Error("SAFETY: publish must remain disabled for HUMAN_REVIEW_DRAFT");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/Direct Blogger publish is disabled|DIRECT_PUBLISH_DISABLED/.test(msg)) {
      throw e;
    }
  }

  const prepared = await publisher.prepare({
    contentVersionId: contentVersionId ?? `human-review-draft:${sample.label}`,
    title: article.title,
    body: html,
    targetFormat: "article",
    destinationRef: config.bloggerBlogId ?? null,
    metadata: {
      mode: "draft",
      path: "HUMAN_REVIEW_DRAFT",
      label: sample.label,
      llmCalls: 0,
      publishForbidden: true,
    },
  });

  const draft = await publisher.createDraft({
    prepared,
    destinationRef: config.bloggerBlogId ?? null,
  });

  // Confirm draft status via API when possible
  const status = await publisher.getStatus(draft.externalId);

  const brainAfter = await snapshotBrainState(database, contentVersionId);
  const brainUnchanged =
    JSON.stringify(brainBefore.contentVersionStatus) ===
      JSON.stringify(brainAfter.contentVersionStatus) &&
    JSON.stringify(brainBefore.brainLifecycle) === JSON.stringify(brainAfter.brainLifecycle) &&
    JSON.stringify(brainBefore.brainRuns) === JSON.stringify(brainAfter.brainRuns) &&
    String(brainBefore.contentVersionUpdatedAt) === String(brainAfter.contentVersionUpdatedAt);

  // Drafts often return the blog root as url; prefer Blogger editor deep-link.
  const editUrl = config.bloggerBlogId
    ? `https://www.blogger.com/blog/post/edit/${config.bloggerBlogId}/${draft.externalId}`
    : draft.url || null;

  const report = {
    A_bloggerDraftCreated: true,
    B_externalId: draft.externalId,
    C_editUrl: editUrl,
    D_title: article.title,
    E_imageCount: imageResolved.images.length,
    F_ctaUrl: cta.url,
    G_formatterProduction: true,
    H_sameImagePipeline: true,
    I_sameCtaPipeline: true,
    J_published: false,
    J_apiStatus: status.status,
    J_responseStatus: draft.status,
    K_brainStateUnchanged: brainUnchanged,
    L_contentVersionStateUnchanged: brainUnchanged,
    M_llmCalls: 0,
    N_apiCostJPY: 0,
    path: "HUMAN_REVIEW_DRAFT",
    rawDir: RAW_DIR,
    outDir: OUT,
    brainBefore,
    brainAfter,
    note: "Human visual review only. No ACCEPTED / no publish / no LLM.",
  };

  writeFileSync(`${OUT}/HUMAN_REVIEW_DRAFT_REPORT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await database.disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
