/**
 * r32 — LLM=0 INTERNAL_METADATA_LEAK / SEMANTIC_REINTERPRETATION audit.
 *
 * Does NOT ban promotional words (魅力/楽しめる/見どころ/…).
 * Tracks whether Writer sees internal type/family/role/profile/transform metadata.
 *
 *   npx tsx src/ops/r32-llm0-internal-metadata-leak-audit.ts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import {
  buildEvidencePack,
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
import { buildOptionBBloggerGeneratorPrompt } from "../editorial-brain/generation/option-b-blogger-prompt.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r32-metadata-leak`;
const SAMPLE_CANDIDATES = [
  "/tmp/prod-gen-20260819-r31-evidence-assignment/sample.json",
  "/tmp/prod-gen-20260819-r29-delete-first/sample.json",
  "/tmp/prod-gen-20260818-r27-evidence-driven/sample.json",
];
const R31_RAW =
  "/tmp/prod-gen-20260819-r31-evidence-assignment/PROVIDER_RAW.json";

/** Internal taxonomy tokens that Writer should not need to see. */
const INTERNAL_TYPE_TOKENS = [
  "body_trait",
  "BODY_TRAIT",
  "scene_or_act",
  "SCENE_ACTION",
  "performer_identity",
  "quantity_or_runtime",
  "series_or_event",
  "product_identity",
  "setting_or_situation",
  "character_trait",
  "PRODUCT_PERSONA",
  "PRODUCT_FORM",
  "primaryEvidenceRole",
  "supportingEvidenceRoles",
  "familyId",
  "blueprintType",
  "materialDepth",
  "sceneFamilies",
  "quantityFamilies",
  "durationFamilies",
  "characterTraitFamilies",
  "bodyTraitFamilies",
  "uniqueConcreteFamilyCount",
  "independentDevelopmentFamilyCount",
  "transformation",
  "natural_compose_multi_fact",
  "slotAssignment",
  "preferredEvidence",
  "availableConcreteEvidence",
  "catalogMetadataNote",
  "catalogMetadataCount",
  "unavailableEvidence",
  "videoEvidence",
  "generationEligible",
  "PRODUCT_FORM_BEST",
  "DURATION_480MIN",
  "COUNT_10",
  "COUNT_22",
  "COUNT_45",
  "SCENE_わからせ",
  "SCENE_痴女",
  "SCENE_激ピス",
  "BODY_デカ尻",
  "PERSONA_メスガキ",
  "PERSONA_ギャル",
  "PERSONA_小悪魔",
];

/** Japanese leak of internal English taxonomy (smoking gun for ボディトレイト). */
const JA_REINTERPRET_LEAKS = [
  "ボディトレイト",
  "ボディートレイト",
  "ボディ・トレイト",
  "body trait",
  "Body Trait",
  "セマンティック",
  "ファミリーID",
  "エビデンスロール",
];

/** Natural promo — NOT a problem per r32 policy. Listed only to exclude from FINDINGS. */
const NATURAL_PROMO_OK = [
  "魅力",
  "魅力を凝縮",
  "楽しめる",
  "見どころ",
  "詰め込んだ",
  "まとめた",
];

type Hit = { token: string; where: string; count: number; samples: string[] };

