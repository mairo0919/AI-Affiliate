/**
 * Generation-time provenance — internal only (not formatter/public output).
 */

import { z } from "zod";

export const segmentProvenanceSchema = z.object({
  claimIdsUsed: z.array(z.string()).default([]),
});

export const articleProvenanceSchema = z.object({
  title: segmentProvenanceSchema.default({ claimIdsUsed: [] }),
  lead: segmentProvenanceSchema.default({ claimIdsUsed: [] }),
  sections: z.array(segmentProvenanceSchema).default([]),
  summary: segmentProvenanceSchema.default({ claimIdsUsed: [] }),
  cta: segmentProvenanceSchema.optional(),
});

export type ArticleProvenance = z.infer<typeof articleProvenanceSchema>;

/** LLM may emit parallel arrays; normalize into ArticleProvenance. */
export const llmProvenanceFieldsSchema = z
  .object({
    titleClaimIds: z.array(z.string()).optional(),
    leadClaimIds: z.array(z.string()).optional(),
    summaryClaimIds: z.array(z.string()).optional(),
    sectionClaimIds: z.array(z.array(z.string())).optional(),
    provenance: articleProvenanceSchema.optional(),
  })
  .passthrough();

export function normalizeArticleProvenance(input: {
  titleClaimIds?: string[];
  leadClaimIds?: string[];
  summaryClaimIds?: string[];
  sectionClaimIds?: string[][];
  provenance?: ArticleProvenance;
  sectionCount: number;
}): ArticleProvenance {
  if (input.provenance) {
    const p = articleProvenanceSchema.parse(input.provenance);
    while (p.sections.length < input.sectionCount) {
      p.sections.push({ claimIdsUsed: [] });
    }
    return p;
  }
  const sections = Array.from({ length: input.sectionCount }, (_, i) => ({
    claimIdsUsed: input.sectionClaimIds?.[i] ?? [],
  }));
  return articleProvenanceSchema.parse({
    title: { claimIdsUsed: input.titleClaimIds ?? [] },
    lead: { claimIdsUsed: input.leadClaimIds ?? [] },
    summary: { claimIdsUsed: input.summaryClaimIds ?? [] },
    sections,
  });
}

export function allProvenanceClaimIds(p: ArticleProvenance): string[] {
  return [
    ...p.title.claimIdsUsed,
    ...p.lead.claimIdsUsed,
    ...p.summary.claimIdsUsed,
    ...p.sections.flatMap((s) => s.claimIdsUsed),
    ...(p.cta?.claimIdsUsed ?? []),
  ];
}

/**
 * Clamp LLM-declared claimIdsUsed to Plan role allowlists.
 * Keeps Generator from being blocked by noisy provenance declarations;
 * omitted/unknown ids still surface via checkPlanCompliance on the raw input when desired.
 */
export function clampProvenanceToAllowlist(
  provenance: ArticleProvenance,
  allow: {
    titleAllowedClaimIds: string[];
    leadAllowedClaimIds: string[];
    developmentAllowedClaimIds: string[];
    summaryAllowedClaimIds: string[];
    ctaAllowedClaimIds: string[];
    omittedClaimIds: string[];
  },
): ArticleProvenance {
  const omit = new Set(allow.omittedClaimIds);
  const clamp = (ids: string[], allowed: string[]) => {
    const a = new Set(allowed);
    return [...new Set(ids.filter((id) => a.has(id) && !omit.has(id)))];
  };
  return {
    title: { claimIdsUsed: clamp(provenance.title.claimIdsUsed, allow.titleAllowedClaimIds) },
    lead: { claimIdsUsed: clamp(provenance.lead.claimIdsUsed, allow.leadAllowedClaimIds) },
    summary: { claimIdsUsed: clamp(provenance.summary.claimIdsUsed, allow.summaryAllowedClaimIds) },
    sections: provenance.sections.map((s) => ({
      claimIdsUsed: clamp(s.claimIdsUsed, allow.developmentAllowedClaimIds),
    })),
    cta: provenance.cta
      ? { claimIdsUsed: clamp(provenance.cta.claimIdsUsed, allow.ctaAllowedClaimIds) }
      : undefined,
  };
}
