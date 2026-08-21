/**
 * Semantic contribution family / subsumption — product-agnostic.
 *
 * Exact facetKey identity is necessary but not sufficient for reuse detection.
 * This module adds:
 * - scene stem subsumption (大乱交 ⊃ 乱交)
 * - quantity equivalence (same digits+unit)
 * - duration equivalence (same absolute minutes: 8時間 ≡ 480分)
 * - composite lock: duration + co-occurring *trackable* valuables in one segment
 *   → restating any locked component later is not information gain
 *
 * Asymmetry:
 * - lead used only duration → body may introduce a new scene sibling
 * - lead used duration+scene together → body may not restate either alone
 *
 * Over-detection guard: only track quantity / duration / plan-known facets.
 * Weak catalog tokens (参加/企画/ファン/展開…) never enter consumed/locks.
 */

import { facetKey, observeFacetsInText } from "./informational-contribution.js";
import { contributionFacetPresent } from "./contribution-compliance.js";

const QTY_RE = /^\d+(?:名|時間|作品|分|人)$/;
const DURATION_RE = /^\d+泊\d+日$/;
const RUNTIME_HOURS_RE = /^(\d+)時間$/;
const RUNTIME_MINUTES_RE = /^(\d+)分$/;

/** Absolute runtime in minutes when facet is N時間 or N分; else null. */
export function runtimeDurationMinutes(facet: string): number | null {
  const f = facetKey(facet);
  const h = f.match(RUNTIME_HOURS_RE);
  if (h) {
    const n = Number(h[1]);
    return Number.isFinite(n) && n >= 0 ? n * 60 : null;
  }
  const m = f.match(RUNTIME_MINUTES_RE);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/** Tokens that must never drive semantic reuse / composite locks. */
const WEAK_FACET_RE =
  /^(ページ|作品|公開|情報|状態|独占|シリーズ|メーカー|レーベル|参加|企画|ファン|展開|イベント|特別|位置|一環|目指|内容|魅力|満足|収録|中心|まとめ|厳選|ボリューム|長時間|演技|特徴|ジャンル|向け|楽し|味わ|存分|彼女|本作品|ベスト|ベスト版|av|moodyz)$/i;

export type ContributionSemanticNode = {
  facet: string;
  key: string;
  kind: "quantity" | "duration" | "scene" | "other";
};

export function classifyFacetKind(facet: string): ContributionSemanticNode["kind"] {
  const f = facet.replace(/\s+/g, "");
  if (DURATION_RE.test(f)) return "duration";
  if (QTY_RE.test(f)) return "quantity";
  if (f.length >= 2 && !isWeakFacet(f)) return "scene";
  return "other";
}

export function isWeakFacet(facet: string): boolean {
  const f = facetKey(facet);
  if (f.length < 2) return true;
  if (QTY_RE.test(f) || DURATION_RE.test(f)) return false;
  if (WEAK_FACET_RE.test(f)) return true;
  // Latin micro-tokens (av, id) are noise; Japanese 2-char stems (乱交 etc.) are meaningful
  if (/^[a-z0-9]{1,3}$/i.test(f)) return true;
  return false;
}

export function isQuantityFacet(facet: string): boolean {
  return QTY_RE.test(facet.replace(/\s+/g, ""));
}

export function isDurationFacet(facet: string): boolean {
  return DURATION_RE.test(facet.replace(/\s+/g, ""));
}

/**
 * Independent informational family for lead budget / development reserve.
 * Product-agnostic scene/qty buckets — not article templates.
 */
export function contributionFamilyKey(facet: string): string {
  const f = facet.replace(/\s+/g, "");
  if (/^\d+泊\d+日$/.test(f)) return "family:duration";
  if (/^\d+名$/.test(f) || /^\d+人$/.test(f)) return "family:participants";
  if (/^\d+時間$/.test(f) || /^\d+分$/.test(f)) return "family:runtime";
  if (/^\d+作品$/.test(f)) return "family:work_count";
  if (/乱交/.test(f)) return "family:orgy_event";
  if (/発掘|育成/.test(f)) return "family:purpose_scout";
  if (/ベロキス|キス/.test(f)) return "family:kiss";
  if (/舐め|イヤラ/.test(f)) return "family:lick";
  if (/セックス|生ハメ/.test(f)) return "family:sex_act";
  if (/ピストン/.test(f)) return "family:piston";
  if (/潮/.test(f)) return "family:squirting";
  if (/ナンパ/.test(f)) return "family:pickup";
  if (/メスガキ/.test(f)) return "family:mesugaki";
  if (/敏感|感度|超敏感|巨乳|Hカップ/.test(f)) return "family:body_trait";
  if (/バスツアー|ツアー/.test(f)) return "family:tour_series";
  if (/わからせ|痴女/.test(f)) return "family:discipline";
  if (/姉妹|洗脳/.test(f)) return "family:brainwash_sisters";
  if (/性玩具/.test(f)) return "family:toy_prop";
  if (/親父|濃厚/.test(f)) return "family:elder_scene";
  return `family:other:${facetKey(f)}`;
}

export function isSettingFamilyKey(key: string): boolean {
  return (
    key === "family:participants" ||
    key === "family:duration" ||
    key === "family:runtime" ||
    key === "family:work_count"
  );
}

export function countIndependentFamilies(facets: Iterable<string>): number {
  return new Set([...facets].map((f) => contributionFamilyKey(f))).size;
}

/** Facets eligible for semantic reuse / composite tracking. */
export function isTrackableFacet(facet: string, planFacets?: Iterable<string>): boolean {
  const f = facetKey(facet);
  if (f.length < 2) return false;
  if (QTY_RE.test(f) || DURATION_RE.test(f)) return true;
  if (planFacets) {
    const plan = [...planFacets].map(facetKey);
    if (
      plan.some(
        (p) =>
          p === f ||
          facetsSemanticallyEquivalent(f, p) ||
          sceneSubsumes(p, f) ||
          sceneSubsumes(f, p),
      )
    ) {
      // Plan-owned facets are trackable unless pure weak catalog noise
      return !WEAK_FACET_RE.test(f);
    }
  }
  // Open observation without plan membership: only qty/duration (already handled) —
  // do not treat free-text scenes as trackable (over-detection).
  return false;
}

/**
 * Scene subsumption: longer form with optional intensifier prefix covers stem.
 * 大乱交 ⊃ 乱交, 超敏感 ⊃ 敏感. Not for quantities.
 */
export function sceneSubsumes(parent: string, child: string): boolean {
  const p = parent.replace(/\s+/g, "");
  const c = child.replace(/\s+/g, "");
  if (p.length < 2 || c.length < 2) return false;
  if (isQuantityFacet(p) || isQuantityFacet(c) || isDurationFacet(p) || isDurationFacet(c)) {
    return false;
  }
  if (isWeakFacet(p) || isWeakFacet(c)) return false;
  if (p === c) return true;
  const strip = (s: string) => s.replace(/^[大超激濃]/, "");
  const ps = strip(p);
  const cs = strip(c);
  if (ps === c && p.length > c.length) return true;
  if (ps === cs && p.length > c.length && cs.length >= 2) return true;
  // suffix containment for short stems (乱交 in 大乱交 / xx乱交)
  if (p.endsWith(c) && c.length >= 2 && p.length - c.length <= 2) return true;
  return false;
}

/** True when a and b denote the same informational atom (incl. scene family). */
export function facetsSemanticallyEquivalent(a: string, b: string): boolean {
  const ka = facetKey(a);
  const kb = facetKey(b);
  if (ka === kb) return true;
  if (sceneSubsumes(a, b) || sceneSubsumes(b, a)) return true;
  const da = runtimeDurationMinutes(ka);
  const db = runtimeDurationMinutes(kb);
  if (da != null && db != null && da === db) return true;
  return false;
}

/**
 * candidate is "already said" given consumed facets:
 * - exact / equivalent
 * - child of a consumed parent (大乱交 consumed → 乱交 blocked)
 * - component of a locked composite (duration+scene bundle)
 */
export function isSemanticRestatement(
  candidate: string,
  consumed: Iterable<string>,
): boolean {
  const cand = facetKey(candidate);
  if (cand.length < 2 || isWeakFacet(cand)) return false;
  const consumedList = [...consumed].map((x) => facetKey(x)).filter((x) => x.length >= 2 && !isWeakFacet(x));
  for (const prev of consumedList) {
    if (facetsSemanticallyEquivalent(candidate, prev)) return true;
    // parent consumed → child restatement
    if (sceneSubsumes(prev, candidate)) return true;
  }
  return false;
}

export type CompositeLock = {
  /** Facets locked together because they co-occurred as one proposition */
  lockedKeys: string[];
  reason: "duration_scene_bundle" | "multi_quantity_bundle";
};

/**
 * Detect composite locks from trackable observed facets only.
 * duration + ≥1 other trackable valuable → lock those co-occurring valuables.
 */
export function detectCompositeLocks(
  observedFacets: string[],
  planFacets?: Iterable<string>,
): CompositeLock[] {
  const keys = [
    ...new Set(
      observedFacets
        .map(facetKey)
        .filter((k) => isTrackableFacet(k, planFacets)),
    ),
  ];
  const locks: CompositeLock[] = [];
  const hasDuration = keys.some((k) => DURATION_RE.test(k));
  const valuables = keys.filter((k) => {
    const kind = classifyFacetKind(k);
    return kind === "duration" || kind === "quantity" || kind === "scene";
  });
  if (hasDuration && valuables.length >= 2) {
    locks.push({
      lockedKeys: valuables,
      reason: "duration_scene_bundle",
    });
  }
  const qtys = keys.filter((k) => QTY_RE.test(k));
  if (qtys.length >= 2) {
    locks.push({ lockedKeys: qtys, reason: "multi_quantity_bundle" });
  }
  return locks;
}

/**
 * Expand observed lead facets into the full consumed set for later segments.
 * Includes scene-family closure + composite lock members — plan-scoped only.
 */
export function expandConsumedFacets(input: {
  segmentText: string;
  /** Optional known plan facets to close against (lead required / all plan) */
  planFacets?: string[];
}): {
  observed: string[];
  consumed: Set<string>;
  locks: CompositeLock[];
} {
  const plan = (input.planFacets ?? []).map(facetKey).filter((k) => k.length >= 2 && !isWeakFacet(k));
  const rawObserved: string[] = observeFacetsInText(input.segmentText)
    .map(facetKey)
    .filter((k) => k.length >= 2);

  // Plan facets literally present in the segment count as observed (even if extractor missed them)
  for (const p of input.planFacets ?? []) {
    if (contributionFacetPresent(input.segmentText, p)) {
      rawObserved.push(facetKey(p));
    }
  }

  // Only trackable observations count (qty/duration/plan family)
  const observed = [...new Set(rawObserved.filter((k) => isTrackableFacet(k, plan)))];
  const consumed = new Set(observed);

  // Close scene family against plan + observed trackables
  const universe = [...new Set([...observed, ...plan])];
  for (const a of [...consumed]) {
    for (const b of universe) {
      if (!isTrackableFacet(b, plan)) continue;
      if (sceneSubsumes(a, b) || facetsSemanticallyEquivalent(a, b)) {
        consumed.add(b);
      }
    }
  }

  const locks = detectCompositeLocks([...consumed], plan);
  for (const lock of locks) {
    for (const k of lock.lockedKeys) consumed.add(k);
  }

  return { observed, consumed, locks };
}

/**
 * Body facet is illicit if it restates consumed lead semantics
 * (exact, equivalent, child-of-parent, or locked composite component).
 */
export function bodyFacetIllicitlyRestates(input: {
  bodyFacet: string;
  leadConsumed: Set<string>;
  leadLocks: CompositeLock[];
  planFacets?: Iterable<string>;
}): boolean {
  if (!isTrackableFacet(input.bodyFacet, input.planFacets)) return false;
  if (isSemanticRestatement(input.bodyFacet, input.leadConsumed)) return true;
  const bk = facetKey(input.bodyFacet);
  for (const lock of input.leadLocks) {
    if (lock.lockedKeys.some((k) => facetsSemanticallyEquivalent(k, input.bodyFacet))) {
      return true;
    }
    if (lock.lockedKeys.includes(bk)) return true;
  }
  return false;
}

/** Signature for repeated plan-failure detection (stable, order-independent). */
export function planFailureSignature(input: {
  codes: string[];
  reusedFacets: string[];
  missingFacets: string[];
}): string {
  const codes = [...new Set(input.codes)].sort().join(",");
  const reused = [...new Set(input.reusedFacets.map(facetKey).filter((k) => !isWeakFacet(k)))]
    .sort()
    .join("|");
  const missing = [...new Set(input.missingFacets.map(facetKey))].sort().join("|");
  return `${codes}::reuse=${reused}::miss=${missing}`;
}
