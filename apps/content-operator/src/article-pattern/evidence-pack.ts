/**
 * Evidence Pack — Generator WHAT SSOT (OPTION B).
 * Separates concrete article fuel from catalog metadata shells.
 */

import type { ResearchEvidence } from "./research-evidence.js";
import { buildResearchEvidence } from "./research-evidence.js";
import type { BlueprintEvidenceType } from "./reference-editorial-blueprint.js";
import { classifyEvidenceTypesInText } from "./reference-editorial-blueprint.js";
import {
  buildSemanticFamilyId,
  classifySemanticEvidence,
  collapseEquivalentDurationSurfaces,
  collectPreferredDurationSurfaces,
  type SemanticEvidenceClass,
} from "./semantic-evidence.js";
import {
  extractAtomsFromPageEvidenceMeta,
  officialPageAtomsToResearchEvidence,
  type PageEvidenceMetaShape,
} from "./official-page-evidence-atoms.js";
import {
  projectWriterEvidenceFact,
  writerClaimSelectionScore,
  writerClauseContextScore,
  isWriterSynopsisLike,
  isWriterNarrativeFragment,
  isWriterCatalogConfirmation,
  isOfficialPerformerLabelQuotationClause,
  isWriterEligibleEvidenceType,
} from "./writer-evidence-filter.js";
import {
  isReaderInvitationOnlyClause,
  writerSafeClauseFromPageFact,
} from "./official-page-evidence-atoms.js";
import {
  extractPerformerEntitiesFromPageMeta,
  performerEntityKey,
  type PerformerEntity,
} from "./performer-identity.js";

export type { PerformerEntity, PerformerEntitySource } from "./performer-identity.js";

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
  /**
   * Upstream semantic family SSOT (OfficialPageFactAtom / ResearchEvidence).
   * Plan/Pack must not re-run classifySemanticEvidence just to recover this.
   */
  semanticFamilyId?: string;
};

/** Prefer stored familyId; derive from pack type + fact surface only when absent (tests / legacy). */
export function packItemSemanticFamilyId(item: EvidencePackItem): string {
  const stored = item.semanticFamilyId?.trim();
  if (stored) return stored;
  return buildSemanticFamilyId(primaryFromPackItemType(item), item.fact);
}

function primaryFromPackItemType(item: EvidencePackItem): SemanticEvidenceClass {
  switch (item.type) {
    case "scene_or_act":
      return "SCENE_ACTION";
    case "body_trait":
      return "BODY_TRAIT";
    case "quantity_or_runtime":
      return /\d+\s*(?:時間|分)/u.test(item.fact.trim()) ? "DURATION" : "QUANTITY";
    case "series_or_event":
      return "PRODUCT_FORM";
    case "setting_or_situation":
      return "RELATIONSHIP";
    case "performer_identity":
      return "PERFORMER_IDENTITY";
    case "maker_or_label":
    case "availability_or_catalog":
    case "catalog_shell":
      return "CATALOG";
    case "product_identity":
      return "TITLE_LABEL";
    default:
      return "UNKNOWN_CONCRETE";
  }
}

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
  /**
   * Raw official page description (projection source only).
   * Never dump unnormalized into Writer — use normalizeOfficialDescriptionForWriter.
   */
  sourceOfficialDescription?: string | null;
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
  /** R143 — unique performer entities from official metadata (not family-deduped facts). */
  performerItems: PerformerEntity[];
};

const CATALOG_FACET_TYPES = new Set<BlueprintEvidenceType>([
  "maker_or_label",
  "availability_or_catalog",
]);

export function isCatalogConfirmationProse(statement: string): boolean {
  return isWriterCatalogConfirmation(statement);
}

export function normalizeEvidenceSurface(fact: string): string {
  return (fact ?? "").trim().replace(/\s+/g, "");
}

