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
  if (f.length > 32 && !/\s|\u3000/u.test(f)) {
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

/**
 * Catalog / genre shells that must not replace SOURCE work themes in title.facts.
 * Used only as last-resort fallback when no work-specific SOURCE theme exists.
 */
export function isGenericTitleFallbackFact(fact: string): boolean {
  const t = (fact ?? "").trim();
  if (!t) return true;
  return /^(?:ベスト・総集編|ベストと総集編|女優ベスト・総集編|単体作品|寝取り・寝取られ・NTR|寝取り・寝取られ|NTR|巨乳|人妻|人妻・主婦|熟女|美少女|中出し|BEST)$/iu.test(
    t,
  );
}

function sourceContainsContiguous(source: string, candidate: string): boolean {
  if (!source || !candidate) return false;
  if (source.includes(candidate)) return true;
  return source.replace(/\s+/gu, "").includes(candidate.replace(/\s+/gu, ""));
}

function scoreSourceTitleTheme(candidate: string): number {
  const t = candidate.trim();
  let s = Math.min(t.length, 28);
  if (/(?:BEST|ベスト第?\d*弾|家政婦|元カノ|義父|実写化|クンニ|メスサド|再会|家出|弟の嫁)/u.test(t)) {
    s += 24;
  }
  if (/(?:BEST|ベスト)/u.test(t) && t.length >= 8) s += 10;
  if (isGenericTitleFallbackFact(t)) s -= 80;
  if (t.length > 32) s -= 12;
  // Residual clause glue — keep as body, not title noun.
  if (/(?:して|した|してくる|くる|され|させ|誘惑)/u.test(t)) s -= 60;
  if (/^[ぁ-ん]/u.test(t)) s -= 40;
  return s;
}

/**
 * Extract title-safe work themes as contiguous SOURCE substrings only.
 * Never invents tokens that are not present in the official source string.
 */
export function extractSourceTitleSafeThemes(source: string): string[] {
  const src = (source ?? "").trim();
  if (src.length < 4) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 4 || t.length > 36) return;
    if (seen.has(t)) return;
    if (!sourceContainsContiguous(src, t)) return;
    if (isGenericTitleFallbackFact(t)) return;
    // Bare compilation stem without edition/brand (e.g. mid-slice 「作品BEST」).
    if (/^作品(?:BEST|ベスト)$/u.test(t)) return;
    if (/^Vol\.?\s*\d+$/iu.test(t)) return;
    // Mid-clause fragments and verb glue are not title nouns (even if short enough
    // to slip under isUnsafeTitleExecutionTarget's length>=20 gate).
    if (/(?:して|した|してくる|され|させ)/u.test(t)) return;
    if (/(?:誘惑)/u.test(t) && !/(?:BEST|ベスト|家政婦|元カノ|再会)/u.test(t)) return;
    if (/^[ぁ-ん]/u.test(t)) return;
    // Dialogue / question crumbs from synopsis are not title axes.
    if (/(?:すいません|ですか|なのか|ください|ありがとう)/u.test(t)) return;
    if (/(?:なの|あり|など|ほしい|しまう|しまった)$/u.test(t)) return;
    if (/(?:なんや|ヤバい|やばい|やわ|やねん|お終|オシマイ|ワシ)/u.test(t)) return;
    if (/\d+\s*時$/u.test(t) && !/\d+\s*時間/u.test(t)) return;
    if (/[「」]/.test(t)) return;
    // Truncation after censor marks (クリ○リス → リス…).
    const at = src.indexOf(t);
    if (at > 0 && /[○●\*※]/.test(src[at - 1]!)) return;
    // Cut mid-hiragana / mid-quantity (セックスレスな|戸川なみ 4).
    const next = at >= 0 ? src[at + t.length] : undefined;
    if (next && /[ぁ-ん]/.test(next) && /[ぁ-ん]$/u.test(t)) return;
    if (next && /[時分回発人本]/u.test(next) && /\d+$/u.test(t)) return;
    if (isUnsafeTitleExecutionTarget(t)) return;
    if (!isTitleSafeExecutionTarget(t)) return;
    if (isTitleClauseFragment(t)) return;
    seen.add(t);
    out.push(t);
  };

  // Already compact / title-safe SOURCE surface (single token — not spaced dumps).
  if (
    !isUnsafeTitleExecutionTarget(src) &&
    isTitleSafeExecutionTarget(src) &&
    src.length <= 36 &&
    !/\s|\u3000/u.test(src) &&
    !/(?:して|した|してくる|され|させ)/u.test(src)
  ) {
    push(src);
  }

  const legacy = compactTitleDisplaySurface(src);
  if (legacy) push(legacy);

  // Contiguous work-form / situation patterns attested in SOURCE (prefer these).
  const patterns: RegExp[] = [
    /[\u4e00-\u9fffァ-ヶーA-Za-z*○●\d]{2,28}(?:BEST|ベスト)(?:第?\d+弾)?(?:\d+\s*時間)?/gu,
    /\d+\s*作品(?:BEST|ベスト)/gu,
    /(?:ベスト|総集編)第?\d+弾/gu,
    /(?:エスワン|MOODYZ|S1|kawaii\*?)[^\s。！？]{0,20}ベスト(?:第?\d+弾)?/gu,
    /(?:吸引式クンニ|クリ[○●]?リス吸引式クンニ)/gu,
    /(?:漫画NTR実写化(?:作品)?(?:\d+\s*時間)?|NTR実写化(?:作品)?)/gu,
    /[\u4e00-\u9fffァ-ヶー]{2,16}(?:家政婦|先生|義父|実写化|クンニ)/gu,
    /(?:元カノと\d+年ぶりに再会|夫婦喧嘩|弟の嫁さん|セックスレスの妻|メスサド誘惑)/gu,
  ];
  const patternHits: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const before = out.length;
      push(m[0]!);
      if (out.length > before) patternHits.push(m[0]!);
    }
  }
  if (patternHits.length > 0) {
    return [...out]
      .sort((a, b) => scoreSourceTitleTheme(b) - scoreSourceTitleTheme(a))
      .slice(0, 6);
  }

  // Segment splits (still must be contiguous SOURCE).
  for (const seg of src.split(/[。！？\n|｜\s\u3000]+/u)) {
    const s = seg.trim();
    if (s.length >= 4) push(s);
  }

  if (out.length > 0) {
    return [...out].sort((a, b) => scoreSourceTitleTheme(b) - scoreSourceTitleTheme(a)).slice(0, 6);
  }

  // Longest title-safe contiguous windows (SOURCE substring only) — last resort.
  const maxLen = Math.min(src.length, 28);
  for (let len = maxLen; len >= 6; len -= 1) {
    let addedAtLen = 0;
    for (let i = 0; i + len <= src.length; i += 1) {
      const sub = src.slice(i, i + len).trim();
      if (sub.length < 6) continue;
      if (/^[。！？、\sぁ-ん]/.test(sub) || /[。！？、\s]$/.test(sub)) continue;
      if (/(?:して|した|してくる|され|させ)/u.test(sub)) continue;
      // Prefer token boundaries (start of string / whitespace / punct).
      if (i > 0 && !/[\s\u3000。！？、・]/.test(src[i - 1]!)) continue;
      const before = out.length;
      push(sub);
      if (out.length > before) {
        addedAtLen += 1;
        if (addedAtLen >= 2) break;
      }
    }
    if (out.length >= 6) break;
  }

  return [...out].sort((a, b) => scoreSourceTitleTheme(b) - scoreSourceTitleTheme(a)).slice(0, 6);
}

