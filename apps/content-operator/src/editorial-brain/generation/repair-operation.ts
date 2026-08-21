/**
 * Repair operation decision table — SSOT.
 * Prompt must not freely choose operations; this module decides.
 */

import { hasEvaluativeRelation } from "../shadow/predicate-families.js";
import type { InformationalContribution } from "./informational-contribution.js";
import {
  countConsumedOverlap,
  facetKey,
  observeFacetsInText,
} from "./informational-contribution.js";
import type { RepairTarget } from "./repair-target.js";

export type RepairOperation =
  | "KEEP"
  | "REWRITE"
  | "DELETE"
  | "COMPRESS"
  | "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL";

export type RepairOperationDecision = {
  segmentId: string;
  operation: RepairOperation;
  reason: string;
  /** When REPLACE: contributions to inject */
  replaceWith: InformationalContribution[];
  requiresLlm: boolean;
  /** Decision-table row id for diagnostics */
  ruleId: string;
};

/** Weak / stop facets that must not count as usable REPLACE contributions. */
const WEAK_FACET_RE =
  /^(ページ|公開|情報|作品|内容|確認|記載|状態|配信|販売|タイトル|メーカー|レーベル|シリーズ|出演|クリエイター)$/;

const SETTING_HINT_RE = /舞台|ロケ|温泉|旅館|学園|教室|オフィス|プール|水着|ナンパ|写真館|生放送/;

export function isStrongUnusedContribution(c: InformationalContribution): boolean {
  const f = c.facet.trim();
  if (f.length < 3) return false;
  if (WEAK_FACET_RE.test(f)) return false;
  if (/^\d+$/.test(f)) return false;
  return true;
}

export function filterStrongUnused(
  unused: InformationalContribution[],
): InformationalContribution[] {
  return unused.filter(isStrongUnusedContribution);
}

/**
 * Detect whether segment text still has a non-evaluative factual core
 * grounded in allowed facets / claim statements.
 */
export function hasFactualCore(input: {
  text: string;
  allowedFacets: string[];
}): boolean {
  const allowedHit = input.allowedFacets.some((a) => a.length >= 2 && input.text.includes(a));
  if (allowedHit) return true;
  const facets = observeFacetsInText(input.text);
  const allowed = new Set(input.allowedFacets.map(facetKey));
  const grounded = facets.filter(
    (f) =>
      allowed.has(facetKey(f)) ||
      [...allowed].some((a) => a.includes(facetKey(f)) || facetKey(f).includes(a)),
  );
  return grounded.length >= 1;
}

/**
 * Explicit setting-like unused contribution (for NAME_DERIVED REPLACE eligibility).
 */
export function hasExplicitSettingContribution(
  unused: InformationalContribution[],
): InformationalContribution[] {
  return filterStrongUnused(unused).filter(
    (c) => SETTING_HINT_RE.test(c.facet) || SETTING_HINT_RE.test(c.id),
  );
}

/**
 * SSOT decision table:
 * failure type × available contribution → operation
 */
