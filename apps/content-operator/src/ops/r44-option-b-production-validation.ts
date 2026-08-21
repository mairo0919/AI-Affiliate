/**
 * r44 — OPTION B PRODUCTION VALIDATION (post-r43 cleanup, mizd00320, max 1 LLM).
 *
 *   OUT_DIR=/tmp/prod-gen-20260820-r44-mizd00320 \
 *   BLOG_MAX_PLAN_ATTEMPTS=1 \
 *   BLOGGER_DRAFT_ID=5758756966895197750 \
 *   npx tsx src/ops/r44-option-b-production-validation.ts
 *
 * No prompt/evidence/brain/rule changes. No regen/repair. Observe-only report. STOP.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import { formatBloggerHtml } from "../generation/blogger-formatter.js";
import { resolveArticleImagesForTopic } from "../generation/resolve-article-images.js";
import {
  fillOptionBArticleDefaults,
  OPTION_B_LLM_REQUIRED_KEYS,
  parseBloggerArticle,
  structuredToPlainBody,
} from "../generation/structured-article.js";
import { validateClaimsAgainstArticle } from "../generation/claim-validator.js";
import { validatePostTransformIntegrity } from "../editorial-brain/generation/post-transform-integrity.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r44-mizd00320`;
const R38_DIR = "/tmp/prod-gen-20260820-r38-mizd00320";
const SAMPLE_CANDIDATES = [
  "/tmp/prod-gen-20260819-r31-evidence-assignment/sample.json",
  "/tmp/prod-gen-20260819-r29-delete-first/sample.json",
];
const BLOGGER_DRAFT_ID = process.env.BLOGGER_DRAFT_ID || "5758756966895197750";
const CTA_URL = "https://video.dmm.co.jp/av/content/?id=mizd00320";

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

class SingleCallLLMProvider implements LLMProvider {
  readonly providerKey: string;
  private used = false;
  readonly captured: { request?: LLMTaskRequest; result?: LLMTaskResult } = {};

  constructor(private readonly inner: LLMProvider) {
    this.providerKey = inner.providerKey;
  }

  async executeTask(request: LLMTaskRequest): Promise<LLMTaskResult> {
    if (this.used) {
      throw new Error("r44 HARD LIMIT: second LLM call blocked (max 1)");
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

function compareToR38(r44Text: string, r38Text: string | null): Record<string, string> {
  if (!r38Text) {
    return { note: "r38 HUMAN_DISPLAY.txt missing — qualitative N/A" };
  }
  const r44 = r44Text.replace(/\s+/g, "");
  const r38 = r38Text.replace(/\s+/g, "");
  const has = (t: string, s: string) => t.includes(s);
  return {
    semantic_misuse:
      has(r44, "10作品") && has(r44, "8時間")
        ? "r44 still repeats scale facts across lead/body (same family as r38)"
        : "r44 scale-fact distribution differs from r38 pattern",
    source_context_fidelity:
      has(r44, "松本いちか") && has(r44, "令和イチのメスガキ")
        ? "core title/identity facts present (parity with r38)"
        : "core identity facts weaker than r38",
    repetition:
      (r44.match(/松本いちか/g)?.length ?? 0) >= 3
        ? "performer name repeated frequently (similar to r38)"
        : "lighter name repetition than typical r38",
    naturalness: has(r44, "魅力") || has(r44, "人気") || has(r44, "ファン")
      ? "evaluative/promo padding present (similar class to r38)"
      : "less overt promo padding than r38",
    factual_grounding:
      has(r44, "480分") || has(r44, "22本番") || has(r44, "45")
        ? "numeric catalog facts present"
        : "fewer numeric catalog facts than r38",
    filler: has(r44, "必見") || has(r44, "充実") || has(r44, "存分")
      ? "filler/evaluative phrases present"
      : "less filler than r38 promo register",
    note: "Observe-only deltas — no auto-fix this round.",
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
  if (!sample?.topicId) throw new Error("sample.json missing");

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
  const writerSourceMaterial = toOptionBWriterSourceMaterial({
    productTitle: product.title,
    claims: claimsForPack.map((c) => ({
      id: c.id,
      statement: c.statement,
      kind: c.kind ?? undefined,
    })),
    officialDescription,
  });
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
  writeFileSync(`${OUT}/WRITER_SOURCE_MATERIAL.json`, JSON.stringify(writerSourceMaterial, null, 2));
  writeFileSync(`${OUT}/WRITER_SOURCE_MATERIAL.txt`, JSON.stringify(writerSourceMaterial, null, 2));
  writeFileSync(`${OUT}/FINAL_SYSTEM.txt`, prompt.systemInstruction);
  writeFileSync(`${OUT}/FINAL_USER.txt`, prompt.userPrompt);
  writeFileSync(`${OUT}/WRITING_SKELETON_PROMPT.json`, JSON.stringify(skeletonPrompt, null, 2));
  writeFileSync(
    `${OUT}/PRE_CALL_AUDIT.json`,
    JSON.stringify(
      {
        ok: atomLeaks.length === 0 && Boolean(writerSourceMaterial.supportedClaims),
        atomLeaks,
        writerKeys: Object.keys(writerSourceMaterial),
        allowlistCount: evidenceAllowlistIds.length,
        systemBytes: utf8Bytes(prompt.systemInstruction),
        userBytes: utf8Bytes(prompt.userPrompt),
      },
      null,
      2,
    ),
  );

  if (atomLeaks.length > 0) {
    writeFileSync(
      `${OUT}/RESULT.json`,
      JSON.stringify({ ok: false, stage: "pre_call_atom_leak", atomLeaks }, null, 2),
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

  // Prefer live generation ModelRun; fallback scan latest mizd run only if needed.
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

  const defaulted = fillOptionBArticleDefaults(rawOutput as Record<string, unknown>);
  const postDefault = parseBloggerArticle(defaulted);
  writeFileSync(`${OUT}/POST_DEFAULT_ARTICLE.json`, JSON.stringify(postDefault, null, 2));

  const versionId = generated?.version.id ?? null;
  const version = versionId
    ? await database.prisma.contentVersion.findUnique({ where: { id: versionId } })
    : null;

  // Count = unique safe product images (no artificial local maxCount; same as production CGS).
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
  const reviewFindings =
    brainRun?.reviewResult && typeof brainRun.reviewResult === "object"
      ? brainRun.reviewResult
      : null;

  const llmResult = llm.captured.result!;
  const costJPY =
    llmResult.currency === "JPY" ? llmResult.actualCost ?? llmResult.estimatedCost : null;
  const costUSD =
    llmResult.currency === "USD"
      ? llmResult.actualCost ?? llmResult.estimatedCost
      : costJPY != null
        ? Number((costJPY / 150).toFixed(6))
        : null;

  const hardPass = claimCheck.ok && integrity.ok;
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

  let bloggerUpdated = false;
  let draftStatus: Record<string, unknown> = { attempted: false };
  if (hardPass && config.bloggerMode === "api" && config.bloggerAllowExternalRequests) {
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
        contentVersionId: versionId ?? `r44-human-review:${sample.label}`,
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
          r44: true,
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
        htmlSaved: true,
      };
    }
  }

  const r38Display = existsSync(`${R38_DIR}/HUMAN_DISPLAY.txt`)
    ? readFileSync(`${R38_DIR}/HUMAN_DISPLAY.txt`, "utf8")
    : null;
  const r38Compare = compareToR38(humanDisplay, r38Display);

  const editUrl = config.bloggerBlogId
    ? `https://www.blogger.com/blog/post/edit/${config.bloggerBlogId}/${BLOGGER_DRAFT_ID}`
    : null;

  const report = {
    round: "r44",
    ok: Boolean(generated) && !generationError,
    generationError,
    A_providerRawFull: providerRaw,
    B_writerSourceMaterialFull: writerSourceMaterial,
    C_llm: {
      calls: 1,
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
    D_brain: {
      decision: brainRun?.brainDecision ?? null,
      status: brainRun?.status ?? null,
      findingCodes,
      reviewResult: reviewFindings,
      contentVersionStatus: version?.status ?? null,
    },
    E_hardValidators: {
      claimValidation: { ok: claimCheck.ok, findings: claimCheck.findings },
      postTransformIntegrity: integrity,
    },
    F_humanDisplayFull: humanDisplay,
    G_imageCount: imageResolution.images.length,
    H_bloggerDraftUpdate: {
      updated: bloggerUpdated ? "YES" : "NO",
      draftId: BLOGGER_DRAFT_ID,
      editUrl,
      detail: draftStatus,
    },
    I_published: false,
    J_human: "PENDING_HUMAN_REVIEW",
    r38_delta_only: r38Compare,
    modelRunId,
    contentVersionId: versionId,
    stop: "no_auto_fix_no_new_rules_no_prompt_change",
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
