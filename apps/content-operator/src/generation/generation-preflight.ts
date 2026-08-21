import type { Claim, ContentStrategy, LifecycleRepository, TopicCandidate } from "@ai-affiliate/database";

export class GenerationPreflightError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `generation_preflight_failed: ${code}: ${detail}` : `generation_preflight_failed: ${code}`);
    this.name = "GenerationPreflightError";
    this.code = code;
  }
}

export interface GenerationPreflightResult {
  topic: TopicCandidate;
  strategy: ContentStrategy;
  claims: Claim[];
}

/**
 * Fail-fast before any LLM spend. Verifies Topic / Strategy relation and optional Claim IDs.
 */
export async function assertBloggerGenerationPreflight(
  repo: LifecycleRepository,
  input: {
    topicId: string;
    strategyId: string;
    claimIds?: string[];
  },
): Promise<GenerationPreflightResult> {
  const topic = await repo.findTopicCandidate(input.topicId);
  if (!topic) {
    throw new GenerationPreflightError("topic_candidate_not_found", input.topicId);
  }

  const strategy = await repo.findContentStrategy(input.strategyId);
  if (!strategy) {
    throw new GenerationPreflightError("strategy_not_found", input.strategyId);
  }

  if (strategy.topicCandidateId !== input.topicId) {
    throw new GenerationPreflightError(
      "strategy_topic_mismatch",
      `strategy.topicCandidateId=${strategy.topicCandidateId} topicId=${input.topicId}`,
    );
  }

  let claims: Claim[] = [];
  if (input.claimIds?.length) {
    claims = await repo.listClaimsByIds(input.claimIds);
    const found = new Set(claims.map((c) => c.id));
    for (const id of input.claimIds) {
      if (!found.has(id)) {
        throw new GenerationPreflightError("claim_not_found", id);
      }
    }
    for (const claim of claims) {
      if (claim.status !== "SUPPORTED") {
        throw new GenerationPreflightError(
          "claim_not_supported",
          `${claim.id} status=${claim.status}`,
        );
      }
    }
  } else {
    claims = await repo.listClaimsForStrategy(input.strategyId);
  }

  return { topic, strategy, claims };
}
