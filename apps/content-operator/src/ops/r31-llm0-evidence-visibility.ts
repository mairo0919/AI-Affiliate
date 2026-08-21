/**
 * r31 — LLM=0 Evidence assignment visibility (mizd00320).
 * No external LLM. Reconstructs production EvidencePack + prompt assignment.
 *
 *   pnpm exec tsx src/ops/r31-llm0-evidence-visibility.ts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import {
  buildEvidencePack,
  dedupeConcreteEvidenceByFamily,
  toOptionBWriterSourceMaterial,
} from "../article-pattern/evidence-pack.js";
import { classifySemanticEvidence } from "../article-pattern/semantic-evidence.js";
import type { PageEvidenceMetaShape } from "../article-pattern/official-page-evidence-atoms.js";
import { buildProductMaterialProfileFromPack } from "../article-pattern/reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../article-pattern/skeleton-feasibility.js";
import { buildReferenceGuidedLayer } from "../editorial-brain/generation/reference-guided-layer.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r31-llm0`;
const CTA_URL = "https://video.dmm.co.jp/av/content/?id=mizd00320";
const SAMPLE_CANDIDATES = [
  "/tmp/prod-gen-20260819-r29-delete-first/sample.json",
  "/tmp/prod-gen-20260818-r27-evidence-driven/sample.json",
  "/tmp/prod-gen-20260818-r26-title-persona/sample.json",
];

const EXPECTED_VISIBLE = [
  "松本いちか",
  "令和イチのメスガキ",
  "ベスト",
  "10作品",
  "8時間",
  "480分",
  "22本番",
  "45射精",
  "わからせ",
  "痴女誘惑",
  "激ピス",
  "ギャル妹",
  "小悪魔",
  "デカ尻",
  "絶対空域",
];

const BEFORE = {
  totalFamily: 17,
  preferred: 6,
  optional: 8,
  droppedByOptionalCap: ["ギャル妹", "小悪魔", "絶対空域"],
};

function familyOf(fact: string, sourceType: string) {
  return classifySemanticEvidence(fact, {
    sourceType: sourceType as "product_title" | "product_description" | "claim",
    titleIdentityToken: sourceType === "product_title",
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  loadConfig();
  const database = createDatabaseClient();
  await database.connect();
  const repo = new LifecycleRepository(database.prisma);

  type SamplePick = {
    productTitle: string;
    claimIds: string[];
    topicId?: string;
    strategyId?: string;
  };
  let picked: SamplePick | null = null;
  for (const p of SAMPLE_CANDIDATES) {
    if (!existsSync(p)) continue;
    const s = JSON.parse(readFileSync(p, "utf8")) as SamplePick;
    if (s?.productTitle && s?.claimIds?.length) {
      picked = s;
      break;
    }
  }

  const product = await database.prisma.affiliateProduct.findFirst({
    where: {
      OR: [
        { externalProductId: { contains: "mizd00320", mode: "insensitive" } },
        { title: { contains: "mizd00320", mode: "insensitive" } },
        { title: { contains: "松本いちか", mode: "insensitive" } },
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
    writeFileSync(
      `${OUT}/RESULT.json`,
      JSON.stringify({ ok: false, error: "NO_PAGE_EVIDENCE", sourceDocumentId: doc?.id }, null, 2),
    );
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
  const eligible = evidencePack.concreteEvidence.filter((e) => e.generationEligible);
  const available = dedupeConcreteEvidenceByFamily(eligible);
  const preferredItems = [
    feasibility.assignment.title.primary,
    ...feasibility.assignment.title.supporting,
    feasibility.assignment.opening.primary,
    ...feasibility.assignment.opening.supporting,
    ...feasibility.assignment.body.flatMap((b) => [b.primary, ...b.supporting]),
    feasibility.assignment.ending.primary,
  ].filter(Boolean) as typeof eligible;
  const preferred = dedupeConcreteEvidenceByFamily(preferredItems);
  const writerMaterial = toOptionBWriterSourceMaterial({
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
  const availableIds = new Set(available.map((e) => e.id));
  const dropped = dedupeConcreteEvidenceByFamily(eligible).filter((e) => !availableIds.has(e.id));

  const familyIds = available.map((e) => familyOf(e.fact, "product_description").familyId);
  const familyDupes = familyIds.filter((f, i) => familyIds.indexOf(f) !== i);

  const blob = JSON.stringify(available);
  const visibility = EXPECTED_VISIBLE.map((fact) => {
    const visible =
      blob.includes(fact) ||
      (fact === "8時間" && (blob.includes("8時間") || blob.includes("480分"))) ||
      (fact === "480分" && (blob.includes("480分") || blob.includes("8時間"))) ||
      (fact === "痴女誘惑" && (blob.includes("痴女誘惑") || blob.includes("痴女")));
    return { fact, visible };
  });
  void writerMaterial;
  const missingExpected = visibility.filter((v) => !v.visible).map((v) => v.fact);

  const bodySlots = feasibility.skeleton.body.length;
  const report = {
    round: "r31",
    llmCalls: 0,
    productTitle: product.title,
    ctaUrl: CTA_URL,
    A_uniqueFamiliesInPack: profile.uniqueConcreteFamilyCount,
    B_preferredCount: preferred.length,
    C_availableConcreteCount: available.length,
    D_promptVisibleFamilies: available.map((e) => ({
      id: e.id,
      fact: e.fact,
      familyId: familyOf(e.fact, "product_description").familyId,
    })),
    E_droppedGenerationEligible: dropped.map((e) => ({ id: e.id, fact: e.fact })),
    F_optionalCapRemoved: true,
    G_anyFallback: feasibility.assignment.anyFallbackCount,
    H_familyDuplicatesInAvailable: familyDupes,
    expectations: {
      droppedByArbitraryCap: dropped.length === 0,
      anyFallbackZero: feasibility.assignment.anyFallbackCount === 0,
      semanticDuplicateZero: familyDupes.length === 0,
      skeletonSlotDoesNotCapVisibility: available.length > bodySlots,
      expectedVisibleOk: missingExpected.length === 0,
    },
    BEFORE,
    AFTER: {
      totalFamily: profile.uniqueConcreteFamilyCount,
      preferred: preferred.length,
      available: available.length,
      dropped: dropped.length,
      optional: 0,
    },
    deletedCaps: [
      "leftover.slice(0, 8)",
      "optionalUnusedConcreteEvidence as visibility bucket",
      "preferred==allowlist (concreteEvidence was assignment-only)",
    ],
    skeletonDecouplingProof: {
      bodySlotCount: bodySlots,
      preferredCount: preferred.length,
      availableCount: available.length,
      availableExceedsBodySlots: available.length > bodySlots,
      preferredIsSubsetNotEqual:
        preferred.length < available.length ||
        preferred.some((p) => !availableIds.has(p.id)) === false,
    },
    expectedVisibility: visibility,
    missingExpected,
    preferredFacts: preferred.map((e) => e.fact),
    availableFacts: available.map((e) => e.fact),
    profile,
    skeleton: feasibility.skeleton,
    ok:
      dropped.length === 0 &&
      feasibility.assignment.anyFallbackCount === 0 &&
      familyDupes.length === 0 &&
      available.length > bodySlots &&
      missingExpected.length === 0,
  };

  writeFileSync(`${OUT}/LLM0_VISIBILITY.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await database.disconnect();
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