/** R149 — order-independent semantic authority for dedupe collisions. */
export function evidenceSemanticAuthority(
  item: EvidencePackItem,
  performerKeys: Set<string>,
  claimKind?: string | null,
): number {
  const surface = normalizeEvidenceSurface(item.fact);
  const isKnownPerformer =
    performerKeys.has(surface) || performerKeys.has(performerEntityKey(item.fact));

  if (isCatalogConfirmationProse(item.fact)) return -1000;

  let score = 0;
  const source = item.provenance.sourceType;
  const kind = (claimKind ?? "").toLowerCase();

  if (item.type === "performer_identity") score += 200;
  if (source === "performer_metadata") score += 180;
  if (kind === "performer" || kind === "cast") score += 160;
  // Upstream type is SSOT — do not reclassify fact text for authority.
  if (item.type === "unknown_concrete" && isKnownPerformer) score += 15;

  if (source === "product_description") score += 40;
  if (source === "supported_claim") score += 30;
  if (source === "product_title") score += 25;

  return score;
}

function pickHigherAuthorityItem(
  a: EvidencePackItem,
  b: EvidencePackItem,
  performerKeys: Set<string>,
  claimKindA?: string | null,
  claimKindB?: string | null,
): EvidencePackItem {
  const sa = evidenceSemanticAuthority(a, performerKeys, claimKindA);
  const sb = evidenceSemanticAuthority(b, performerKeys, claimKindB);
  if (sb > sa) return b;
  if (sa > sb) return a;
  if (a.provenance.sourceType === "performer_metadata" && b.provenance.sourceType !== "performer_metadata") {
    return a;
  }
  if (b.provenance.sourceType === "performer_metadata" && a.provenance.sourceType !== "performer_metadata") {
    return b;
  }
  // Prefer more specific surface within equal-authority family (edition > brand stem).
  if (b.fact.length > a.fact.length) return b;
  return a;
}

/** R149 — SSOT metadata performers must not survive as unknown_concrete downgrades. */
export function enforcePerformerIdentityInvariant(
  items: EvidencePackItem[],
  performerItems: PerformerEntity[],
): EvidencePackItem[] {
  if (performerItems.length === 0) return items;
  const keys = new Set(performerItems.map((p) => performerEntityKey(p.displayName)));
  return items.map((item) => {
    const key = performerEntityKey(item.fact);
    if (!keys.has(key)) return item;
    const entity = performerItems.find((p) => performerEntityKey(p.displayName) === key);
    if (
      item.type === "performer_identity" &&
      item.provenance.sourceType === "performer_metadata"
    ) {
      if (item.semanticFamilyId) return item;
      return {
        ...item,
        semanticFamilyId: buildSemanticFamilyId("PERFORMER_IDENTITY", item.fact),
      };
    }
    const fact = entity?.displayName ?? item.fact;
    return {
      ...item,
      type: "performer_identity",
      fact,
      provenance: {
        ...item.provenance,
        sourceType: "performer_metadata",
        sourceRef: entity?.sourceId ?? item.provenance.sourceRef,
      },
      generationEligible: item.generationEligible !== false,
      semanticFamilyId: buildSemanticFamilyId("PERFORMER_IDENTITY", fact),
    };
  });
}

function performerKeysFromEntities(performerItems: PerformerEntity[]): Set<string> {
  const keys = new Set<string>();
  for (const p of performerItems) {
    keys.add(performerEntityKey(p.displayName));
  }
  return keys;
}

function resolvePerformerClaimKind(
  statement: string,
  performerKeys: Set<string>,
  explicitKind?: string | null,
): string | null {
  const kind = (explicitKind ?? "").toLowerCase();
  if (kind === "performer" || kind === "cast") return kind;
  const surface = performerEntityKey(statement);
  if (performerKeys.has(surface)) return "performer";
  return explicitKind ?? null;
}

