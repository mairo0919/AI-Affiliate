/**
 * R114 — ArticlePlan: Planner-owned WHAT / ORDER / DEPTH / STOP for OPTION B Writer.
 *
 * Writer-visible SSOT. Not a soft prompt dump.
 * facts[] are selected execution targets — not candidate pools.
 */

import type { EvidencePack, EvidencePackItem } from "./evidence-pack.js";
import {
  isCatalogConfirmationProse,
  packItemSemanticFamilyId,
  projectWriterSafeFact,
  projectWriterSafeFactFromPackItem,
} from "./evidence-pack.js";
import type { SkeletonEvidenceAssignment } from "./skeleton-evidence-assignment.js";
import type { ProductMaterialProfile } from "./reference-type-profile.js";
import {
  preferRepresentationOverForcedRoster,
  representationLeadCoversFacts,
  resolveRepresentationLeadFact,
} from "./performer-representation.js";
import { classifySemanticEvidence } from "./semantic-evidence.js";
import {
  classifyEvidenceMaterialRole,
  derivePresentationPurpose,
  dominantPresentationPurpose,
  isDemotedBodyMaterial,
  WORK_THEME_FACET_RE,
} from "./evidence-material-role.js";
import {
  isTitleSafeExecutionTarget,
  isUnsafeTitleExecutionTarget,
} from "./writer-evidence-filter.js";
import {
  isTitleEligibleFact,
  isTitleClauseFragment,
  repairBracketSplitPlanFacts,
  toTitleDisplayFact,
} from "./title-eligibility.js";
import {
  balanceReaderFacingPunctuation,
  sourcePunctuationHints,
} from "./punctuation-balance.js";
import {
  allocateReaderJobs,
  buildOverviewLeadFacts,
  composeTitleFacts,
  resolveArticlePurpose,
  resolveCoreAngle,
} from "./article-plan-editorial-frame.js";

export type ArticlePlanMaterialDepth = "scarce" | "standard" | "rich";

export type ArticlePlanSlot = {
  /** Short job id — informational duty for the slot (not an essay note). */
  job: string;
  /** Planner-selected Writer-safe facts for this slot (execution targets). */
  facts: string[];
  /** Evidence-derived structural label; Formatter may ignore (Phase 1). */
  heading?: string | null;
  /**
   * Lightweight: dominant product aspect this slot's facts explain.
   * Not a fact source — only guides how to present assigned Evidence.
   */
  presentationPurpose?: import("./evidence-material-role.js").BodyPresentationPurpose | null;
  /** Parallel to facts[] — per-fact presentation purpose when mixed. */
  factPurposes?: Array<import("./evidence-material-role.js").BodyPresentationPurpose | null> | null;
};

export type {
  ArticlePurposeId,
  ArticlePlanPurpose,
  ArticlePlanCoreAngle,
  ReaderJobId,
} from "./article-plan-editorial-frame.js";

/**
 * Writer-visible ArticlePlan only.
 * schemaVersion 2 adds purpose / coreAngle / reader jobs (not new fact sources).
 */
export type ArticlePlan = {
  schemaVersion: 1 | 2;
  materialDepth: ArticlePlanMaterialDepth;
  /** Identity source only — do not paste wholesale as title. */
  productTitle: string;
  title: ArticlePlanSlot;
  lead: ArticlePlanSlot;
  body: ArticlePlanSlot[];
  /** V2 — Evidence-derived connection framing (not a fact source). */
  purpose?: import("./article-plan-editorial-frame.js").ArticlePlanPurpose | null;
  /** V2 — highest-signal Evidence axis; null when only bare names. */
  coreAngle?: import("./article-plan-editorial-frame.js").ArticlePlanCoreAngle | null;
};

export const ARTICLE_PLAN_JOBS = {
  title: "who_plus_core",
  lead: "opening_facts",
  body: "body_facts",
  /** V2 aliases — only when editorialFrame=true */
  titleV2: "title_compose",
  leadV2: "overview",
} as const;

/**
 * Body fact floors / fixed caps by depth (Planner owns expansion — not Writer).
 * rich floor is NOT a hard cut — see resolveBodyFactBudget (family-preserving).
 */
const BODY_FACT_CAPS: Record<ArticlePlanMaterialDepth, number> = {
  scarce: 1,
  standard: 4,
  rich: 8,
};

/** Safety ceiling only — must not be the reason independent rich families are dropped. */
const RICH_BODY_FACT_HARD_CEILING = 18;

const TITLE_FACT_CAP = 3;
const LEAD_FACT_CAP = 4;

function isNoiseContentIdFact(fact: string): boolean {
  const t = (fact ?? "").trim();
  // Short Latin genre/theme facets (NTR, SM, …) are product content — not cid scraps.
  if (WORK_THEME_FACET_RE.test(t)) return false;
  // FANZA cid-like scraps (mizd / halt00091 claims) — never title/lead/body fuel.
  return /^[a-z]{2,8}\d{0,5}$/i.test(t);
}

/** Duration/quantity-only tokens — not sufficient as sole product-identifying title. */
function isQuantityOrRuntimeOnlyFact(fact: string): boolean {
  const f = (fact ?? "").trim();
  if (!f) return false;
  if (/^\d+\s*(?:時間|分|回|本番|射精|作品|名|人|cm|コーナー|タイトル)$/u.test(f)) {
    return true;
  }
  const primary = classifySemanticEvidence(f).primary;
  return (primary === "QUANTITY" || primary === "DURATION") && f.length <= 12;
}

function packPerformerNameSet(pack: EvidencePack): Set<string> {
  const names = new Set<string>();
  for (const item of pack.concreteEvidence) {
    if (item.type !== "performer_identity") continue;
    const safe = projectWriterSafeFactFromPackItem(item) ?? item.fact.trim();
    if (safe && safe.length >= 2 && !isNoiseContentIdFact(safe)) names.add(safe);
  }
  return names;
}

function isPerformerOnlyTitleFacts(titleFacts: string[], performerNames: Set<string>): boolean {
  if (titleFacts.length !== 1) return false;
  const f = titleFacts[0]!.trim();
  if (performerNames.has(f)) return true;
  if ([...performerNames].some((p) => p === f || (p.length >= 2 && f.includes(p)))) return true;
  // Bare Japanese name-shaped token without qty/scene markers
  if (
    /^[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fffー]{2,8}$/u.test(f) &&
    !isQuantityOrRuntimeOnlyFact(f) &&
    !/(?:ベスト|総集編|作品|時間|分|射精|本番|痴女|中出し)/u.test(f)
  ) {
    return true;
  }
  return false;
}

/** Title too thin to identify the work when richer title-safe Evidence exists. */
function isThinTitleFacts(titleFacts: string[], performerNames: Set<string>): boolean {
  if (titleFacts.length === 0) return true;
  if (titleFacts.every(isQuantityOrRuntimeOnlyFact)) return true;
  if (isPerformerOnlyTitleFacts(titleFacts, performerNames)) return true;
  return false;
}

/** Prefer compact work/situation facets for title (avoid long atom dumps). */
function isCompactTitleWorkFacet(fact: string): boolean {
  const f = fact.trim();
  if (!f || isQuantityOrRuntimeOnlyFact(f)) return false;
  // Bare work-theme tags stay title-eligible but are not "compact identity" fuel.
  if (WORK_THEME_FACET_RE.test(f)) return false;
  if (/^【/.test(f) && f.length <= 48) return true;
  // Product/work noun identity — not mid-length scene play-by-play.
  if (/(?:作品|ベスト(?:第?\d*弾)?|総集編|コレクション)$/u.test(f)) {
    return f.length >= 4 && f.length <= 24 && isTitleSafeExecutionTarget(f);
  }
  if (isTitleIdentityOrFormFacet(f) && f.length <= 24 && isTitleSafeExecutionTarget(f)) {
    return true;
  }
  // Short noun labels without clause progression — not detailed scene compounds.
  if (
    f.length >= 2 &&
    f.length <= 12 &&
    isTitleSafeExecutionTarget(f) &&
    !isTitleClauseFragment(f) &&
    !/(?:で|を|が|に|反り|絶頂|失禁|エグ|させ|して|猛烈)/u.test(f)
  ) {
    return true;
  }
  return false;
}