export function selectRepairOperation(input: {
  target: RepairTarget;
  unusedContributions: InformationalContribution[];
  consumedFacetKeys: Set<string>;
  allowedFacets?: string[];
  /**
   * Body substance guard — when deleting this segment would wipe required /
   * sole development material, prefer COMPRESS/REPLACE over empty DELETE.
   */
  bodyGuard?: {
    isBodySegment: boolean;
    isSoleBodySegment: boolean;
    requiredBodyFacets: string[];
    bodyAssignedFacets: string[];
    remainingBodyTextIfDeleted: string;
  };
}): RepairOperationDecision {
  const codes = new Set(input.target.failureCodes);
  const text = input.target.originalText;
  const strongUnused = filterStrongUnused(input.unusedContributions);
  const settingUnused = hasExplicitSettingContribution(input.unusedContributions);
  const allowedFacets = input.allowedFacets ?? [];
  const factualCore = hasFactualCore({ text, allowedFacets });
  const overlap = countConsumedOverlap(text, input.consumedFacetKeys);
  const isOpeningRole =
    input.target.segmentId === "lead" ||
    input.target.kind === "LEAD" ||
    input.target.segmentId === "title" ||
    input.target.kind === "TITLE" ||
    input.target.segmentId === "summary" ||
    input.target.kind === "SUMMARY";

  const base = (partial: Omit<RepairOperationDecision, "segmentId">): RepairOperationDecision => ({
    segmentId: input.target.segmentId,
    ...partial,
  });

  const remainingIfDeleted = (input.bodyGuard?.remainingBodyTextIfDeleted ?? "").replace(/\s+/g, "");
  const deleteWouldEmptyBody =
    Boolean(input.bodyGuard?.isBodySegment) &&
    (Boolean(input.bodyGuard?.isSoleBodySegment) || remainingIfDeleted.length < 4);
  const deleteWouldDropRequired =
    Boolean(input.bodyGuard?.isBodySegment) &&
    (input.bodyGuard?.requiredBodyFacets ?? []).some(
      (f) => f.length >= 2 && text.includes(f) && !remainingIfDeleted.includes(f),
    );
  const uniqueBodyFacets = (input.bodyGuard?.bodyAssignedFacets ?? []).filter(
    (f) =>
      f.length >= 2 &&
      text.includes(f) &&
      !input.consumedFacetKeys.has(facetKey(f)),
  );

  /** Body may DELETE; opening roles must COMPRESS/REWRITE (never empty lead). */
  const deleteOrOpeningCompress = (reason: string, ruleId: string): RepairOperationDecision => {
    if (isOpeningRole) {
      return base({
        operation: "COMPRESS",
        reason: `${reason} → opening role COMPRESS (never DELETE lead/title/summary)`,
        replaceWith: [],
        requiresLlm: true,
        ruleId: `${ruleId}_OPENING`,
      });
    }
    // Body substance protection: never empty-DELETE sole/required development
    if (deleteWouldEmptyBody || deleteWouldDropRequired) {
      if (strongUnused.length > 0) {
        return base({
          operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
          reason: `${reason} → body substance guard REPLACE (no empty DELETE)`,
          replaceWith: strongUnused.slice(0, 3),
          requiresLlm: false,
          ruleId: `${ruleId}_BODY_REPLACE`,
        });
      }
      if (uniqueBodyFacets.length > 0 || factualCore) {
        return base({
          operation: "COMPRESS",
          reason: `${reason} → body substance guard COMPRESS (keep unique facets)`,
          replaceWith: [],
          requiresLlm: false,
          ruleId: `${ruleId}_BODY_COMPRESS`,
        });
      }
      // No unique substance and no unused — leave for DEFER path (REWRITE signals insufficiency)
      return base({
        operation: "REWRITE",
        reason: `${reason} → body substance guard REWRITE/DEFER (DELETE banned)`,
        replaceWith: [],
        requiresLlm: true,
        ruleId: `${ruleId}_BODY_GUARD`,
      });
    }
    return base({
      operation: "DELETE",
      reason,
      replaceWith: [],
      requiresLlm: false,
      ruleId,
    });
  };

  // --- TITLE ---
  if (input.target.kind === "TITLE" || input.target.segmentId === "title") {
    return base({
      operation: "REWRITE",
      reason: "TITLE → REWRITE within allowed contributions",
      replaceWith: [],
      requiresLlm: true,
      ruleId: "TITLE_REWRITE",
    });
  }

  // --- SUMMARY ---
  if (input.target.kind === "SUMMARY" || input.target.segmentId === "summary") {
    return base({
      operation: factualCore ? "COMPRESS" : "REWRITE",
      reason: factualCore
        ? "SUMMARY → COMPRESS to central claims snippet"
        : "SUMMARY → REWRITE list snippet",
      replaceWith: [],
      requiresLlm: true,
      ruleId: factualCore ? "SUMMARY_COMPRESS" : "SUMMARY_REWRITE",
    });
  }

  // --- FILLER / CTA ---
  if (codes.has("FILLER") || codes.has("CTA")) {
    return deleteOrOpeningCompress("FILLER/CTA → DELETE (no length padding)", "FILLER_DELETE");
  }

  // --- NAME_DERIVED ---
  if (codes.has("NAME_DERIVED_INFERENCE")) {
    if (settingUnused.length > 0) {
      return base({
        operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
        reason: "NAME_DERIVED + explicit supported setting → REPLACE",
        replaceWith: settingUnused.slice(0, 2),
        requiresLlm: true, // natural editorial sentence, not catalog facet dump
        ruleId: "NAME_REPLACE_SETTING",
      });
    }
    return deleteOrOpeningCompress(
      "NAME_DERIVED + no explicit supported setting → DELETE",
      "NAME_DELETE",
    );
  }

  // --- EVALUATIVE ---
  if (codes.has("EVALUATIVE_INFERENCE")) {
    if (factualCore || isOpeningRole) {
      return base({
        operation: "COMPRESS",
        reason: isOpeningRole
          ? "EVALUATIVE on opening role → COMPRESS (never DELETE lead/title/summary)"
          : "EVALUATIVE + factual core → COMPRESS (factual only)",
        replaceWith: [],
        requiresLlm: true, // prefer LLM when deterministic trim is unsafe
        ruleId: isOpeningRole ? "EVAL_COMPRESS_OPENING" : "EVAL_COMPRESS",
      });
    }
    return deleteOrOpeningCompress(
      "EVALUATIVE only / no factual core → DELETE",
      "EVAL_DELETE",
    );
  }

  // --- INTERPRETIVE / UNSUPPORTED ---
  if (codes.has("INTERPRETIVE_INFERENCE") || codes.has("UNSUPPORTED_INFERENCE")) {
    if (strongUnused.length > 0) {
      return base({
        operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
        reason: "INTERPRETIVE/UNSUPPORTED + unused supported → REPLACE",
        replaceWith: strongUnused.slice(0, 2),
        requiresLlm: true,
        ruleId: "INTERP_REPLACE",
      });
    }
    return deleteOrOpeningCompress(
      "INTERPRETIVE/UNSUPPORTED + no unused → DELETE",
      "INTERP_DELETE",
    );
  }

  // --- REPETITION (after inference codes so EVAL isn't misrouted) ---
  if (codes.has("REPETITION") || overlap >= 2) {
    if (strongUnused.length > 0) {
      return base({
        operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
        reason: "REPETITION + strong unused contribution → REPLACE",
        replaceWith: strongUnused.slice(0, 3),
        // Prefer deterministic when unused facets are concrete atomics
        requiresLlm: false,
        ruleId: "REP_REPLACE",
      });
    }
    // Keep unique body facets; strip only lead-consumed overlap
    if (uniqueBodyFacets.length > 0) {
      return base({
        operation: "COMPRESS",
        reason: "REPETITION → COMPRESS keep unique body contributions (no empty DELETE)",
        replaceWith: [],
        requiresLlm: false,
        ruleId: "REP_COMPRESS_UNIQUE",
      });
    }
    return deleteOrOpeningCompress(
      "REPETITION + no strong unused → DELETE (shorter dense OK)",
      "REP_DELETE",
    );
  }

  // --- default ---
  return base({
    operation: "REWRITE",
    reason: "Fallback REWRITE within allowed contributions",
    replaceWith: [],
    requiresLlm: true,
    ruleId: "DEFAULT_REWRITE",
  });
}

