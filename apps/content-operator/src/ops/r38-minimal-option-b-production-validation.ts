/**
 * r38 — MINIMAL OPTION B production validation (mizd00320, max 1 LLM call).
 *
 *   OUT_DIR=/tmp/prod-gen-20260820-r38-mizd00320 \
 *   BLOG_MAX_PLAN_ATTEMPTS=1 \
 *   BLOGGER_DRAFT_ID=4991474828435212647 \
 *   npx tsx src/ops/r38-minimal-option-b-production-validation.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import type { LLMProvider, LLMTaskRequest, LLMTaskResult } from "../adapters/types.js";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import {
  BloggerApiPublisher,
  createBloggerPublisherFromConfig,
} from "../adapters/publisher/blogger-api-publisher.js";
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
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { resolveArticleImagesForTopic } from "../generation/resolve-article-images.js";
import {
  fillOptionBArticleDefaults,
  OPTION_B_LLM_REQUIRED_KEYS,
  parseBloggerArticle,
} from "../generation/structured-article.js";
import { validateClaimsAgainstArticle } from "../generation/claim-validator.js";
import { validatePostTransformIntegrity } from "../editorial-brain/generation/post-transform-integrity.js";
import { structuredToPlainBody } from "../generation/structured-article.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r38-mizd00320`;
const ORACLE_R37 = "/tmp/prod-gen-20260820-r37-oracle";
const ORACLE_R33 = "/tmp/prod-gen-20260819-r33-writer-projection";
void ORACLE_R37;
void ORACLE_R33;
const R31_RAW = "/tmp/prod-gen-20260819-r31-evidence-assignment/PROVIDER_RAW.json";
const SAMPLE_CANDIDATES = [
  "/tmp/prod-gen-20260819-r29-delete-first/sample.json",
  "/tmp/prod-gen-20260819-r31-evidence-assignment/sample.json",
];
const BLOGGER_DRAFT_ID = process.env.BLOGGER_DRAFT_ID || "4991474828435212647";
const CTA_URL = "https://video.dmm.co.jp/av/content/?id=mizd00320";

const FORBIDDEN_TAXONOMY = [
  "body_trait",
  "unknown_concrete",
  "performer_identity",
  "quantity_or_runtime",
  "scene_or_act",
  "series_or_event",
  "primaryEvidenceRole",
  "supportingEvidenceRoles",
];

const EXPECTED_FACT_SNIPPETS = [
  "松本いちか",
  "令和イチのメスガキ",
  "ベスト",
  "10作品",
  "8時間",
  "480分",
  "22本番",
  "45射精",
  "わからせ",
  "痴女",
  "激ピス",
  "ギャル妹",
  "小悪魔",
  "絶対空域",
  "デカ尻",
];

class SingleCallLLMProvider implements LLMProvider {
  readonly providerKey: string;
  private used = false;
  readonly captured: {
    request?: LLMTaskRequest;
    result?: LLMTaskResult;
  } = {};

  constructor(private readonly inner: LLMProvider) {
    this.providerKey = inner.providerKey;
  }

  async executeTask(request: LLMTaskRequest): Promise<LLMTaskResult> {
    if (this.used) {
      throw new Error("r38 HARD LIMIT: second LLM call blocked (max 1)");
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

function factsInText(text: string, facts: Array<{ id: string; fact: string }>): string[] {
  const norm = text.replace(/\s+/g, "");
  return facts.filter((f) => {
    const snippet = f.fact.replace(/\s+/g, "");
    return snippet.length >= 2 && norm.includes(snippet);
  }).map((f) => f.fact);
}

async function buildPreCallContract(
  database: ReturnType<typeof createDatabaseClient>,
  repo: LifecycleRepository,
  sample: { claimIds: string[]; productTitle: string },
) {
  const product = await database.prisma.affiliateProduct.findFirst({
    where: {
      OR: [
        { externalProductId: { contains: "mizd00320", mode: "insensitive" } },
        { title: { contains: "mizd00320", mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!product) throw new Error("mizd00320 product not found");

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
    throw new Error("NO_PAGE_EVIDENCE — abort before LLM");
  }

  const referenceGuided = await buildReferenceGuidedLayer({
    prisma: database.prisma,
    productTitle: product.title,
    claims: claimsForPack,
    pageEvidenceMeta,
  });
  if (referenceGuided.defer) {
    throw new Error(`DEFER before LLM: ${referenceGuided.deferReason ?? "reference"}`);
  }

  const evidencePack = buildEvidencePack({
    productTitle: product.title,
    claims: claimsForPack,
    researchEvidence: referenceGuided.researchEvidence,
    pageEvidenceMeta,
  });
  if (evidencePack.insufficientConcrete) {
    throw new Error(`DEFER insufficient concrete: ${evidencePack.insufficientReason ?? "unknown"}`);
  }

  const profile = buildProductMaterialProfileFromPack(evidencePack);
  const feasibility = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack: evidencePack,
    profile,
  });
  if (feasibility.deferred || feasibility.assignment.anyFallbackCount > 0) {
    throw new Error(`DEFER skeleton: ${feasibility.deferReason ?? "infeasible"}`);
  }

  const skeletonPrompt = toWritingSkeletonPromptContract(feasibility.skeleton)!;
  const officialDescription =
    typeof pageEvidenceMeta.description?.text === "string"
      ? pageEvidenceMeta.description.text
      : null;
  const evidencePrompt = toOptionBWriterSourceMaterial({
    productTitle: product.title,
    claims: claimsForPack.map((c) => ({
      id: c.id,
      statement: c.statement,
      kind: c.kind ?? undefined,
    })),
    officialDescription,
  });
  const authority = buildOptionBGenerationAuthority({
    writingSkeleton: skeletonPrompt,
    evidencePack: evidencePrompt,
  });
  const prompt = buildOptionBBloggerGeneratorPrompt({
    productTitle: product.title,
    ctaUrl: CTA_URL,
    articleFormat: "NEW_RELEASE_SINGLE",
    generationAuthority: authority,
  });

  return {
    product,
    evidencePrompt,
    skeletonPrompt,
    authority,
    prompt,
    evidencePack,
    evidenceAllowlistIds: evidenceAllowlistIdsFromPack(evidencePack),
  };
}

function auditPreCall(
  evidencePrompt: Record<string, unknown>,
  prompt: { systemInstruction: string; userPrompt: string },
) {
  const full = prompt.systemInstruction + "\n" + prompt.userPrompt;
  const atomExposure = [
    "concreteEvidence",
    "availableConcreteEvidence",
    "preferredEvidence",
    "assignedFacts",
    "page_atom::",
    "title_facet::",
    "slotAssignment",
    ...FORBIDDEN_TAXONOMY,
  ].filter((t) => full.includes(t));
  const claims = (evidencePrompt.supportedClaims as Array<{ id: string; statement: string }>) ?? [];
  const desc =
    typeof evidencePrompt.officialDescription === "string"
      ? evidencePrompt.officialDescription
      : "";
  const ok =
    atomExposure.length === 0 &&
    claims.length > 0 &&
    desc.length > 0 &&
    full.includes(desc) &&
    full.includes("supportedClaims");

  return {
    ok,
    oracleMatch: null as boolean | null,
    taxonomyLeak: atomExposure.filter((t) => FORBIDDEN_TAXONOMY.includes(t)).length,
    taxonomyHits: atomExposure,
    catalogWrapperLeak: /公開ページ/.test(JSON.stringify(evidencePrompt)) ? 1 : 0,
    available: 0,
    preferred: 0,
    dropped: 0,
    itemKeys: [] as string[],
    availableFacts: EXPECTED_FACT_SNIPPETS.map((fact, i) => ({ id: `snippet::${i}`, fact })),
    preferredFacts: [] as Array<{ id: string; fact: string }>,
    claimsVisible: claims.length,
    descriptionVisible: desc.length > 0,
    atomExposure: atomExposure.length,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  process.env.BLOG_MAX_PLAN_ATTEMPTS = process.env.BLOG_MAX_PLAN_ATTEMPTS ?? "1";

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
  if (!sample?.topicId) throw new Error("sample.json missing (topicId/strategyId)");

  const pre = await buildPreCallContract(database, repo, sample);
  const audit = auditPreCall(pre.evidencePrompt, pre.prompt);

  writeFileSync(`${OUT}/FINAL_SYSTEM.txt`, pre.prompt.systemInstruction);
  writeFileSync(`${OUT}/FINAL_USER.txt`, pre.prompt.userPrompt);
  writeFileSync(`${OUT}/EVIDENCE_PACK_PROMPT.json`, JSON.stringify(pre.evidencePrompt, null, 2));
  writeFileSync(`${OUT}/WRITING_SKELETON_PROMPT.json`, JSON.stringify(pre.skeletonPrompt, null, 2));
  writeFileSync(`${OUT}/GENERATION_AUTHORITY.json`, JSON.stringify(pre.authority, null, 2));
  writeFileSync(`${OUT}/PRE_CALL_AUDIT.json`, JSON.stringify(audit, null, 2));

  if (!audit.ok) {
    writeFileSync(
      `${OUT}/RESULT.json`,
      JSON.stringify({ ok: false, stage: "pre_call_mismatch", audit }, null, 2),
    );
    await database.disconnect();
    process.exit(2);
  }

  const innerLlm = requireApiLLMProvider(config);
  const llm = new SingleCallLLMProvider(innerLlm);
  const generation = new ContentGenerationService(repo, llm, {
    generation: config.llmModelGeneration,
    review: config.llmModelReview,
    revision: config.llmModelRevision,
  });

  const generated = await generation.generateBloggerArticle({
    topicId: sample.topicId,
    strategyId: sample.strategyId,
    productTitle: sample.productTitle,
    ctaUrl: CTA_URL,
    claimIds: sample.claimIds,
    brainGuidedRepair: false,
  });

  const modelRun = await database.prisma.modelRun.findUnique({
    where: { id: generated.modelRunId },
  });
  const rawOutput = (modelRun?.metadata as { output?: Record<string, unknown> } | null)?.output;
  if (!rawOutput || typeof rawOutput !== "object") {
    throw new Error("ModelRun metadata.output missing — cannot save Provider RAW");
  }

  const providerRaw = extractProviderRawKeys(rawOutput as Record<string, unknown>);
  writeFileSync(`${OUT}/PROVIDER_RAW.json`, JSON.stringify(providerRaw, null, 2));

  const defaulted = fillOptionBArticleDefaults(rawOutput as Record<string, unknown>);
  const postDefault = parseBloggerArticle(defaulted);
  writeFileSync(`${OUT}/POST_DEFAULT_ARTICLE.json`, JSON.stringify(postDefault, null, 2));

  const postDefaultDiff: Record<string, unknown> = {};
  if (!("summary" in providerRaw) && postDefault.summary) {
    postDefaultDiff.summary_from_lead = postDefault.summary;
  }
  for (const k of ["seoTitle", "metaDescription", "labels", "usedClaimIds"] as const) {
    if (!(k in providerRaw) && (postDefault as Record<string, unknown>)[k] != null) {
      postDefaultDiff[k] = (postDefault as Record<string, unknown>)[k];
    }
  }

  const version = await database.prisma.contentVersion.findUnique({
    where: { id: generated.version.id },
  });
  const structured = (version?.structuredContent ?? {}) as Record<string, unknown>;
  const storedArticle = structured.article as Record<string, unknown> | undefined;

  const imageResolution = await resolveArticleImagesForTopic(repo, sample.topicId, {
    altBase: sample.productTitle,
  });
  const bodyText = structuredToPlainBody(postDefault, { images: imageResolution.images });
  const claims = await database.prisma.claim.findMany({
    where: { id: { in: sample.claimIds } },
  });
  const claimCheck = validateClaimsAgainstArticle({
    article: postDefault,
    claims,
    bodyText,
    allowedEvidenceIds: pre.evidenceAllowlistIds,
  });
  const integrity = validatePostTransformIntegrity({
    title: postDefault.title,
    lead: postDefault.lead,
    summary: postDefault.summary,
    sections: postDefault.sections.map((s) => ({ paragraphs: s.paragraphs })),
  });

  const brainRun = await database.prisma.editorialBrainRun.findFirst({
    where: { contentVersionId: generated.version.id },
    orderBy: { createdAt: "desc" },
  });
  const brainMeta =
    brainRun?.metadata && typeof brainRun.metadata === "object"
      ? (brainRun.metadata as Record<string, unknown>)
      : {};
  const findingCodes = Array.isArray(brainMeta.findingCodes)
    ? brainMeta.findingCodes
    : Array.isArray(brainMeta.findings)
      ? (brainMeta.findings as Array<{ code?: string }>).map((f) => f.code).filter(Boolean)
      : [];

  const articleText = [
    postDefault.title,
    postDefault.lead,
    ...postDefault.sections.flatMap((s) => s.paragraphs),
  ].join("\n");
  const usedFacts = factsInText(articleText, audit.availableFacts);
  const unusedFacts = audit.availableFacts
    .filter((f) => !usedFacts.includes(f.fact))
    .map((f) => f.fact);

  const llmResult = llm.captured.result!;
  const costJPY = llmResult.currency === "JPY" ? llmResult.actualCost ?? llmResult.estimatedCost : null;
  const costUSD =
    llmResult.currency === "USD"
      ? llmResult.actualCost ?? llmResult.estimatedCost
      : costJPY != null
        ? costJPY / 150
        : null;

  let bloggerUpdated = false;
  let draftStatus: Record<string, unknown> = { attempted: false };
  const hardPass = claimCheck.ok && integrity.ok;

  if (hardPass && config.bloggerMode === "api" && config.bloggerAllowExternalRequests) {
    const html = formatBloggerHtml({
      title: postDefault.title,
      lead: postDefault.lead,
      sections: postDefault.sections,
      cta: postDefault.cta.url
        ? postDefault.cta
        : { label: postDefault.cta.label, url: CTA_URL },
      images: imageResolution.images,
    });
    writeFileSync(`${OUT}/HUMAN_REVIEW_DRAFT.html`, html);
    writeFileSync(`${OUT}/HUMAN_DISPLAY.txt`, html.replace(/<[^>]+>/g, (tag) => {
      if (tag.startsWith("<img")) {
        const m = tag.match(/src="([^"]+)"/);
        return m ? `\n[image] ${m[1]}\n` : "";
      }
      if (tag === "<p>") return "\n";
      if (tag === "</p>") return "\n";
      if (tag.startsWith("<h2")) return "\n";
      if (tag === "</h2>") return "\n";
      if (tag.startsWith("<a ")) return "";
      if (tag === "</a>") return "";
      return "";
    }).replace(/\n{3,}/g, "\n\n").trim());

    const publisher = createBloggerPublisherFromConfig({
      ...config,
      bloggerAllowDirectPublish: false,
    });
    publisher.assertCanCallApi("update");
    const prepared = await publisher.prepare({
      contentVersionId: generated.version.id,
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
        r38: true,
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
      published: status.status !== "LIVE",
      isDraft: status.status === "DRAFT" || status.status === "UNKNOWN",
    };
  } else if (hardPass) {
    const html = formatBloggerHtml({
      title: postDefault.title,
      lead: postDefault.lead,
      sections: postDefault.sections,
      cta: { label: postDefault.cta.label, url: CTA_URL },
      images: imageResolution.images,
    });
    writeFileSync(`${OUT}/HUMAN_REVIEW_DRAFT.html`, html);
    draftStatus = { attempted: false, reason: "blogger_api_not_configured", htmlSaved: true };
  }

  const r31Raw = existsSync(R31_RAW)
    ? (JSON.parse(readFileSync(R31_RAW, "utf8")) as Record<string, unknown>)
    : null;

  const report = {
    A_preCall: {
      oracleMatch: audit.oracleMatch,
      taxonomyLeak: audit.taxonomyLeak,
      catalogWrapperLeak: audit.catalogWrapperLeak,
      available: audit.available,
      preferred: audit.preferred,
      dropped: audit.dropped,
    },
    B_llmCalls: 1,
    C_model: llmResult.model,
    D_tokens: {
      input: llmResult.inputTokens,
      output: llmResult.outputTokens,
      cached: llmResult.cachedTokens ?? 0,
    },
    E_cost: {
      currency: llmResult.currency,
      jpy: costJPY,
      usd: costUSD,
      estimated: llmResult.estimatedCost,
      actual: llmResult.actualCost,
    },
    F_finalSystemBytes: utf8Bytes(pre.prompt.systemInstruction),
    G_finalUserBytes: utf8Bytes(pre.prompt.userPrompt),
    H_providerRaw: providerRaw,
    I_postDefaultDiff: postDefaultDiff,
    J_usedEvidence: usedFacts,
    K_unusedEvidence: unusedFacts,
    L_brainDecision: brainRun?.brainDecision ?? null,
    M_brainFindingCodes: findingCodes,
    N_hardValidators: {
      claimValidation: { ok: claimCheck.ok, findings: claimCheck.findings },
      postTransformIntegrity: integrity,
    },
    O_bloggerDraftUpdated: bloggerUpdated ? "YES" : "NO",
    P_bloggerDisplayPath: `${OUT}/HUMAN_DISPLAY.txt`,
    Q_images: {
      count: imageResolution.images.length,
      contentKeys: imageResolution.images.map((i) => ({
        role: i.role,
        imageType: i.imageType,
        sourceUrl: i.sourceUrl,
      })),
      researchImageCount: imageResolution.researchImageCount,
      pageImageCount: imageResolution.pageImageCount,
    },
    R_draftId: BLOGGER_DRAFT_ID,
    S_editUrl: bloggerUpdated
      ? ((draftStatus.updateResult as { url?: string })?.url ??
        (draftStatus.status as { url?: string })?.url ??
        null)
      : null,
    T_publishedFalse: draftStatus.isDraft !== false,
    U_human: "PENDING_HUMAN_REVIEW",
    V_blogQualityStatus: "PENDING_HUMAN_REVIEW",
    W_r31Comparison: r31Raw
      ? {
          r31Title: r31Raw.title,
          r38Title: providerRaw.title,
          note: "qualitative — see HUMAN_REPORT narrative",
        }
      : null,
    contentVersionId: generated.version.id,
    modelRunId: generated.modelRunId,
    generationAttempt: (modelRun?.metadata as { generationAttempt?: number })?.generationAttempt ?? 1,
    draftStatus,
    stop: "no_auto_fix_no_production_ready",
  };

  writeFileSync(`${OUT}/HUMAN_REPORT.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify({ ok: true, ...report }, null, 2));
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