/** Detailed scene play-by-play — body fuel, not title identity when compact work-form exists. */
function isDetailedSceneTitleCompound(fact: string): boolean {
  const f = fact.trim();
  if (!f || isTitleClauseFragment(f)) return true;
  if (/(?:作品|ベスト(?:第?\d*弾)?|総集編|コレクション)$/u.test(f)) return false;
  if (isTitleIdentityOrFormFacet(f)) return false;
  if (/^【/.test(f)) return false;
  const primary = classifySemanticEvidence(f).primary;
  if (primary !== "SCENE_ACTION") return false;
  return (
    f.length > 12 &&
    /(?:で|を|が|に|反り|絶頂|失禁|エグ|させ|して|猛烈|限界|追い?込|追撃)/u.test(f)
  );
}

/** Product identity / collection / form facets preferred over bare theme tags in titles. */
function isTitleIdentityOrFormFacet(fact: string): boolean {
  const f = fact.trim();
  if (!f || WORK_THEME_FACET_RE.test(f)) return false;
  const role = classifyEvidenceMaterialRole(f);
  if (role === "COLLECTION_SCOPE" || role === "QUANTITY_SCALE") return true;
  if (
    /(?:ベスト第?\d*弾|総集編|コレクション|\d+\s*(?:タイトル|作品|コーナー)|エスワン|MOODYZ|周年)/u.test(
      f,
    )
  ) {
    return true;
  }
  const primary = classifySemanticEvidence(f).primary;
  return (
    primary === "PRODUCT_FORM" ||
    primary === "SERIES_CONCEPT" ||
    primary === "SERIES_CONTEXT" ||
    primary === "TITLE_LABEL" ||
    primary === "EVENT"
  );
}

/** Same product-form meaning (ベスト / 時間ベスト / MOODYZベスト第2弾) — keep one in title. */
function titleFormSemanticallyRedundant(a: string, b: string): boolean {
  const na = a.replace(/\s+/g, "");
  const nb = b.replace(/\s+/g, "");
  if (!na || !nb || na === nb) return na === nb;
  if (na.includes(nb) || nb.includes(na)) return true;
  const formStem = /ベスト|総集編|コレクション/u;
  return formStem.test(na) && formStem.test(nb);
}

/** Prefer specific edition/brand form over bare 「ベスト」「時間ベスト」. */
function titleFormSpecificityScore(fact: string): number {
  const f = fact.trim();
  let s = Math.min(f.length, 28);
  if (/第\d+弾/u.test(f)) s += 24;
  if (/(?:MOODYZ|エスワン|S1|kawaii\*?)/iu.test(f)) s += 14;
  if (/\d+\s*(?:作品|タイトル|コーナー|時間)/u.test(f)) s += 10;
  if (/わからせ|痴女|ハーレム|騎乗|中出し/u.test(f)) s += 8;
  if (/^(?:ベスト|時間ベスト|8時間ベスト)$/u.test(f)) s -= 40;
  return s;
}

/** Ultra-short marketing crumbs — usable as SEO theme fill, not as title identity. */
function isSparseTitleWorkAtom(fact: string): boolean {
  const f = fact.trim();
  if (!f) return true;
  if (WORK_THEME_FACET_RE.test(f)) return false;
  if (isTitleIdentityOrFormFacet(f)) return false;
  return f.length <= 4;
}

/** Multi-theme membership lists belong in body variety — not title identity. */
function isTitleThemeVarietyList(fact: string): boolean {
  const f = fact.trim();
  if (!f) return false;
  const themes = f.match(/人妻|NTR|痴女|熟女|美少女|OL|女子校生|ギャル|SM/gu);
  return (themes?.length ?? 0) >= 2 && /[・、／]|など|収録/u.test(f);
}

/** Lead must not paste synopsis-like / unsafe full titles (same gate as title). */
function isUnsafeLeadExecutionTarget(text: string): boolean {
  return isUnsafeTitleExecutionTarget(text) || isNoiseContentIdFact(text);
}

function isProtectedRepresentationLeadFact(
  fact: string,
  rep?: ProductMaterialProfile["performerRepresentation"],
): boolean {
  if (!rep) return false;
  const f = fact.trim();
  if (!f) return false;
  const labels = [
    rep.representationLabel,
    rep.collectionLabel,
    rep.combinedLabel,
    rep.neutralMultiLabel,
  ].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return labels.some((l) => l.trim() === f);
}

function leadFactAllowed(
  fact: string,
  rep?: ProductMaterialProfile["performerRepresentation"],
): boolean {
  const f = fact.trim();
  if (!f) return false;
  if (isProtectedRepresentationLeadFact(f, rep)) return true;
  return !isUnsafeLeadExecutionTarget(f);
}

function itemSemanticFamilyId(item: EvidencePackItem): string {
  return packItemSemanticFamilyId(item);
}

/**
 * rich: preserve independent concrete families already in EvidencePack.
 * scarce/standard: keep fixed caps (safety / thin-material stop).
 */
function resolveBodyFactBudget(
  depth: ArticlePlanMaterialDepth,
  pack: EvidencePack,
  titleLeadFacts: Set<string>,
): number {
  if (depth === "scarce") return BODY_FACT_CAPS.scarce;
  if (depth === "standard") return BODY_FACT_CAPS.standard;

  const families = new Set<string>();
  for (const item of pack.concreteEvidence) {
    if (!item.generationEligible || item.type === "product_identity") continue;
    const safe = safeFactFromItem(item);
    if (!safe || isBlockedByTitleLead(safe, titleLeadFacts)) continue;
    if (isCatalogConfirmationProse(safe) || isNoiseContentIdFact(safe)) continue;
    if (isDemotedBodyMaterial(safe)) continue;
    families.add(itemSemanticFamilyId(item));
  }
  return Math.min(
    RICH_BODY_FACT_HARD_CEILING,
    Math.max(BODY_FACT_CAPS.rich, families.size),
  );
}

function packPunctuationHints(pack: EvidencePack, productTitle: string): string[] {
  return sourcePunctuationHints({
    productTitle,
    extraTexts: [
      ...pack.productIdentity.titleFacets,
      ...(pack.sourceOfficialDescription ? [pack.sourceOfficialDescription] : []),
      ...pack.concreteEvidence.map((e) => e.fact).filter(Boolean),
    ],
  });
}

function balancePlanFacts(facts: string[], hints: string[]): string[] {
  return facts.map((f) => balanceReaderFacingPunctuation(f, hints));
}

function pushSafeFact(
  out: string[],
  item: EvidencePackItem | null | undefined,
  opts?: { allowTitleIdentityCore?: boolean },
): void {
  if (!item?.fact) return;
  let safe = item.generationEligible
    ? projectWriterSafeFactFromPackItem(item)
    : projectWriterSafeFact(item.fact, String(item.type), item.provenance.sourceType);
  if (
    !safe &&
    opts?.allowTitleIdentityCore &&
    item.type === "performer_identity" &&
    item.provenance.sourceType === "product_title"
  ) {
    const raw = item.fact.trim();
    if (raw.length >= 2 && raw.length <= 40) safe = raw;
  }
  if (!safe || out.includes(safe)) return;
  if (isNoiseContentIdFact(safe) || isCatalogConfirmationProse(safe)) return;
  out.push(safe);
}

