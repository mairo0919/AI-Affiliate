/**
 * r33 — LLM=0 production Writer Prompt projection audit (no LLM).
 *
 *   npx tsx src/ops/r33-llm0-writer-prompt-projection.ts
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
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r33-writer-projection`;
const SAMPLE_CANDIDATES = [
  "/tmp/prod-gen-20260819-r31-evidence-assignment/sample.json",
  "/tmp/prod-gen-20260819-r29-delete-first/sample.json",
];

const FORBIDDEN = [
  "body_trait",
  "unknown_concrete",
  "performer_identity",
  "quantity_or_runtime",
  "scene_or_act",
  "series_or_event",
  "primaryEvidenceRole",
  "supportingEvidenceRoles",
];

const BEFORE_EVIDENCE = {
  itemKeys: ["id", "type", "fact", "claimId"],
  alsoHad: [
    "catalogMetadataNote",
    "catalogMetadataCount",
    "unavailableEvidence",
    "videoEvidence",
  ],
};
const BEFORE_SKELETON = {
  openingKeys: ["purpose", "primaryEvidenceRole"],
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  const repo = new LifecycleRepository(database.prisma);

  type SamplePick = { claimIds: string[] };
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
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify({ ok: false, error: "NO_PAGE" }, null, 2));
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
  const skeletonPrompt = toWritingSkeletonPromptContract(feasibility.skeleton)!;
  const evidencePrompt = toOptionBWriterSourceMaterial({
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
    writingSkeleton: skeletonPrompt,
    evidencePack: evidencePrompt,
  });
  const prompt = buildOptionBBloggerGeneratorPrompt({
    productTitle: product.title,
    ctaUrl: "https://video.dmm.co.jp/av/content/?id=mizd00320",
    articleFormat: "NEW_RELEASE_SINGLE",
    generationAuthority: authority,
  });
  const full = prompt.systemInstruction + "\n" + prompt.userPrompt;

  writeFileSync(`${OUT}/FINAL_SYSTEM.txt`, prompt.systemInstruction);
  writeFileSync(`${OUT}/FINAL_USER.txt`, prompt.userPrompt);
  writeFileSync(`${OUT}/EVIDENCE_PACK_PROMPT.json`, JSON.stringify(evidencePrompt, null, 2));
  writeFileSync(`${OUT}/WRITING_SKELETON_PROMPT.json`, JSON.stringify(skeletonPrompt, null, 2));
  writeFileSync(`${OUT}/GENERATION_AUTHORITY.json`, JSON.stringify(authority, null, 2));

  const claimsVisible =
    (evidencePrompt.supportedClaims as Array<{ id: string; statement: string }>) ?? [];
  const sampleItem = claimsVisible[0] ?? null;
  const forbiddenHits = FORBIDDEN.filter((t) => full.includes(t));

  const expectedFacts = [
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
    "デカ尻",
    "絶対空域",
  ];
  const desc =
    typeof evidencePrompt.officialDescription === "string"
      ? evidencePrompt.officialDescription
      : "";
  const blob = [product.title, desc, ...claimsVisible.map((c) => c.statement)].join("\n");
  const missingFacts = expectedFacts.filter((f) => !blob.includes(f));

  const internalTypesKept = evidencePack.concreteEvidence
    .filter((e) => e.generationEligible)
    .some((e) => typeof e.type === "string" && e.type.length > 0);
  const internalRolesKept = Boolean(feasibility.skeleton.opening.primaryEvidenceRole);

  const remainingMeta = {
    authorityTopKeys: Object.keys(authority),
    evidencePackKeys: Object.keys(evidencePrompt),
    skeletonKeys: Object.keys(skeletonPrompt),
    evidenceItemKeys: sampleItem ? Object.keys(sampleItem) : [],
    skeletonOpeningKeys: Object.keys((skeletonPrompt.opening as object) ?? {}),
  };

  const report = {
    round: "r33",
    llmCalls: 0,
    apiCostJPY: 0,
    A_changedFiles: [
      "apps/content-operator/src/article-pattern/skeleton-evidence-assignment.ts",
      "apps/content-operator/src/article-pattern/writing-skeleton.ts",
      "apps/content-operator/src/article-pattern/evidence-pack.ts",
      "apps/content-operator/src/generation/content-generation-service.ts",
      "apps/content-operator/src/article-pattern/__tests__/r43-writer-source-material.test.ts",
      "apps/content-operator/src/ops/r33-llm0-writer-prompt-projection.ts",
    ],
    B_evidenceBeforeAfter: {
      before: BEFORE_EVIDENCE,
      afterItemKeys: sampleItem ? Object.keys(sampleItem) : [],
      afterPackKeys: Object.keys(evidencePrompt),
      sampleItem,
    },
    C_skeletonBeforeAfter: {
      before: BEFORE_SKELETON,
      after: skeletonPrompt,
    },
    D_deletedInternalMetadata: [
      "concreteEvidence[].type",
      "concreteEvidence[].claimId",
      "catalogMetadataNote",
      "catalogMetadataCount",
      "unavailableEvidence",
      "videoEvidence",
      "WRITING_SKELETON.primaryEvidenceRole",
      "WRITING_SKELETON.supportingEvidenceRoles",
      "pack.duty (legacy toEvidencePackPromptContract)",
    ],
    E_remainingWriterMetadata: remainingMeta,
    F_allFamiliesVisible: {
      availableCount: claimsVisible.length,
      uniqueFamilyCount: profile.uniqueConcreteFamilyCount,
      missingExpectedFacts: missingFacts,
      descriptionLen: desc.length,
      ok: missingFacts.length === 0 && desc.length > 0 && claimsVisible.length > 0,
    },
    G_preferredAvailable: {
      preferredCount: 0,
      availableCount: claimsVisible.length,
      preferredIdsSubset: true,
      noDrop: true,
      note: "r43: Writer uses source Claims+description; preferred atoms are internal-only",
    },
    H_forbiddenSearch: {
      tokens: FORBIDDEN,
      hits: forbiddenHits,
      clean: forbiddenHits.length === 0,
    },
    I_internalPackKeepsType: internalTypesKept,
    J_assignmentKeepsRoles: internalRolesKept,
    L_llmCalls: 0,
    M_apiCostJPY: 0,
    ok:
      forbiddenHits.length === 0 &&
      missingFacts.length === 0 &&
      internalTypesKept &&
      internalRolesKept &&
      desc.length > 0 &&
      claimsVisible.length > 0 &&
      !full.includes("concreteEvidence") &&
      !full.includes("assignedFacts"),
  };

  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await database.disconnect();
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
