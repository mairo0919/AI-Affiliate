/**
 * Post-transform grammatical integrity — HARD deterministic gate.
 * Runs after redaction/rewrite; never uses LLM.
 * Broken Japanese must not reach Brain or ContentVersion persist.
 */

export type PostTransformIntegrityFinding = {
  code:
    | "POST_TRANSFORM_INTEGRITY_FAILED"
    | "INCOMPLETE_CLAUSE"
    | "DANGLING_PARTICLE"
    | "EMPTY_SUBJECT"
    | "FRAGMENT";
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

function checkText(text: string, role: string): PostTransformIntegrityFinding[] {
  const findings: PostTransformIntegrityFinding[] = [];
  const t = (text ?? "").trim();
  if (!t) return findings;

  if (FRAGMENT_RE.test(t) || t.replace(/\s+/g, "").length < 4) {
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
  return findings;
}

export function validatePostTransformIntegrity(input: {
  title?: string;
  lead: string;
  sections: Array<{ paragraphs: string[] }>;
  summary?: string;
}): PostTransformIntegrityResult {
  const findings: PostTransformIntegrityFinding[] = [];
  if (input.title) findings.push(...checkText(input.title, "title"));
  findings.push(...checkText(input.lead, "lead"));
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
