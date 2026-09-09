/**
 * Detect upstream Claim quality issues that Editorial repair must not "invent-fix".
 * Example: jammed performer names like 「優梨まいなましろ杏」.
 *
 * Must NOT flag title-rich product/identity claims that merely mention 男優/女優
 * as cast entities inside a scenario (e.g. 「AV男優16名とAV女優16名の…」).
 */

import type { ClaimStatementRef } from "./generation-input-contract.js";

export type BadClaimFinding = {
  claimId: string;
  code: "BAD_INPUT_CLAIM";
  message: string;
};

/** Cast/list field markers — not scenario nouns inside product titles. */
const CAST_FIELD_HINT =
  /出演者／クリエイター|出演者\/クリエイター|^出演は|^出演[：:]|キャスト[：:]|performer\s*:/i;

/** UI chrome that pollutes cast/title scrapes. */
const UI_POLLUTION = /すべて表示する|もっと見る|続きを読む|CLICK HERE|Read more/i;

/** Concrete product/title evidence (quantity, duration, scenario, identity wrappers). */
const TITLE_RICH_EVIDENCE =
  /\d+\s*(?:名|人|時間|作品|分|泊)|1泊2日|乱交|バスツアー|ベロキス|舐め|痴女|わからせ|洗脳|ベスト|収録|独占配信|は公開ページ上で確認できる/;

/**
 * Product/title/trait carriers — protect from cast-jam heuristics.
 * Uses claim kind + factual structure, not character-count hacks alone.
 */
export function isTitleRichClaim(claim: ClaimStatementRef): boolean {
  const s = claim.statement.trim();
  if (!s) return false;
  const kind = (claim.kind ?? "").toLowerCase();
  if (kind === "trait_or_scene" || kind === "identity_name" || kind === "other") {
    if (TITLE_RICH_EVIDENCE.test(s)) return true;
  }
  if (kind === "trait_or_scene") return true;
  // Long product-title wrappers with concrete facets
  if (/は公開ページ上で確認できる/.test(s) && TITLE_RICH_EVIDENCE.test(s)) return true;
  if (/【/.test(s) && TITLE_RICH_EVIDENCE.test(s)) return true;
  if (TITLE_RICH_EVIDENCE.test(s) && s.length >= 40 && !CAST_FIELD_HINT.test(s)) return true;
  return false;
}

/** Dedicated cast/list claims where jammed-name detection applies strongly. */
export function isCastListClaim(claim: ClaimStatementRef): boolean {
  const s = claim.statement.trim();
  const kind = (claim.kind ?? "").toLowerCase();
  if (kind === "performer" || kind === "cast") return true;
  if (CAST_FIELD_HINT.test(s)) return true;
  return false;
}

/** Name payload inside quotes, or cast-line remainder. */
function extractCastNamePayload(statement: string): string {
  const quoted = [...statement.matchAll(/「([^」]+)」/g)].map((m) => m[1]!);
  if (quoted.length > 0) {
    return quoted.join("");
  }
  return statement
    .replace(/^出演者／クリエイターとして/, "")
    .replace(/^出演者\/クリエイターとして/, "")
    .replace(/^出演は/, "")
    .replace(/が記載されている。?$/, "")
    .replace(/が公開されている。?$/, "")
    .trim();
}

/**
 * True when a cast name blob looks like multiple names jammed without separators.
 * Single short performer names (松本いちか) must NOT match.
 */
export function looksLikeJammedCastNames(namePayload: string): boolean {
  const raw = namePayload.trim();
  if (!raw) return false;
  if (/[・、，,]/.test(raw)) return false; // explicit list separators → OK
  const compact = raw.replace(/[\s「」『』【】[\]()（）]/g, "");
  // Pure CJK/kana blob long enough to be two+ names smashed together
  if (/^[\u3040-\u30ff\u4e00-\u9faf]{8,}$/.test(compact)) return true;
  return false;
}

/**
 * Returns findings when Claims look corrupted. Caller should stop as BAD_INPUT_CLAIM
 * and must not invent missing performers/settings in targeted repair.
 */
export function detectBadInputClaims(claims: ClaimStatementRef[]): BadClaimFinding[] {
  const findings: BadClaimFinding[] = [];
  for (const c of claims) {
    const s = c.statement.trim();
    if (!s) continue;

    if (UI_POLLUTION.test(s)) {
      findings.push({
        claimId: c.id,
        code: "BAD_INPUT_CLAIM",
        message: `Claim appears to include UI chrome pollution: ${s.slice(0, 80)}`,
      });
      continue;
    }

    // Title-rich product/scenario claims: never treat 男優/女優 scenario nouns as jammed cast.
    if (isTitleRichClaim(c) && !isCastListClaim(c)) {
      continue;
    }

    // Cast/list claims (and non-title cast-field lines): inspect name payload only.
    if (isCastListClaim(c)) {
      const payload = extractCastNamePayload(s);
      if (looksLikeJammedCastNames(payload)) {
        findings.push({
          claimId: c.id,
          code: "BAD_INPUT_CLAIM",
          message: `Claim appears to jam multiple names without separators: ${s.slice(0, 80)}`,
        });
      }
    }
  }
  return findings;
}
