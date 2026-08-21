/**
 * Map Brain Review failures → repair target segments (channel-agnostic contract).
 * BLOG mapping implemented; X can reuse the same target kinds later.
 */

import type { EditorialFailure, EditorialReviewReport } from "../core/types.js";

export type RepairTargetKind =
  | "TITLE"
  | "SUMMARY"
  | "LEAD"
  | "SECTION"
  | "PARAGRAPH"
  | "CTA"
  | "FULL_SEGMENT";

export type RepairTarget = {
  kind: RepairTargetKind;
  /** e.g. title | summary | lead | section:0 | section:0:p1 | cta */
  segmentId: string;
  failureCodes: string[];
  originalText: string;
  allowedClaimIds: string[];
  hints: string[];
};

export type BlogArticleParts = {
  title: string;
  summary: string;
  lead: string;
  sections: Array<{ heading: string | null; paragraphs: string[] }>;
  ctaLabel?: string;
};

function segmentFromEvidence(f: EditorialFailure): string | null {
  const samples = f.evidence?.sampleAssertions;
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const first = samples[0] as { sourceSegment?: string };
  return typeof first.sourceSegment === "string" ? first.sourceSegment : null;
}

/**
 * Resolve minimal set of repair targets from a review report.
 * Multiple failures on the same segment collapse to one target.
 */
export function mapFailuresToRepairTargets(input: {
  review: EditorialReviewReport;
  article: BlogArticleParts;
  roleAllowlist: {
    titleAllowedClaimIds: string[];
    leadAllowedClaimIds: string[];
    developmentAllowedClaimIds: string[];
    summaryAllowedClaimIds: string[];
    ctaAllowedClaimIds: string[];
  };
}): RepairTarget[] {
  const bySegment = new Map<string, RepairTarget>();

  const upsert = (t: RepairTarget) => {
    const prev = bySegment.get(t.segmentId);
    if (!prev) {
      bySegment.set(t.segmentId, t);
      return;
    }
    prev.failureCodes = [...new Set([...prev.failureCodes, ...t.failureCodes])];
    prev.hints = [...new Set([...prev.hints, ...t.hints])];
  };

  for (const f of input.review.failures) {
    if (f.severity === "INFO") continue;
    const code = f.code;
    const seg = segmentFromEvidence(f);

    if (code === "CTA" || seg === "cta") {
      upsert({
        kind: "CTA",
        segmentId: "cta",
        failureCodes: [code],
        originalText: input.article.ctaLabel ?? "",
        allowedClaimIds: input.roleAllowlist.ctaAllowedClaimIds,
        hints: [f.message],
      });
      continue;
    }

    if (code === "SUMMARY" || seg === "summary") {
      upsert({
        kind: "SUMMARY",
        segmentId: "summary",
        failureCodes: [code],
        originalText: input.article.summary,
        allowedClaimIds: input.roleAllowlist.summaryAllowedClaimIds,
        hints: [f.message],
      });
      continue;
    }

    if (code === "OPENING" || seg === "lead") {
      upsert({
        kind: "LEAD",
        segmentId: "lead",
        failureCodes: [code],
        originalText: input.article.lead,
        allowedClaimIds: input.roleAllowlist.leadAllowedClaimIds,
        hints: [f.message],
      });
      continue;
    }

    if (seg === "title") {
      upsert({
        kind: "TITLE",
        segmentId: "title",
        failureCodes: [code],
        originalText: input.article.title,
        allowedClaimIds: input.roleAllowlist.titleAllowedClaimIds,
        hints: [f.message],
      });
      continue;
    }

    const sectionPara = /^section:(\d+):p(\d+)$/.exec(seg ?? "");
    if (sectionPara) {
      const si = Number(sectionPara[1]);
      const pi = Number(sectionPara[2]);
      const text = input.article.sections[si]?.paragraphs[pi] ?? "";
      upsert({
        kind: "PARAGRAPH",
        segmentId: `section:${si}:p${pi}`,
        failureCodes: [code],
        originalText: text,
        allowedClaimIds: input.roleAllowlist.developmentAllowedClaimIds,
        hints: [f.message],
      });
      continue;
    }

    const sectionOnly = /^section:(\d+)$/.exec(seg ?? "");
    if (sectionOnly) {
      const si = Number(sectionOnly[1]);
      const paras = input.article.sections[si]?.paragraphs ?? [];
      upsert({
        kind: "SECTION",
        segmentId: `section:${si}`,
        failureCodes: [code],
        originalText: paras.join("\n"),
        allowedClaimIds: input.roleAllowlist.developmentAllowedClaimIds,
        hints: [f.message],
      });
      continue;
    }

    // Fallback by failure code family when evidence lacks a segment
    if (
      [
        "EVALUATIVE_INFERENCE",
        "INTERPRETIVE_INFERENCE",
        "NAME_DERIVED_INFERENCE",
        "REPETITION",
        "FILLER",
        "UNSUPPORTED_INFERENCE",
        "GROUNDING",
      ].includes(code)
    ) {
      const text = input.article.sections[0]?.paragraphs[0] ?? input.article.lead;
      const segmentId = input.article.sections[0]?.paragraphs[0] ? "section:0:p0" : "lead";
      upsert({
        kind: segmentId.startsWith("section") ? "PARAGRAPH" : "LEAD",
        segmentId,
        failureCodes: [code],
        originalText: text,
        allowedClaimIds: segmentId.startsWith("section")
          ? input.roleAllowlist.developmentAllowedClaimIds
          : input.roleAllowlist.leadAllowedClaimIds,
        hints: [f.message],
      });
    }
  }

  return [...bySegment.values()];
}

export const MAX_TARGETED_REPAIR_ATTEMPTS = 1;

export type RepairStopReason =
  | "PASS"
  | "REPAIR_SUCCEEDED"
  | "REGEN_CANDIDATE"
  | "HUMAN_REVIEW_CANDIDATE"
  | "BAD_INPUT_CLAIM"
  | "SKIPPED";
