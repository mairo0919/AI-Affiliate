/**
 * r48 — OPTION B PRODUCTION GENERATION + BLOGGER DRAFT (mizd00320, max 1 LLM).
 *
 * No code/prompt/brain/schema/rule changes this round — execute only.
 *
 *   OUT_DIR=/tmp/prod-gen-20260820-r48-mizd00320 \
 *   BLOG_MAX_PLAN_ATTEMPTS=1 \
 *   BLOGGER_DRAFT_ID=5758756966895197750 \
 *   npx tsx src/ops/r48-option-b-production-generation.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import type { LLMProvider, LLMTaskRequest, LLMTaskResult } from "../adapters/types.js";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { createBloggerPublisherFromConfig } from "../adapters/publisher/blogger-api-publisher.js";
import {
  buildEvidencePack,
  evidenceAllowlistIdsFromPack,
  toOptionBWriterSourceMaterial,
} from "../article-pattern/evidence-pack.js";
import type { PageEvidenceMetaShape } from "../article-pattern/official-page-evidence-atoms.js";
import { buildProductMaterialProfileFromPack } from "../article-pattern/reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../article-pattern/skeleton-feasibility.js";
import { toWritingSkeletonPromptContract } from "../article-pattern/writing-skeleton.js";
import { buildReferenceGuidedLayer } from "../editorial-brain/generation/reference-guided-layer.js";
import { buildOptionBGenerationAuthority } from "../generation/generation-authority.js";
import {
  buildOptionBBloggerGeneratorPrompt,
  utf8Bytes,
} from "../editorial-brain/generation/option-b-blogger-prompt.js";
import { OPTION_B_SEGMENT_RAW_OBSERVE_REASON } from "../editorial-brain/generation/option-b-segment-raw-gate.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { selectArticleImagesWithReport } from "../generation/article-images.js";
import { resolveArticleImagesForTopic } from "../generation/resolve-article-images.js";
import {
  assertSectionHeadingsAgainstStructurePattern,
  fillOptionBArticleDefaults,
  OPTION_B_LLM_REQUIRED_KEYS,
  parseBloggerArticle,
  structuredToPlainBody,
  validateSectionHeadingsAgainstStructurePattern,
} from "../generation/structured-article.js";
import { validateClaimsAgainstArticle } from "../generation/claim-validator.js";
import { validatePostTransformIntegrity } from "../editorial-brain/generation/post-transform-integrity.js";
import { extractProductIdFromUrl } from "./page-diagnose.js";
import { optionBAllowsPostLlmProseMutation } from "../editorial-brain/generation/option-b-blog-boundary.js";
import { buildSemanticFamilyId } from "../article-pattern/semantic-evidence.js";
import { facetsSemanticallyEquivalent } from "../editorial-brain/generation/contribution-family.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r48-mizd00320`;
const SAMPLE_CANDIDATES = [
  "/tmp/prod-gen-20260819-r31-evidence-assignment/sample.json",
  "/tmp/prod-gen-20260819-r29-delete-first/sample.json",
];
const BLOGGER_DRAFT_ID = process.env.BLOGGER_DRAFT_ID || "5758756966895197750";
const CTA_URL = "https://video.dmm.co.jp/av/content/?id=mizd00320";
const EXPECTED_WRITER_KEYS = ["productTitle", "supportedClaims", "officialDescription"];

const FORBIDDEN_ATOM_LEAKS = [
  "concreteEvidence",
  "availableConcreteEvidence",
  "preferredEvidence",
  "assignedFacts",
  "page_atom::",
  "title_facet::",
  "slotAssignment",
  "body_trait",
  "unknown_concrete",
  "performer_identity",
  "quantity_or_runtime",
  "scene_or_act",
  "series_or_event",
  "primaryEvidenceRole",
  "supportingEvidenceRoles",
];

const TAXONOMY_LEAKS = [
  "SEGMENT_CONTRACTS",
  "CLAIM USAGE PLAN",
  "roleAllowlist",
  "contributionPlan",
  "reservedForLater",
];

class SingleCallLLMProvider implements LLMProvider {
  readonly providerKey: string;
  private used = false;
  readonly captured: { request?: LLMTaskRequest; result?: LLMTaskResult } = {};

  constructor(private readonly inner: LLMProvider) {
    this.providerKey = inner.providerKey;
  }

  async executeTask(request: LLMTaskRequest): Promise<LLMTaskResult> {
    if (this.used) {
      throw new Error("r48 HARD LIMIT: second LLM call blocked (max 1)");
    }
    this.used = true;
    this.captured.request = request;
    const result = await this.inner.executeTask(request);
    this.captured.result = result;
    return result;
  }
}

function extractProviderRawKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of OPTION_B_LLM_REQUIRED_KEYS) {
    if (k in raw) out[k] = raw[k];
  }
  return out;
}

function htmlToHumanDisplay(html: string): string {
  return html
    .replace(/<[^>]+>/g, (tag) => {
      if (tag.startsWith("<img")) {
        const m = tag.match(/src="([^"]+)"/);
        return m ? `\n[image] ${m[1]}\n` : "";
      }
      if (tag === "<p>" || tag.startsWith("<h2")) return "\n";
      if (tag === "</p>" || tag === "</h2>") return "\n";
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function observeQuantityExpressions(text: string): Record<string, unknown> {
  const has8h = /8\s*時間/.test(text);
  const has480m = /480\s*分/.test(text);
  const parentheticalBoth = /8\s*時間\s*[（(]\s*480\s*分\s*[）)]/.test(text);
  const reverseBoth = /480\s*分\s*[（(]\s*8\s*時間\s*[）)]/.test(text);
  return {
    has_8時間: has8h,
    has_480分: has480m,
    same_quantity_parenthetical: parentheticalBoth || reverseBoth,
    note: "observe-only — no auto-fix",
  };
}

function stopMismatch(mismatches: string[], extra?: Record<string, unknown>) {
  mkdirSync(OUT, { recursive: true });
  const report = {
    round: "r48",
    ok: false,
    stage: "PREFLIGHT_MISMATCH",
    mismatches,
    LLM: 0,
    ...extra,
    stop: "MISMATCH — LLM not called",
  };
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  process.env.BLOG_MAX_PLAN_ATTEMPTS = process.env.BLOG_MAX_PLAN_ATTEMPTS ?? "1";

  const mismatches: string[] = [];
  const here = dirname(fileURLToPath(import.meta.url));
  const structuredSrc = readFileSync(join(here, "../generation/structured-article.ts"), "utf8");
  const cgsSrc = readFileSync(join(here, "../generation/content-generation-service.ts"), "utf8");
  const segmentGateSrc = readFileSync(
    join(here, "../editorial-brain/generation/option-b-segment-raw-gate.ts"),
    "utf8",
  );

  // --- Static preflight (no LLM) ---
  if (structuredSrc.includes("heading is required when no Structure Pattern is applied")) {
    mismatches.push("heading_legacy_gate_still_present");
  }
  if (!cgsSrc.includes("toOptionBWriterSourceMaterial")) {
    mismatches.push("cgs_missing_toOptionBWriterSourceMaterial");
  }
  if (!cgsSrc.includes("optionBSegmentRawAllowsPersist")) {
    mismatches.push("cgs_missing_optionBSegmentRawAllowsPersist");
  }
  if (!segmentGateSrc.includes(OPTION_B_SEGMENT_RAW_OBSERVE_REASON)) {
    mismatches.push("segment_observe_reason_missing");
  }
  if (optionBAllowsPostLlmProseMutation()) {
    mismatches.push("option_b_prose_mutation_allowed_unexpected");
  }

  const fam8 = buildSemanticFamilyId("DURATION", "8時間");
  const fam480 = buildSemanticFamilyId("DURATION", "480分");
  if (fam8 !== fam480 || fam8 !== "DURATION_480MIN") {
    mismatches.push(`duration_family_mismatch:${fam8}|${fam480}`);
  }
  if (!facetsSemanticallyEquivalent("8時間", "480分")) {
    mismatches.push("duration_facets_not_equivalent");
  }

  const nullHeadingProbe = parseBloggerArticle(
    fillOptionBArticleDefaults({
      title: "probe",
      lead: "lead text for probe length ok",
      sections: [{ heading: null, paragraphs: ["body"], lists: [] }],
      cta: { label: "x", url: null },
    }),
  );
  const headingGate = validateSectionHeadingsAgainstStructurePattern(nullHeadingProbe, null);
  if (!headingGate.ok) mismatches.push("heading_null_not_legal_without_structure_pattern");
  try {
    assertSectionHeadingsAgainstStructurePattern(nullHeadingProbe, null);
  } catch {
    mismatches.push("assert_heading_null_throws");
  }

  const config = loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  const repo = new LifecycleRepository(database.prisma);
  await seedP45Prompts(repo);

  let sample: {
    label: string;
    topicId: string;
    strategyId: string;
    productTitle: string;
    claimIds: string[];
  } | null = null;
  for (const p of SAMPLE_CANDIDATES) {
    if (!existsSync(p)) continue;
    sample = JSON.parse(readFileSync(p, "utf8"));
    break;
  }
  if (!sample?.topicId) {
    mismatches.push("sample_json_missing");
    stopMismatch(mismatches);
    await database.disconnect();
    process.exit(2);
  }

  const product = await database.prisma.affiliateProduct.findFirst({
    where: {
      OR: [
        { externalProductId: { contains: "mizd00320", mode: "insensitive" } },
        { title: { contains: "mizd00320", mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!product) {
    mismatches.push("product_mizd00320_missing");
    stopMismatch(mismatches);
    await database.disconnect();
    process.exit(2);
  }

  const claims = sample.claimIds.length
    ? await database.prisma.claim.findMany({ where: { id: { in: sample.claimIds } } })
    : [];
  const claimsForPack = claims.map((c) => ({
    id: c.id,
    statement: c.statement,
    kind: (c as { kind?: string | null }).kind ?? null,
    status: "SUPPORTED" as const,
  }));

  const doc = await repo.findLatestSourceDocumentByUrlContains("mizd00320");
  const pageEvidenceMeta =
    doc?.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
      ? ((doc.metadata as Record<string, unknown>).pageEvidence as PageEvidenceMetaShape | undefined) ??
        null
      : null;
  if (!pageEvidenceMeta?.description?.text) {
    mismatches.push("NO_PAGE_EVIDENCE");
    stopMismatch(mismatches);
    await database.disconnect();
    process.exit(2);
  }

  const referenceGuided = await buildReferenceGuidedLayer({
    prisma: database.prisma,
    productTitle: product.title,
    claims: claimsForPack,
    pageEvidenceMeta,
  });
  if (referenceGuided.defer) {
    mismatches.push(`DEFER_reference:${referenceGuided.deferReason ?? "reference"}`);
  }

  const evidencePack = buildEvidencePack({
    productTitle: product.title,
    claims: claimsForPack,
    researchEvidence: referenceGuided.researchEvidence,
    pageEvidenceMeta,
  });
  if (evidencePack.insufficientConcrete) {
    mismatches.push(`DEFER_concrete:${evidencePack.insufficientReason ?? "unknown"}`);
  }

  const profile = buildProductMaterialProfileFromPack(evidencePack);
  const feasibility = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack: evidencePack,
    profile,
  });
  if (feasibility.deferred || feasibility.assignment.anyFallbackCount > 0) {
    mismatches.push(`DEFER_skeleton:${feasibility.deferReason ?? "infeasible"}`);
  }

  const skeletonPrompt = toWritingSkeletonPromptContract(feasibility.skeleton)!;
  const officialDescription =
    typeof pageEvidenceMeta.description?.text === "string"
      ? pageEvidenceMeta.description.text
      : null;
  const writerSourceMaterial = toOptionBWriterSourceMaterial({
    productTitle: product.title,
    claims: claimsForPack.map((c) => ({
      id: c.id,
      statement: c.statement,
      kind: c.kind ?? undefined,
    })),
    officialDescription,
  });
  const writerKeys = Object.keys(writerSourceMaterial).sort();
  if (JSON.stringify(writerKeys) !== JSON.stringify([...EXPECTED_WRITER_KEYS].sort())) {
    mismatches.push(`writer_keys_mismatch:${writerKeys.join(",")}`);
  }

  const evidenceAllowlistIds = evidenceAllowlistIdsFromPack(evidencePack);
  const authority = buildOptionBGenerationAuthority({
    writingSkeleton: skeletonPrompt,
    evidencePack: writerSourceMaterial,
  });
  const prompt = buildOptionBBloggerGeneratorPrompt({
    productTitle: product.title,
    ctaUrl: CTA_URL,
    articleFormat: "NEW_RELEASE_SINGLE",
    generationAuthority: authority,
  });

  const fullPrompt = `${prompt.systemInstruction}\n${prompt.userPrompt}`;
  const atomLeaks = FORBIDDEN_ATOM_LEAKS.filter((t) => fullPrompt.includes(t));
  const taxonomyLeaks = TAXONOMY_LEAKS.filter((t) => fullPrompt.includes(t));
  if (atomLeaks.length > 0) mismatches.push(`atom_leak:${atomLeaks.join("|")}`);
  if (taxonomyLeaks.length > 0) mismatches.push(`taxonomy_leak:${taxonomyLeaks.join("|")}`);

  // Images — production unique count must be 11
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
  if (selectionReport.candidates.length !== 11) {
    mismatches.push(`image_unique_count_mismatch:${selectionReport.candidates.length}`);
  }

  writeFileSync(`${OUT}/WRITER_SOURCE_MATERIAL.json`, JSON.stringify(writerSourceMaterial, null, 2));
  writeFileSync(`${OUT}/WRITER_SOURCE_MATERIAL.txt`, JSON.stringify(writerSourceMaterial, null, 2));
  writeFileSync(`${OUT}/FINAL_SYSTEM.txt`, prompt.systemInstruction);
  writeFileSync(`${OUT}/FINAL_USER.txt`, prompt.userPrompt);
  writeFileSync(`${OUT}/WRITING_SKELETON_PROMPT.json`, JSON.stringify(skeletonPrompt, null, 2));
  writeFileSync(
    `${OUT}/PRE_CALL_AUDIT.json`,
    JSON.stringify(
      {
        ok: mismatches.length === 0,
        mismatches,
        atomLeaks,
        taxonomyLeaks,
        writerKeys,
        allowlistCount: evidenceAllowlistIds.length,
        imageUnique: selectionReport.candidates.length,
        imageDbCandidates: selectionReport.dbCandidateCount,
        headingNullLegal: headingGate.ok,
        segmentObserveReason: OPTION_B_SEGMENT_RAW_OBSERVE_REASON,
        proseMutationAllowed: optionBAllowsPostLlmProseMutation(),
        durationFamily8h: buildSemanticFamilyId("DURATION", "8時間"),
        durationFamily480m: buildSemanticFamilyId("DURATION", "480分"),
        durationEquivalent: facetsSemanticallyEquivalent("8時間", "480分"),
        systemBytes: utf8Bytes(prompt.systemInstruction),
        userBytes: utf8Bytes(prompt.userPrompt),
      },
      null,
      2,
    ),
  );

  if (mismatches.length > 0) {
    stopMismatch(mismatches, {
      writerKeys,
      atomLeaks,
      taxonomyLeaks,
      imageUnique: selectionReport.candidates.length,
    });
    await database.disconnect();
    process.exit(2);
  }

  // --- 1 LLM call only ---
  const innerLlm = requireApiLLMProvider(config);
  const llm = new SingleCallLLMProvider(innerLlm);
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

  let modelRunId = generated?.modelRunId ?? null;
  if (!modelRunId && llm.captured.result) {
    const recent = await database.prisma.modelRun.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 10 * 60_000) } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    modelRunId =
      recent.find((m) => {
        const out = (m.metadata as { output?: { title?: string } } | null)?.output;
        return Boolean(out?.title);
      })?.id ?? null;
  }

  const modelRun = modelRunId
    ? await database.prisma.modelRun.findUnique({ where: { id: modelRunId } })
    : null;
  const rawOutput = (modelRun?.metadata as { output?: Record<string, unknown> } | null)?.output;
  if (!rawOutput || typeof rawOutput !== "object") {
    writeFileSync(
      `${OUT}/RESULT.json`,
      JSON.stringify(
        {
          round: "r48",
          ok: false,
          stage: "no_provider_raw",
          generationError,
          llmCalls: llm.captured.result ? 1 : 0,
        },
        null,
        2,
      ),
    );
    await database.disconnect();
    process.exit(2);
  }

  const providerRaw = extractProviderRawKeys(rawOutput as Record<string, unknown>);
  writeFileSync(`${OUT}/PROVIDER_RAW.json`, JSON.stringify(providerRaw, null, 2));
  writeFileSync(`${OUT}/PROVIDER_RAW.txt`, JSON.stringify(providerRaw, null, 2));

  let schemaPass = true;
  let schemaError: string | null = null;
  let postDefault: ReturnType<typeof parseBloggerArticle>;
  try {
    const defaulted = fillOptionBArticleDefaults(rawOutput as Record<string, unknown>);
    postDefault = parseBloggerArticle(defaulted);
    assertSectionHeadingsAgainstStructurePattern(postDefault, null);
  } catch (e) {
    schemaPass = false;
    schemaError = e instanceof Error ? e.message : String(e);
    postDefault = parseBloggerArticle(
      fillOptionBArticleDefaults({
        title: "schema_fail",
        lead: "schema_fail_lead_placeholder_text",
        sections: [{ heading: null, paragraphs: ["x"], lists: [] }],
        cta: { label: "x", url: CTA_URL },
      }),
    );
  }
  writeFileSync(`${OUT}/POST_DEFAULT_ARTICLE.json`, JSON.stringify(postDefault, null, 2));

  const versionId = generated?.version.id ?? null;
  const version = versionId
    ? await database.prisma.contentVersion.findUnique({ where: { id: versionId } })
    : null;

  const imageResolution = await resolveArticleImagesForTopic(repo, sample.topicId, {
    altBase: sample.productTitle,
  });
  const bodyText = structuredToPlainBody(postDefault, { images: imageResolution.images });
  const claimCheck = validateClaimsAgainstArticle({
    article: postDefault,
    claims,
    bodyText,
    allowedEvidenceIds: evidenceAllowlistIds,
  });
  const integrity = validatePostTransformIntegrity({
    title: postDefault.title,
    lead: postDefault.lead,
    summary: postDefault.summary,
    sections: postDefault.sections.map((s) => ({ paragraphs: s.paragraphs })),
  });

  const modelMeta =
    modelRun?.metadata && typeof modelRun.metadata === "object"
      ? (modelRun.metadata as Record<string, unknown>)
      : {};
  const rawPlanCompliance =
    modelMeta.rawPlanCompliance && typeof modelMeta.rawPlanCompliance === "object"
      ? (modelMeta.rawPlanCompliance as Record<string, unknown>)
      : null;
  const segmentRouting =
    rawPlanCompliance?.routing && typeof rawPlanCompliance.routing === "object"
      ? (rawPlanCompliance.routing as Record<string, unknown>)
      : null;

  const brainRun = versionId
    ? await database.prisma.editorialBrainRun.findFirst({
        where: { contentVersionId: versionId },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const brainMeta =
    brainRun?.metadata && typeof brainRun.metadata === "object"
      ? (brainRun.metadata as Record<string, unknown>)
      : {};
  const findingCodes = Array.isArray(brainMeta.findingCodes)
    ? brainMeta.findingCodes
    : Array.isArray(brainMeta.findings)
      ? (brainMeta.findings as Array<{ code?: string }>).map((f) => f.code).filter(Boolean)
      : [];
  const findingsFull =
    Array.isArray(brainMeta.findings)
      ? brainMeta.findings
      : brainRun?.reviewResult && typeof brainRun.reviewResult === "object"
        ? brainRun.reviewResult
        : brainMeta;

  const llmResult = llm.captured.result!;
  const costJPY =
    llmResult.currency === "JPY" ? llmResult.actualCost ?? llmResult.estimatedCost : null;
  const costUSD =
    llmResult.currency === "USD"
      ? llmResult.actualCost ?? llmResult.estimatedCost
      : costJPY != null
        ? Number((costJPY / 150).toFixed(6))
        : null;

  const hardPass = schemaPass && claimCheck.ok && integrity.ok;
  const brainDecision = brainRun?.brainDecision ?? null;
  const html = formatBloggerHtml({
    title: postDefault.title,
    lead: postDefault.lead,
    sections: postDefault.sections,
    cta: postDefault.cta.url
      ? postDefault.cta
      : { label: postDefault.cta.label, url: CTA_URL },
    images: imageResolution.images,
  });
  const humanDisplay = htmlToHumanDisplay(html);
  writeFileSync(`${OUT}/HUMAN_REVIEW_DRAFT.html`, html);
  writeFileSync(`${OUT}/HUMAN_DISPLAY.txt`, humanDisplay);

  // Hard safety/integrity fail → no Blogger. PASS or TARGETED_REPAIR (no repair) → draft OK.
  const allowBloggerDraft = hardPass;
  let bloggerUpdated = false;
  let draftStatus: Record<string, unknown> = { attempted: false };
  if (
    allowBloggerDraft &&
    config.bloggerMode === "api" &&
    config.bloggerAllowExternalRequests
  ) {
    try {
      const publisher = createBloggerPublisherFromConfig({
        bloggerMode: config.bloggerMode,
        bloggerAllowExternalRequests: config.bloggerAllowExternalRequests,
        bloggerAllowDirectPublish: false,
        bloggerDefaultPublishMode: "draft",
        bloggerClientId: config.bloggerClientId,
        bloggerClientSecret: config.bloggerClientSecret,
        bloggerRefreshToken: config.bloggerRefreshToken,
        bloggerBlogId: config.bloggerBlogId,
        bloggerApiBaseUrl: config.bloggerApiBaseUrl,
        bloggerOAuthTokenUrl: config.bloggerOAuthTokenUrl,
      });
      publisher.assertCanCallApi("update");
      const prepared = await publisher.prepare({
        contentVersionId: versionId ?? `r48-human-review:${sample.label}`,
        title: postDefault.title,
        body: html,
        targetFormat: "article",
        destinationRef: config.bloggerBlogId ?? null,
        metadata: {
          mode: "draft",
          path: "HUMAN_REVIEW_DRAFT",
          label: "mizd00320",
          llmCalls: 1,
          publishForbidden: true,
          r48: true,
          brainDecision,
        },
      });
      const updated = await publisher.update({
        externalId: BLOGGER_DRAFT_ID,
        prepared,
      });
      const status = await publisher.getStatus(BLOGGER_DRAFT_ID);
      bloggerUpdated = true;
      draftStatus = {
        attempted: true,
        externalId: BLOGGER_DRAFT_ID,
        updateResult: updated,
        status,
        published: status.status === "LIVE",
        isDraft: status.status === "DRAFT" || status.status === "UNKNOWN" || status.status !== "LIVE",
      };
    } catch (e) {
      draftStatus = {
        attempted: true,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        htmlSavedLocal: true,
      };
    }
  } else if (!hardPass) {
    draftStatus = {
      attempted: false,
      skipped: true,
      reason: "hard_validator_or_schema_failed",
      htmlSavedLocal: true,
    };
  }

  const editUrl = config.bloggerBlogId
    ? `https://www.blogger.com/blog/post/edit/${config.bloggerBlogId}/${BLOGGER_DRAFT_ID}`
    : null;

  const headingStates = postDefault.sections.map((s, i) => ({
    index: i,
    heading: s.heading,
  }));
  const quantityObs = observeQuantityExpressions(
    [postDefault.title, postDefault.lead, postDefault.summary, humanDisplay].join("\n"),
  );

  const report = {
    round: "r48",
    ok: Boolean(generated) && !generationError && schemaPass,
    generationError,
    schemaError,
    A_providerRawFull: providerRaw,
    B_writerSourceMaterialFull: writerSourceMaterial,
    C_llm: {
      calls: llm.captured.result ? 1 : 0,
      regen: 0,
      repair: 0,
      model: llmResult.model,
      inputTokens: llmResult.inputTokens,
      outputTokens: llmResult.outputTokens,
      cachedTokens: llmResult.cachedTokens ?? 0,
      costJPY,
      costUSD,
      currency: llmResult.currency,
    },
    D_quantity: quantityObs,
    E_schema: {
      status: schemaPass ? "PASS" : "FAIL",
      headingStates,
      error: schemaError,
    },
    F_hardValidators: {
      claimValidation: { ok: claimCheck.ok, findings: claimCheck.findings },
      postTransformIntegrity: integrity,
      DEFER: false,
      proseMutation: optionBAllowsPostLlmProseMutation() ? "UNEXPECTED_ON" : 0,
    },
    G_SEGMENT: {
      findings: rawPlanCompliance?.findings ?? null,
      routingReason: segmentRouting?.reason ?? null,
      observeOnly:
        segmentRouting?.reason === OPTION_B_SEGMENT_RAW_OBSERVE_REASON ||
        rawPlanCompliance?.optionB === true,
      planExecutionFailed: rawPlanCompliance?.planExecutionFailed ?? null,
      ok: rawPlanCompliance?.ok ?? null,
    },
    H_ContentVersion: {
      created: Boolean(versionId && version),
      id: versionId,
      status: version?.status ?? null,
    },
    I_Brain: {
      reached: Boolean(brainRun),
      decision: brainDecision,
      status: brainRun?.status ?? null,
      findingCodes,
      findingsFull,
      reviewResult: brainRun?.reviewResult ?? null,
    },
    J_humanDisplayFull: humanDisplay,
    K_images: {
      dbCandidates: selectionReport.dbCandidateCount,
      uniqueCandidates: selectionReport.candidates.length,
      actuallyRendered: imageResolution.images.length,
      contentKeys: selectionReport.candidates.map((c) => c.contentKey),
      renderedUrls: imageResolution.images.map((i) => i.sourceUrl),
    },
    L_Blogger: {
      draftSave: bloggerUpdated ? "SUCCESS" : "FAIL",
      draftId: BLOGGER_DRAFT_ID,
      editUrl,
      published: false,
      detail: draftStatus,
    },
    M_human: "PENDING_HUMAN_REVIEW",
    N_BLOG_QUALITY_STATUS: "PENDING_HUMAN_REVIEW",
    O_llmCalls: llm.captured.result ? 1 : 0,
    P_regen: 0,
    Q_repair: 0,
    R_automaticProseMutation: 0,
    S_promptCodeRuleChanges: 0,
    modelRunId,
    contentVersionId: versionId,
    stop: "human_review_no_publish",
  };

  writeFileSync(`${OUT}/HUMAN_REPORT.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await database.disconnect();
}

main().catch(async (e) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/RESULT.json`,
    JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }, null, 2),
  );
  console.error(e);
  process.exit(1);
});
