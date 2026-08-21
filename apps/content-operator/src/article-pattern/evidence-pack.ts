/**
 * Evidence Pack — Generator WHAT SSOT (OPTION B).
 * Separates concrete article fuel from catalog metadata shells.
 */

import type { ResearchEvidence } from "./research-evidence.js";
import { buildResearchEvidence } from "./research-evidence.js";
import type { BlueprintEvidenceType } from "./reference-editorial-blueprint.js";
import { classifyEvidenceTypesInText } from "./reference-editorial-blueprint.js";
import { classifySemanticEvidence, collapseEquivalentDurationSurfaces, collectPreferredDurationSurfaces } from "./semantic-evidence.js";
import type { PageEvidenceMetaShape } from "./official-page-evidence-atoms.js";
import {
  extractAtomsFromPageEvidenceMeta,
  officialPageAtomsToResearchEvidence,
} from "./official-page-evidence-atoms.js";

export type EvidencePackItem = {
  id: string;
  type: BlueprintEvidenceType | "product_identity" | "catalog_shell";
  fact: string;
  provenance: {
    sourceType: string;
    sourceRef: string;
    claimId?: string | null;
  };
  confidence: "high" | "medium" | "low";
  generationEligible: boolean;
};

export type EvidencePack = {
  schemaVersion: 1;
  productIdentity: {
    title: string;
    titleFacets: string[];
  };
  concreteEvidence: EvidencePackItem[];
  /** Non-primary context (optional supporting) — not catalog shells */
  contextualEvidence?: EvidencePackItem[];
  catalogMetadata: EvidencePackItem[];
  unavailableEvidence: Array<{
    kind:
      | "product_description"
      | "sample_video_content"
      | "third_party_review"
      | "DESCRIPTION_EVIDENCE"
      | "VIDEO_EVIDENCE"
      | "IMAGE_OBSERVATION";
    reason: string;
    generationEligible: false;
  }>;
  /**
   * Extension point for future video analysis (not implemented this phase).
   * Allowed future types: VIDEO_SCENE | VIDEO_ACTION | VIDEO_SETTING | VIDEO_SEQUENCE
   */
  videoEvidence?: {
    playerUrlPresent: boolean;
    generationEligible: false;
    pendingTypes?: Array<"VIDEO_SCENE" | "VIDEO_ACTION" | "VIDEO_SETTING" | "VIDEO_SEQUENCE">;
  };
  insufficientConcrete: boolean;
  insufficientReason: string | null;
};

const CATALOG_FACET_TYPES = new Set<BlueprintEvidenceType>([
  "maker_or_label",
  "availability_or_catalog",
]);

/** Strip catalog confirmation wrappers; keep the factual core. */
export function stripCatalogWrapper(statement: string): string {
  let s = (statement ?? "").trim();
  s = s.replace(/\s*は公開ページ上で確認できる。?$/u, "");
  s = s.replace(/\s*は公開カタログ上で確認できる。?$/u, "");
  s = s.replace(/\s*は公開ページで確認できた。?$/u, "");
  s = s.replace(/\s*が公開ページ上で確認できる。?$/u, "");
  s = s.replace(/^メーカー／レーベルとして「(.+?)」が公開されている。?$/u, "$1");
  s = s.replace(/^シリーズ情報として「(.+?)」が公開されている。?$/u, "$1");
  s = s.replace(/^出演者／クリエイターとして「(.+?)」が記載されている。?$/u, "$1");
  s = s.replace(/^公開ページ上で販売／配信状態は「(.+?)」と確認できる。?$/u, "$1");
  s = s.replace(/^公開されている発売／配信情報:\s*/u, "");
  s = s.replace(/^公開価格として\s*/u, "").replace(/\s*が確認できる。?$/u, "");
  s = s.replace(/^(.+?)が収録規模として記載されている。?$/u, "$1");
  s = s.replace(/^(.+?)が公開情報として記載されている。?$/u, "$1");
  return s.trim();
}

