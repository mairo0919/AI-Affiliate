/**
 * R150 — Title slot eligibility (Planner-only).
 *
 * Representation labels (combinedLabel, neutralMultiLabel, etc.) are body-overview
 * tools (formerly lead) — not automatic title candidates unless SOURCE product
 * title attests them.
 *
 * Title material kinds (minimal, no new schema product):
 * - DISPLAY_READY: noun/label usable as title surface as-is
 * - SEMANTIC_ONLY: meaning OK for title only after compactDisplay (or body)
 * - BODY_ONLY: prefer body explanation
 */

import type { PerformerRepresentation } from "./performer-representation.js";
import {
  isTitleSafeExecutionTarget,
  isUnsafeTitleExecutionTarget,
} from "./writer-evidence-filter.js";
import {
  balanceReaderFacingPunctuation,
  repairBracketSplitPlanFacts,
  hasOrphanPairedPunctuation,
} from "./punctuation-balance.js";

export {
  balanceReaderFacingPunctuation,
  repairBracketSplitPlanFacts,
  hasOrphanPairedPunctuation,
} from "./punctuation-balance.js";

export type TitleMaterialKind = "DISPLAY_READY" | "SEMANTIC_ONLY" | "BODY_ONLY";

/**
 * Unfinished / continuative clause fragments — not DISPLAY_READY title nouns.
 * Provenance-aware alternative to a Japanese grammar parser.
 */
export function isTitleClauseFragment(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  if (/(?:を迎え|迎えて|しており|しながら|しつつ|てから|にあたり|にあたって)$/u.test(t)) {
    return true;
  }
  // Continuative verb ending without noun closure (short title crumbs)
  if (t.length >= 8 && /(?:して|していて|なり|なりつつ|できず)$/u.test(t)) return true;
  return false;
}

/**
 * SOURCE-substring compact for title DISPLAY (no invented facts).
 * e.g. 「AVデビューから8周年を迎え」→「デビュー8周年」
 */
export function compactTitleDisplaySurface(fact: string): string | null {
  const f = (fact ?? "").trim();
  if (!f) return null;
  let m = f.match(/^(?:AV)?デビューから(\d+)周年を迎え(?:て|、)?$/u);
  if (m) return `デビュー${m[1]}周年`;
  m = f.match(/^(?:AV)?デビューから(\d+)周年$/u);
  if (m) return `デビュー${m[1]}周年`;
  m = f.match(/^(\d+)周年を迎え(?:て)?$/u);
  if (m) return `${m[1]}周年`;
  m = f.match(/^(?:AV)?デビュー(\d+)周年$/u);
  if (m) return `デビュー${m[1]}周年`;
  // Long work-form clause → trailing SOURCE noun (e.g. …究極のピストン作品).
  // Substring only — no invented modifiers. Skip spaced product titles.
  if (f.length > 32 && !/\s|　/u.test(f)) {
    // Clause-like dumps only (not already-compact labels).
    if (/(?:させる|した|する|ない|れる|られる|て|を|が|と言)/u.test(f)) {
      m = f.match(
        /((?:[\u4e00-\u9fffァ-ヶー]{2,10}の)?[\u4e00-\u9fffァ-ヶー]{2,12}(?:作品|ベスト))$/u,
      );
      if (m?.[1] && m[1].length >= 4 && m[1].length <= 20 && f.includes(m[1])) {
        return m[1];
      }
    }
  }
  return null;
}

/** Resolve Planner title surface: compact SEMANTIC_ONLY fragments when possible. */
export function toTitleDisplayFact(fact: string): string | null {
  const f = (fact ?? "").trim();
  if (!f) return null;
  const compact = compactTitleDisplaySurface(f);
  if (compact) return compact;
  if (isTitleClauseFragment(f)) return null;
  return f;
}

