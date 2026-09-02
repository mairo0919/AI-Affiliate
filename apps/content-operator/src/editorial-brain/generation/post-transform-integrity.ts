/**
 * Post-transform grammatical integrity — HARD deterministic gate.
 * Runs after redaction/rewrite; never uses LLM.
 * Broken Japanese must not reach Brain or ContentVersion persist.
 */

import {
  isTitleClauseFragment,
  validateTitleSurfaceRealization,
} from "../../article-pattern/title-eligibility.js";

export type PostTransformIntegrityFinding = {
  code:
    | "POST_TRANSFORM_INTEGRITY_FAILED"
    | "INCOMPLETE_CLAUSE"
    | "DANGLING_PARTICLE"
    | "EMPTY_SUBJECT"
    | "FRAGMENT"
    | "TITLE_KEYWORD_CONCAT"
    | "TITLE_UNFINISHED_FRAGMENT";
  message: string;
  evidence?: string;
};

export type PostTransformIntegrityResult = {
  ok: boolean;
  findings: PostTransformIntegrityFinding[];
};

const DANGLING_RE =
  /(?:^|[。．\n])\s*(?:を|が|は|に|で|と|へ|より|から)(?:目指|し|なっ|よる|対し|つい|おける)/;
/** Particle immediately after topic/comma without a head noun — not 「は、女優が」 */
const DOUBLE_PARTICLE_RE = /は、を|が、を|を、を|は、は|が、が/;
const SENTENCE_START_PARTICLE_RE = /(?:^|[。．\n])\s*(?:を|に|で|と|へ)[\u3040-\u309F]/;
const EMPTY_TOPIC_RE = /(?:^|[。．\n])\s*(?:\d{2,4})?は、を/;
const DANGLING_PREDICATE_RE = /(?:を目指す|として|による|に対し|について)(?:[。．]|$)/;
const FRAGMENT_RE = /^[、。．・…\s]+$/;
/** Compact SOURCE/Plan title facts — valid EXACT_SURFACE, not broken fragments. */
const COMPACT_QUANTITY_TITLE_RE = /^\d+\s*(?:時間|分|回|発|名|人|本|作品|タイトル|cm)$/u;

function isFragmentOrTooShort(text: string, role: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (FRAGMENT_RE.test(t)) return true;
  const compact = t.replace(/\s+/g, "");
  // R152 — title EXACT_SURFACE may be short (e.g. 「2時間」). Length<4 is not corruption.
  if (role === "title") {
    return compact.length < 2;
  }
  // summary often mirrors title via fillOptionBArticleDefaults — same exemption
  if (role === "summary" && COMPACT_QUANTITY_TITLE_RE.test(compact)) {
    return false;
  }
  return compact.length < 4;
}