/** Strip catalog confirmation wrappers; keep the factual core. */
export function stripCatalogWrapper(statement: string): string {
  let s = (statement ?? "").trim();
  // R149 — performer catalog confirmation (公式/公開ページ) → bare performer/core
  s = s.replace(
    /^出演者として\s*(.+?)\s*が(?:公式|公開|商品)ページ上?で確認できる。?$/u,
    "$1",
  );
  s = s.replace(/\s*は公開ページ上で確認できる。?$/u, "");
  s = s.replace(/\s*は公開カタログ上で確認できる。?$/u, "");
  s = s.replace(/\s*は公式カタログ上で確認できる。?$/u, "");
  s = s.replace(/\s*は公開ページで確認できた。?$/u, "");
  s = s.replace(/\s*は公式ページ上?で確認できる。?$/u, "");
  s = s.replace(/\s*が公開ページ上で確認できる。?$/u, "");
  s = s.replace(/\s*が公式ページ上?で確認できる。?$/u, "");
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
  if (isCatalogConfirmationProse(s)) return true;
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
  // R151 — keep balanced 【…】 / 「…」 as atomic title phrases (do not shred pairs).
  const balanced =
    t.match(/【[^】]{2,48}】/gu) ??
    [];
  out.push(...balanced);
  const quoted = t.match(/「[^」]{2,40}」/gu) ?? [];
  out.push(...quoted);
  const qty = t.match(/\d+\s*(?:名|人|時間|分|作品|泊|日)/g) ?? [];
  out.push(...qty);
  const form = t.match(/ベスト|総集編|コレクション|COMPLETE/gi) ?? [];
  out.push(...form);
  const scenes =
    t.match(
      /[\u4e00-\u9fffァ-ヶー]{2,12}(?:シーン|キス|責め|乱交|ツアー|ベスト|洗脳|姉妹|巨乳|敏感|わからせ|痴女)/g,
    ) ?? [];
  out.push(...scenes);
  // Remaining chunks outside balanced pairs — strip unpaired openers only.
  const withoutBalanced = balanced.reduce((acc, b) => acc.split(b).join(" "), t);
  for (const part of withoutBalanced
    .split(/[\s　【】\[\]\|｜]+/)
    .filter((p) => p.length >= 4 && p.length <= 40)) {
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
  if (isCatalogConfirmationProse(s)) return "catalog";
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

function looksLikeBareContentId(title: string, contentId?: string | null): boolean {
  const t = title.trim();
  if (!t) return true;
  if (contentId && t.toLowerCase() === contentId.trim().toLowerCase()) return true;
  return /^[a-z]{2,8}\d{3,}$/i.test(t);
}

/**
 * Map persisted pageEvidence.catalog → catalogMetadata only.
 * Never mixes into concrete/scene fuel; never invents scene prose from genres.
 * generationEligible=false so catalog alone cannot satisfy skeleton material checks.
 */
export function catalogMetadataItemsFromPageMeta(
  meta: PageEvidenceMetaShape | null | undefined,
): EvidencePackItem[] {
  if (!meta) return [];
  const out: EvidencePackItem[] = [];
  const push = (
    id: string,
    type: EvidencePackItem["type"],
    fact: string,
    provenance: string,
    originField: string,
  ) => {
    const f = fact.trim();
    if (f.length < 1) return;
    out.push({
      id,
      type,
      fact: f,
      provenance: {
        sourceType: "fanza_product_page_catalog",
        sourceRef: `${provenance}:${originField}`,
      },
      confidence: "high",
      generationEligible: false,
    });
  };

  const productName = meta.productName?.trim();
  if (productName) {
    push(
      "catalog::productName",
      "product_identity",
      productName,
      meta.productNameProvenance ?? "page_json_ld",
      meta.productNameOriginField ?? "productName",
    );
  }

  const cat = meta.catalog;
  if (!cat) return out;

  if (cat.maker?.value) {
    push(
      "catalog::maker",
      "maker_or_label",
      cat.maker.value,
      cat.maker.provenance,
      cat.maker.originField,
    );
  }
  if (cat.label?.value) {
    push(
      "catalog::label",
      "maker_or_label",
      cat.label.value,
      cat.label.provenance,
      cat.label.originField,
    );
  }
  if (cat.series?.value) {
    push(
      "catalog::series",
      "availability_or_catalog",
      cat.series.value,
      cat.series.provenance,
      cat.series.originField,
    );
  }
  for (const [i, g] of (cat.genres ?? []).entries()) {
    if (!g?.value) continue;
    push(
      `catalog::genre::${i}`,
      "availability_or_catalog",
      g.value,
      g.provenance,
      g.originField,
    );
  }
  if (cat.durationMinutes && Number.isFinite(cat.durationMinutes.value)) {
    push(
      "catalog::durationMinutes",
      "quantity_or_runtime",
      `${cat.durationMinutes.value}分`,
      cat.durationMinutes.provenance,
      cat.durationMinutes.originField,
    );
  }
  if (cat.releaseDate?.value) {
    push(
      "catalog::releaseDate",
      "availability_or_catalog",
      cat.releaseDate.value,
      cat.releaseDate.provenance,
      cat.releaseDate.originField,
    );
  }
  if (cat.manufacturerSku?.value) {
    push(
      "catalog::manufacturerSku",
      "availability_or_catalog",
      cat.manufacturerSku.value,
      cat.manufacturerSku.provenance,
      cat.manufacturerSku.originField,
    );
  }
  return out;
}

export function buildEvidencePack(input: {
  productTitle: string;
  claims: Array<{ id: string; statement: string; kind?: string | null; status?: string | null }>;
  researchEvidence?: ResearchEvidence[];
  sampleVideo?: { playerUrl: string; note?: string } | null;
  /** When set, concrete atoms merge via researchEvidence (or built here). */
  pageEvidenceMeta?: PageEvidenceMetaShape | null;
}): EvidencePack {
  const rawTitle = (input.productTitle ?? "").trim();
  const pageName = input.pageEvidenceMeta?.productName?.trim() ?? "";
  const title =
    pageName && looksLikeBareContentId(rawTitle, input.pageEvidenceMeta?.contentId)
      ? pageName
      : rawTitle || pageName;
  const performerItems = extractPerformerEntitiesFromPageMeta({
    pageEvidenceMeta: input.pageEvidenceMeta,
    productTitle: title,
  });
  const performerKeys = performerKeysFromEntities(performerItems);

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
  const concreteBySurface = new Map<string, EvidencePackItem>();
  const catalogBySurface = new Map<string, EvidencePackItem>();
  const itemClaimKinds = new Map<string, string | null>();

  const pushUnique = (
    bucket: "concrete" | "catalog",
    item: EvidencePackItem,
    claimKind?: string | null,
  ) => {
    const surfaceKey = normalizeEvidenceSurface(item.fact).slice(0, 48);
    const store = bucket === "concrete" ? concreteBySurface : catalogBySurface;
    const existing = store.get(surfaceKey);
    if (existing) {
      const merged = pickHigherAuthorityItem(existing, item, performerKeys, itemClaimKinds.get(existing.id), claimKind);
      store.set(surfaceKey, merged);
      if (claimKind) itemClaimKinds.set(merged.id, claimKind);
      return;
    }
    store.set(surfaceKey, item);
    if (claimKind) itemClaimKinds.set(item.id, claimKind);
  };

  const flushUniqueMaps = () => {
    concreteEvidence.push(...concreteBySurface.values());
    catalogMetadata.push(...catalogBySurface.values());
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
      semanticFamilyId: buildSemanticFamilyId("TITLE_LABEL", title),
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
        semanticFamilyId: sem.familyId,
      });
    }
  }

  // Official catalog fields → catalogMetadata only (deduped by field id, not value).
  // maker/label may share the same string (e.g. ROOKIE) but remain distinct fields.
  for (const item of catalogMetadataItemsFromPageMeta(input.pageEvidenceMeta)) {
    const existing = catalogBySurface.get(item.id);
    if (existing) {
      catalogBySurface.set(
        item.id,
        pickHigherAuthorityItem(existing, item, performerKeys, null, null),
      );
      continue;
    }
    // Also suppress duplicate value collisions with prior catalog shells of same surface
    // only when id namespace differs — keep catalog::* ids authoritative for their field.
    catalogBySurface.set(item.id, item);
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
      semanticFamilyId: e.semanticFamilyId,
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
    const resolvedKind = resolvePerformerClaimKind(raw, performerKeys, c.kind);
    const sem = classifySemanticEvidence(raw, { kind: resolvedKind });
    const facetType = sem.blueprintType;
    const bucket = classifyClaimBucket({ statement: raw, kind: resolvedKind, facetType });
    const fact = stripCatalogWrapper(raw) || raw;
    const id = `claim_pack::${c.id}`;
    const item: EvidencePackItem = {
      id,
      type: bucket === "catalog" ? "catalog_shell" : facetType,
      fact,
      provenance: { sourceType: "supported_claim", sourceRef: c.id, claimId: c.id },
      confidence: "high",
      generationEligible: bucket === "concrete" && sem.primary !== "EVALUATIVE",
      semanticFamilyId: sem.familyId,
    };
    pushUnique(bucket, item, resolvedKind);
  }

  flushUniqueMaps();

  const invariantConcrete = enforcePerformerIdentityInvariant(concreteEvidence, performerItems).map(
    (item) =>
      item.semanticFamilyId
        ? item
        : { ...item, semanticFamilyId: packItemSemanticFamilyId(item) },
  );
  const eligibleConcrete = invariantConcrete.filter((c) => c.generationEligible);
  const familyDedupedConcrete = dedupeConcreteEvidenceByFamily(eligibleConcrete, performerKeys);
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
    sourceOfficialDescription:
      typeof input.pageEvidenceMeta?.description?.text === "string"
        ? input.pageEvidenceMeta.description.text.trim() || null
        : null,
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
    performerItems,
  };
}

