/**
 * Minimal OPTION B baseline quality repair (LEGACY_ONLY / off generation path).
 *
 * Kept for historical ops/tests. OPTION B `generateBloggerArticle` must NOT call this —
 * policy is validate → REGENERATE (see optionBAllowsPostLlmProseMutation).
 *
 * Not a full legacy Brain revive. Originally reused failure taxonomy codes for
 * lead/body repetition, catalog confirmation prose, unsupported evaluative padding,
 * and theme invent in title.
 *
 * Max one deterministic pass. No new Quality Gate product. No LLM repair call.
 * Evaluative padding uses plan-surface attestation residue (not a growing banned-word list).
 */

import { isCatalogConfirmationProse } from "../../article-pattern/evidence-pack.js";
import {
  hasShortThemeSemanticOverreach,
  hasUnsupportedEvaluativeResidue,
  stripUnsupportedEvalFrames,
} from "../../article-pattern/plan-surface-attestation.js";

export type BaselineQualityCode =
  | "REPETITION"
  | "EVALUATIVE_INFERENCE"
  | "THEME_OVERREACH"
  | "CATALOG_CONFIRMATION"
  | "THEME_INVENT";

export type BaselineQualityFinding = {
  code: BaselineQualityCode;
  severity: "BLOCKING" | "WARNING";
  detail: string;
  segmentId?: string;
};

export type BaselineArticleShape = {
  title: string;
  summary: string;
  /** Legacy-only; empty/absent on leadless writes. */
  lead?: string;
  sections: Array<{ heading: string | null; paragraphs: string[]; lists?: string[] }>;
};

const THEME_INVENT = /(?:世界観|徹底解説|完全ガイド|珠玉の|独自の魅力)/u;

function norm(s: string): string {
  return s.replace(/\s+/g, "").trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

function overlapRatio(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    return Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
  }
  return 0;
}

/** Detect defects without mutating. */
export function detectBaselineQualityDefects(input: {
  article: BaselineArticleShape;
  planFacts: string[];
}): BaselineQualityFinding[] {
  const findings: BaselineQualityFinding[] = [];
  const lead = input.article.lead ?? "";
  const bodyParas = input.article.sections.flatMap((s) => s.paragraphs);
  const bodyText = bodyParas.join("\n");
  const planBlob = input.planFacts.join(" ");

  if (overlapRatio(lead, input.article.summary) >= 0.92) {
    // summary==lead is common in OPTION B; not blocking by itself
  }

  for (let i = 0; i < bodyParas.length; i++) {
    const p = bodyParas[i]!;
    if (lead && overlapRatio(lead, p) >= 0.75) {
      findings.push({
        code: "REPETITION",
        severity: "BLOCKING",
        detail: "body paragraph restates lead",
        segmentId: `section:0:p${i}`,
      });
    }
    // Leadless: catch adjacent paragraph restatement (former lead/body overlap class).
    if (i > 0 && overlapRatio(bodyParas[i - 1]!, p) >= 0.75) {
      findings.push({
        code: "REPETITION",
        severity: "BLOCKING",
        detail: "body paragraph restates previous paragraph",
        segmentId: `section:0:p${i}`,
      });
    }
  }

  const full = [input.article.title, lead, bodyText].join("\n");
  if (isCatalogConfirmationProse(full) || /公式ページで確認|出演者として.*確認できる/.test(full)) {
    findings.push({
      code: "CATALOG_CONFIRMATION",
      severity: "BLOCKING",
      detail: "catalog confirmation prose in output",
    });
  }

  if (THEME_INVENT.test(input.article.title) && !THEME_INVENT.test(planBlob)) {
    findings.push({
      code: "THEME_INVENT",
      severity: "BLOCKING",
      detail: "title invents theme words absent from plan",
    });
  }

  for (const sent of sentences(bodyText)) {
    if (hasUnsupportedEvaluativeResidue(sent, input.planFacts)) {
      findings.push({
        code: "EVALUATIVE_INFERENCE",
        severity: "WARNING",
        detail: sent.slice(0, 80),
      });
    }
    if (hasShortThemeSemanticOverreach(sent, input.planFacts)) {
      findings.push({
        code: "THEME_OVERREACH",
        severity: "WARNING",
        detail: sent.slice(0, 80),
      });
    }
    if (/(?:で|が|も|を|は|と|の)[。．]?$/u.test(sent.trim())) {
      findings.push({
        code: "EVALUATIVE_INFERENCE",
        severity: "WARNING",
        detail: `unfinished particle ending: ${sent.slice(0, 80)}`,
      });
    }
  }

  return findings;
}

