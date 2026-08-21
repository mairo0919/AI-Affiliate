/**
 * Helpers for RAW plan compliance + authority injection around blogger.generate.
 */

import type { PlanViolationFeedback } from "../../generation/generation-authority.js";
import type { SegmentContributionProvenance } from "./raw-plan-compliance.js";
import type { RawPlanComplianceResult } from "./raw-plan-compliance.js";
import type { RawFailureRouting } from "./raw-failure-routing.js";

export const MAX_PLAN_EXECUTION_ATTEMPTS = Math.max(
  1,
  Math.min(2, Number(process.env.BLOG_MAX_PLAN_ATTEMPTS ?? 2) || 2),
);

export function extractSegmentContributionProvenance(
  rawOut: Record<string, unknown>,
): SegmentContributionProvenance | null {
  const p = rawOut.segmentContributionProvenance;
  if (!p || typeof p !== "object") return null;
  const obj = p as Record<string, unknown>;
  const lead = obj.lead && typeof obj.lead === "object" ? (obj.lead as Record<string, unknown>) : null;
  const sections = Array.isArray(obj.sections) ? obj.sections : [];
  return {
    lead: lead
      ? {
          requiredContributionIds: Array.isArray(lead.requiredContributionIds)
            ? (lead.requiredContributionIds as string[])
            : undefined,
          usedContributionIds: Array.isArray(lead.usedContributionIds)
            ? (lead.usedContributionIds as string[])
            : undefined,
        }
      : undefined,
    sections: sections.map((s) => {
      const row = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
      return {
        requiredContributionIds: Array.isArray(row.requiredContributionIds)
          ? (row.requiredContributionIds as string[])
          : undefined,
        usedContributionIds: Array.isArray(row.usedContributionIds)
          ? (row.usedContributionIds as string[])
          : undefined,
      };
    }),
  };
}

export function buildPlanViolationFeedback(
  attempt: number,
  result: RawPlanComplianceResult,
  routing?: RawFailureRouting | null,
): PlanViolationFeedback {
  return {
    attempt,
    violatedSegments: result.violatedSegments,
    missingRequiredContributionIds: result.missingRequiredContributionIds,
    forbiddenReusedContributionIds: result.forbiddenReusedContributionIds,
    prematurelyConsumedContributionIds: result.prematurelyConsumedContributionIds,
    codes: [...new Set(result.findings.filter((f) => f.severity === "BLOCKING").map((f) => f.code))],
    consumedContributionFacets: result.leadConsumedFacets.slice(0, 24),
    semanticReuseFamilies: result.semanticReusedFacets.slice(0, 16),
    failureClass: routing?.failureClass ?? undefined,
    failureSignature: result.failureSignature,
    note: [
      "Bounded regen — do NOT resend prior article prose.",
      "prematurelyConsumedContributionIds are RESERVED_FOR_LATER — forbid them in lead.",
      "Keep lead-consumed / composite-locked facets ONLY in lead.",
      "Body must introduce missing required contributions that are NOT semantic restatements of lead.",
    ].join(" "),
  };
}

const OPTION_B_BANNER = [
  "GENERATION AUTHORITY (SSOT OPTION B — lower ranks must not override higher ranks):",
  "1) FACTUAL/SAFETY 2) EVIDENCE_PACK 3) WRITING_SKELETON 4) BLOG_CHANNEL_REQUIREMENTS 5) MINIMAL_STYLE.",
  "Write natural Japanese using ONLY EVIDENCE_PACK.concreteEvidence, following WRITING_SKELETON progression.",
  "Never pad with catalogMetadata. Never invent facts. Never copy reference article wording.",
  "When generationAuthority JSON is in the user prompt, obey it over any legacy pattern/SEGMENT walls.",
].join(" ");

/** Ensure generationAuthority JSON reaches the model even if DB PromptDefinition template is stale. */
export function ensureGenerationAuthorityInUserPrompt(
  userPrompt: string,
  generationAuthority: Record<string, unknown>,
): string {
  const authJson = JSON.stringify(generationAuthority);
  if (
    userPrompt.includes("generationAuthority=") &&
    userPrompt.includes("WRITING_SKELETON") &&
    userPrompt.includes("EVIDENCE_PACK") &&
    !/generationAuthority=\s*($|\n)/.test(userPrompt)
  ) {
    return userPrompt;
  }
  if (userPrompt.includes("generationAuthority={{generationAuthority}}")) {
    return userPrompt.replace(
      "generationAuthority={{generationAuthority}}",
      `generationAuthority=${authJson}`,
    );
  }
  return `${userPrompt}\n\ngenerationAuthority=${authJson}`;
}

export function ensureGenerationAuthorityInSystem(systemInstruction: string): string {
  if (systemInstruction.includes("GENERATION AUTHORITY (SSOT")) {
    if (
      systemInstruction.includes("OPTION B") &&
      systemInstruction.includes("EVIDENCE_PACK") &&
      systemInstruction.includes("WRITING_SKELETON")
    ) {
      return systemInstruction;
    }
    return systemInstruction.replace(/GENERATION AUTHORITY \(SSOT[^\n]*/, OPTION_B_BANNER);
  }
  return `${OPTION_B_BANNER}\n${systemInstruction}`;
}