function checkText(text: string, role: string): PostTransformIntegrityFinding[] {
  const findings: PostTransformIntegrityFinding[] = [];
  const t = (text ?? "").trim();
  if (!t) return findings;

  if (isFragmentOrTooShort(t, role)) {
    findings.push({
      code: "FRAGMENT",
      message: `${role} is fragment/too short after transform`,
      evidence: t.slice(0, 40),
    });
  }
  if (DOUBLE_PARTICLE_RE.test(t) || EMPTY_TOPIC_RE.test(t)) {
    findings.push({
      code: "INCOMPLETE_CLAUSE",
      message: `${role} has incomplete particle sequence (e.g. は、を)`,
      evidence: t.slice(0, 60),
    });
  }
  if (DANGLING_RE.test(t) || SENTENCE_START_PARTICLE_RE.test(t)) {
    findings.push({
      code: "DANGLING_PARTICLE",
      message: `${role} starts clause with dangling particle`,
      evidence: t.slice(0, 60),
    });
  }
  // "を目指す" without a head noun immediately before を
  if (/[^ぁ-んァ-ヶ一-龥A-Za-z0-9]を目指す|、を目指す|^を目指す/.test(t)) {
    findings.push({
      code: "INCOMPLETE_CLAUSE",
      message: `${role} has dangling を目指す without head noun`,
      evidence: t.slice(0, 60),
    });
  }
  // "は、" followed by object particle without noun (は、を / は、に…)
  if (/は、[をにでとへ]/.test(t)) {
    findings.push({
      code: "EMPTY_SUBJECT",
      message: `${role} topic marker followed by particle without head`,
      evidence: t.slice(0, 60),
    });
  }
  if (DANGLING_PREDICATE_RE.test(t) && /は、を|、を目指す|は、として/.test(t)) {
    findings.push({
      code: "INCOMPLETE_CLAUSE",
      message: `${role} dangling predicate after deletion`,
      evidence: t.slice(0, 60),
    });
  }
  if (role === "title") {
    const surface = validateTitleSurfaceRealization(t);
    if (!surface.ok) {
      for (const code of surface.codes) {
        if (code === "TITLE_UNFINISHED_FRAGMENT") {
          findings.push({
            code: "TITLE_UNFINISHED_FRAGMENT",
            message: "title has unfinished clause fragment",
            evidence: t.slice(0, 80),
          });
        } else if (code === "TITLE_KEYWORD_CONCAT") {
          findings.push({
            code: "TITLE_KEYWORD_CONCAT",
            message: "title looks like bare keyword concatenation without Japanese linkage",
            evidence: t.slice(0, 80),
          });
        } else if (code === "EMPTY_TITLE") {
          findings.push({
            code: "FRAGMENT",
            message: "title empty after transform",
            evidence: t.slice(0, 40),
          });
        }
      }
    }
    // Extra: clause fragment anywhere inside title (not only trailing)
    if (isTitleClauseFragment(t) || /を迎え/.test(t)) {
      if (!findings.some((f) => f.code === "TITLE_UNFINISHED_FRAGMENT")) {
        findings.push({
          code: "TITLE_UNFINISHED_FRAGMENT",
          message: "title embeds unfinished clause fragment",
          evidence: t.slice(0, 80),
        });
      }
    }
  }
  return findings;
}

export function validatePostTransformIntegrity(input: {
  title?: string;
  /** Legacy-only; omit on leadless writes. */
  lead?: string | null;
  sections: Array<{ paragraphs: string[] }>;
  summary?: string;
}): PostTransformIntegrityResult {
  const findings: PostTransformIntegrityFinding[] = [];
  if (input.title) findings.push(...checkText(input.title, "title"));
  if (typeof input.lead === "string" && input.lead.trim()) {
    findings.push(...checkText(input.lead, "lead"));
  }
  if (input.summary) findings.push(...checkText(input.summary, "summary"));
  for (let i = 0; i < input.sections.length; i++) {
    for (let j = 0; j < (input.sections[i]?.paragraphs.length ?? 0); j++) {
      findings.push(
        ...checkText(input.sections[i]!.paragraphs[j]!, `section[${i}].p[${j}]`),
      );
    }
  }
  // Deduplicate by code+evidence
  const seen = new Set<string>();
  const uniq = findings.filter((f) => {
    const k = `${f.code}:${f.evidence ?? f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    ok: uniq.length === 0,
    findings: uniq.map((f) =>
      f.code === "FRAGMENT" || f.code === "EMPTY_SUBJECT" || f.code === "DANGLING_PARTICLE"
        ? { ...f, code: "POST_TRANSFORM_INTEGRITY_FAILED" as const, message: `${f.code}: ${f.message}` }
        : f.code === "INCOMPLETE_CLAUSE"
          ? { ...f, code: "POST_TRANSFORM_INTEGRITY_FAILED" as const, message: `${f.code}: ${f.message}` }
          : f,
    ),
  };
}

/** Brain-facing alias codes */
export function integrityFindingsAsBrainCodes(
  result: PostTransformIntegrityResult,
): Array<{ code: "GRAMMATICAL_INTEGRITY" | "INCOMPLETE_CLAUSE"; message: string }> {
  if (result.ok) return [];
  return result.findings.map((f) => ({
    code: /INCOMPLETE|EMPTY_SUBJECT|DANGLING|は、を/.test(f.message)
      ? ("INCOMPLETE_CLAUSE" as const)
      : ("GRAMMATICAL_INTEGRITY" as const),
    message: f.message,
  }));
}