/**
 * Deterministic REPLACE text from unused contributions — no LLM.
 * Prefer a short grounded paraphrase drawn from the claim statement that contains
 * unused facets. Never emit catalog readout templates ("公開情報として…").
 */
export function buildDeterministicReplaceText(input: {
  replaceWith: InformationalContribution[];
  claims: Array<{ id: string; statement: string }>;
}): { text: string; claimIdsUsed: string[] } {
  const first = input.replaceWith[0];
  if (!first) {
    return { text: "", claimIdsUsed: [] };
  }
  const claimIdsUsed = [...new Set(input.replaceWith.map((c) => c.claimId))];
  const facets = input.replaceWith
    .map((c) => c.facet.trim())
    .filter((f) => f.length >= 2)
    .slice(0, 3);
  if (facets.length === 0) {
    return { text: "", claimIdsUsed };
  }

  const byId = new Map(input.claims.map((c) => [c.id, c.statement]));
  const statement = (byId.get(first.claimId) ?? "").trim();
  // Strip catalog wrappers; keep reader-facing concrete clause when possible.
  const cleaned = statement
    .replace(/は公開ページ上で確認できる。?$/u, "")
    .replace(/として公開されている。?$/u, "")
    .replace(/が公開されている。?$/u, "")
    .replace(/^シリーズ情報として/u, "")
    .replace(/^メーカー／レーベルとして/u, "")
    .replace(/^出演者／クリエイターとして/u, "")
    .replace(/^公開ページ上で販売／配信状態は/u, "")
    .replace(/[「」]/g, "")
    .trim();

  const hitFacets = facets.filter((f) => cleaned.includes(f) || statement.includes(f));
  if (cleaned.length >= 12 && hitFacets.length > 0) {
    // Compact one sentence from the claim body — not a facet catalog dump.
    const sentence = cleaned.endsWith("。") ? cleaned : `${cleaned}。`;
    // Keep short: prefer first clause-ish chunk when very long
    if (sentence.length <= 120) {
      return { text: sentence, claimIdsUsed };
    }
    const cut = sentence.slice(0, 100);
    const lastPunct = Math.max(cut.lastIndexOf("、"), cut.lastIndexOf(" "));
    const compact = (lastPunct > 40 ? cut.slice(0, lastPunct) : cut).replace(/[、\s]+$/u, "");
    return { text: `${compact}。`, claimIdsUsed };
  }

  // Last resort: state concrete facets directly (never catalog 「確認できる」 shells)
  if (facets.length === 1) {
    return { text: `${facets[0]}。`, claimIdsUsed };
  }
  return {
    text: `${facets[0]}。${facets[1]}。`,
    claimIdsUsed,
  };
}