function collectHits(blob: string, tokens: string[], where: string): Hit[] {
  const hits: Hit[] = [];
  for (const token of tokens) {
    if (!blob.includes(token)) continue;
    const count = blob.split(token).length - 1;
    const samples: string[] = [];
    let idx = 0;
    while ((idx = blob.indexOf(token, idx)) !== -1 && samples.length < 2) {
      samples.push(blob.slice(Math.max(0, idx - 40), Math.min(blob.length, idx + token.length + 40)));
      idx += token.length;
    }
    hits.push({ token, where, count, samples });
  }
  return hits;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  const repo = new LifecycleRepository(database.prisma);

  type SamplePick = { productTitle: string; claimIds: string[] };
  let picked: SamplePick | null = null;
  for (const p of SAMPLE_CANDIDATES) {
    if (!existsSync(p)) continue;
    const s = JSON.parse(readFileSync(p, "utf8")) as SamplePick;
    if (s?.claimIds?.length) {
      picked = s;
      break;
    }
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
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify({ ok: false, error: "NO_PRODUCT" }, null, 2));
    await database.disconnect();
    process.exit(2);
  }

  const claims = picked?.claimIds?.length
    ? await database.prisma.claim.findMany({ where: { id: { in: picked.claimIds } } })
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
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify({ ok: false, error: "NO_PAGE_EVIDENCE" }, null, 2));
    await database.disconnect();
    process.exit(2);
  }

  const referenceGuided = await buildReferenceGuidedLayer({
    prisma: database.prisma,
    productTitle: product.title,
    claims: claimsForPack,
    pageEvidenceMeta,
  });
  const evidencePack = buildEvidencePack({
    productTitle: product.title,
    claims: claimsForPack,
    researchEvidence: referenceGuided.researchEvidence,
    pageEvidenceMeta,
  });
  const profile = buildProductMaterialProfileFromPack(evidencePack);
  const feasibility = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack: evidencePack,
    profile,
  });
  const writingSkeletonPrompt = toWritingSkeletonPromptContract(feasibility.skeleton)!;
  const evidencePackPrompt = toOptionBWriterSourceMaterial({
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
  const authority = buildOptionBGenerationAuthority({
    writingSkeleton: writingSkeletonPrompt,
    evidencePack: evidencePackPrompt,
  });
  const prompt = buildOptionBBloggerGeneratorPrompt({
    productTitle: product.title,
    ctaUrl: "https://video.dmm.co.jp/av/content/?id=mizd00320",
    articleFormat: "NEW_RELEASE_SINGLE",
    generationAuthority: authority,
  });

  const system = prompt.systemInstruction;
  const user = prompt.userPrompt;
  const full = system + "\n---\n" + user;
  const authJson = JSON.stringify(authority, null, 2);
  const epJson = JSON.stringify(evidencePackPrompt, null, 2);
  const skJson = JSON.stringify(writingSkeletonPrompt, null, 2);

  writeFileSync(`${OUT}/FINAL_SYSTEM.txt`, system);
  writeFileSync(`${OUT}/FINAL_USER.txt`, user);
  writeFileSync(`${OUT}/GENERATION_AUTHORITY.json`, authJson);
  writeFileSync(`${OUT}/EVIDENCE_PACK_PROMPT.json`, epJson);
  writeFileSync(`${OUT}/WRITING_SKELETON_PROMPT.json`, skJson);

  const layers = {
    FINAL_WRITER_PROMPT: collectHits(full, INTERNAL_TYPE_TOKENS, "FINAL_WRITER_PROMPT"),
    EVIDENCE_PACK_PROMPT: collectHits(epJson, INTERNAL_TYPE_TOKENS, "EVIDENCE_PACK_PROMPT"),
    WRITING_SKELETON_PROMPT: collectHits(skJson, INTERNAL_TYPE_TOKENS, "WRITING_SKELETON_PROMPT"),
    GENERATION_AUTHORITY: collectHits(authJson, INTERNAL_TYPE_TOKENS, "GENERATION_AUTHORITY"),
  };

  // productMaterialProfile is on brain contract — confirm NOT in OPTION B authority/prompt
  const profileKeys = [
    "materialDepth",
    "sceneFamilies",
    "quantityFamilies",
    "uniqueConcreteFamilyCount",
    "identity_heavy_best_collection",
  ];
  const profileInWriter = profileKeys.filter((k) => full.includes(k));

  // Writer source material field inventory (r43: no atom items)
  const sampleItem = Array.isArray(evidencePackPrompt.supportedClaims)
    ? (evidencePackPrompt.supportedClaims as unknown[])[0]
    : null;
  const evidenceItemKeys =
    sampleItem && typeof sampleItem === "object" ? Object.keys(sampleItem as object) : [];

  const bodyTraitItems: Array<{ fact?: string; type?: string }> = [];

  const r31Raw = existsSync(R31_RAW)
    ? (JSON.parse(readFileSync(R31_RAW, "utf8")) as {
        lead?: string;
        sections?: Array<{ paragraphs?: string[] }>;
      })
    : null;
  const r31Prose = r31Raw
    ? [
        r31Raw.lead ?? "",
        ...((r31Raw.sections ?? []).flatMap((s) => s.paragraphs ?? [])),
      ].join("\n")
    : "";
  const jaLeaksInRaw = collectHits(r31Prose, JA_REINTERPRET_LEAKS, "R31_PROVIDER_RAW");
  const promoInRaw = NATURAL_PROMO_OK.filter((w) => r31Prose.includes(w));

  // Causal chain for ボディトレイト
  const causalChain = {
    hypothesis: "INTERNAL_TYPE_EXPOSED → MODEL_REINTERPRETS_AS_JA_TAXONOMY_WORD",
    evidenceInPack: bodyTraitItems.map((e) => ({ fact: e.fact, type: e.type })),
    typeFieldInWriterPrompt: full.includes('"type":"body_trait"') || full.includes('"type": "body_trait"'),
    roleFieldInWriterPrompt:
      full.includes("primaryEvidenceRole") && full.includes("body_trait"),
    r31OutputContainsボディトレイト: r31Prose.includes("ボディトレイト"),
    naturalPromoNotRootCause: {
      note: "見どころ/魅力 are OK; problem is ボディトレイト as taxonomy word",
      promoPresentInR31: promoInRaw,
    },
  };

  const findings = [
    {
      id: "INTERNAL_METADATA_LEAK",
      severity: "P0",
      present: layers.FINAL_WRITER_PROMPT.length > 0,
      detail:
        "Writer FINAL prompt (generationAuthority JSON) contains internal Evidence.type and Skeleton.primaryEvidenceRole taxonomy tokens (e.g. body_trait).",
      hits: layers.FINAL_WRITER_PROMPT.slice(0, 40),
    },
    {
      id: "SEMANTIC_REINTERPRETATION",
      severity: "P0",
      present: Boolean(causalChain.r31OutputContainsボディトレイト && causalChain.typeFieldInWriterPrompt),
      detail:
        "r31 RAW used 「ボディトレイト」 while Writer saw type=body_trait on デカ尻/絶対空域 — taxonomy→reader-prose conversion, not promo-word failure.",
      causalChain,
    },
    {
      id: "MATERIAL_PROFILE_IN_WRITER",
      severity: "P1",
      present: profileInWriter.length > 0,
      detail:
        profileInWriter.length > 0
          ? "productMaterialProfile keys appear in Writer prompt"
          : "productMaterialProfile NOT injected into OPTION B generationAuthority (good — stays on brain contract only)",
      keysFound: profileInWriter,
    },
    {
      id: "FAMILY_ID_IN_WRITER",
      severity: "P1",
      present: layers.FINAL_WRITER_PROMPT.some((h) =>
        /^(BODY_|SCENE_|PERSONA_|COUNT_|DURATION_|PRODUCT_FORM_)/.test(h.token) ||
        h.token === "familyId",
      ),
      detail: "Semantic familyId strings in Writer prompt?",
    },
    {
      id: "NATURAL_PROMO_NOT_IN_SCOPE",
      severity: "INFO",
      present: true,
      detail:
        "魅力/楽しめる/見どころ/詰め込んだ/まとめた are NOT DELETE targets. Do not add ban rules for them.",
      tokens: NATURAL_PROMO_OK,
    },
  ];

  const deleteFirstCandidates = [
    {
      field: "concreteEvidence[].type",
      current: "body_trait / scene_or_act / …",
      writerNeed: "NONE — fact string is enough",
      action: "STRIP from toEvidencePackPromptWithAssignments mapItem (keep internal for assignment)",
    },
    {
      field: "WRITING_SKELETON.*.primaryEvidenceRole",
      current: "performer_identity / quantity_or_runtime / body_trait",
      writerNeed: "LOW — HOW can be purpose-only without taxonomy role names",
      action: "Consider strip or replace with human purpose only (already have purpose)",
    },
    {
      field: "slotAssignment",
      current: "primaryFact/supportingFacts by slot",
      writerNeed: "OPTIONAL hint — facts OK, but duplicates preferredEvidence",
      action: "Audit whether still needed after preferredEvidence; if kept, facts-only is fine",
    },
    {
      field: "productMaterialProfile / family lists",
      current: "on brain contract, not authority",
      writerNeed: "NONE",
      action: "KEEP out of Writer (already excluded from OPTION B authority)",
    },
    {
      field: "魅力/見どころ/楽しめる",
      current: "natural promo in RAW",
      writerNeed: "OK",
      action: "DO NOT DELETE / DO NOT BAN",
    },
  ];

  const report = {
    round: "r32",
    llmCalls: 0,
    policy:
      "Natural promo OK. Track INTERNAL_METADATA_LEAK / SEMANTIC_REINTERPRETATION only.",
    evidenceItemKeysInWriter: evidenceItemKeys,
    writingSkeletonKeysInWriter: Object.keys(writingSkeletonPrompt),
    authorityTopKeys: Object.keys(authority),
    layers,
    findings,
    deleteFirstCandidates,
    FIRST_LOSS: findings
      .filter((f) => f.present === true && f.severity === "P0")
      .map((f) => f.id),
    nextLayer:
      "WRITER_PROMPT_PROJECTION — strip Evidence.type (+ optionally Skeleton role taxonomy) from Generator-facing pack; keep internal for assignment",
    ok: true,
  };

  writeFileSync(`${OUT}/AUDIT.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await database.disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
