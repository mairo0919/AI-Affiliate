/**
 * Read-only EditorialBrainRun inspector — no DB writes.
 * Optional reReview recomputes semantic review from stored artifact + claims (still no writes).
 */

import type { EditorialBrainRepository, LifecycleRepository } from "@ai-affiliate/database";
import type { CoreEditorialPlan } from "./core/types.js";
import {
  reviewArtifactShadow,
  type ReviewableBlogArtifact,
  type ReviewableXArtifact,
} from "./shadow/reviewer.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function extractFacets(text: string): string[] {
  const facets = [
    ...(text.match(/[\u30a0-\u30ff]{3,}/g) ?? []),
    ...(text.match(/[\u4e00-\u9fff]{2,}/g) ?? []),
    ...(text.match(/[A-Za-z0-9]+[\u30a0-\u30ff\u4e00-\u9fff]{2,}/g) ?? []),
  ];
  return [...new Set(facets.filter((f) => f.length >= 2))];
}

export type InspectBrainRunReport = {
  brainRunId: string;
  mode: string;
  channel: string;
  status: string;
  contentVersionId: string | null;
  contentId: string | null;
  generatorModelRunIds: string[];
  formatKey: string | null;
  structurePatternId: string | null;
  editorialPatternId: string | null;
  selectedClaimIds: string[];
  omittedClaimIds: Array<{ claimId: string; reason?: string }>;
  corePlan: Record<string, unknown> | null;
  channelPlan: Record<string, unknown> | null;
  retrieval: {
    retrievedExperienceIds: string[];
    experiences: Array<{
      id: string;
      scope: string;
      channel: string;
      confidence: number;
      outcome: string | null;
      failureCodes: string[];
    }>;
  };
  review: Record<string, unknown> | null;
  comparison: {
    legacyDecision: string | null;
    brainShadowDecision: string | null;
    finalDecision: string | null;
  };
  experience: {
    createdExperienceIds: string[];
    rows: Array<{
      id: string;
      scope: string;
      sourceType: string;
      confidence: number;
      outcome: string | null;
    }>;
  };
  article?: {
    title: string;
    summary: string | null;
    lead: string | null;
    sections: unknown;
    bodyPreview: string;
  };
  claimUsageAnalysis?: Array<{
    segment: string;
    textPreview: string;
    matchedClaimIds: string[];
  }>;
  informationGainAnalysis?: {
    uniqueSupportedDetailEstimate: number;
    supportedNovelAssertionCount: number | null;
    unsupportedAssertionCount: number | null;
    informationGainTarget: number | null;
    semanticRepetitionHits: number | null;
    bodyUnits: number | null;
    lengthWasNotSoleJudge: boolean | null;
    assertionSupportStats: Record<string, unknown> | null;
  };
  /** Present only when reReview=true — computed live, not persisted */
  liveReReview?: {
    decision: string;
    failureCodes: string[];
    metrics: Record<string, unknown>;
    assertionSupportStats: Record<string, unknown>;
    failingAssertionSamples: Array<{
      supportType: string;
      sourceSegment: string;
      failureCodes: string[];
      assertionPreview: string;
    }>;
  };
  failureCodes: string[];
  repairHints: string[];
  traceComplete: boolean;
  readOnly: true;
};