/**
 * Prefer a title-safe SOURCE substring when the raw fact is clause-like / unsafe.
 */
export function toSourceTitleSafeFact(fact: string): string | null {
  const f = (fact ?? "").trim();
  if (!f) return null;
  const display = toTitleDisplayFact(f);
  if (
    display &&
    !isUnsafeTitleExecutionTarget(display) &&
    isTitleSafeExecutionTarget(display) &&
    !isTitleClauseFragment(display)
  ) {
    return display;
  }
  const themes = extractSourceTitleSafeThemes(f);
  return themes[0] ?? null;
}

/** Resolve Planner title surface: compact SEMANTIC_ONLY fragments when possible. */
export function toTitleDisplayFact(fact: string): string | null {
  const f = (fact ?? "").trim();
  if (!f) return null;
  const compact = compactTitleDisplaySurface(f);
  if (compact) return compact;
  // Spaced / multi-clause official titles → contiguous SOURCE theme noun first.
  if ((/\s|\u3000/u.test(f) || f.length > 28) && (isUnsafeTitleExecutionTarget(f) || f.length > 28 || /\s|\u3000/u.test(f))) {
    const themes = extractSourceTitleSafeThemes(f);
    if (themes[0]) return themes[0];
  }
  if (isTitleClauseFragment(f)) {
    // Clause fragments may still yield a contiguous SOURCE noun theme.
    const themes = extractSourceTitleSafeThemes(f);
    return themes[0] ?? null;
  }
  // Unsafe long SOURCE clauses → shorten to contiguous title-safe theme.
  if (isUnsafeTitleExecutionTarget(f) || !isTitleSafeExecutionTarget(f)) {
    const themes = extractSourceTitleSafeThemes(f);
    return themes[0] ?? null;
  }
  return f;
}

export function classifyTitleMaterialKind(fact: string): TitleMaterialKind {
  const f = (fact ?? "").trim();
  if (!f) return "BODY_ONLY";
  if (
    isUnsafeTitleExecutionTarget(f) &&
    !compactTitleDisplaySurface(f) &&
    extractSourceTitleSafeThemes(f).length === 0
  ) {
    return "BODY_ONLY";
  }
  if (isTitleClauseFragment(f)) return "SEMANTIC_ONLY";
  const compact = compactTitleDisplaySurface(f);
  // Needs compaction to become display-ready
  if (compact && compact !== f) return "SEMANTIC_ONLY";
  if (isUnsafeTitleExecutionTarget(f) && extractSourceTitleSafeThemes(f).length > 0) {
    return "SEMANTIC_ONLY";
  }
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
  // Eligibility is for the display surface itself. Long SOURCE clauses that only
  // become safe after compaction must be compacted before they enter title.facts.
  if (display !== raw) return false;
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
