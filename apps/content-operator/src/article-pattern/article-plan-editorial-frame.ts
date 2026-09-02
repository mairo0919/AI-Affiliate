/**
 * ARTICLE_PLAN V2 — reader-facing editorial frame (Phase 1).
 *
 * Deterministic only: purpose / coreAngle / reader jobs / title compose
 * from EvidencePack + ProductMaterialProfile. Not a new fact source.
 * A/B allowed; C (subjective eval) forbidden.
 */

import type { EvidencePack, EvidencePackItem } from "./evidence-pack.js";
import { projectWriterSafeFactFromPackItem } from "./evidence-pack.js";
import type { ProductMaterialProfile } from "./reference-type-profile.js";
import { classifySemanticEvidence } from "./semantic-evidence.js";
import type { ArticlePlanMaterialDepth, ArticlePlanSlot } from "./article-plan.js";

export type ArticlePurposeId =
  | "cast_centered_intro"
  | "situation_set_overview"
  | "runtime_content_map"
  | "ensemble_feature_map"
  | "series_or_form_map";

export type ArticlePlanPurpose = {
  id: ArticlePurposeId;
  evidenceIds: string[];
  /** Connection framing only — Writer must not copy-pad or invent from this. */
  statement: string;
};

export type CoreAngleRankReason =
  | "discriminative"
  | "quantity"
  | "duration"
  | "cast_structure"
  | "scene_set";

export type ArticlePlanCoreAngle = {
  id: string;
  fact: string;
  evidenceId: string;
  rankReason: CoreAngleRankReason;
};

export type ReaderJobId =
  | "key_features"
  | "notable_details"
  | "structure"
  | "cast"
  | "decision_material"
  | "before_cta";

const PURPOSE_STATEMENTS: Record<ArticlePurposeId, string> = {
  cast_centered_intro: "出演者を中心に、確認できる作品情報を整理する",
  situation_set_overview: "収録シチュエーションの構成を整理する",
  runtime_content_map: "収録時間と作中の展開要素を整理する",
  ensemble_feature_map: "人数・尺・プレイ構成を整理する",
  series_or_form_map: "作品形式と収録内容を整理する",
};

const HEADING_BY_JOB: Record<ReaderJobId, string> = {
  key_features: "主な見どころ",
  notable_details: "収録の詳細",
  structure: "尺と構成",
  cast: "出演",
  decision_material: "確認ポイント",
  before_cta: "ページで確認できること",
};

/** Evaluative / C-class tokens forbidden in Planner templates. */
const FORBIDDEN_EVAL =
  /飽き|楽しめる|必見|満足|格別|見逃せ|魅力的|世界観|究極|最高|おすすめ|買うべき|今すぐ/;

function safeProject(item: EvidencePackItem): string | null {
  return projectWriterSafeFactFromPackItem(item);
}

function normalizeFactKey(f: string): string {
  return f.replace(/\s+/g, "").trim();
}

function eligibleItems(pack: EvidencePack): EvidencePackItem[] {
  return pack.concreteEvidence.filter((e) => e.generationEligible && e.type !== "product_identity");
}

function countSceneLike(pack: EvidencePack): { n: number; ids: string[]; facts: string[] } {
  const ids: string[] = [];
  const facts: string[] = [];
  for (const e of eligibleItems(pack)) {
    const sem = classifySemanticEvidence(e.fact, { sourceType: e.provenance.sourceType });
    if (
      e.type === "scene_or_act" ||
      e.type === "setting_or_situation" ||
      sem.primary === "SCENE_ACTION" ||
      sem.primary === "RELATIONSHIP"
    ) {
      const s = safeProject(e);
      if (!s) continue;
      ids.push(e.id);
      facts.push(s);
    }
  }
  return { n: facts.length, ids, facts };
}

