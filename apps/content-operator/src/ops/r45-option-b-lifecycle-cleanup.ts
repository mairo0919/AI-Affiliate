/**
 * r45 — OPTION B FINAL LIFECYCLE CLEANUP validation (LLM=0 / external API=0 / Blogger=0).
 *
 * Replays r44 PROVIDER_RAW through CGS (Mock LLM) → ContentVersion → Brain,
 * and reports image candidate counts without artificial maxCount.
 *
 *   OUT_DIR=/tmp/prod-gen-20260820-r45-mizd00320 \
 *   npx tsx src/ops/r45-option-b-lifecycle-cleanup.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import type { LLMProvider, LLMTaskRequest, LLMTaskResult } from "../adapters/types.js";
import {
  buildEvidencePack,
  evidenceAllowlistIdsFromPack,
  toOptionBWriterSourceMaterial,
} from "../article-pattern/evidence-pack.js";
import type { PageEvidenceMetaShape } from "../article-pattern/official-page-evidence-atoms.js";
import { selectArticleImagesWithReport } from "../generation/article-images.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { resolveArticleImagesForTopic } from "../generation/resolve-article-images.js";
import {
  assertSectionHeadingsAgainstStructurePattern,
  fillOptionBArticleDefaults,
  parseBloggerArticle,
  structuredToPlainBody,
} from "../generation/structured-article.js";
import { validateClaimsAgainstArticle } from "../generation/claim-validator.js";
import { validatePostTransformIntegrity } from "../editorial-brain/generation/post-transform-integrity.js";
import { extractProductIdFromUrl } from "./page-diagnose.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r45-mizd00320`;
const R44_RAW = "/tmp/prod-gen-20260820-r44-mizd00320/PROVIDER_RAW.json";
const SAMPLE_CANDIDATES = [
  "/tmp/prod-gen-20260819-r31-evidence-assignment/sample.json",
  "/tmp/prod-gen-20260819-r29-delete-first/sample.json",
];
const CTA_URL = "https://video.dmm.co.jp/av/content/?id=mizd00320";

class FixtureLLMProvider implements LLMProvider {
  readonly providerKey = "fixture-r44-raw";
  constructor(private readonly raw: Record<string, unknown>) {}
  async executeTask(request: LLMTaskRequest): Promise<LLMTaskResult> {
    void request;
    return {
      output: this.raw,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      estimatedCost: 0,
      actualCost: 0,
      currency: "JPY",
      finishReason: "stop",
      model: "fixture-r44",
      provider: this.providerKey,
    };
  }
}

function loadSample(): {
  label: string;
  productTitle: string;
  topicId: string;
  strategyId: string;
  claimIds: string[];
} {
  for (const p of SAMPLE_CANDIDATES) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf8"));
    }
  }
  throw new Error("sample.json not found");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(R44_RAW)) {
    throw new Error(`Missing r44 RAW fixture: ${R44_RAW}`);
  }
  const fixtureRaw = JSON.parse(readFileSync(R44_RAW, "utf8")) as Record<string, unknown>;
  const sample = loadSample();
  const config = loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  const repo = new LifecycleRepository(database.prisma);
  await seedP45Prompts(repo);

  const defaulted = fillOptionBArticleDefaults(fixtureRaw);
  const parsed = parseBloggerArticle(defaulted);
  assertSectionHeadingsAgainstStructurePattern(parsed, null);

  const topic = await repo.findTopicCandidate(sample.topicId);
  if (!topic?.affiliateProductId) throw new Error("topic/product missing");
  const product = await repo.findAffiliateProduct(topic.affiliateProductId);
  if (!product) throw new Error("product missing");

  const externalIds = new Set<string>();
  if (product.externalProductId?.trim()) externalIds.add(product.externalProductId.trim());
  const cid = product.url ? extractProductIdFromUrl(product.url) : null;
  if (cid) externalIds.add(cid);
  const researchImages = await repo.listResearchImagesByExternalIds([...externalIds]);
  const pageDocs = await repo.listSourceDocumentsImageReferencesByUrls(
    [product.url].filter((u): u is string => Boolean(u?.trim())),
  );
  const pageImageUrls = pageDocs.flatMap((d) => d.imageReferences);
  const selectionReport = selectArticleImagesWithReport({
    researchImages,
    pageImageUrls,
    options: { altBase: sample.productTitle },
  });
  const imageResolution = await resolveArticleImagesForTopic(repo, sample.topicId, {
    altBase: sample.productTitle,
  });
  const imageResolutionCapped2 = await resolveArticleImagesForTopic(repo, sample.topicId, {
    altBase: sample.productTitle,
    maxCount: 2,
  });

  const claimsOk = await repo.listClaimsByIds(sample.claimIds);
  const doc = await repo.findLatestSourceDocumentByUrlContains("mizd00320");
  const pageEvidenceMeta =
    doc?.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
      ? ((doc.metadata as Record<string, unknown>).pageEvidence as PageEvidenceMetaShape | undefined) ??
        null
      : null;
  const claimsForPack = claimsOk.map((c) => ({
    id: c.id,
    statement: c.statement,
    kind: (c as { kind?: string | null }).kind ?? null,
    status: c.status,
  }));
  const evidencePack = buildEvidencePack({
    productTitle: product.title,
    claims: claimsForPack.map((c) => ({
      id: c.id,
      statement: c.statement,
      kind: c.kind ?? "trait_or_scene",
      status: (c.status as "SUPPORTED") ?? "SUPPORTED",
    })),
    pageEvidenceMeta,
  });
  const evidenceAllowlistIds = evidenceAllowlistIdsFromPack(evidencePack);
  const writerSourceMaterial = toOptionBWriterSourceMaterial({
    productTitle: product.title,
    claims: claimsForPack.map((c) => ({
      id: c.id,
      statement: c.statement,
      kind: c.kind ?? undefined,
    })),
    officialDescription:
      typeof pageEvidenceMeta?.description?.text === "string"
        ? pageEvidenceMeta.description.text
        : null,
  });

  const llm = new FixtureLLMProvider(fixtureRaw);
  const generation = new ContentGenerationService(repo, llm, {
    generation: config.llmModelGeneration,
    review: config.llmModelReview,
    revision: config.llmModelRevision,
  });

  let generated: Awaited<ReturnType<typeof generation.generateBloggerArticle>> | null = null;
  let generationError: string | null = null;
  try {
    generated = await generation.generateBloggerArticle({
      topicId: sample.topicId,
      strategyId: sample.strategyId,
      productTitle: sample.productTitle,
      ctaUrl: CTA_URL,
      claimIds: sample.claimIds,
      brainGuidedRepair: false,
    });
  } catch (e) {
    generationError = e instanceof Error ? e.message : String(e);
  }

  const versionId = generated?.version.id ?? null;
  const version = versionId
    ? await database.prisma.contentVersion.findUnique({ where: { id: versionId } })
    : null;
  const brainRun = versionId
    ? await database.prisma.editorialBrainRun.findFirst({
        where: { contentVersionId: versionId },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const bodyText = structuredToPlainBody(parsed, { images: imageResolution.images });
  const claimCheck = validateClaimsAgainstArticle({
    article: parsed,
    claims: claimsOk as never,
    bodyText,
    allowedEvidenceIds: evidenceAllowlistIds,
  });
  const integrity = validatePostTransformIntegrity({
    title: parsed.title,
    lead: parsed.lead,
    summary: parsed.summary,
    sections: parsed.sections.map((s) => ({ paragraphs: s.paragraphs })),
  });
  const html = formatBloggerHtml({
    title: parsed.title,
    lead: parsed.lead,
    sections: parsed.sections,
    cta: parsed.cta.url ? parsed.cta : { label: parsed.cta.label, url: CTA_URL },
    images: imageResolution.images,
  });
  writeFileSync(`${OUT}/HUMAN_REVIEW_DRAFT.html`, html);

  const packageCount = selectionReport.candidates.filter((c) => c.family === "package").length;
  const sampleCount = selectionReport.candidates.filter((c) => c.family === "sample").length;

  const report = {
    round: "r45",
    LLM: 0,
    externalAPI: 0,
    Blogger: 0,
    A_headingFirstConflict:
      "validateSectionHeadingsAgainstStructurePattern no-pattern branch (legacy all-headings-required)",
    B_headingClassification: "LEGACY / CONFLICTING with Writer schema + OPTION B natural_product_intro",
    C_treatment: "DELETE legacy no-pattern heading-required gate",
    D_contentVersionReachable: Boolean(versionId && version),
    E_brainReachable: Boolean(brainRun),
    contentVersionId: versionId,
    brainRunId: brainRun?.id ?? null,
    generationError,
    headingNullBlocks: false,
    hardClaimOk: claimCheck.ok,
    integrityOk: integrity.ok,
    writerKeys: Object.keys(writerSourceMaterial),
    F_imageFirstLoss: "ops local path maxCount:2 (r44 / r18 human-review) — not production CGS",
    G_dbCandidateCount: selectionReport.dbCandidateCount,
    H_uniqueCandidateCount: selectionReport.candidates.length,
    I_formatterImageCount: imageResolution.images.length,
    J_cause: "C — local/review ops forced maxCount:2 (r44 G_imageCount=2); production has no fixed cap",
    K_imageProductionCodeChangeNeeded: false,
    imageDetail: {
      researchImageCount: researchImages.length,
      pageImageCount: pageImageUrls.length,
      packageFamily: packageCount,
      sampleFamily: sampleCount,
      selectedWithoutCap: imageResolution.images.length,
      selectedWithMaxCount2: imageResolutionCapped2.images.length,
      publishableCount: selectionReport.publishableCount,
    },
    M_addedRules: 0,
    N_deletedLegacy: [
      "no-Structure-Pattern → all section headings required",
      "ops maxCount:2 on r44 / r18 human-review paths",
    ],
    Q_LLM: 0,
    R_externalAPI: 0,
    S_Blogger: 0,
  };

  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/POST_DEFAULT_ARTICLE.json`, JSON.stringify(parsed, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await database.disconnect();
  if (!versionId || !brainRun || !claimCheck.ok || !integrity.ok) {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