export function isCatalogShellStatement(statement: string): boolean {
  const s = (statement ?? "").trim();
  if (!s) return true;
  if (/^メーカー／レーベルとして/.test(s)) return true;
  if (/^公開ページ上で販売／配信状態は/.test(s)) return true;
  if (/^シリーズ情報として/.test(s) && s.length < 80) return true;
  if (/は公開ページ上で確認できる。?$/.test(s)) {
    // Title-rich rows: wrapper is catalog but core may be concrete — not pure shell
    const core = stripCatalogWrapper(s);
    return core.length < 8 || !classifyEvidenceTypesInText(core).some((t) =>
      ["scene_or_act", "body_trait", "quantity_or_runtime", "series_or_event", "setting_or_situation", "performer_identity"].includes(t),
    );
  }
  return false;
}

function titleFacets(title: string): string[] {
  const t = title.trim();
  const out: string[] = [];
  const qty = t.match(/\d+\s*(?:名|人|時間|分|作品|泊|日)/g) ?? [];
  out.push(...qty);
  const form = t.match(/ベスト|総集編|コレクション|COMPLETE/gi) ?? [];
  out.push(...form);
  const scenes =
    t.match(
      /[\u4e00-\u9fffァ-ヶー]{2,12}(?:シーン|キス|責め|乱交|ツアー|ベスト|洗脳|姉妹|巨乳|敏感|わからせ|痴女)/g,
    ) ?? [];
  out.push(...scenes);
  // Japanese / kana chunks only — Latin catalog scraps are not concrete article fuel
  for (const part of t.split(/[\s　【】\[\]\|｜]+/).filter((p) => p.length >= 4 && p.length <= 40)) {
    if (!/[\u4e00-\u9fffァ-ヶー]/.test(part)) continue;
    if (!/独占|特別|緊急/.test(part) || part.length >= 8) out.push(part);
  }
  return [...new Set(out)].slice(0, 16);
}

function classifyClaimBucket(input: {
  statement: string;
  kind?: string | null;
  facetType: BlueprintEvidenceType;
}): "concrete" | "catalog" {
  const s = input.statement.trim();
  if (CATALOG_FACET_TYPES.has(input.facetType)) return "catalog";
  const kind = (input.kind ?? "").toLowerCase();
  if (kind === "maker" || kind === "label" || kind === "availability" || kind === "temporal_sale") {
    return "catalog";
  }
  if (/^メーカー／レーベルとして|^公開ページ上で販売／配信状態は/.test(s)) return "catalog";
  // Title-rich with wrapper → concrete core
  if (/は公開ページ上で確認できる/.test(s)) {
    const core = stripCatalogWrapper(s);
    return core.length >= 8 ? "concrete" : "catalog";
  }
  if (isCatalogShellStatement(s)) return "catalog";
  return "concrete";
}