export async function inspectEditorialBrainRun(input: {
  brainRepo: EditorialBrainRepository;
  lifecycle: LifecycleRepository;
  brainRunId?: string;
  contentVersionId?: string;
  /** Recompute semantic review from artifact + claims (read-only; does not write) */
  reReview?: boolean;
}): Promise<InspectBrainRunReport> {
  let run = input.brainRunId ? await input.brainRepo.findBrainRun(input.brainRunId) : null;
  if (!run && input.contentVersionId) {
    run = await input.brainRepo.findLatestBrainRunByContentVersion(input.contentVersionId);
  }
  if (!run) {
    throw new Error(
      `EditorialBrainRun not found (brain-run-id=${input.brainRunId ?? ""} content-version-id=${input.contentVersionId ?? ""})`,
    );
  }

  const corePlan = asRecord(run.corePlan);
  const channelPlan = asRecord(run.channelPlan);
  const review = asRecord(run.reviewResult);
  const selectedClaimIds = asStringArray(run.selectedClaimIds);
  const retrievedExperienceIds = asStringArray(run.retrievedExperienceIds);
  const generatorModelRunIds = asStringArray(run.generatorModelRunIds);
  const failureCodes = asStringArray(run.failureCodes);

  const omittedRaw = corePlan?.omittedClaimIds;
  const omittedClaimIds = Array.isArray(omittedRaw)
    ? omittedRaw
        .map((o) => asRecord(o))
        .filter((o): o is Record<string, unknown> => Boolean(o))
        .map((o) => ({
          claimId: String(o.claimId ?? ""),
          reason: typeof o.reason === "string" ? o.reason : undefined,
        }))
        .filter((o) => o.claimId)
    : [];

  const createdExperiences = await input.brainRepo.listExperiencesByBrainRun(run.id);
  const retrievedRows = await input.brainRepo.listExperiencesByIds(retrievedExperienceIds);

  const version = run.contentVersionId
    ? await input.lifecycle.findContentVersion(run.contentVersionId)
    : null;

  const structured = asRecord(version?.structuredContent);
  const article = asRecord(structured?.article);

  const claimStatements: Array<{ id: string; statement: string }> = [];
  if (selectedClaimIds.length) {
    const claims = await input.lifecycle.listClaimsByIds(selectedClaimIds);
    for (const c of claims) claimStatements.push({ id: c.id, statement: c.statement });
  }

  const claimUsageAnalysis: InspectBrainRunReport["claimUsageAnalysis"] = [];
  if (article) {
    const segments: Array<{ segment: string; text: string }> = [
      { segment: "title", text: String(article.title ?? "") },
      { segment: "summary", text: String(article.summary ?? "") },
      { segment: "lead", text: String(article.lead ?? "") },
    ];
    const sections = Array.isArray(article.sections) ? article.sections : [];
    sections.forEach((sec, i) => {
      const s = asRecord(sec);
      const paras = Array.isArray(s?.paragraphs) ? (s!.paragraphs as unknown[]).map(String) : [];
      paras.forEach((p, pi) => {
        segments.push({ segment: `sections[${i}].paragraphs[${pi}]`, text: p });
      });
    });
    for (const seg of segments) {
      const matched = claimStatements
        .filter((c) => {
          const facets = extractFacets(c.statement);
          return (
            facets.some((f) => seg.text.includes(f)) ||
            (c.statement.length >= 8 && seg.text.includes(c.statement.slice(0, 12)))
          );
        })
        .map((c) => c.id);
      claimUsageAnalysis.push({
        segment: seg.segment,
        textPreview: seg.text.slice(0, 200),
        matchedClaimIds: matched,
      });
    }
  }

  const metrics = asRecord(review?.metrics);
  const failures = Array.isArray(review?.failures) ? review!.failures : [];
  const repairHints = failures
    .map((f) => {
      const fr = asRecord(f);
      return fr ? `${String(fr.code)}: ${String(fr.message)}` : String(f);
    })
    .concat(failureCodes.length && failures.length === 0 ? failureCodes.map((c) => `${c}`) : []);

  const traceComplete = Boolean(
    run.id &&
      run.corePlan &&
      run.channelPlan &&
      run.reviewResult &&
      run.legacyDecision &&
      run.brainDecision &&
      generatorModelRunIds.length > 0 &&
      run.contentVersionId,
  );

  let liveReReview: InspectBrainRunReport["liveReReview"];
  if (input.reReview && corePlan && version) {
    const plan = run.corePlan as CoreEditorialPlan;
    if (run.channel === "BLOG" && article) {
      const sectionsRaw = Array.isArray(article.sections) ? article.sections : [];
      const sections = sectionsRaw.map((sec) => {
        const s = asRecord(sec);
        return {
          paragraphs: Array.isArray(s?.paragraphs) ? (s!.paragraphs as unknown[]).map(String) : [],
          lists: Array.isArray(s?.lists) ? (s!.lists as unknown[]).map(String) : [],
        };
      });
      const artifact: ReviewableBlogArtifact = {
        channel: "BLOG",
        title: String(article.title ?? version.title ?? ""),
        summary: String(article.summary ?? version.summary ?? ""),
        lead: String(article.lead ?? ""),
        sections,
        bodyText: version.body ?? "",
      };
      const live = reviewArtifactShadow({
        artifact,
        corePlan: plan,
        claimStatements,
      });
      liveReReview = {
        decision: live.decision,
        failureCodes: live.failures.map((f) => f.code),
        metrics: live.metrics as unknown as Record<string, unknown>,
        assertionSupportStats: live.metrics.assertionSupportStats as unknown as Record<
          string,
          unknown
        >,
        failingAssertionSamples: (live.semanticAssertions ?? [])
          .filter((a) => a.failureCodes.length > 0)
          .slice(0, 16)
          .map((a) => ({
            supportType: a.supportType,
            sourceSegment: a.sourceSegment,
            failureCodes: a.failureCodes,
            assertionPreview: a.assertion.slice(0, 160),
          })),
      };
    } else if (run.channel === "X") {
      const postsRaw = structured?.posts;
      const posts = Array.isArray(postsRaw)
        ? postsRaw
            .map((p) => asRecord(p))
            .filter((p): p is Record<string, unknown> => Boolean(p))
            .map((p) => ({
              order: Number(p.order ?? 0),
              text: String(p.text ?? ""),
            }))
        : undefined;
      const artifact: ReviewableXArtifact = {
        channel: "X",
        body: version.body,
        reply: null,
        posts,
      };
      const live = reviewArtifactShadow({
        artifact,
        corePlan: plan,
        claimStatements,
      });
      liveReReview = {
        decision: live.decision,
        failureCodes: live.failures.map((f) => f.code),
        metrics: live.metrics as unknown as Record<string, unknown>,
        assertionSupportStats: live.metrics.assertionSupportStats as unknown as Record<
          string,
          unknown
        >,
        failingAssertionSamples: (live.semanticAssertions ?? [])
          .filter((a) => a.failureCodes.length > 0)
          .slice(0, 16)
          .map((a) => ({
            supportType: a.supportType,
            sourceSegment: a.sourceSegment,
            failureCodes: a.failureCodes,
            assertionPreview: a.assertion.slice(0, 160),
          })),
      };
    }
  }

  return {
    brainRunId: run.id,
    mode: run.mode,
    channel: run.channel,
    status: run.status,
    contentVersionId: run.contentVersionId,
    contentId: run.contentId,
    generatorModelRunIds,
    formatKey: run.formatKey,
    structurePatternId: run.structurePatternId,
    editorialPatternId: run.editorialPatternId,
    selectedClaimIds,
    omittedClaimIds,
    corePlan: corePlan
      ? {
          openingDriverClaimIds: corePlan.openingDriverClaimIds,
          claimAllocation: corePlan.claimAllocation,
          developmentDepth: corePlan.developmentDepth,
          informationGainTarget: corePlan.informationGainTarget,
          scarcityMode: corePlan.scarcityMode,
          titleStrategy: corePlan.titleStrategy,
          summaryStrategy: corePlan.summaryStrategy,
          ctaStrategy: corePlan.ctaStrategy,
          selectedClaimIds: corePlan.selectedClaimIds,
          omittedClaimIds: corePlan.omittedClaimIds,
          inferencePolicy: corePlan.inferencePolicy,
          claimProfile: corePlan.claimProfile,
        }
      : null,
    channelPlan: channelPlan
      ? {
          channel: channelPlan.channel,
          specifics: channelPlan.specifics,
        }
      : null,
    retrieval: {
      retrievedExperienceIds,
      experiences: retrievedRows.map((e) => ({
        id: e.id,
        scope: e.scope,
        channel: e.channel,
        confidence: e.confidence,
        outcome: e.outcome,
        failureCodes: asStringArray(e.failureCodes),
      })),
    },
    review: review
      ? {
          decision: review.decision,
          axes: review.axes,
          failures: review.failures,
          metrics: review.metrics,
          lengthWasNotSoleJudge: review.lengthWasNotSoleJudge,
        }
      : null,
    comparison: {
      legacyDecision: run.legacyDecision,
      brainShadowDecision: run.brainDecision,
      finalDecision: run.finalDecision,
    },
    experience: {
      createdExperienceIds: createdExperiences.map((e) => e.id),
      rows: createdExperiences.map((e) => ({
        id: e.id,
        scope: e.scope,
        sourceType: e.sourceType,
        confidence: e.confidence,
        outcome: e.outcome,
      })),
    },
    article: article
      ? {
          title: String(article.title ?? version?.title ?? ""),
          summary: version?.summary ?? String(article.summary ?? ""),
          lead: String(article.lead ?? ""),
          sections: article.sections,
          bodyPreview: (version?.body ?? "").slice(0, 2500),
        }
      : version
        ? {
            title: version.title,
            summary: version.summary,
            lead: null,
            sections: null,
            bodyPreview: version.body.slice(0, 2500),
          }
        : undefined,
    claimUsageAnalysis,
    informationGainAnalysis: {
      uniqueSupportedDetailEstimate: Number(metrics?.uniqueSupportedDetailEstimate ?? 0),
      supportedNovelAssertionCount:
        typeof metrics?.supportedNovelAssertionCount === "number"
          ? (metrics.supportedNovelAssertionCount as number)
          : null,
      unsupportedAssertionCount:
        typeof metrics?.unsupportedAssertionCount === "number"
          ? (metrics.unsupportedAssertionCount as number)
          : null,
      informationGainTarget:
        typeof corePlan?.informationGainTarget === "number"
          ? (corePlan.informationGainTarget as number)
          : null,
      semanticRepetitionHits:
        typeof metrics?.semanticRepetitionHits === "number"
          ? (metrics.semanticRepetitionHits as number)
          : null,
      bodyUnits: typeof metrics?.bodyUnits === "number" ? (metrics.bodyUnits as number) : null,
      lengthWasNotSoleJudge:
        typeof review?.lengthWasNotSoleJudge === "boolean"
          ? (review.lengthWasNotSoleJudge as boolean)
          : null,
      assertionSupportStats: asRecord(metrics?.assertionSupportStats),
    },
    liveReReview,
    failureCodes,
    repairHints,
    traceComplete,
    readOnly: true,
  };
}