function dedupeConcreteEvidenceBySurface(
  items: EvidencePackItem[],
  performerKeys: Set<string>,
): EvidencePackItem[] {
  const bySurface = new Map<string, EvidencePackItem>();
  for (const e of items) {
    if (!e.generationEligible) continue;
    const surfaceKey = normalizeEvidenceSurface(e.fact).slice(0, 48);
    const existing = bySurface.get(surfaceKey);
    if (!existing) {
      bySurface.set(surfaceKey, e);
      continue;
    }
    bySurface.set(surfaceKey, pickHigherAuthorityItem(existing, e, performerKeys));
  }
  return [...bySurface.values()];
}

/** Compact prompt projection — concrete facts only (+ identity), family-deduped. */
export function dedupeConcreteEvidenceByFamily(
  items: EvidencePackItem[],
  performerKeys: Set<string> = new Set(),
): EvidencePackItem[] {
  const surfaceDeduped = dedupeConcreteEvidenceBySurface(items, performerKeys);
  const byFamily = new Map<string, EvidencePackItem>();
  for (const e of surfaceDeduped) {
    if (!e.generationEligible) continue;
    const fam = packItemSemanticFamilyId(e);
    const existing = byFamily.get(fam);
    if (!existing) {
      byFamily.set(fam, e);
      continue;
    }
    byFamily.set(fam, pickHigherAuthorityItem(existing, e, performerKeys));
  }
  return [...byFamily.values()];
}

