/**
 * Experience retrieval — PostgreSQL facets only (no vector DB in Phase 1).
 */

import type { EditorialBrainRepository } from "@ai-affiliate/database";
import type {
  ExperienceQuery,
  ExperienceRetrievalHit,
  ExperienceRetrievalResult,
} from "./types.js";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function daysAgo(iso: Date): number {
  return (Date.now() - iso.getTime()) / (1000 * 60 * 60 * 24);
}

function humanQualityRankBonus(sourceType: string | null | undefined, outcome: string | null): number {
  let bonus = 0;
  if (sourceType === "HUMAN_FEEDBACK") bonus += 2.2;
  if (
    outcome === "QUALITY_SUCCESS" ||
    outcome === "HUMAN_POSITIVE" ||
    outcome === "SUCCESS"
  ) {
    bonus += 1.6;
  }
  if (
    outcome === "QUALITY_IMPROVEMENT" ||
    outcome === "HUMAN_MIXED_IMPROVEMENT" ||
    outcome === "IMPROVEMENT"
  ) {
    bonus += 1.2;
  }
  if (sourceType === "SYSTEM_VALIDATOR" && outcome === "SUCCESS") {
    bonus -= 1.5;
  }
  return bonus;
}

export function rankExperienceScore(input: {
  scope: string;
  channel: string;
  queryChannel: string;
  formatKey: string | null;
  queryFormatKey: string | null;
  claimProfile: string | null;
  queryClaimProfile: string | null;
  structurePatternId: string | null;
  queryStructurePatternId: string | null;
  editorialPatternId: string | null;
  queryEditorialPatternId: string | null;
  confidence: number;
  sampleEvidence: number;
  createdAt: Date;
  sourceType?: string | null;
  outcome?: string | null;
}): number {
  let score = 0;
  // CORE is usable by all channels; CHANNEL must match
  if (input.scope === "CORE") score += 2.5;
  if (input.scope === "CHANNEL" && input.channel === input.queryChannel) score += 3;
  if (input.scope === "CHANNEL" && input.channel !== input.queryChannel) return -100; // hard reject mis-apply

  if (input.formatKey && input.queryFormatKey && input.formatKey === input.queryFormatKey) {
    score += 2;
  }
  if (
    input.claimProfile &&
    input.queryClaimProfile &&
    (input.claimProfile === input.queryClaimProfile ||
      (input.claimProfile.startsWith("quality:") &&
        (input.queryClaimProfile?.startsWith("quality:") ?? false)))
  ) {
    score += 2.5;
  }
  if (
    input.structurePatternId &&
    input.queryStructurePatternId &&
    input.structurePatternId === input.queryStructurePatternId
  ) {
    score += 1.2;
  }
  if (
    input.editorialPatternId &&
    input.queryEditorialPatternId &&
    input.editorialPatternId === input.queryEditorialPatternId
  ) {
    score += 1.2;
  }

  score += Math.min(2, input.confidence * 2);
  score += Math.min(1.5, Math.log10(1 + Math.max(0, input.sampleEvidence)) * 0.8);
  score += humanQualityRankBonus(input.sourceType, input.outcome ?? null);

  const age = daysAgo(input.createdAt);
  if (age <= 14) score += 1;
  else if (age <= 60) score += 0.4;
  else if (age > 180) score -= 0.5;

  // Low confidence never becomes a forced rule — ranking only
  if (input.confidence < 0.35) score *= 0.55;

  return score;
}

export async function retrieveExperiences(
  repo: EditorialBrainRepository,
  query: ExperienceQuery,
): Promise<ExperienceRetrievalResult> {
  const rows = await repo.listExperiencesForRetrieval({
    channel: query.channel,
    formatKey: query.formatKey ?? null,
    contentType: query.contentType ?? null,
    claimProfile: query.claimProfile ?? null,
    structurePatternId: query.structurePatternId ?? null,
    editorialPatternId: query.editorialPatternId ?? null,
    failureCodes: query.failureCodes,
    limit: query.limit ?? 8,
  });

  const hits: ExperienceRetrievalHit[] = [];
  for (const row of rows) {
    const score = rankExperienceScore({
      scope: row.scope,
      channel: row.channel,
      queryChannel: query.channel,
      formatKey: row.formatKey,
      queryFormatKey: query.formatKey ?? null,
      claimProfile: row.claimProfile,
      queryClaimProfile: query.claimProfile ?? null,
      structurePatternId: row.structurePatternId,
      queryStructurePatternId: query.structurePatternId ?? null,
      editorialPatternId: row.editorialPatternId,
      queryEditorialPatternId: query.editorialPatternId ?? null,
      confidence: row.confidence,
      sampleEvidence: row.sampleEvidence,
      createdAt: row.createdAt,
      sourceType: row.sourceType,
      outcome: row.outcome,
    });
    if (score < 0) continue;
    hits.push({
      id: row.id,
      scope: row.scope === "CORE" ? "CORE" : "CHANNEL",
      channel: row.channel,
      score,
      confidence: row.confidence,
      failureCodes: asStringArray(row.failureCodes),
      outcome: row.outcome,
      sourceType: row.sourceType,
    });
  }

  hits.sort((a, b) => b.score - a.score);
  const limit = Math.max(1, Math.min(20, query.limit ?? 8));
  return { hits: hits.slice(0, limit), query };
}

/**
 * LearningRule boundary: Experience never mutates LearningRule.
 * This helper exists so tests can assert the Foundation invariant.
 */
export function experienceMustNotMutateLearningRules(): {
  autoPromote: false;
  writesLearningRule: false;
} {
  return { autoPromote: false, writesLearningRule: false };
}