function factsFromPrimarySupporting(
  primary: EvidencePackItem | null | undefined,
  supporting: EvidencePackItem[] | undefined,
  max: number,
  opts?: { allowTitleIdentityCore?: boolean },
): string[] {
  const out: string[] = [];
  pushSafeFact(out, primary, opts);
  for (const s of supporting ?? []) {
    pushSafeFact(out, s, opts);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

function itemById(pack: EvidencePack, id: string): EvidencePackItem | undefined {
  return pack.concreteEvidence.find((e) => e.id === id);
}

function safeFactFromItem(item: EvidencePackItem): string | null {
  return projectWriterSafeFactFromPackItem(item);
}

/** Coarse diversity bucket — avoids consecutive meta/theme streaks without scene quotas. */
type BodyFactDiversityBucket = "scene" | "quantity" | "trait" | "meta" | "theme" | "other";

function bodyFactDiversityBucket(item: EvidencePackItem): BodyFactDiversityBucket {
  // Upstream pack type is semantic SSOT input — do not reclassify fact text for primary.
  switch (item.type) {
    case "scene_or_act":
    case "setting_or_situation":
      return "scene";
    case "quantity_or_runtime":
      return "quantity";
    case "body_trait":
      return "trait";
    case "series_or_event":
      return "meta";
    default:
      break;
  }
  const f = item.fact.trim();
  // Digits+unit collection/runtime before generic meta (12タイトル / 55コーナー).
  if (/\d+\s*(?:回|発|本|名|人|時間|分|作品|タイトル|cm|コーナー|発射|射精|本番)/u.test(f)) {
    return "quantity";
  }
  if (/^(?:人妻|NTR|痴女|熟女|美少女|OL|女子校生|ギャル)$/iu.test(f)) return "theme";
  if (/(?:ベスト|周年|映画|舞台|収録|作品|第\d+弾|デビュー|活躍)/u.test(f)) {
    return "meta";
  }
  return "other";
}

function isBlockedByTitleLead(safe: string, titleLeadFacts: Set<string>): boolean {
  if (!titleLeadFacts.has(safe)) return false;
  // Short work-theme facets may also fuel body product-understanding (not title-only).
  if (WORK_THEME_FACET_RE.test(safe)) return false;
  return true;
}

function expansionCandidateEligible(
  item: EvidencePackItem,
  titleLeadFacts: Set<string>,
  selectedFacts: Set<string>,
): boolean {
  if (item.type === "product_identity") return false;
  const safe = safeFactFromItem(item);
  if (!safe) return false;
  if (selectedFacts.has(safe)) return false;
  if (isBlockedByTitleLead(safe, titleLeadFacts)) return false;
  // Performer career / external activity is not core product-understanding body fuel.
  if (isDemotedBodyMaterial(safe)) return false;
  return true;
}

/** When cap is full, swap trailing meta/theme in a 3+ streak for an unused scene/action fact. */
function swapMetaStreakForUnusedScene(
  selected: EvidencePackItem[],
  remaining: EvidencePackItem[],
  budget: number,
): EvidencePackItem[] {
  if (selected.length < budget) return selected;
  const selectedIds = new Set(selected.map((s) => s.id));
  const scene = remaining.find(
    (c) => !selectedIds.has(c.id) && bodyFactDiversityBucket(c) === "scene",
  );
  if (!scene) return selected;

  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < selected.length; i++) {
    const b = bodyFactDiversityBucket(selected[i]!);
    if (b !== "meta" && b !== "theme") continue;
    let j = i;
    while (
      j < selected.length &&
      (bodyFactDiversityBucket(selected[j]!) === "meta" ||
        bodyFactDiversityBucket(selected[j]!) === "theme")
    ) {
      j++;
    }
    const len = j - i;
    if (len >= 3 && len > bestLen) {
      bestLen = len;
      bestStart = i;
    }
  }
  if (bestStart < 0) return selected;

  const replaceIdx = bestStart + bestLen - 1;
  const replaced = bodyFactDiversityBucket(selected[replaceIdx]!);
  if (replaced !== "meta" && replaced !== "theme") return selected;

  const next = [...selected];
  next[replaceIdx] = scene;
  return next;
}

const BODY_BUCKET_PRIORITY: BodyFactDiversityBucket[] = [
  "scene",
  "theme",
  "trait",
  "meta",
  "other",
  "quantity",
];

function bodyBucketPriorityRank(bucket: BodyFactDiversityBucket): number {
  const i = BODY_BUCKET_PRIORITY.indexOf(bucket);
  return i >= 0 ? i : BODY_BUCKET_PRIORITY.length;
}

function attachPresentationPurposes(facts: string[]): ArticlePlanSlot {
  const filtered = facts.filter((f) => !isDemotedBodyMaterial(f));
  const use = filtered.length > 0 ? filtered : facts;
  return {
    job: ARTICLE_PLAN_JOBS.body,
    facts: use,
    heading: null,
    presentationPurpose: dominantPresentationPurpose(use),
    factPurposes: use.map((f) => derivePresentationPurpose(f)),
  };
}

/** Ensure short work-theme facets from the pack are not dropped from a full body budget. */
function injectMissingWorkThemes(
  facts: string[],
  pack: EvidencePack,
  ceiling: number,
): string[] {
  const have = new Set(facts);
  const missing: string[] = [];
  for (const item of pack.concreteEvidence) {
    if (!item.generationEligible) continue;
    const safe = safeFactFromItem(item);
    if (!safe || have.has(safe) || !WORK_THEME_FACET_RE.test(safe)) continue;
    if (isDemotedBodyMaterial(safe) || isNoiseContentIdFact(safe)) continue;
    missing.push(safe);
    have.add(safe);
  }
  if (missing.length === 0) return facts;
  const next = [...facts];
  for (const theme of missing) {
    if (next.includes(theme)) continue;
    if (next.length < ceiling) {
      next.push(theme);
      continue;
    }
    const swapIdx = [...next.keys()]
      .reverse()
      .find((i) => {
        const f = next[i]!;
        if (WORK_THEME_FACET_RE.test(f)) return false;
        if (/(?:周年|活躍|映画|舞台)/u.test(f)) return true;
        const purpose = derivePresentationPurpose(f);
        return purpose === "OTHER" || purpose === "PRODUCT_IDENTITY";
      });
    if (swapIdx == null) {
      const qtyIdx = [...next.keys()].reverse().find((i) => {
        const purpose = derivePresentationPurpose(next[i]!);
        return (
          (purpose === "QUANTITY_SCALE" || purpose === "COLLECTION_SCOPE") &&
          next.filter((f) => {
            const p = derivePresentationPurpose(f);
            return p === "QUANTITY_SCALE" || p === "COLLECTION_SCOPE";
          }).length >= 3
        );
      });
      if (qtyIdx == null) break;
      next[qtyIdx] = theme;
      continue;
    }
    next[swapIdx] = theme;
  }
  return next;
}

/**
 * Prefer one fact per semantic family; round-robin across diversity buckets
 * so quantity does not crowd out scene / series / feature families.
 */
function selectBodyFactsWithDiversity(input: {
  seedItems: EvidencePackItem[];
  unusedIds: string[];
  pack: EvidencePack;
  budget: number;
  titleLeadFacts: Set<string>;
  consumedIds: Set<string>;
  /** rich: rebuild from full pool with family coverage (ignore seed order fill). */
  familyCoverageFirst?: boolean;
}): EvidencePackItem[] {
  const selectedFacts = new Set<string>();
  const selectedFamilies = new Set<string>();
  const pool: EvidencePackItem[] = [];
  const seenIds = new Set<string>();

  const tryEnqueue = (item: EvidencePackItem | undefined | null) => {
    if (!item || seenIds.has(item.id)) return;
    if (item.type === "product_identity") return;
    const safe = safeFactFromItem(item);
    if (
      !safe ||
      isBlockedByTitleLead(safe, input.titleLeadFacts) ||
      isCatalogConfirmationProse(safe) ||
      isNoiseContentIdFact(safe) ||
      isDemotedBodyMaterial(safe)
    ) {
      return;
    }
    seenIds.add(item.id);
    pool.push(item);
  };

  if (!input.familyCoverageFirst) {
    for (const item of input.seedItems) tryEnqueue(item);
  }
  for (const id of input.unusedIds) {
    if (input.consumedIds.has(id) && !input.familyCoverageFirst) continue;
    tryEnqueue(itemById(input.pack, id));
  }
  if (input.familyCoverageFirst) {
    for (const item of input.seedItems) tryEnqueue(item);
    for (const item of input.pack.concreteEvidence) {
      if (!item.generationEligible) continue;
      tryEnqueue(item);
    }
  }

  // Prefer longer / more specific surface within the same family when both appear.
  pool.sort((a, b) => {
    const famCmp = itemSemanticFamilyId(a).localeCompare(itemSemanticFamilyId(b));
    if (famCmp !== 0) return 0;
    return b.fact.length - a.fact.length;
  });

  const byBucket = new Map<BodyFactDiversityBucket, EvidencePackItem[]>();
  for (const item of pool) {
    const b = bodyFactDiversityBucket(item);
    const list = byBucket.get(b) ?? [];
    list.push(item);
    byBucket.set(b, list);
  }
  for (const list of byBucket.values()) {
    list.sort((a, b) => {
      const ra = bodyBucketPriorityRank(bodyFactDiversityBucket(a));
      const rb = bodyBucketPriorityRank(bodyFactDiversityBucket(b));
      if (ra !== rb) return ra - rb;
      return b.fact.length - a.fact.length;
    });
  }

  const selected: EvidencePackItem[] = [];
  /** Soft cap — quantity families are many (COUNT_N); don't let them crowd scene/series. */
  const QUANTITY_BODY_SOFT_CAP = 3;
  let quantityTaken = 0;

  const tryTake = (item: EvidencePackItem): boolean => {
    if (selected.length >= input.budget) return false;
    const safe = safeFactFromItem(item);
    if (!safe || selectedFacts.has(safe) || isBlockedByTitleLead(safe, input.titleLeadFacts)) {
      return false;
    }
    const fam = itemSemanticFamilyId(item);
    if (selectedFamilies.has(fam)) return false;
    const bucket = bodyFactDiversityBucket(item);
    if (bucket === "quantity") {
      if (quantityTaken >= QUANTITY_BODY_SOFT_CAP) return false;
      quantityTaken += 1;
    }
    selected.push(item);
    selectedFacts.add(safe);
    selectedFamilies.add(fam);
    input.consumedIds.add(item.id);
    return true;
  };

  // Pass 1 — one fact per family, round-robin across buckets (scene before quantity).
  let progressed = true;
  while (selected.length < input.budget && progressed) {
    progressed = false;
    for (const bucket of BODY_BUCKET_PRIORITY) {
      const list = byBucket.get(bucket);
      if (!list?.length) continue;
      while (list.length > 0) {
        const item = list.shift()!;
        if (tryTake(item)) {
          progressed = true;
          break;
        }
      }
    }
  }

  // Pass 2 — fill remaining budget with unused families (respect quantity soft cap).
  if (selected.length < input.budget) {
    for (const item of pool) {
      if (selected.length >= input.budget) break;
      tryTake(item);
    }
  }

  const selectedIds = new Set(selected.map((s) => s.id));
  const remaining = pool.filter((item) => !selectedIds.has(item.id));
  const withScenes = swapMetaStreakForUnusedScene(selected, remaining, input.budget);
  return ensureUnusedThemeFacets(
    withScenes,
    pool.filter((item) => !withScenes.some((s) => s.id === item.id)),
    input.budget,
  ).slice(0, input.budget);
}

/** Prefer unused work-theme facets (NTR / 人妻 …) over trailing meta when budget is full. */
function ensureUnusedThemeFacets(
  selected: EvidencePackItem[],
  remaining: EvidencePackItem[],
  budget: number,
): EvidencePackItem[] {
  const missingThemes = remaining.filter((c) => bodyFactDiversityBucket(c) === "theme");
  if (missingThemes.length === 0) return selected;
  const next = [...selected];
  for (const theme of missingThemes) {
    if (next.some((s) => s.id === theme.id)) continue;
    if (next.length < budget) {
      next.push(theme);
      continue;
    }
    const swapIdx = [...next.keys()]
      .reverse()
      .find((i) => {
        const b = bodyFactDiversityBucket(next[i]!);
        // Prefer dropping meta/other; also a surplus quantity when ≥2 already kept.
        if (b === "meta" || b === "other") return true;
        if (
          b === "quantity" &&
          next.filter((x) => bodyFactDiversityBucket(x) === "quantity").length >= 2
        ) {
          return true;
        }
        return false;
      });
    if (swapIdx == null) break;
    next[swapIdx] = theme;
  }
  return next;
}

function appendSequentialUnusedExpansion(input: {
  unusedIds: string[];
  pack: EvidencePack;
  expandBudget: number;
  flatBodyFacts: string[];
  titleLeadFacts: Set<string>;
  consumedIds: Set<string>;
}): string[] {
  const extra: string[] = [];
  for (const id of input.unusedIds) {
    if (extra.length + input.flatBodyFacts.length >= input.expandBudget) break;
    if (input.consumedIds.has(id)) continue;
    const item = itemById(input.pack, id);
    if (!item || item.type === "product_identity") continue;
    const before = extra.length;
    pushSafeFact(extra, item);
    if (extra.length > before) {
      const f = extra[extra.length - 1]!;
      if (input.titleLeadFacts.has(f) || input.flatBodyFacts.includes(f)) {
        extra.pop();
        continue;
      }
      input.consumedIds.add(id);
    }
  }
  return extra;
}

/** R145/R146 — mode-aware lead representation (dual_host / ensemble / collection / unknown_multi). */
function applyRepresentationLeadFacts(
  leadFacts: string[],
  input: {
    pack: EvidencePack;
    profile: ProductMaterialProfile;
    titleFacts: string[];
    max: number;
  },
): string[] {
  const rep = input.profile.performerRepresentation;
  if (rep.mode === "single" || rep.entities.length <= 1) return leadFacts;

  if (representationLeadCoversFacts(leadFacts, rep)) {
    return preferRepresentationOverForcedRoster(leadFacts, rep).slice(0, input.max);
  }

  const eligible = input.pack.concreteEvidence.filter((e) => e.generationEligible);
  const label = resolveRepresentationLeadFact(rep, eligible);
  if (!label) return leadFacts;

  const out = preferRepresentationOverForcedRoster(
    [label, ...leadFacts.filter((f) => f !== label)],
    rep,
  );
  return out.slice(0, input.max);
}

/** R147 — swap causal narrative title targets for SOURCE title-safe facets. */
function refineTitleExecutionFacts(input: {
  titleFacts: string[];
  leadFacts: string[];
  pack: EvidencePack;
  productTitle: string;
  assignment: SkeletonEvidenceAssignment;
  maxTitle: number;
  maxLead: number;
  rep?: ProductMaterialProfile["performerRepresentation"];
}): { titleFacts: string[]; leadFacts: string[] } {
  let titleFacts = [...input.titleFacts];
  let leadFacts = [...input.leadFacts];
  // CID scraps are not title/lead fuel (same as post dropCatalog) — treat as empty for enrichment.
  titleFacts = titleFacts.filter((f) => f.trim() && !isNoiseContentIdFact(f));
  leadFacts = leadFacts.filter((f) => f.trim() && !isNoiseContentIdFact(f));
  const titlePrimaryRaw = input.assignment.title.primary?.fact?.trim();
  const unsafeSet = new Set(titleFacts.filter(isUnsafeTitleExecutionTarget));
  if (titlePrimaryRaw && isUnsafeTitleExecutionTarget(titlePrimaryRaw)) {
    unsafeSet.add(titlePrimaryRaw);
  }
  if (isUnsafeTitleExecutionTarget(input.productTitle)) {
    unsafeSet.add(input.productTitle.trim());
  }
  const unsafe = [...unsafeSet];
  // Drop unsafe from title/lead — do NOT paste full unsafe/synopsis title into lead.
  for (const u of unsafe) {
    titleFacts = titleFacts.filter((f) => f !== u);
    leadFacts = leadFacts.filter((f) => f !== u);
  }
  leadFacts = leadFacts.filter((f) => f.trim() && !isUnsafeLeadExecutionTarget(f));
  // Compact / drop unfinished clause fragments already in titleFacts.
  titleFacts = titleFacts
    .map((f) => toTitleDisplayFact(f))
    .filter(
      (f): f is string =>
        !!f && isTitleEligibleFact(f, { productTitle: input.productTitle, rep: input.rep }),
    );


  const eligibility = { productTitle: input.productTitle, rep: input.rep };
  const titleAttested = new Set(input.rep?.titleAttested ?? []);
  const performerNames = packPerformerNameSet(input.pack);
  const productTitleIsNoise = isNoiseContentIdFact(input.productTitle);
  const thinBefore = isThinTitleFacts(titleFacts, performerNames);
  type Cand = { fact: string; score: number; isPerformer: boolean; isQty: boolean };
  const candidates: Cand[] = [];
  for (const item of input.pack.concreteEvidence) {
    if (!item.generationEligible) continue;
    let safe = projectWriterSafeFactFromPackItem(item);
    if (
      !safe &&
      item.provenance.sourceType === "product_title" &&
      item.type !== "product_identity"
    ) {
      const raw = item.fact.trim();
      if (isTitleSafeExecutionTarget(raw)) safe = raw;
    }
    // SEMANTIC_ONLY clause fragments → compact DISPLAY surface, or skip title.
    if (safe) {
      const display = toTitleDisplayFact(safe);
      if (!display) continue;
      safe = display;
    }
    if (!safe || !isTitleEligibleFact(safe, eligibility)) continue;
    if (unsafe.includes(safe) || isUnsafeLeadExecutionTarget(safe)) continue;
    if (isNoiseContentIdFact(safe)) continue;
    const isPerformer = item.type === "performer_identity";
    const nameForAttest = safe.trim();
    const performerAttested =
      isPerformer &&
      (titleAttested.has(nameForAttest) ||
        [...titleAttested].some((a) => nameForAttest.includes(a) || a.includes(nameForAttest)));
    if (isPerformer && item.provenance.sourceType !== "product_title") {
      // When SOURCE title already attests cast, do not let secondary hosts win title
      // enrichment via short-name score (dual_host: ましろ杏 over 優梨まいな).
      // CID scrap / no attested cast: allow metadata performers (R156 halt pattern).
      if (!performerAttested) {
        if (productTitleIsNoise || (thinBefore && titleAttested.size === 0)) {
          // allow
        } else {
          continue;
        }
      }
    }
    let score = 18 + Math.min(safe.length, 22);
    if (safe.length <= 3 && !WORK_THEME_FACET_RE.test(safe)) score -= 12;
    if (isSparseTitleWorkAtom(safe)) score -= 10;
    // Elongated kana reaction crumbs are weak title identity (body OK).
    if (/^[ぁ-んァ-ヶー]{3,}$/u.test(safe) && /[ぅうウァ]{2,}/u.test(safe)) score -= 22;
    if (item.provenance.sourceType === "product_title") score += 12;
    if (safe === input.productTitle.trim()) score += 50; // SOURCE title-safe facet wins over crumbs
    if (/^【/.test(safe)) score += 8;
    if (
      item.type === "scene_or_act" ||
      item.type === "series_or_event" ||
      item.type === "setting_or_situation" ||
      item.type === "body_trait"
    ) {
      score += 14;
    }
    if (item.type === "scene_or_act") {
      if (/(?:作品|ベスト(?:第?\d*弾)?)$/u.test(safe)) {
        score += 28;
      } else if (isDetailedSceneTitleCompound(safe)) {
        score -= 24;
      }
    }
    if (item.type === "unknown_concrete") {
      score += safe.length >= 6 ? 6 : -4;
    }
    if (isPerformer) score += 4;
    if (performerAttested) score += 40;
    const isQty = item.type === "quantity_or_runtime" || isQuantityOrRuntimeOnlyFact(safe);
    // Duration/quantity is auxiliary title fuel — never outrank work identity/feature.
    if (isQty) score -= 6;
    // Identity/collection/form beats bare theme tags (prevents 奥田咲 人妻 痴女 keyword concat).
    if (isTitleIdentityOrFormFacet(safe) && !isTitleThemeVarietyList(safe)) {
      score += 30 + titleFormSpecificityScore(safe);
      // Prefer compact identity (ベスト第6弾) over synopsis-like fragments (今回は彼女の最新12タイトル).
      if (safe.length <= 16) score += 4;
      if (safe.length > 22) score -= 8;
      if (/^(?:今回は|彼女の|なお且つ)/u.test(safe)) score -= 16;
      // Bare / weak compilation stems lose to edition-specific forms.
      if (/^(?:ベスト|時間ベスト)$/u.test(safe)) score -= 36;
    }
    if (isTitleThemeVarietyList(safe)) score -= 20;
    if (WORK_THEME_FACET_RE.test(safe)) score -= 14;
    // Prefer compact non-theme facets over long dumps in title
    if (isCompactTitleWorkFacet(safe)) score += 6;
    if (!isPerformer && !isCompactTitleWorkFacet(safe) && !isTitleIdentityOrFormFacet(safe) && safe.length > 24) {
      score -= 8;
    }
    candidates.push({ fact: safe, score, isPerformer, isQty });
  }
  // Prefer SOURCE product title when it is already a compact title-safe facet (【…】 etc.)
  {
    const pt = input.productTitle.trim();
    if (
      pt &&
      !isNoiseContentIdFact(pt) &&
      isTitleEligibleFact(pt, eligibility) &&
      !candidates.some((c) => c.fact === pt)
    ) {
      candidates.push({
        fact: pt,
        score: 90,
        isPerformer: false,
        isQty: isQuantityOrRuntimeOnlyFact(pt),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const performers = candidates.filter((c) => c.isPerformer);
  const workFacets = candidates.filter((c) => !c.isPerformer);
  const compactWork = workFacets.filter((c) => isCompactTitleWorkFacet(c.fact));
  const nonQtyWork = (compactWork.length > 0 ? compactWork : workFacets).filter((c) => !c.isQty);
  const titleIsPerformerOnly = isPerformerOnlyTitleFacts(titleFacts, performerNames);
  const titleIsQtyOnly =
    titleFacts.length > 0 && titleFacts.every(isQuantityOrRuntimeOnlyFact);

  const needsTitleEnrichment =
    unsafe.length > 0 ||
    titleFacts.length === 0 ||
    (titleIsPerformerOnly && (nonQtyWork.length > 0 || workFacets.length > 0)) ||
    (titleIsQtyOnly && (performers.length > 0 || nonQtyWork.length > 0)) ||
    (thinBefore && (performers.length > 0 || nonQtyWork.length > 0 || workFacets.length > 0));

  if (needsTitleEnrichment) {
    const composed: string[] = [];
    const pushUnique = (f: string, opts?: { allowQty?: boolean; allowSparse?: boolean }) => {
      if (!f || composed.includes(f) || !isTitleEligibleFact(f, eligibility)) return;
      if (composed.length >= input.maxTitle) return;
      const qty = isQuantityOrRuntimeOnlyFact(f);
      // Duration is auxiliary — never the only work feature beside performer when better facets exist.
      if (qty && !opts?.allowQty) {
        const hasNonQtyWork = composed.some(
          (c) => !performerNames.has(c) && !isQuantityOrRuntimeOnlyFact(c),
        );
        if (hasNonQtyWork) return;
        if (nonQtyWork.length > 0) return;
      }
      if (isSparseTitleWorkAtom(f) && !opts?.allowSparse) {
        const hasSolidWork = composed.some(
          (c) =>
            !performerNames.has(c) &&
            !isQuantityOrRuntimeOnlyFact(c) &&
            !isSparseTitleWorkAtom(c),
        );
        if (hasSolidWork) return;
      }
      if (
        isTitleIdentityOrFormFacet(f) &&
        composed.some((c) => titleFormSemanticallyRedundant(c, f))
      ) {
        // Replace weaker form with more specific edition when redundant.
        const idx = composed.findIndex((c) => titleFormSemanticallyRedundant(c, f));
        if (idx >= 0) {
          if (titleFormSpecificityScore(f) > titleFormSpecificityScore(composed[idx]!)) {
            composed[idx] = f;
          }
        }
        return;
      }
      composed.push(f);
    };

    if (performers[0]) pushUnique(performers[0].fact, { allowSparse: true });
    // Prefer specific identity/form/collection before bare theme tags.
    const facetPool = nonQtyWork.length > 0 ? nonQtyWork : workFacets;
    const identityFacets = facetPool
      .filter(
        (w) => isTitleIdentityOrFormFacet(w.fact) && !isTitleThemeVarietyList(w.fact),
      )
      .sort(
        (a, b) =>
          titleFormSpecificityScore(b.fact) - titleFormSpecificityScore(a.fact) ||
          b.score - a.score,
      );
    const themeFacets = facetPool.filter(
      (w) => WORK_THEME_FACET_RE.test(w.fact) || isTitleThemeVarietyList(w.fact),
    );
    const otherFacets = facetPool
      .filter(
        (w) =>
          !isTitleIdentityOrFormFacet(w.fact) &&
          !WORK_THEME_FACET_RE.test(w.fact) &&
          !isTitleThemeVarietyList(w.fact),
      )
      .sort((a, b) => {
        const aCompact = isCompactTitleWorkFacet(a.fact);
        const bCompact = isCompactTitleWorkFacet(b.fact);
        if (aCompact !== bCompact) return aCompact ? -1 : 1;
        const aDetail = isDetailedSceneTitleCompound(a.fact);
        const bDetail = isDetailedSceneTitleCompound(b.fact);
        if (aDetail !== bDetail) return aDetail ? 1 : -1;
        return b.score - a.score || b.fact.length - a.fact.length;
      });

    for (const w of identityFacets) {
      if (composed.length >= input.maxTitle) break;
      if (w.isQty) continue;
      // One product-form / edition identity beside performer — avoid ベスト+テーマ列挙 concat.
      if (
        composed.some(
          (c) => isTitleIdentityOrFormFacet(c) && !performerNames.has(c),
        )
      ) {
        break;
      }
      pushUnique(w.fact);
    }
    const hasFormIdentity = composed.some(
      (c) => isTitleIdentityOrFormFacet(c) && !performerNames.has(c),
    );
    // When form/edition is present, do not pile persona/scene crumbs into title.
    if (!hasFormIdentity) {
      let otherAdded = 0;
      const otherCap =
        performers[0] && composed.some((c) => c === performers[0]!.fact) ? 1 : 2;
      for (const w of otherFacets) {
        if (composed.length >= input.maxTitle) break;
        if (w.isQty) continue;
        if (otherAdded >= otherCap) break;
        if (isSparseTitleWorkAtom(w.fact) && otherFacets.some((x) => !isSparseTitleWorkAtom(x.fact))) {
          continue;
        }
        const before = composed.length;
        pushUnique(w.fact);
        if (composed.length > before) otherAdded += 1;
      }
    }
    // Theme tags remain eligible — fill only remaining slots (at most one when identity present).
    const hasIdentity = composed.some((f) => isTitleIdentityOrFormFacet(f));
    let themeAdded = 0;
    for (const w of themeFacets) {
      if (composed.length >= input.maxTitle) break;
      if (hasFormIdentity) break;
      if (hasIdentity && themeAdded >= 1) break;
      if (!hasIdentity && themeAdded >= 2) break;
      // Variety lists are body fuel; single theme tags may still title-fill.
      if (isTitleThemeVarietyList(w.fact)) continue;
      pushUnique(w.fact, { allowSparse: true });
      themeAdded += 1;
    }
    // Duration only when no non-qty work feature was available.
    const hasNonQtyWork = composed.some(
      (c) => !performerNames.has(c) && !isQuantityOrRuntimeOnlyFact(c),
    );
    if (!hasNonQtyWork) {
      const qtyFacet = workFacets.find((w) => w.isQty);
      if (qtyFacet) pushUnique(qtyFacet.fact, { allowQty: true });
    }
    if (composed.length === 0 && workFacets[0]) {
      pushUnique(workFacets[0].fact, { allowQty: true, allowSparse: true });
    }
    if (composed.length === 0 && performers[0]) {
      pushUnique(performers[0].fact, { allowSparse: true });
    }

    if (composed.length > 0) {
      titleFacts = composed;
    } else if (titleFacts.length === 0) {
      const primary = input.assignment.title.primary?.fact?.trim();
      if (primary && isTitleEligibleFact(primary, eligibility) && !isNoiseContentIdFact(primary)) {
        titleFacts.push(primary);
      } else {
        const attested = input.rep?.titleAttested?.[0]?.trim();
        if (attested && isTitleEligibleFact(attested, eligibility)) {
          titleFacts.push(attested);
        } else {
          const fromProduct = input.productTitle.trim().slice(0, 48);
          if (
            isTitleEligibleFact(fromProduct, eligibility) &&
            !isNoiseContentIdFact(fromProduct)
          ) {
            titleFacts.push(fromProduct);
          }
        }
      }
    }
  }

  titleFacts = titleFacts.filter((f) => isTitleEligibleFact(f, eligibility));
  // Collapse redundant product-form facts left from earlier skeleton title picks.
  {
    const collapsed: string[] = [];
    for (const f of titleFacts) {
      const idx = collapsed.findIndex((c) => titleFormSemanticallyRedundant(c, f));
      if (idx < 0) {
        collapsed.push(f);
        continue;
      }
      if (titleFormSpecificityScore(f) > titleFormSpecificityScore(collapsed[idx]!)) {
        collapsed[idx] = f;
      }
    }
    // Drop bare performer when a kept form/title already contains that name.
    titleFacts = collapsed.filter((f, _i, arr) => {
      if (!performerNames.has(f)) return true;
      return !arr.some(
        (o) => o !== f && o.includes(f) && (isTitleIdentityOrFormFacet(o) || o.length >= f.length + 4),
      );
    });
  }
  // Final thin-title pass: if still performer/qty-only and compact facets exist, force compose
  if (
    isThinTitleFacts(titleFacts, performerNames) &&
    (nonQtyWork.length > 0 || (performers.length > 0 && workFacets.length > 0))
  ) {
    const composed: string[] = [];
    const push = (f: string, allowQty = false) => {
      if (!f || composed.includes(f) || !isTitleEligibleFact(f, eligibility)) return;
      if (composed.length >= input.maxTitle) return;
      if (isQuantityOrRuntimeOnlyFact(f) && !allowQty && nonQtyWork.length > 0) return;
      if (
        isTitleIdentityOrFormFacet(f) &&
        composed.some((c) => titleFormSemanticallyRedundant(c, f))
      ) {
        const idx = composed.findIndex((c) => titleFormSemanticallyRedundant(c, f));
        if (idx >= 0 && titleFormSpecificityScore(f) > titleFormSpecificityScore(composed[idx]!)) {
          composed[idx] = f;
        }
        return;
      }
      composed.push(f);
    };
    if (performers[0]) push(performers[0].fact);
    const pool = nonQtyWork.length > 0 ? nonQtyWork : workFacets;
    for (const w of pool
      .filter(
        (x) => isTitleIdentityOrFormFacet(x.fact) && !isTitleThemeVarietyList(x.fact),
      )
      .sort(
        (a, b) =>
          titleFormSpecificityScore(b.fact) - titleFormSpecificityScore(a.fact) ||
          b.score - a.score,
      )) {
      if (
        composed.some(
          (c) => isTitleIdentityOrFormFacet(c) && !performerNames.has(c),
        )
      ) {
        break;
      }
      push(w.fact);
    }
    const hasFormIdentity = composed.some(
      (c) => isTitleIdentityOrFormFacet(c) && !performerNames.has(c),
    );
    if (!hasFormIdentity) {
      for (const w of pool
        .filter(
          (x) =>
            !isTitleIdentityOrFormFacet(x.fact) &&
            !WORK_THEME_FACET_RE.test(x.fact) &&
            !isTitleThemeVarietyList(x.fact),
        )
        .sort((a, b) => b.score - a.score || b.fact.length - a.fact.length)) {
        push(w.fact);
      }
      for (const w of pool.filter(
        (x) => WORK_THEME_FACET_RE.test(x.fact) && !isTitleThemeVarietyList(x.fact),
      )) {
        if (composed.some((f) => isTitleIdentityOrFormFacet(f)) && composed.length >= 2) break;
        push(w.fact);
      }
    }
    if (!composed.some((c) => !performerNames.has(c) && !isQuantityOrRuntimeOnlyFact(c))) {
      const qty = pool.find((x) => x.isQty) ?? workFacets.find((x) => x.isQty);
      if (qty) push(qty.fact, true);
    }
    if (composed.length > titleFacts.length) titleFacts = composed;
  }

  // Lead must carry additive situation/work facts — not title-subset performer alone,
  // and never synopsis-like full product titles.
  const titleSetForLead = new Set(titleFacts);
  const leadHasAdditiveFact = leadFacts.some((f) => !titleSetForLead.has(f));
  if (!leadHasAdditiveFact) {
    const filled: string[] = leadFacts.filter((f) => !isUnsafeLeadExecutionTarget(f));
    for (const c of workFacets) {
      if (filled.length >= input.maxLead) break;
      if (titleSetForLead.has(c.fact) || filled.includes(c.fact)) continue;
      if (isUnsafeLeadExecutionTarget(c.fact)) continue;
      filled.push(c.fact);
    }
    if (filled.length === 0) {
      for (const c of performers) {
        if (filled.length >= input.maxLead) break;
        if (isUnsafeLeadExecutionTarget(c.fact)) continue;
        filled.push(c.fact);
      }
    }
    leadFacts = filled;
  }

  return {
    titleFacts: titleFacts.slice(0, input.maxTitle),
    leadFacts: leadFacts.slice(0, input.maxLead),
  };
}

function resolveTitleFallbackFact(input: {
  productTitle: string;
  assignment: SkeletonEvidenceAssignment;
  leadFacts: string[];
  rep?: ProductMaterialProfile["performerRepresentation"];
}): string | undefined {
  const eligibility = { productTitle: input.productTitle, rep: input.rep };

  const facet = input.productTitle.trim();
  if (isTitleEligibleFact(facet, eligibility)) return facet;

  const primary = input.assignment.title.primary?.fact?.trim();
  if (primary && isTitleEligibleFact(primary, eligibility)) return primary;

  const attested = input.rep?.titleAttested?.[0]?.trim();
  if (attested && isTitleEligibleFact(attested, eligibility)) return attested;

  const fromProduct = input.productTitle.trim().slice(0, 48);
  if (isTitleEligibleFact(fromProduct, eligibility)) return fromProduct;

  for (const f of input.leadFacts) {
    if (isTitleEligibleFact(f, eligibility)) return f;
  }

  return factsFromPrimarySupporting(
    input.assignment.body[0]?.primary,
    input.assignment.body[0]?.supporting,
    1,
  ).find((f) => isTitleEligibleFact(f, eligibility));
}

/** R147/R150 — SOURCE title-safe product facet beats bare metadata performer as title execution target. */
function preferSourceTitleFacetIfEligible(
  titleFacts: string[],
  productTitle: string,
  assignment: SkeletonEvidenceAssignment,
  rep?: ProductMaterialProfile["performerRepresentation"],
): string[] {
  const eligibility = { productTitle, rep };
  const facet = productTitle.trim();
  if (!isTitleEligibleFact(facet, eligibility)) return titleFacts;

  const primary = assignment.title.primary;
  const metadataPerformerPrimary =
    primary?.type === "performer_identity" &&
    primary.provenance.sourceType === "performer_metadata";

  if (!metadataPerformerPrimary) return titleFacts;

  const attested = rep?.titleAttested ?? [];
  const primaryName = primary?.fact?.trim() ?? "";
  const attestedOnlyName =
    attested.length === 1 &&
    titleFacts.length === 1 &&
    titleFacts[0] === attested[0] &&
    attested[0] === primaryName &&
    facet.length <= attested[0]!.length + 4;

  if (attestedOnlyName) return titleFacts;

  return [facet];
}

/**
 * Build Writer-visible ArticlePlan from R83 assignment + material depth.
 * Planner selects/expands facts here; Writer must not re-select from EvidencePack.
 */
export function buildArticlePlan(input: {
  productTitle: string;
  pack: EvidencePack;
  assignment: SkeletonEvidenceAssignment;
  materialDepth: ArticlePlanMaterialDepth | string;
  /** R145 — dual_host lead representation uses profile.performerRepresentation. */
  profile?: ProductMaterialProfile;
  /**
   * R154 editorial frame (purpose / coreAngle / reader jobs).
   * Default false — GOOD BASELINE restore keeps production on schemaVersion 1.
   * Pass true only for explicit V2 experiments / r154 tests.
   */
  editorialFrame?: boolean;
}): ArticlePlan {
  const depth: ArticlePlanMaterialDepth =
    input.materialDepth === "scarce" || input.materialDepth === "rich"
      ? input.materialDepth
      : "standard";
  const a = input.assignment;
  const punctHints = packPunctuationHints(input.pack, input.productTitle);

  let titleFacts = factsFromPrimarySupporting(
    a.title.primary,
    a.title.supporting,
    TITLE_FACT_CAP,
    { allowTitleIdentityCore: true },
  );
  titleFacts = preferSourceTitleFacetIfEligible(
    titleFacts,
    input.productTitle,
    a,
    input.profile?.performerRepresentation,
  );
  titleFacts = balancePlanFacts(titleFacts, punctHints);

  let leadFacts = factsFromPrimarySupporting(
    a.opening.primary,
    a.opening.supporting,
    LEAD_FACT_CAP,
  );
  leadFacts = repairBracketSplitPlanFacts(
    leadFacts,
    input.productTitle,
    input.pack.concreteEvidence.map((e) => e.fact),
  );
  // Title↔lead may share (R83 allowReuseInOpening) when opening projection is empty.
  if (leadFacts.length === 0 && titleFacts.length > 0) {
    leadFacts = [...titleFacts];
  }

  const rep = input.profile?.performerRepresentation;
  ({ titleFacts, leadFacts } = refineTitleExecutionFacts({
    titleFacts,
    leadFacts,
    pack: input.pack,
    productTitle: input.productTitle,
    assignment: a,
    maxTitle: TITLE_FACT_CAP,
    maxLead: LEAD_FACT_CAP,
    rep,
  }));

  if (input.profile) {
    leadFacts = applyRepresentationLeadFacts(leadFacts, {
      pack: input.pack,
      profile: input.profile,
      titleFacts,
      max: LEAD_FACT_CAP,
    });
  }

  // Ensure title has at least one planned fact when lead/body have material.
  if (titleFacts.length === 0) {
    const fallback = resolveTitleFallbackFact({
      productTitle: input.productTitle,
      assignment: a,
      leadFacts,
      rep,
    });
    if (fallback) titleFacts.push(fallback);
  }

  if (rep) {
    const eligibility = { productTitle: input.productTitle, rep };
    titleFacts = titleFacts.filter((f) => isTitleEligibleFact(f, eligibility));
  }

  // R108 meaning: lead must not be title-paraphrase-only when unused concrete exists.
  const titleSet = new Set(titleFacts);
  const leadHasAdditive = leadFacts.some((f) => !titleSet.has(f));
  const representationSatisfied =
    input.profile != null &&
    input.profile.performerRepresentation.entities.length > 1 &&
    input.profile.performerRepresentation.mode !== "single" &&
    representationLeadCoversFacts(leadFacts, input.profile.performerRepresentation);
  const leadConsumedUnusedIds = new Set<string>();
  if (
    !leadHasAdditive &&
    !representationSatisfied &&
    a.unusedConcreteIds.length > 0 &&
    depth !== "scarce"
  ) {
    for (const id of a.unusedConcreteIds) {
      const item = itemById(input.pack, id);
      if (!item) continue;
      const before = leadFacts.length;
      pushSafeFact(leadFacts, item);
      if (leadFacts.length > before) {
        leadConsumedUnusedIds.add(id);
        leadFacts = leadFacts.slice(0, LEAD_FACT_CAP);
        break;
      }
    }
  }

  // Leadless write: body may consume opening materials. Block only title surfaces
  // (not opening/lead candidates) so overview evidence can land in body.
  const titleLeadFacts = new Set([...titleFacts]);
  const bodyCap = resolveBodyFactBudget(depth, input.pack, titleLeadFacts);
  const bodySlots: ArticlePlanSlot[] = [];
  const consumedIds = new Set<string>(leadConsumedUnusedIds);

  for (const b of a.body) {
    const facts = factsFromPrimarySupporting(b.primary, b.supporting, bodyCap).filter(
      (f) => !isDemotedBodyMaterial(f),
    );
    if (facts.length === 0) continue;
    if (b.primary) consumedIds.add(b.primary.id);
    for (const s of b.supporting) consumedIds.add(s.id);
    bodySlots.push(attachPresentationPurposes(facts));
  }

  // Planner-owned depth expansion: pull unused concrete into body (not Writer choice).
  const expandBudget =
    depth === "rich" ? bodyCap : depth === "standard" ? Math.max(2, bodyCap - 1) : bodyCap;

  let flatBodyFacts = bodySlots.flatMap((s) => s.facts);
  const seedItems: EvidencePackItem[] = [];
  for (const b of a.body) {
    if (b.primary) seedItems.push(b.primary);
    seedItems.push(...b.supporting);
  }

  // rich: always rebuild body so fixed seed order cannot drop scene/series families.
  const shouldRebuildBody =
    depth === "rich" || (flatBodyFacts.length < expandBudget && bodySlots.length <= 1);

  if (shouldRebuildBody) {
    const mergedFacts = selectBodyFactsWithDiversity({
      seedItems,
      unusedIds: a.unusedConcreteIds,
      pack: input.pack,
      budget: expandBudget,
      titleLeadFacts,
      consumedIds,
      familyCoverageFirst: depth === "rich",
    })
      .map((item) => safeFactFromItem(item))
      .filter((f): f is string => !!f);

    if (mergedFacts.length > 0) {
      const slot = attachPresentationPurposes(mergedFacts);
      if (bodySlots.length === 0) {
        bodySlots.push(slot);
      } else {
        bodySlots[0] = slot;
        bodySlots.splice(1);
      }
      flatBodyFacts = slot.facts;
    }
  } else if (flatBodyFacts.length < expandBudget && bodySlots.length > 1) {
    const extra = appendSequentialUnusedExpansion({
      unusedIds: a.unusedConcreteIds,
      pack: input.pack,
      expandBudget,
      flatBodyFacts,
      titleLeadFacts,
      consumedIds,
    });
    if (extra.length > 0) {
      const last = bodySlots[bodySlots.length - 1]!;
      last.facts = [...last.facts, ...extra].slice(0, expandBudget);
      flatBodyFacts = bodySlots.flatMap((s) => s.facts);
    }
  }

  // Final pass: short work-theme facets must not be dropped when budget is full of meta/qty.
  if (bodySlots.length > 0 && depth !== "scarce") {
    const injected = injectMissingWorkThemes(
      bodySlots.flatMap((s) => s.facts),
      input.pack,
      Math.max(expandBudget, RICH_BODY_FACT_HARD_CEILING),
    );
    if (injected.length > 0) {
      bodySlots[0] = attachPresentationPurposes(injected);
      bodySlots.splice(1);
      flatBodyFacts = bodySlots[0]!.facts;
    }
  }

  // Leadless write: opening (former lead) materials are body overview fuel — not a lead slot.
  {
    const bodyHave = new Set(bodySlots.flatMap((s) => s.facts));
    const openingForBody = leadFacts.filter(
      (f) =>
        f.trim() &&
        !isDemotedBodyMaterial(f) &&
        !isNoiseContentIdFact(f) &&
        !isCatalogConfirmationProse(f) &&
        !bodyHave.has(f),
    );
    if (openingForBody.length > 0) {
      if (bodySlots.length === 0) {
        bodySlots.push(attachPresentationPurposes(openingForBody));
      } else {
        bodySlots[0] = attachPresentationPurposes([
          ...openingForBody,
          ...bodySlots[0]!.facts,
        ]);
        bodySlots.splice(1);
      }
      flatBodyFacts = bodySlots.flatMap((s) => s.facts);
    }
    // Ensemble/collection: overview must not dump metadata roster when abstraction covers.
    if (input.profile?.performerRepresentation && bodySlots.length > 0) {
      const overview = preferRepresentationOverForcedRoster(
        bodySlots[0]!.facts,
        input.profile.performerRepresentation,
      );
      if (overview.length !== bodySlots[0]!.facts.length) {
        bodySlots[0] = attachPresentationPurposes(overview);
        flatBodyFacts = bodySlots.flatMap((s) => s.facts);
      }
    }
    // Internalize opening into body — plan.lead stays empty (Writer-visible plan omits lead).
    leadFacts = [];
  }

  // scarce with empty body: body=[] — Writer emits one section with paragraphs:[] (no invent).
  if (bodySlots.length === 0 && depth === "scarce") {
    // intentionally empty
  }

  /** Push overview-safe candidates into body[0] (leadless write — never revive lead slot). */
  const pushOverviewIntoBody = (candidate: string | null | undefined) => {
    const c = (candidate ?? "").trim();
    if (!c || isUnsafeLeadExecutionTarget(c) || isDemotedBodyMaterial(c)) return;
    if (isCatalogConfirmationProse(c) || isNoiseContentIdFact(c)) return;
    const have = new Set(bodySlots.flatMap((s) => s.facts));
    if (have.has(c) || titleFacts.includes(c)) return;
    if (bodySlots.length === 0) {
      bodySlots.push(attachPresentationPurposes([c]));
    } else {
      bodySlots[0] = attachPresentationPurposes([c, ...bodySlots[0]!.facts]);
      bodySlots.splice(1);
    }
  };

  const displacedTitleRaw = a.title.primary?.fact?.trim();
  if (displacedTitleRaw && isUnsafeTitleExecutionTarget(displacedTitleRaw)) {
    const planned = bodySlots.flatMap((s) => s.facts);
    const retained = planned.some(
      (f) => f === displacedTitleRaw || displacedTitleRaw.includes(f.slice(0, 12)),
    );
    if (!retained && a.title.primary) {
      const safeOverview: string[] = [];
      pushSafeFact(safeOverview, a.title.primary);
      pushOverviewIntoBody(safeOverview[0]);
    }
  }

  for (const item of input.pack.concreteEvidence) {
    const raw = item.fact?.trim();
    if (!raw || !isUnsafeTitleExecutionTarget(raw)) continue;
    if (titleFacts.includes(raw)) continue;
    if (item.type === "product_identity") continue;
    const planned = bodySlots.flatMap((s) => s.facts);
    if (planned.some((f) => f === raw || raw.includes(f.slice(0, 12)))) continue;
    const safeOverview: string[] = [];
    pushSafeFact(safeOverview, item);
    pushOverviewIntoBody(safeOverview[0]);
    break;
  }

  // Opening already merged — keep leadFacts empty for leadless plan contract.
  leadFacts = [];
  titleFacts = balancePlanFacts(titleFacts, punctHints);

  // R149 boundary — catalog confirmation prose must never remain as plan fuel.
  const dropCatalog = (facts: string[]) =>
    facts.filter(
      (f) => f.trim() && !isCatalogConfirmationProse(f) && !isNoiseContentIdFact(f),
    );
  titleFacts = dropCatalog(titleFacts);
  leadFacts = [];
  for (const slot of bodySlots) {
    slot.facts = dropCatalog(slot.facts);
    if (slot.factPurposes) {
      slot.factPurposes = slot.facts.map((f) => derivePresentationPurpose(f));
      slot.presentationPurpose = dominantPresentationPurpose(slot.facts);
    }
  }

  const flatBodyAfterDrop = bodySlots.flatMap((s) => s.facts);

  // --- Optional R154 V2 editorial frame (off by default on production) ---
  if (input.editorialFrame === true) {
    const purpose = resolveArticlePurpose({ pack: input.pack, profile: input.profile });
    const coreAngle = resolveCoreAngle({
      pack: input.pack,
      profile: input.profile,
      titleFacts,
    });
    titleFacts = dropCatalog(
      composeTitleFacts({
        titleFacts,
        coreAngle,
        pack: input.pack,
        profile: input.profile,
        max: TITLE_FACT_CAP,
      }),
    );
    const overviewFacts = dropCatalog(
      buildOverviewLeadFacts({
        leadFacts: [],
        purpose,
        coreAngle,
        max: LEAD_FACT_CAP,
      }),
    );

    let bodyForJobs = flatBodyAfterDrop;
    const overviewExtra = overviewFacts.filter((f) => !bodyForJobs.includes(f));
    if (overviewExtra.length > 0) {
      bodyForJobs = [...overviewExtra, ...bodyForJobs];
    }

    const readerBody = allocateReaderJobs({
      bodyFacts: bodyForJobs,
      pack: input.pack,
      depth,
      profile: input.profile,
      leadFacts: [],
    });

    const finalBody =
      readerBody.length > 0
        ? readerBody
        : bodySlots
            .filter((s) => s.facts.length > 0)
            .map((s) => ({
              job: s.job || ARTICLE_PLAN_JOBS.body,
              facts:
                overviewExtra.length > 0 && s === bodySlots[0]
                  ? [...overviewExtra, ...s.facts]
                  : s.facts,
              heading: s.heading ?? null,
            }));

    return {
      schemaVersion: 2,
      materialDepth: depth,
      productTitle: input.productTitle,
      purpose,
      coreAngle,
      title: { job: ARTICLE_PLAN_JOBS.titleV2, facts: titleFacts, heading: null },
      // Leadless: empty lead retained only for transitional ArticlePlan typing.
      lead: { job: ARTICLE_PLAN_JOBS.leadV2, facts: [], heading: null },
      body: finalBody,
    };
  }

  return {
    schemaVersion: 1,
    materialDepth: depth,
    productTitle: input.productTitle,
    title: { job: ARTICLE_PLAN_JOBS.title, facts: titleFacts, heading: null },
    // Leadless write: opening materials live in body; lead.facts always empty.
    lead: { job: ARTICLE_PLAN_JOBS.lead, facts: [], heading: null },
    body: bodySlots.filter((s) => s.facts.length > 0),
  };
}

export function articlePlanAllFacts(plan: ArticlePlan): string[] {
  return [
    ...plan.title.facts,
    ...(plan.lead?.facts ?? []),
    ...plan.body.flatMap((b) => b.facts),
  ];
}

export function materialDepthFromProfile(
  profile: Pick<ProductMaterialProfile, "materialDepth"> | null | undefined,
): ArticlePlanMaterialDepth {
  const d = profile?.materialDepth;
  if (d === "scarce" || d === "rich") return d;
  return "standard";
}