/**
 * Production claim bootstrap from page-evidence atoms — never raw description.text synopsis.
 * r81: unknown_concrete may contribute only via Writer salvage (not all-pass).
 */
export function claimStatementsFromPageEvidence(input: {
  pageEvidenceMeta: PageEvidenceMetaShape;
  productTitle: string;
  actors?: string[] | null;
  maxClaims?: number;
}): string[] {
  const atoms = extractAtomsFromPageEvidenceMeta(input.pageEvidenceMeta);
  const scored: Array<{ statement: string; score: number; familyId: string }> = [];
  const seenFam = new Set<string>();
  for (const atom of atoms.concrete.filter((a) => a.generatorAllowed)) {
    const projected = projectWriterEvidenceFact(String(atom.blueprintType), atom.fact);
    if (!projected) continue;
    const fam =
      atom.familyId ||
      buildSemanticFamilyId(
        atom.primary === "UNKNOWN_CONCRETE"
          ? "UNKNOWN_CONCRETE"
          : classifySemanticEvidence(projected.statement).primary,
        projected.statement,
      );
    if (seenFam.has(fam)) continue;
    seenFam.add(fam);
    scored.push({
      statement: projected.statement,
      score: writerClaimSelectionScore(projected),
      familyId: fam,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const statements = scored.slice(0, 4).map((s) => s.statement);
  const actors = input.actors ?? input.pageEvidenceMeta.actors ?? [];
  for (const name of actors) {
    const actor = name?.trim();
    if (!actor) continue;
    if (
      !statements.some(
        (s) => performerEntityKey(s) === performerEntityKey(actor) || s.includes(actor),
      )
    ) {
      statements.push(actor);
    }
  }
  return [...new Set(statements)].slice(0, input.maxClaims ?? 5);
}

/**
 * Options for Writer-safe projection.
 * packConcrete: EvidencePack concrete already marked generationEligible —
 * skip fragment salvage; apply thin hard-safety only.
 */
export type ProjectWriterSafeFactOpts = {
  packConcrete?: boolean;
};

/**
 * r95 — Writer-safe fact: context-preserving clause; reader invitation stripped.
 * Thin safety boundary for Plan/Writer — not a second extractor.
 *
 * When `packConcrete` is set, unknown_concrete does not re-enter
 * salvageWriterFactFromUnknownConcrete (complete concrete ≠ fragment salvage).
 * Legacy / non-pack unknown still uses salvage for true fragments.
 */
export function projectWriterSafeFact(
  fact: string,
  evidenceType: string,
  _sourceType = "product_description",
  opts?: ProjectWriterSafeFactOpts,
): string | null {
  const raw = (fact ?? "").trim();
  if (raw.length < 2 || isWriterCatalogConfirmation(raw)) return null;

  const clause = writerSafeClauseFromPageFact(raw);
  if (!clause) return null;

  let projected;
  if (opts?.packConcrete) {
    // Extractor/Pack already certified this surface. Thin pass-through only.
    const typeForThin =
      evidenceType === "product_identity" || isWriterEligibleEvidenceType(evidenceType)
        ? evidenceType
        : "setting_or_situation";
    projected = projectWriterEvidenceFact(typeForThin, clause);
    // Presentation unwrap for bracket-only labels (not fragment salvage of long clauses).
    if (projected?.statement) {
      const unwrapped = projected.statement.trim().match(/^【([^】]{2,24})】$/u);
      if (unwrapped?.[1]?.trim()) {
        projected = {
          ...projected,
          statement: unwrapped[1].trim(),
          fromUnknownSalvage: false,
        };
      }
    }
  } else {
    projected =
      projectWriterEvidenceFact(evidenceType, clause) ??
      projectWriterEvidenceFact("unknown_concrete", clause);
  }
  // Never fall back to raw clause when projection/salvage rejected the atom —
  // that re-admitted fragments like あぁ / ヤッテ / （きょうしゃ）.
  if (!projected?.statement) return null;
  const candidate = projected.statement.trim();
  if (candidate.length < 2) return null;

  if (isWriterSynopsisLike(candidate)) return null;
  if (
    isWriterNarrativeFragment(candidate) &&
    writerClauseContextScore(candidate) === 0 &&
    !isOfficialPerformerLabelQuotationClause(candidate, _sourceType)
  ) {
    return null;
  }
  if (isReaderInvitationOnlyClause(candidate)) return null;

  return candidate;
}

/** Project a generationEligible EvidencePack concrete item (packConcrete=true). */
export function projectWriterSafeFactFromPackItem(item: EvidencePackItem): string | null {
  if (!item.generationEligible) return null;
  return projectWriterSafeFact(
    item.fact,
    String(item.type),
    item.provenance.sourceType,
    { packConcrete: true },
  );
}

function supportedClaimsFromPack(pack: EvidencePack): Array<{ id: string; statement: string }> {
  type Cand = {
    id: string;
    statement: string;
    score: number;
  };
  const cands: Cand[] = [];
  const seenFam = new Set<string>();
  const seenStmt = new Set<string>();

  for (const item of pack.concreteEvidence) {
    if (!item.generationEligible) continue;
    if (item.type === "product_identity") continue;
    const safe = projectWriterSafeFactFromPackItem(item);
    if (!safe || seenStmt.has(safe)) continue;
    const fam = packItemSemanticFamilyId(item);
    if (seenFam.has(fam)) continue;
    seenFam.add(fam);
    seenStmt.add(safe);
    const projected =
      projectWriterEvidenceFact(String(item.type), safe) ??
      projectWriterEvidenceFact("unknown_concrete", safe);
    cands.push({
      id: item.provenance.claimId ?? item.id,
      statement: safe,
      score: projected ? writerClaimSelectionScore(projected) : writerClauseContextScore(safe) || 30,
    });
  }

  cands.sort((a, b) => b.score - a.score);
  return cands.slice(0, 5);
}

/** r94 — Individual Writer-safe facts from concrete evidence (no prose join). */
export function collectWriterSafeFactsFromPack(pack: EvidencePack): string[] {
  const claims = supportedClaimsFromPack(pack);
  return claims.map((c) => c.statement);
}

/**
 * r94 — Writer officialDescription: individual safe facts only (not raw page prose).
 */
function composeWriterOfficialDescriptionFromPack(pack: EvidencePack): string[] | null {
  const facts = collectWriterSafeFactsFromPack(pack);
  return facts.length > 0 ? facts : null;
}

/**
 * Production Writer WHAT — projected only from normalized EvidencePack (r67/r76).
 * All ingest paths must use this after buildEvidencePack; no raw page synopsis bypass.
 */
export function toOptionBWriterSourceMaterialFromPack(pack: EvidencePack): Record<string, unknown> {
  return toOptionBWriterSourceMaterial({
    productTitle: pack.productIdentity.title,
    claims: supportedClaimsFromPack(pack),
    officialDescription: composeWriterOfficialDescriptionFromPack(pack),
  });
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
  /** r94: string[] = individual facts; legacy string = single blob (tests/manual). */
  officialDescription?: string | string[] | null;
}): Record<string, unknown> {
  const productTitle = input.productTitle;
  const claimStatements = input.claims.map((c) => c.statement);
  const preferredDurations = collectPreferredDurationSurfaces(
    productTitle,
    ...claimStatements,
  );
  let officialDescription: string | string[] | null = null;
  if (Array.isArray(input.officialDescription)) {
    const facts = input.officialDescription
      .map((f) => (typeof f === "string" ? f.trim() : ""))
      .filter((f) => f.length >= 2);
    officialDescription =
      facts.length > 0
        ? facts.map((f) =>
            preferredDurations.size > 0
              ? collapseEquivalentDurationSurfaces(f, preferredDurations)
              : f,
          )
        : null;
  } else if (typeof input.officialDescription === "string" && input.officialDescription.trim()) {
    let single = input.officialDescription.trim();
    if (preferredDurations.size > 0) {
      single = collapseEquivalentDurationSurfaces(single, preferredDurations);
    }
    officialDescription = single;
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