export function resolveArticlePurpose(input: {
  pack: EvidencePack;
  profile?: ProductMaterialProfile | null;
}): ArticlePlanPurpose | null {
  const pack = input.pack;
  const profile = input.profile;
  const scenes = countSceneLike(pack);
  const rep = profile?.performerRepresentation;
  const formN = profile?.productFormFamilies.length ?? 0;
  const durN = profile?.durationFamilies.length ?? 0;
  const qtyN = profile?.quantityFamilies.length ?? 0;
  const perfN = profile?.performerCount ?? pack.performerItems.length;

  const pick = (id: ArticlePurposeId, evidenceIds: string[]): ArticlePlanPurpose | null => {
    const statement = PURPOSE_STATEMENTS[id];
    if (FORBIDDEN_EVAL.test(statement)) return null;
    if (evidenceIds.length === 0) return null;
    return { id, evidenceIds: [...new Set(evidenceIds)].slice(0, 8), statement };
  };

  // Priority: ensemble → situation set → runtime → series/form → cast
  if (
    (rep?.mode === "ensemble" || rep?.mode === "unknown_multi" || (perfN ?? 0) >= 3) &&
    (scenes.n >= 1 || durN > 0 || qtyN > 0)
  ) {
    const ids = [
      ...scenes.ids,
      ...eligibleItems(pack)
        .filter((e) => e.type === "quantity_or_runtime" || e.type === "performer_identity")
        .map((e) => e.id),
    ];
    const p = pick("ensemble_feature_map", ids);
    if (p) return p;
  }

  if (scenes.n >= 3) {
    const p = pick("situation_set_overview", scenes.ids);
    if (p) return p;
  }

  if (durN > 0 || (qtyN > 0 && scenes.n >= 1)) {
    const ids = eligibleItems(pack)
      .filter((e) => e.type === "quantity_or_runtime" || e.type === "scene_or_act")
      .map((e) => e.id);
    const p = pick("runtime_content_map", ids.length ? ids : scenes.ids);
    if (p) return p;
  }

  if (formN > 0 || /ベスト|総集編|COMPLETE|コレクション/i.test(pack.productIdentity.title)) {
    const ids = eligibleItems(pack)
      .filter((e) => e.type === "series_or_event" || e.type === "quantity_or_runtime")
      .map((e) => e.id);
    const titleFacet = pack.productIdentity.titleFacets[0];
    if (ids.length === 0 && titleFacet) {
      const hit = eligibleItems(pack).find((e) => e.fact.includes(titleFacet.slice(0, 8)));
      if (hit) ids.push(hit.id);
    }
    if (ids.length > 0) {
      const p = pick("series_or_form_map", ids);
      if (p) return p;
    }
  }

  if (perfN >= 1 && (rep?.mode === "single" || rep?.mode === "dual_host" || perfN === 2)) {
    const ids = [
      ...pack.performerItems.map((p) => `performer::${p.displayName}`),
      ...eligibleItems(pack)
        .filter((e) => e.type === "performer_identity")
        .map((e) => e.id),
    ];
    const p = pick("cast_centered_intro", ids);
    if (p) return p;
  }

  if (scenes.n >= 2) {
    return pick("situation_set_overview", scenes.ids);
  }

  return null;
}