export function buildEvidencePack(input: {
  productTitle: string;
  claims: Array<{ id: string; statement: string; kind?: string | null; status?: string | null }>;
  researchEvidence?: ResearchEvidence[];
  sampleVideo?: { playerUrl: string; note?: string } | null;
  /** When set, concrete atoms merge via researchEvidence (or built here). */
  pageEvidenceMeta?: PageEvidenceMetaShape | null;
}): EvidencePack {
  const title = (input.productTitle ?? "").trim();
  const pageAtoms = input.pageEvidenceMeta
    ? extractAtomsFromPageEvidenceMeta(input.pageEvidenceMeta)
    : null;
  let research =
    input.researchEvidence ??
    buildResearchEvidence({
      productTitle: title,
      claims: input.claims,
      sampleVideo: input.sampleVideo,
      pageEvidenceMeta: input.pageEvidenceMeta,
    });
  if (
    pageAtoms &&
    pageAtoms.concrete.length > 0 &&
    !research.some((e) => e.evidenceId.startsWith("page_atom::"))
  ) {
    research = [...research, ...officialPageAtomsToResearchEvidence(pageAtoms.concrete)];
  }

  const concreteEvidence: EvidencePackItem[] = [];
  const catalogMetadata: EvidencePackItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (bucket: "concrete" | "catalog", item: EvidencePackItem) => {
    const key = `${bucket}:${item.fact.replace(/\s+/g, "").slice(0, 48)}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (bucket === "concrete") concreteEvidence.push(item);
    else catalogMetadata.push(item);
  };

  // Title as identity + concrete facets
  if (title.length >= 4) {
    pushUnique("concrete", {
      id: `title::full`,
      type: "product_identity",
      fact: title,
      provenance: { sourceType: "product_title", sourceRef: "product.title" },
      confidence: "high",
      generationEligible: true,
    });
    for (const [i, facet] of titleFacets(title).entries()) {
      const sem = classifySemanticEvidence(facet, {
        sourceType: "product_title",
        titleIdentityToken: true,
      });
      const facetType = sem.blueprintType;
      if (facetType === "maker_or_label" || facetType === "availability_or_catalog") continue;
      if (sem.primary === "EVALUATIVE" || sem.primary === "CATALOG") continue;
      pushUnique("concrete", {
        id: `title_facet::${i}`,
        type: facetType,
        fact: facet,
        provenance: { sourceType: "product_title", sourceRef: "product.title" },
        confidence: "high",
        generationEligible: true,
      });
    }
  }

  for (const e of research) {
    if (e.sourceType === "product_title") continue; // already handled
    if (e.sourceType === "package_or_page_image") continue;
    if (e.sourceType === "sample_video") continue;

    const raw = e.observedFact.trim();
    const bucket = classifyClaimBucket({
      statement: raw,
      kind: null,
      facetType: e.facetType,
    });
    const fact = bucket === "concrete" ? stripCatalogWrapper(raw) || raw : stripCatalogWrapper(raw) || raw;
    const item: EvidencePackItem = {
      id: e.evidenceId,
      type: bucket === "catalog" ? "catalog_shell" : e.facetType,
      fact,
      provenance: {
        sourceType: e.sourceType,
        sourceRef: e.sourceRef,
        claimId: e.claimId,
      },
      confidence: e.confidence,
      generationEligible: bucket === "concrete" && e.allowedForGeneration && e.confidence !== "low",
    };
    if (bucket === "catalog" || CATALOG_FACET_TYPES.has(e.facetType)) {
      item.generationEligible = false;
      pushUnique("catalog", item);
    } else if (item.generationEligible && fact.length >= 2) {
      pushUnique("concrete", item);
    } else {
      item.generationEligible = false;
      pushUnique("catalog", item);
    }
  }

  // Prefer claim-level kind when research missed
  for (const c of input.claims) {
    const status = (c.status ?? "SUPPORTED").toUpperCase();
    if (status !== "SUPPORTED" && status !== "AVAILABLE") continue;
    const raw = (c.statement ?? "").trim();
    if (raw.length < 2) continue;
    const sem = classifySemanticEvidence(raw, { kind: c.kind });
    const facetType = sem.blueprintType;
    const bucket = classifyClaimBucket({ statement: raw, kind: c.kind, facetType });
    const fact = stripCatalogWrapper(raw) || raw;
    const id = `claim_pack::${c.id}`;
    if (seen.has(`concrete:${fact.replace(/\s+/g, "").slice(0, 48)}`)) continue;
    if (seen.has(`catalog:${fact.replace(/\s+/g, "").slice(0, 48)}`)) continue;
    const item: EvidencePackItem = {
      id,
      type: bucket === "catalog" ? "catalog_shell" : facetType,
      fact,
      provenance: { sourceType: "supported_claim", sourceRef: c.id, claimId: c.id },
      confidence: "high",
      generationEligible: bucket === "concrete" && sem.primary !== "EVALUATIVE",
    };
    pushUnique(bucket, item);
  }

  const eligibleConcrete = concreteEvidence.filter((c) => c.generationEligible);
  const familyDedupedConcrete = dedupeConcreteEvidenceByFamily(eligibleConcrete);
  const RICH = new Set([
    "scene_or_act",
    "body_trait",
    "quantity_or_runtime",
    "series_or_event",
    "setting_or_situation",
    "performer_identity",
  ]);
  // Title-only identity / unknown latin scraps are insufficient for development
  const nonIdentity = familyDedupedConcrete.filter(
    (c) => c.type !== "product_identity" && RICH.has(String(c.type)),
  );
  const insufficientConcrete = nonIdentity.length === 0;
  const insufficientReason = insufficientConcrete
    ? "no_concrete_scene_trait_quantity_beyond_title_identity"
    : null;

  const pageConcreteCount = pageAtoms?.concrete.length ?? 0;
  const hasPageDescription = Boolean(input.pageEvidenceMeta?.description?.text?.trim());
  const hasPageVideoMeta = Boolean(
    input.pageEvidenceMeta?.video?.description ||
      input.pageEvidenceMeta?.video?.actor?.length ||
      input.pageEvidenceMeta?.actors?.length,
  );

  return {
    schemaVersion: 1,
    productIdentity: {
      title,
      titleFacets: titleFacets(title),
    },
    concreteEvidence: familyDedupedConcrete,
    catalogMetadata,
    unavailableEvidence: [
      {
        kind: "product_description",
        reason: hasPageDescription
          ? pageConcreteCount > 0
            ? "raw_full_text_blocked_concrete_atoms_in_pack"
            : "page_description_present_but_no_concrete_atoms"
          : "fanza_mapper_description_null",
        generationEligible: false,
      },
      {
        kind: "sample_video_content",
        reason: hasPageVideoMeta
          ? "video_binary_not_analyzed_meta_atoms_may_be_in_concrete"
          : "meta_only_allowedForGeneration_false",
        generationEligible: false,
      },
      {
        kind: "third_party_review",
        reason: "not_ingested_as_product_evidence",
        generationEligible: false,
      },
    ],
    videoEvidence: input.sampleVideo?.playerUrl
      ? { playerUrlPresent: true, generationEligible: false }
      : {
          playerUrlPresent: Boolean(input.pageEvidenceMeta?.video?.contentUrl || input.pageEvidenceMeta?.video?.playerUrl),
          generationEligible: false,
        },
    insufficientConcrete,
    insufficientReason,
  };
}

/** Compact prompt projection — concrete facts only (+ identity), family-deduped. */
export function dedupeConcreteEvidenceByFamily(
  items: EvidencePackItem[],
): EvidencePackItem[] {
  const seen = new Set<string>();
  const out: EvidencePackItem[] = [];
  for (const e of items) {
    if (!e.generationEligible) continue;
    const fam = classifySemanticEvidence(e.fact, {
      sourceType: e.provenance.sourceType,
      titleIdentityToken:
        e.provenance.sourceType === "product_title" && e.type !== "product_identity",
    }).familyId;
    if (seen.has(fam)) continue;
    seen.add(fam);
    out.push(e);
  }
  return out;
}

/**
 * OPTION B Writer WHAT — source materials only (r43).
 * Atoms stay internal (DEFER / assignment / family dedupe); not projected here.
 *
 * Duration surfaces that are minute-equivalent to forms already present in
 * productTitle / supportedClaims are collapsed in officialDescription so the
 * Writer does not see the same runtime as two independent facts (e.g. 8時間 + 480分).
 */
export function toOptionBWriterSourceMaterial(input: {
  productTitle: string;
  claims: Array<{ id: string; statement: string; kind?: string }>;
  officialDescription: string | null | undefined;
}): Record<string, unknown> {
  const productTitle = input.productTitle;
  const claimStatements = input.claims.map((c) => c.statement);
  const preferredDurations = collectPreferredDurationSurfaces(
    productTitle,
    ...claimStatements,
  );
  let officialDescription: string | null =
    typeof input.officialDescription === "string" && input.officialDescription.trim()
      ? input.officialDescription.trim()
      : null;
  if (officialDescription && preferredDurations.size > 0) {
    officialDescription = collapseEquivalentDurationSurfaces(
      officialDescription,
      preferredDurations,
    );
  }
  return {
    productTitle,
    supportedClaims: input.claims.map((c) => ({
      id: c.id,
      statement: c.statement,
      ...(typeof c.kind === "string" && c.kind.trim() ? { kind: c.kind } : {}),
    })),
    officialDescription,
  };
}

/** Evidence ids for internal claim validation (not Writer-visible). */
export function evidenceAllowlistIdsFromPack(pack: EvidencePack): string[] {
  const ids = dedupeConcreteEvidenceByFamily(
    pack.concreteEvidence.filter((e) => e.generationEligible),
  ).map((e) => e.id);
  return [
    ...ids,
    "title::full",
    ...Array.from({ length: 24 }, (_, i) => `title_facet::${i}`),
  ];
}
