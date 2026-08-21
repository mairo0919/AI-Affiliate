/**
 * REFERENCE_EXECUTION compliance — mapped evidence used, progression, near-copy.
 * Additive Brain axis; does not relax existing thresholds.
 */

import type { EditorialFailureCode } from "../core/failure-taxonomy.js";
import type { ReferenceEvidenceMappingPlan } from "../../article-pattern/reference-evidence-mapping.js";
import { detectReferenceNearCopy } from "../../article-pattern/reference-near-copy.js";
import { contributionFacetPresent } from "../generation/contribution-compliance.js";

export type ReferenceExecutionFinding = {
  code: EditorialFailureCode;
  message: string;
  severity: "BLOCKING" | "WARNING";
};

export function validateReferenceExecution(input: {
  article: {
    title: string;
    lead: string;
    summary: string;
    sections: Array<{ paragraphs: string[] }>;
  };
  mappingPlan: ReferenceEvidenceMappingPlan | null;
}): { ok: boolean; findings: ReferenceExecutionFinding[] } {
  const findings: ReferenceExecutionFinding[] = [];
  if (!input.mappingPlan) return { ok: true, findings };

  const body = input.article.sections.flatMap((s) => s.paragraphs).join("\n");
  const full = `${input.article.title}\n${input.article.lead}\n${body}\n${input.article.summary}`;

  const mapped = input.mappingPlan.mappings.filter((m) => m.status === "mapped");
  for (const m of mapped) {
    const segmentText =
      m.role === "lead"
        ? input.article.lead
        : m.role === "summary"
          ? input.article.summary
          : body;
    for (const fact of m.assignedFacts) {
      // Fact hit: require a concrete token (≥2) from the fact to appear
      const tokens =
        fact.match(/\d+[\u4e00-\u9fff]+|[\u30a0-\u30ff]{3,}|[\u4e00-\u9fff]{2,6}/g) ?? [];
      const hit =
        tokens.some((t) => t.length >= 2 && contributionFacetPresent(segmentText, t)) ||
        (fact.length >= 4 && segmentText.includes(fact.slice(0, Math.min(12, fact.length))));
      if (!hit && m.role !== "cta") {
        findings.push({
          code: "EVIDENCE_OMISSION",
          message: `mapped evidence not realized in ${m.role}: ${fact.slice(0, 40)}`,
          severity: "BLOCKING",
        });
      }
    }
  }

  // Unmapped padding: long body with zero mapped development facts realized
  const mappedDevFacts = mapped
    .filter((m) => m.role === "development")
    .flatMap((m) => m.assignedFacts);
  if (
    mappedDevFacts.length > 0 &&
    body.replace(/\s+/g, "").length > 80 &&
    mappedDevFacts.every((f) => {
      const tok = f.match(/[\u4e00-\u9fff]{2,6}/g)?.[0];
      return tok ? !body.includes(tok) : true;
    })
  ) {
    findings.push({
      code: "UNMAPPED_PADDING",
      message: "body length without realizing mapped development evidence",
      severity: "BLOCKING",
    });
  }

  // Progression: lead mapped fact must not be the only substance restated as whole body
  const leadFacts = mapped.filter((m) => m.role === "lead").flatMap((m) => m.assignedFacts);
  if (leadFacts.length > 0 && mapped.filter((m) => m.role === "development").length > 0) {
    const leadCore = leadFacts[0]!.replace(/\s+/g, "").slice(0, 24);
    if (leadCore.length >= 12 && body.replace(/\s+/g, "").includes(leadCore)) {
      findings.push({
        code: "REFERENCE_PROGRESSION_VIOLATION",
        message: "body restates lead-mapped evidence core without progression",
        severity: "BLOCKING",
      });
    }
  }

  const near = detectReferenceNearCopy({
    generatedText: full,
    blockedPhrases: [],
  });
  if (near.hit) {
    findings.push({
      code: "REFERENCE_NEAR_COPY",
      message: `near-copy overlap=${near.maxOverlap}`,
      severity: "BLOCKING",
    });
  }

  return { ok: findings.length === 0, findings };
}