export function resolveCoreAngle(input: {
  pack: EvidencePack;
  profile?: ProductMaterialProfile | null;
  titleFacts: string[];
}): ArticlePlanCoreAngle | null {
  const pack = input.pack;
  const profile = input.profile;
  const scenes = countSceneLike(pack);
  const candidates: Array<ArticlePlanCoreAngle & { score: number }> = [];

  // Discriminative title facet (long, title-sourced)
  for (const e of eligibleItems(pack)) {
    if (e.provenance.sourceType !== "product_title" && e.type === "performer_identity") continue;
    const fact = safeProject(e);
    if (!fact || fact.length < 10) continue;
    if (/^[\u4e00-\u9fffァ-ヶー]{2,8}$/u.test(fact)) continue; // bare name
    let score = 0;
    let reason: CoreAngleRankReason = "discriminative";
    if (e.provenance.sourceType === "product_title") score += 80;
    if (fact.length >= 16) score += 40;
    if (/ハーレム|ベスト|ノンストップ|写真館|騎乗|逆\d*P/.test(fact)) score += 30;
    if (input.titleFacts.some((t) => normalizeFactKey(t) === normalizeFactKey(fact))) score += 10;
    candidates.push({
      id: `angle::${e.id}`,
      fact,
      evidenceId: e.id,
      rankReason: reason,
      score,
    });
  }

  // Scene set
  if (scenes.n >= 3) {
    candidates.push({
      id: "angle::scene_set",
      fact: scenes.facts[0]!,
      evidenceId: scenes.ids[0]!,
      rankReason: "scene_set",
      score: 70 + scenes.n * 5,
    });
  }

  // Duration / quantity
  for (const e of eligibleItems(pack)) {
    if (e.type !== "quantity_or_runtime") continue;
    const fact = safeProject(e);
    if (!fact) continue;
    const isDur = /\d+\s*(?:時間|分)/.test(fact) || (profile?.durationFamilies.length ?? 0) > 0;
    candidates.push({
      id: `angle::${e.id}`,
      fact,
      evidenceId: e.id,
      rankReason: isDur ? "duration" : "quantity",
      score: isDur ? 65 : 55,
    });
  }

  // Cast structure (not bare single name as sole angle)
  const rep = profile?.performerRepresentation;
  if (rep && (rep.mode === "dual_host" || rep.mode === "ensemble") && rep.combinedLabel) {
    const label = rep.combinedLabel;
    if (!/^[\u4e00-\u9fffァ-ヶー]{2,8}$/u.test(label)) {
      candidates.push({
        id: "angle::cast_structure",
        fact: label,
        evidenceId: pack.performerItems[0]
          ? `performer::${pack.performerItems[0].displayName}`
          : "cast_structure",
        rankReason: "cast_structure",
        score: 50,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  if (!top || top.score < 50) return null;
  // Bare performer-only → null
  if (
    top.rankReason !== "cast_structure" &&
    /^[\u4e00-\u9fffァ-ヶー]{2,12}$/u.test(top.fact) &&
    pack.performerItems.some((p) => p.displayName === top.fact)
  ) {
    return null;
  }
  return {
    id: top.id,
    fact: top.fact,
    evidenceId: top.evidenceId,
    rankReason: top.rankReason,
  };
}

/**
 * Verified title composition — only Evidence-backed facts; no theme padding.
 */
export function composeTitleFacts(input: {
  titleFacts: string[];
  coreAngle: ArticlePlanCoreAngle | null;
  pack: EvidencePack;
  profile?: ProductMaterialProfile | null;
  max?: number;
}): string[] {
  const max = input.max ?? 3;
  const base = [...input.titleFacts].filter(Boolean);
  if (base.length === 0) return base;

  // Strong single facet already — keep EXACT_SURFACE identity
  const primary = base[0]!;
  if (primary.length >= 18 && !/^[\u4e00-\u9fffァ-ヶー]{2,12}$/u.test(primary)) {
    return base.slice(0, max);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (f: string) => {
    const k = normalizeFactKey(f);
    if (!k || seen.has(k) || isCatalogish(f)) return;
    seen.add(k);
    out.push(f);
  };

  for (const f of base) push(f);

  // Compose performer + verified core feature
  if (out.length < max && input.coreAngle) {
    const angle = input.coreAngle.fact;
    if (!seen.has(normalizeFactKey(angle)) && angle.length >= 4) {
      // If title is bare performer, add angle (or swap order: performer + feature)
      push(angle);
    }
  }

  // duration + form from pack if still thin
  if (out.length < 2 && out.length < max) {
    for (const e of eligibleItems(input.pack)) {
      if (e.type !== "quantity_or_runtime") continue;
      const s = safeProject(e);
      if (s && /\d+\s*(?:時間|分)|ノンストップ/.test(s)) {
        push(s);
        break;
      }
    }
  }

  return out.slice(0, max);
}

function isCatalogish(f: string): boolean {
  return /公式ページ|公開ページ|確認できる/.test(f);
}

function classifyReaderBucket(
  fact: string,
  item: EvidencePackItem | undefined,
): ReaderJobId {
  const type = item?.type ?? "";
  const sem = classifySemanticEvidence(fact, {
    sourceType: item?.provenance.sourceType,
  });
  if (type === "performer_identity" || sem.primary === "PERFORMER_IDENTITY") return "cast";
  if (type === "quantity_or_runtime" || sem.primary === "QUANTITY" || sem.primary === "DURATION") {
    return "structure";
  }
  if (type === "series_or_event" || sem.primary === "PRODUCT_FORM" || sem.primary === "EVENT") {
    return "decision_material";
  }
  if (
    type === "scene_or_act" ||
    type === "body_trait" ||
    type === "setting_or_situation" ||
    sem.primary === "SCENE_ACTION" ||
    sem.primary === "BODY_TRAIT"
  ) {
    return "key_features";
  }
  return "notable_details";
}

function targetReaderJobCount(
  depth: ArticlePlanMaterialDepth,
  independentDevelopmentFamilyCount: number,
): number {
  if (depth === "scarce") return independentDevelopmentFamilyCount >= 2 ? 2 : 1;
  if (depth === "standard") {
    return Math.min(3, Math.max(2, independentDevelopmentFamilyCount >= 3 ? 3 : 2));
  }
  // rich — do not force long form when families are thin
  if (independentDevelopmentFamilyCount < 3) return 2;
  if (independentDevelopmentFamilyCount < 4) return 3;
  return Math.min(4, Math.max(3, independentDevelopmentFamilyCount));
}

/**
 * Allocate body facts into reader jobs. No duplicate facts across jobs.
 */
export function allocateReaderJobs(input: {
  bodyFacts: string[];
  pack: EvidencePack;
  depth: ArticlePlanMaterialDepth;
  profile?: ProductMaterialProfile | null;
  leadFacts: string[];
}): ArticlePlanSlot[] {
  const indep = input.profile?.independentDevelopmentFamilyCount ?? 0;
  const targetJobs = targetReaderJobCount(input.depth, indep);
  const used = new Set(input.leadFacts.map(normalizeFactKey));
  const byJob = new Map<ReaderJobId, string[]>();
  const order: ReaderJobId[] = [
    "cast",
    "key_features",
    "structure",
    "notable_details",
    "decision_material",
  ];

  const findItem = (fact: string): EvidencePackItem | undefined =>
    input.pack.concreteEvidence.find((e) => {
      const s = safeProject(e);
      return s && normalizeFactKey(s) === normalizeFactKey(fact);
    });

  for (const fact of input.bodyFacts) {
    const k = normalizeFactKey(fact);
    if (!k || used.has(k) || isCatalogish(fact)) continue;
    used.add(k);
    const job = classifyReaderBucket(fact, findItem(fact));
    const list = byJob.get(job) ?? [];
    list.push(fact);
    byJob.set(job, list);
  }

  // Merge tiny buckets into key_features / notable_details to respect target job count
  const nonEmpty = order.filter((j) => (byJob.get(j)?.length ?? 0) > 0);
  while (nonEmpty.length > targetJobs && nonEmpty.length > 1) {
    // merge last into previous
    const drop = nonEmpty.pop()!;
    const into = nonEmpty[nonEmpty.length - 1] ?? "key_features";
    const dropped = byJob.get(drop) ?? [];
    byJob.set(into, [...(byJob.get(into) ?? []), ...dropped]);
    byJob.delete(drop);
  }

  // If too few jobs but many facts in one bucket, split key_features → notable_details
  let jobs = order.filter((j) => (byJob.get(j)?.length ?? 0) > 0);
  if (jobs.length < targetJobs) {
    const kf = byJob.get("key_features") ?? [];
    if (kf.length >= 4) {
      const mid = Math.ceil(kf.length / 2);
      byJob.set("key_features", kf.slice(0, mid));
      byJob.set("notable_details", [...(byJob.get("notable_details") ?? []), ...kf.slice(mid)]);
      jobs = order.filter((j) => (byJob.get(j)?.length ?? 0) > 0);
    }
  }

  const slots: ArticlePlanSlot[] = [];
  for (const job of order) {
    const facts = byJob.get(job);
    if (!facts?.length) continue;
    if (slots.length >= targetJobs) {
      // append remaining into last slot rather than exceed target (still no dup)
      const last = slots[slots.length - 1]!;
      last.facts = [...last.facts, ...facts];
      continue;
    }
    slots.push({
      job,
      facts,
      heading: HEADING_BY_JOB[job],
    });
  }

  // before_cta only when we have leftover unused eligible structure/cast labels
  // Prefer a single unused quantity/duration or cast fact not already used
  if (slots.length > 0 && input.depth !== "scarce") {
    const leftover: string[] = [];
    for (const e of eligibleItems(input.pack)) {
      const s = safeProject(e);
      if (!s || used.has(normalizeFactKey(s))) continue;
      if (e.type === "quantity_or_runtime" || e.type === "performer_identity") {
        leftover.push(s);
        used.add(normalizeFactKey(s));
        if (leftover.length >= 2) break;
      }
    }
    if (leftover.length > 0 && slots.length < targetJobs + 1) {
      slots.push({
        job: "before_cta",
        facts: leftover,
        heading: HEADING_BY_JOB.before_cta,
      });
    }
  }

  return slots.filter((s) => s.facts.length > 0);
}

export function buildOverviewLeadFacts(input: {
  leadFacts: string[];
  purpose: ArticlePlanPurpose | null;
  coreAngle: ArticlePlanCoreAngle | null;
  max: number;
}): string[] {
  // Keep Evidence facts only — purpose statement is NOT added as a fact.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of input.leadFacts) {
    if (!f?.trim() || isCatalogish(f)) continue;
    const k = normalizeFactKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
    if (out.length >= input.max) break;
  }
  // Prefer including coreAngle fact in overview when not already present
  if (input.coreAngle && out.length < input.max) {
    const k = normalizeFactKey(input.coreAngle.fact);
    if (!seen.has(k) && !isCatalogish(input.coreAngle.fact)) {
      // Put angle early for overview framing
      out.unshift(input.coreAngle.fact);
      if (out.length > input.max) out.pop();
    }
  }
  return out.slice(0, input.max);
}