/**
 * Deterministic bounded repair (≤1 pass). Prefer DELETE of defective sentences.
 * Does not invent replacement prose.
 */
export function applyBaselineQualityRepair(input: {
  article: BaselineArticleShape;
  planFacts: string[];
}): {
  article: BaselineArticleShape;
  findings: BaselineQualityFinding[];
  repaired: boolean;
  codes: BaselineQualityCode[];
} {
  const findings = detectBaselineQualityDefects(input);
  if (findings.length === 0) {
    return { article: input.article, findings, repaired: false, codes: [] };
  }

  const next: BaselineArticleShape = {
    title: input.article.title,
    summary: input.article.summary,
    lead: input.article.lead,
    sections: input.article.sections.map((s) => ({
      heading: s.heading,
      paragraphs: [...s.paragraphs],
      lists: s.lists ? [...s.lists] : undefined,
    })),
  };
  let repaired = false;
  const codes = new Set<BaselineQualityCode>();

  const leadN = norm(next.lead ?? "");
  for (const sec of next.sections) {
    const kept: string[] = [];
    for (const p of sec.paragraphs) {
      if (
        (next.lead && overlapRatio(next.lead, p) >= 0.75) ||
        (leadN && norm(p) === leadN)
      ) {
        repaired = true;
        codes.add("REPETITION");
        continue;
      }
      if (isCatalogConfirmationProse(p) || /公式ページで確認|出演者として.*確認できる/.test(p)) {
        repaired = true;
        codes.add("CATALOG_CONFIRMATION");
        continue;
      }
      // Strip unsupported promotional frames; drop sentence if nothing concrete remains.
      const parts = (() => {
        const sents = sentences(p);
        return sents.length > 0 ? sents : p.trim() ? [p.trim()] : [];
      })();
      const dropEval = parts
        .map((sent) => {
          const badTheme = hasShortThemeSemanticOverreach(sent, input.planFacts);
          if (badTheme) {
            repaired = true;
            codes.add("THEME_OVERREACH");
            return "";
          }
          let next = sent;
          if (hasUnsupportedEvaluativeResidue(sent, input.planFacts)) {
            const stripped = stripUnsupportedEvalFrames(sent, input.planFacts);
            if (stripped !== sent) {
              repaired = true;
              codes.add("EVALUATIVE_INFERENCE");
            }
            next = stripped;
          }
          // Writer sometimes stops mid-clause under "no promo closer" pressure.
          if (next && /(?:で|が|も|を|は|と|の)[。．]?$/u.test(next.trim())) {
            const t = next.trim();
            const coreLen = t.replace(/[。．\s]/gu, "").length;
            if (/で[。．]?$/u.test(t) && coreLen >= 12) {
              next = t.replace(/で[。．]?$/u, "です。");
              repaired = true;
              codes.add("EVALUATIVE_INFERENCE");
            } else if (/(?:が|も|を|は|と|の)[。．]?$/u.test(t) && coreLen >= 16) {
              // Close unfinished particle endings without inventing new claims.
              next = t.replace(/(?:が|も|を|は|と|の)[。．]?$/u, "です。");
              repaired = true;
              codes.add("EVALUATIVE_INFERENCE");
            } else if (/(?:が|も|を|は|と|の)[。．]?$/u.test(t)) {
              repaired = true;
              codes.add("EVALUATIVE_INFERENCE");
              next = "";
            }
          }
          return next;
        })
        .filter((s) => s.trim().length > 0);
      const rebuilt = dropEval.join("");
      if (rebuilt.trim()) kept.push(rebuilt);
      // else: paragraph emptied by repair — omit
    }
    sec.paragraphs = kept;
  }

  // Keep ≥1 section skeleton
  const nonEmpty = next.sections.filter((s) => s.paragraphs.length > 0);
  if (nonEmpty.length > 0) next.sections = nonEmpty;
  else if (next.sections.length > 0) {
    next.sections = [{ heading: null, paragraphs: [] }];
  }

  if (THEME_INVENT.test(next.title) && !THEME_INVENT.test(input.planFacts.join(" "))) {
    // Cannot invent a replacement title deterministically — leave for Writer regen path.
    codes.add("THEME_INVENT");
  }

  return {
    article: next,
    findings,
    repaired,
    codes: [...codes],
  };
}