export function classifyTitleMaterialKind(fact: string): TitleMaterialKind {
  const f = (fact ?? "").trim();
  if (!f) return "BODY_ONLY";
  if (isUnsafeTitleExecutionTarget(f) && !compactTitleDisplaySurface(f)) return "BODY_ONLY";
  if (isTitleClauseFragment(f)) return "SEMANTIC_ONLY";
  const compact = compactTitleDisplaySurface(f);
  // Needs compaction to become display-ready
  if (compact && compact !== f) return "SEMANTIC_ONLY";
  return "DISPLAY_READY";
}

export function isSourceAttestedCombinedTitle(
  productTitle: string,
  combinedLabel: string,
): boolean {
  const title = (productTitle ?? "").trim();
  const label = (combinedLabel ?? "").trim();
  if (!title || !label) return false;
  const norm = (s: string) => s.replace(/\s+/g, "");
  if (norm(title).includes(norm(label))) return true;
  const [a, b] = label.split(/と/u).map((p) => p.trim());
  if (a && b && title.includes(a) && title.includes(b) && /と/u.test(title)) return true;
  return false;
}

/** True when fact is an internal representation label — not title-eligible by default. */
export function isRepresentationDerivedTitleCandidate(
  fact: string,
  rep: PerformerRepresentation,
  productTitle: string,
): boolean {
  const f = (fact ?? "").trim();
  if (!f) return false;

  if (rep.combinedLabel && f === rep.combinedLabel) {
    return !isSourceAttestedCombinedTitle(productTitle, f);
  }
  if (rep.neutralMultiLabel && f === rep.neutralMultiLabel) return true;
  if (rep.representationLabel && f === rep.representationLabel) {
    if (rep.mode === "dual_host") {
      return !isSourceAttestedCombinedTitle(productTitle, f);
    }
    if (rep.mode === "ensemble" || rep.mode === "collection" || rep.mode === "unknown_multi") {
      return !productTitle.includes(f.slice(0, Math.min(12, f.length)));
    }
  }
  if (rep.collectionLabel && f === rep.collectionLabel) return true;
  return false;
}

export function isTitleEligibleFact(
  fact: string,
  input: { productTitle: string; rep?: PerformerRepresentation },
): boolean {
  const raw = (fact ?? "").trim();
  if (raw.length < 2) return false;
  // FANZA content-id scraps are never title execution targets
  if (/^[a-z]{2,8}\d{0,5}$/i.test(raw)) return false;
  const display = toTitleDisplayFact(raw);
  if (!display) return false;
  if (isUnsafeTitleExecutionTarget(display)) return false;
  if (!isTitleSafeExecutionTarget(display)) return false;
  if (input.rep && isRepresentationDerivedTitleCandidate(display, input.rep, input.productTitle)) {
    return false;
  }
  return true;
}

/**
 * Lightweight final-title surface checks (no Japanese grammar parser).
 * Uses shape + whitespace patterns only.
 */
export function validateTitleSurfaceRealization(title: string): {
  ok: boolean;
  codes: string[];
} {
  const t = (title ?? "").trim();
  const codes: string[] = [];
  if (!t) return { ok: false, codes: ["EMPTY_TITLE"] };
  const compact = t.replace(/\s+/g, "");
  if (isTitleClauseFragment(compact) || isTitleClauseFragment(t)) {
    codes.push("TITLE_UNFINISHED_FRAGMENT");
  }
  if (/(?:を迎え|迎えて|しており|しながら)\s*$/u.test(t)) {
    codes.push("TITLE_UNFINISHED_FRAGMENT");
  }
  const parts = t.split(/\s+/u).filter((p) => p.length > 0);
  // Bare keyword concatenation: ≥3 whitespace tokens and almost no linking particles
  if (parts.length >= 3 && !/[のとへにあでを]/u.test(t)) {
    codes.push("TITLE_KEYWORD_CONCAT");
  }
  return { ok: codes.length === 0, codes: [...new Set(codes)] };
}
