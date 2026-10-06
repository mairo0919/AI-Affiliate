import { publicationPriorityClass } from "../daily-ops/demand-signal.js";

export type XRefillMetrics = {
  neededSlots: number;
  candidatesConsidered: number;
  deterministicRejected: number;
  passArtifactReused: number;
  newLlmGenerations: number;
  llmPass: number;
  llmRejected: number;
  transientFailed: number;
  slotsFilled: number;
};

export type XRefillProbeDraft = {
  canonicalId: string;
  contentVersionId?: string | null;
  pass: boolean;
  skipReason?: string | null;
};

export type XRefillPrepare =
  | { kind: "hard_block"; probe: XRefillProbeDraft }
  | { kind: "cached_reject"; probe: XRefillProbeDraft }
  | { kind: "transient_wait" }
  | { kind: "spend"; willGenerate: boolean };

export function emptyXRefillMetrics(neededSlots: number): XRefillMetrics {
  return {
    neededSlots,
    candidatesConsidered: 0,
    deterministicRejected: 0,
    passArtifactReused: 0,
    newLlmGenerations: 0,
    llmPass: 0,
    llmRejected: 0,
    transientFailed: 0,
    slotsFilled: 0,
  };
}

export function orderCandidatesPassFirst<T extends { researchItemId: string }>(
  ranked: readonly T[],
  passResearchItemIds: ReadonlySet<string>,
): T[] {
  const pass: T[] = [];
  const rest: T[] = [];
  for (const candidate of ranked) {
    if (passResearchItemIds.has(candidate.researchItemId)) pass.push(candidate);
    else rest.push(candidate);
  }
  return [...pass, ...rest];
}

const PRIORITY_CLASS_RANK = { RECOMMENDED: 0, STRONG_DEMAND: 1, NORMAL: 2 } as const;

export function orderCandidatesByPublicationPriority<
  T extends {
    researchItemId: string;
    recommendedRank?: number | null;
    popularRank?: number | null;
  },
>(ranked: readonly T[], passResearchItemIds: ReadonlySet<string>): T[] {
  return ranked
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const leftClass = publicationPriorityClass(left.candidate);
      const rightClass = publicationPriorityClass(right.candidate);
      const classDelta = PRIORITY_CLASS_RANK[leftClass] - PRIORITY_CLASS_RANK[rightClass];
      if (classDelta !== 0) return classDelta;
      const leftPass = passResearchItemIds.has(left.candidate.researchItemId) ? 0 : 1;
      const rightPass = passResearchItemIds.has(right.candidate.researchItemId) ? 0 : 1;
      if (leftPass !== rightPass) return leftPass - rightPass;
      return left.index - right.index;
    })
    .map((row) => row.candidate);
}

export function formatXRefillNote(metrics: XRefillMetrics): string {
  return [
    "x_refill",
    `needed=${metrics.neededSlots}`,
    `considered=${metrics.candidatesConsidered}`,
    `deterministicRejected=${metrics.deterministicRejected}`,
    `passReused=${metrics.passArtifactReused}`,
    `newLlm=${metrics.newLlmGenerations}`,
    `llmPass=${metrics.llmPass}`,
    `llmRejected=${metrics.llmRejected}`,
    `transient=${metrics.transientFailed}`,
    `filled=${metrics.slotsFilled}`,
  ].join(" ");
}

/**
 * Fill only the open slots. Existing PASS artifacts are materialized with no model call.
 * A quality reject is not rewritten. A transient miss does not stop the next candidate.
 */
export async function runXCandidateRefill<T>(input: {
  slotsNeeded: number;
  maxNewGenerations: number;
  candidates: readonly T[];
  prepare: (candidate: T) => Promise<XRefillPrepare>;
  materialize: (candidate: T) => Promise<{
    probe: XRefillProbeDraft;
    generated: boolean;
    transient: boolean;
  }>;
}): Promise<{ probes: XRefillProbeDraft[]; metrics: XRefillMetrics }> {
  const metrics = emptyXRefillMetrics(Math.max(0, input.slotsNeeded));
  const probes: XRefillProbeDraft[] = [];
  if (metrics.neededSlots === 0) return { probes, metrics };

  for (const candidate of input.candidates) {
    if (metrics.slotsFilled >= metrics.neededSlots) break;
    metrics.candidatesConsidered += 1;
    const prepared = await input.prepare(candidate);
    if (prepared.kind === "hard_block" || prepared.kind === "cached_reject") {
      metrics.deterministicRejected += 1;
      probes.push(prepared.probe);
      continue;
    }
    if (prepared.kind === "transient_wait") continue;
    if (prepared.willGenerate && metrics.newLlmGenerations >= input.maxNewGenerations) continue;

    const materialized = await input.materialize(candidate);
    probes.push(materialized.probe);
    if (materialized.generated) {
      metrics.newLlmGenerations += 1;
      if (materialized.probe.pass) metrics.llmPass += 1;
      else if (materialized.transient) metrics.transientFailed += 1;
      else metrics.llmRejected += 1;
    } else if (materialized.probe.pass) {
      metrics.passArtifactReused += 1;
    } else {
      metrics.deterministicRejected += 1;
    }
    if (materialized.probe.pass) metrics.slotsFilled += 1;
  }
  return { probes, metrics };
}