/**
 * Deterministic COMPRESS: drop sentences with evaluative / name-setting cues;
 * keep sentences that hit allowed facets. When consumedFacetKeys provided,
 * drop sentences whose only hits are already-consumed (lead) facets.
 */
export function buildDeterministicCompressText(input: {
  originalText: string;
  allowedFacets: string[];
  /** Lead-consumed / forbidden facet keys — strip pure restatement sentences */
  consumedFacetKeys?: Set<string>;
}): { text: string; ok: boolean } {
  const sentences = input.originalText
    .split(/(?<=[。．！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const consumed = input.consumedFacetKeys ?? new Set<string>();
  const kept: string[] = [];
  for (const s of sentences) {
    if (hasEvaluativeRelation(s)) continue;
    if (/世界観|リアルタイム感|シチュエーションが展開|舞台|ロケ地/.test(s)) continue;
    const facets = observeFacetsInText(s);
    const uniqueHits = facets.filter((f) => !consumed.has(facetKey(f)));
    // Pure restatement of consumed facets only → drop
    if (facets.length > 0 && uniqueHits.length === 0 && consumed.size > 0) continue;
    const hitsAllowed = input.allowedFacets.some((a) => a.length >= 2 && s.includes(a));
    const allowed = new Set(input.allowedFacets.map(facetKey));
    const facetHit = facets.some(
      (f) =>
        allowed.has(facetKey(f)) ||
        [...allowed].some((a) => a.includes(facetKey(f)) || facetKey(f).includes(a)),
    );
    const uniqueAllowed = uniqueHits.some(
      (f) =>
        allowed.has(facetKey(f)) ||
        input.allowedFacets.some((a) => a.length >= 2 && (f.includes(a) || a.includes(f))),
    );
    if (hitsAllowed || facetHit || uniqueAllowed) {
      kept.push(s);
    }
  }
  // If sentence split failed but text has unique allowed facets, rebuild short factual line
  if (kept.length === 0 && input.allowedFacets.length > 0) {
    const uniqueAllowed = input.allowedFacets.filter(
      (a) => a.length >= 2 && input.originalText.includes(a) && !consumed.has(facetKey(a)),
    );
    if (uniqueAllowed.length > 0) {
      const line =
        uniqueAllowed.length === 1
          ? `${uniqueAllowed[0]}。`
          : `${uniqueAllowed[0]}。${uniqueAllowed[1]}。`;
      return { text: line, ok: true };
    }
  }
  if (kept.length === 0) return { text: "", ok: false };
  return { text: kept.join(""), ok: true };
}
