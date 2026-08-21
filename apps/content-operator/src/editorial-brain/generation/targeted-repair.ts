/**
 * Bounded targeted repair — operation-aware (DELETE/REPLACE/COMPRESS/REWRITE).
 * Max 1 attempt; prefer deterministic DELETE/REPLACE (0 LLM) when safe.
 */

import type { LLMProvider } from "../../adapters/types.js";
import type { ClaimStatementRef } from "./generation-input-contract.js";
import {
  buildContributionPlan,
  consumedFacetKeysOutsideTarget,
  facetKey,
  unusedContributionsForRepair,
  type ContributionPlan,
  type InformationalContribution,
} from "./informational-contribution.js";
import {
  buildDeterministicCompressText,
  buildDeterministicReplaceText,
  selectRepairOperation,
  type RepairOperation,
  type RepairOperationDecision,
} from "./repair-operation.js";
import {
  mergeRepairSuccessResults,
  validateRepairedSegment,
  type RepairSuccessFinding,
} from "./repair-success.js";
import type { BlogArticleParts, RepairTarget } from "./repair-target.js";
import { MAX_TARGETED_REPAIR_ATTEMPTS } from "./repair-target.js";

export type RepairedSegment = {
  segmentId: string;
  text: string;
  claimIdsUsed: string[];
  operation: RepairOperation;
};

export type TargetedRepairResult = {
  attempts: number;
  modelRunId: string | null;
  repaired: RepairedSegment[];
  article: BlogArticleParts;
  stopped: boolean;
  operations: RepairOperationDecision[];
  successValidation: { ok: boolean; findings: RepairSuccessFinding[] };
  llmCallUsed: boolean;
};

export function applyRepairs(article: BlogArticleParts, repaired: RepairedSegment[]): BlogArticleParts {
  const next: BlogArticleParts = {
    title: article.title,
    summary: article.summary,
    lead: article.lead,
    sections: article.sections.map((s) => ({
      heading: s.heading,
      paragraphs: [...s.paragraphs],
    })),
    ctaLabel: article.ctaLabel,
  };
  for (const r of repaired) {
    if (r.segmentId === "title") next.title = r.text;
    else if (r.segmentId === "summary") next.summary = r.text;
    else if (r.segmentId === "lead") next.lead = r.text;
    else if (r.segmentId === "cta") next.ctaLabel = r.text;
    else {
      const m = /^section:(\d+)(?::p(\d+))?$/.exec(r.segmentId);
      if (!m) continue;
      const si = Number(m[1]);
      const sec = next.sections[si];
      if (!sec) continue;
      if (m[2] != null) {
        const pi = Number(m[2]);
        if (r.operation === "DELETE" || r.text === "") {
          sec.paragraphs[pi] = "";
        } else if (sec.paragraphs[pi] != null) {
          sec.paragraphs[pi] = r.text;
        }
      } else if (r.operation === "DELETE") {
        sec.paragraphs = [];
      } else {
        sec.paragraphs = r.text.split(/\n+/).filter(Boolean);
      }
    }
  }
  // Drop empty paragraphs. Keep ≥1 section skeleton if needed — NO meta filler.
  for (const sec of next.sections) {
    sec.paragraphs = sec.paragraphs.filter((p) => p.trim().length > 0);
  }
  // Remove fully empty sections when another section still has content
  const nonEmpty = next.sections.filter((s) => s.paragraphs.length > 0);
  if (nonEmpty.length > 0) {
    next.sections = nonEmpty;
  } else if (next.sections.length > 0) {
    // Schema needs ≥1 section: leave one empty-paragraph section (formatter handles)
    next.sections = [{ heading: null, paragraphs: [] }];
  }
  return next;
}

function buildMinimalRepairPrompt(input: {
  decision: RepairOperationDecision;
  target: RepairTarget;
  allowedFacts: string[];
  forbiddenFacets: string[];
  unused: InformationalContribution[];
  inferencePolicy: { allowed: string[]; forbidden: string[] };
  /** OPTION B: slim inputs — no claim wall / full article dump */
  optionB?: {
    evidencePackSubset?: Array<{ id: string; type: string; fact: string }>;
    writingSkeletonSlot?: Record<string, unknown> | null;
    surroundingContext?: { before?: string; after?: string };
  };
}): string {
  if (input.optionB) {
    return [
      "OPTION B repair — rewrite ONLY the target segment.",
      `Operation: ${input.decision.operation}`,
      `Segment: ${input.target.segmentId}`,
      `Brain findings: ${input.target.failureCodes.join(", ")}`,
      `Reason: ${input.decision.reason}`,
      "Evidence Pack subset (WHAT — use only these facts):",
      JSON.stringify(input.optionB.evidencePackSubset ?? []),
      "Writing Skeleton slot (HOW):",
      JSON.stringify(input.optionB.writingSkeletonSlot ?? null),
      input.optionB.surroundingContext
        ? `Surrounding clean context: ${JSON.stringify(input.optionB.surroundingContext)}`
        : "",
      `Forbidden restatement facets: ${input.forbiddenFacets.slice(0, 24).join(" / ") || "(none)"}`,
      "Original segment:",
      input.target.originalText,
      "Do not invent facts. Do not pad with catalog metadata. Do not rewrite other segments.",
      'Return JSON: {"text":"...","claimIdsUsed":["..."]}',
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Operation: ${input.decision.operation}`,
    `Segment: ${input.target.segmentId}`,
    `Failures: ${input.target.failureCodes.join(", ")}`,
    `Reason: ${input.decision.reason}`,
    `Allowed factual contributions: ${input.allowedFacts.join(" / ") || "(none)"}`,
    `Forbidden (already consumed): ${input.forbiddenFacets.slice(0, 24).join(" / ") || "(none)"}`,
    input.decision.operation === "COMPRESS"
      ? "Remove unsupported evaluation/setting. Keep only supported factual core. Shorter is OK. Do not restate forbidden facets."
      : "",
    input.decision.operation === "REWRITE"
      ? "Rewrite within allowed facts only. No new relations. No restating forbidden facets."
      : "",
    `Inference allowed: ${input.inferencePolicy.allowed.join(", ")}`,
    `Inference forbidden: ${input.inferencePolicy.forbidden.join(", ")}`,
    "Original:",
    input.target.originalText,
    'Return JSON: {"text":"...","claimIdsUsed":["..."]}',
  ]
    .filter(Boolean)
    .join("\n");
}

function allowedFacetsForTarget(
  plan: ContributionPlan,
  target: RepairTarget,
  replaceWith: InformationalContribution[],
): string[] {
  const leadFacets = plan.byRole.lead.map((c) => c.facet);
  const devFacets = plan.byRole.development.map((c) => c.facet);
  const replaceFacets = replaceWith.map((c) => c.facet);
  if (target.segmentId === "title" || target.segmentId === "summary" || target.segmentId === "lead") {
    return [...new Set([...leadFacets, ...replaceFacets])];
  }
  return [...new Set([...devFacets, ...replaceFacets, ...leadFacets])];
}

function expandedAllowedClaimIds(
  target: RepairTarget,
  replaceWith: InformationalContribution[],
): string[] {
  return [...new Set([...target.allowedClaimIds, ...replaceWith.map((c) => c.claimId)])];
}

/**
 * Run at most one targeted repair attempt.
 */
export async function runBoundedTargetedRepair(input: {
  llm: LLMProvider;
  model: string;
  article: BlogArticleParts;
  targets: RepairTarget[];
  claims: ClaimStatementRef[];
  openingClaimIds: string[];
  developmentClaimIds: string[];
  inferencePolicy: { allowed: string[]; forbidden: string[] };
  contributionPlan?: ContributionPlan;
  /** OPTION B: Evidence Pack subset + skeleton slot per repair (no claim wall dump) */
  optionBRepair?: {
    evidencePackSubset: Array<{ id: string; type: string; fact: string }>;
    writingSkeletonBySegment?: Record<string, Record<string, unknown>>;
  };
  createModelRun: (meta: Record<string, unknown>) => Promise<{ id: string }>;
  completeModelRun: (
    id: string,
    result: {
      status: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCost?: number;
      actualCost?: number;
      currency?: string;
      metadata?: unknown;
      errorDetail?: string;
    },
  ) => Promise<void>;
}): Promise<TargetedRepairResult> {
  if (input.targets.length === 0) {
    return {
      attempts: 0,
      modelRunId: null,
      repaired: [],
      article: input.article,
      stopped: false,
      operations: [],
      successValidation: { ok: true, findings: [] },
      llmCallUsed: false,
    };
  }

  const plan =
    input.contributionPlan ??
    buildContributionPlan({
      claims: input.claims,
      openingClaimIds: input.openingClaimIds,
      developmentClaimIds: input.developmentClaimIds,
    });

  const unusedGlobal = unusedContributionsForRepair({ plan, article: input.article });
  const bodyParagraphIds: string[] = [];
  input.article.sections.forEach((sec, si) => {
    sec.paragraphs.forEach((p, pi) => {
      if (p.trim().length > 0) bodyParagraphIds.push(`section:${si}:p${pi}`);
    });
  });
  const requiredBodyFacets = plan.byRole.development.slice(0, 2).map((c) => c.facet);
  const bodyAssignedFacets = plan.byRole.development.map((c) => c.facet);

  const operations: RepairOperationDecision[] = input.targets.map((t) => {
    const consumed = consumedFacetKeysOutsideTarget({
      article: input.article,
      targetSegmentId: t.segmentId,
      plan,
    });
    const unused = unusedGlobal.filter((u) => !consumed.has(facetKey(u.facet)));
    const allowedFacets = allowedFacetsForTarget(plan, t, []);
    const isBody = /^section:\d+/.test(t.segmentId);
    const remainingBodyTextIfDeleted = isBody
      ? input.article.sections
          .flatMap((sec, si) =>
            sec.paragraphs.map((p, pi) =>
              `section:${si}:p${pi}` === t.segmentId ? "" : p,
            ),
          )
          .join("")
      : "";
    return selectRepairOperation({
      target: t,
      unusedContributions: unused.length ? unused : unusedGlobal,
      consumedFacetKeys: consumed,
      allowedFacets,
      bodyGuard: isBody
        ? {
            isBodySegment: true,
            isSoleBodySegment: bodyParagraphIds.length <= 1,
            requiredBodyFacets,
            bodyAssignedFacets,
            remainingBodyTextIfDeleted,
          }
        : undefined,
    });
  });

  const repaired: RepairedSegment[] = [];
  let modelRunId: string | null = null;
  let llmCallUsed = false;

  // Deterministic path: DELETE / REPLACE / COMPRESS (when compress succeeds without LLM)
  const llmNeeded: RepairOperationDecision[] = [];
  for (const op of operations) {
    if (op.operation === "DELETE") {
      repaired.push({
        segmentId: op.segmentId,
        text: "",
        claimIdsUsed: [],
        operation: "DELETE",
      });
      continue;
    }
  if (op.operation === "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL" && !op.requiresLlm) {
      const target = input.targets.find((t) => t.segmentId === op.segmentId)!;
      const built = buildDeterministicReplaceText({
        replaceWith: op.replaceWith,
        claims: input.claims,
      });
      const consumed = consumedFacetKeysOutsideTarget({
        article: input.article,
        targetSegmentId: op.segmentId,
        plan,
      });
      const precheck = validateRepairedSegment({
        operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
        originalText: target.originalText,
        repairedText: built.text,
        claimIdsUsed: built.claimIdsUsed,
        allowedClaimIds: expandedAllowedClaimIds(target, op.replaceWith),
        allowedFacets: allowedFacetsForTarget(plan, target, op.replaceWith),
        consumedFacetKeys: consumed,
        replaceWith: op.replaceWith,
      });
      const isOpening =
        op.segmentId === "lead" || op.segmentId === "title" || op.segmentId === "summary";
      if (precheck.ok && built.text.length > 0) {
        repaired.push({
          segmentId: op.segmentId,
          text: built.text,
          claimIdsUsed: built.claimIdsUsed,
          operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
        });
        continue;
      }
      // Body: failed REPLACE → COMPRESS unique facets if possible; never empty sole body
      if (!isOpening) {
        const allowedFacets = allowedFacetsForTarget(plan, target, op.replaceWith);
        const compressed = buildDeterministicCompressText({
          originalText: target.originalText,
          allowedFacets,
          consumedFacetKeys: consumed,
        });
        if (compressed.ok && compressed.text.length > 0) {
          repaired.push({
            segmentId: op.segmentId,
            text: compressed.text,
            claimIdsUsed: target.allowedClaimIds.slice(0, 2),
            operation: "COMPRESS",
          });
          op.operation = "COMPRESS";
          op.reason = `${op.reason} → fallback COMPRESS (REPLACE precheck failed)`;
          op.ruleId = `${op.ruleId}_FALLBACK_COMPRESS`;
          continue;
        }
        const remaining = input.article.sections
          .flatMap((sec, si) =>
            sec.paragraphs.map((p, pi) => (`section:${si}:p${pi}` === op.segmentId ? "" : p)),
          )
          .join("")
          .replace(/\s+/g, "");
        if (remaining.length < 4) {
          // Sole body — escalate to LLM rather than empty DELETE
          op.operation = "REWRITE";
          op.requiresLlm = true;
          op.reason = `${op.reason} → LLM REWRITE (body substance guard)`;
          op.ruleId = `${op.ruleId}_BODY_GUARD_REWRITE`;
          llmNeeded.push(op);
          continue;
        }
        repaired.push({
          segmentId: op.segmentId,
          text: "",
          claimIdsUsed: [],
          operation: "DELETE",
        });
        op.operation = "DELETE";
        op.reason = `${op.reason} → fallback DELETE (REPLACE precheck failed)`;
        op.replaceWith = [];
        op.requiresLlm = false;
        op.ruleId = `${op.ruleId}_FALLBACK_DELETE`;
        continue;
      }
      op.operation = "REWRITE";
      op.requiresLlm = true;
      op.reason = `${op.reason} → LLM REWRITE (REPLACE precheck failed on opening)`;
      op.ruleId = `${op.ruleId}_OPENING_REWRITE`;
      llmNeeded.push(op);
      continue;
    }
    if (op.operation === "COMPRESS") {
      const target = input.targets.find((t) => t.segmentId === op.segmentId)!;
      const isOpeningRole =
        op.segmentId === "lead" || op.segmentId === "title" || op.segmentId === "summary";
      // Opening roles: if LLM required, skip deterministic and use LLM path
      if (op.requiresLlm) {
        llmNeeded.push(op);
        continue;
      }
      const allowedFacets = allowedFacetsForTarget(plan, target, op.replaceWith);
      const consumed = consumedFacetKeysOutsideTarget({
        article: input.article,
        targetSegmentId: op.segmentId,
        plan,
      });
      const compressed = buildDeterministicCompressText({
        originalText: target.originalText,
        allowedFacets,
        consumedFacetKeys: consumed,
      });
      if (compressed.ok && compressed.text.length > 0) {
        repaired.push({
          segmentId: op.segmentId,
          text: compressed.text,
          claimIdsUsed: target.allowedClaimIds.slice(0, 2),
          operation: "COMPRESS",
        });
        continue;
      }
      if (isOpeningRole) {
        // Never DELETE lead/title/summary — escalate to LLM REWRITE
        op.operation = "REWRITE";
        op.requiresLlm = true;
        op.reason = `${op.reason} → LLM REWRITE (opening role)`;
        op.ruleId = `${op.ruleId}_OPENING_REWRITE`;
        llmNeeded.push(op);
        continue;
      }
      const remaining = input.article.sections
        .flatMap((sec, si) =>
          sec.paragraphs.map((p, pi) => (`section:${si}:p${pi}` === op.segmentId ? "" : p)),
        )
        .join("")
        .replace(/\s+/g, "");
      if (remaining.length < 4 || op.ruleId.includes("BODY")) {
        op.operation = "REWRITE";
        op.requiresLlm = true;
        op.reason = `${op.reason} → LLM REWRITE (body substance guard)`;
        op.ruleId = `${op.ruleId}_BODY_GUARD_REWRITE`;
        llmNeeded.push(op);
        continue;
      }
      // Body with other paragraphs remaining: DELETE rather than invent
      repaired.push({
        segmentId: op.segmentId,
        text: "",
        claimIdsUsed: [],
        operation: "DELETE",
      });
      op.operation = "DELETE";
      op.reason = `${op.reason} → fallback DELETE (unsafe compress)`;
      op.requiresLlm = false;
      op.ruleId = `${op.ruleId}_FALLBACK_DELETE`;
      continue;
    }
    if (op.requiresLlm) {
      llmNeeded.push(op);
    }
  }

  if (llmNeeded.length > 0) {
    llmCallUsed = true;
    const modelRun = await input.createModelRun({
      task: "BRAIN_TARGETED_REPAIR",
      operations: llmNeeded.map((o) => ({
        segmentId: o.segmentId,
        operation: o.operation,
        reason: o.reason,
        ruleId: o.ruleId,
      })),
    });
    modelRunId = modelRun.id;

    try {
      const payload = {
        repairs: llmNeeded.map((op) => {
          const target = input.targets.find((t) => t.segmentId === op.segmentId)!;
          const allowedFacts = allowedFacetsForTarget(plan, target, op.replaceWith);
          const consumed = consumedFacetKeysOutsideTarget({
            article: input.article,
            targetSegmentId: op.segmentId,
            plan,
          });
          return {
            segmentId: op.segmentId,
            operation: op.operation,
            prompt: buildMinimalRepairPrompt({
              decision: op,
              target,
              allowedFacts,
              forbiddenFacets: [...consumed],
              unused: op.replaceWith,
              inferencePolicy: input.inferencePolicy,
              optionB: input.optionBRepair
                ? {
                    evidencePackSubset: input.optionBRepair.evidencePackSubset,
                    writingSkeletonSlot:
                      input.optionBRepair.writingSkeletonBySegment?.[op.segmentId] ?? null,
                    surroundingContext: {
                      before: input.article.lead?.slice(0, 120),
                      after: input.article.sections[0]?.paragraphs[0]?.slice(0, 120),
                    },
                  }
                : undefined,
            }),
            allowedClaimIds: expandedAllowedClaimIds(target, op.replaceWith),
            originalText: target.originalText,
          };
        }),
      };

      const llm = await input.llm.executeTask({
        taskType: "REVISION",
        promptIdentifier: "editorial-brain.targeted-repair",
        promptVersion: "v3",
        systemInstruction:
          "Repair only listed segments. Stay inside allowedFacts. Never invent evaluation relations, cast, or settings. Never restate forbiddenFacets. Prefer unused supported contributions for REPLACE. No full-article rewrite.",
        userPrompt: llmNeeded
          .map((op) => {
            const entry = payload.repairs.find((r) => r.segmentId === op.segmentId)!;
            return entry.prompt;
          })
          .join("\n\n---\n\n"),
        outputSchema: {
          type: "object",
          properties: {
            repairs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  segmentId: { type: "string" },
                  text: { type: "string" },
                  claimIdsUsed: { type: "array", items: { type: "string" } },
                },
                required: ["segmentId", "text"],
              },
            },
          },
          required: ["repairs"],
        },
        model: input.model,
        input: { repairs: payload.repairs.map((r) => ({ segmentId: r.segmentId, operation: r.operation })) },
      });

      const out = llm.output as {
        repairs?: Array<{ segmentId?: string; text?: string; claimIdsUsed?: string[] }>;
      };
      for (const r of out.repairs ?? []) {
        if (!r.segmentId || typeof r.text !== "string") continue;
        const op = operations.find((o) => o.segmentId === r.segmentId);
        repaired.push({
          segmentId: r.segmentId,
          text: r.text,
          claimIdsUsed: Array.isArray(r.claimIdsUsed) ? r.claimIdsUsed.map(String) : [],
          operation: op?.operation ?? "REWRITE",
        });
      }

      // Missing LLM repairs → hard fail (do not pretend success with partial apply)
      for (const needed of llmNeeded) {
        if (!repaired.some((r) => r.segmentId === needed.segmentId)) {
          repaired.push({
            segmentId: needed.segmentId,
            text: input.targets.find((t) => t.segmentId === needed.segmentId)?.originalText ?? "",
            claimIdsUsed: [],
            operation: needed.operation,
          });
        }
      }

      await input.completeModelRun(modelRun.id, {
        status: "COMPLETED",
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
        estimatedCost: llm.estimatedCost,
        actualCost: llm.actualCost ?? llm.estimatedCost,
        currency: llm.currency,
        metadata: { repairs: repaired.length, operations, llmNeeded: llmNeeded.length },
      });
    } catch (error) {
      await input.completeModelRun(modelRun.id, {
        status: "FAILED",
        errorDetail: error instanceof Error ? error.message : "repair failed",
      });
      throw error;
    }
  }

  const validations = repaired.map((r) => {
    const target = input.targets.find((t) => t.segmentId === r.segmentId);
    const op = operations.find((o) => o.segmentId === r.segmentId);
    if (!target || !op) {
      return {
        ok: false,
        findings: [{ code: "STRUCTURE_UNSATISFIED" as const, message: "missing target" }],
      };
    }
    const consumed = consumedFacetKeysOutsideTarget({
      article: input.article,
      targetSegmentId: r.segmentId,
      plan,
    });
    const allowedClaimIds = expandedAllowedClaimIds(target, op.replaceWith);
    const allowedFacets = allowedFacetsForTarget(plan, target, op.replaceWith);
    return validateRepairedSegment({
      operation: r.operation,
      originalText: target.originalText,
      repairedText: r.text,
      claimIdsUsed: r.claimIdsUsed,
      allowedClaimIds,
      allowedFacets,
      consumedFacetKeys: consumed,
      replaceWith: op.replaceWith,
    });
  });

  const successValidation = mergeRepairSuccessResults(validations);
  const article = applyRepairs(input.article, repaired);

  return {
    attempts: MAX_TARGETED_REPAIR_ATTEMPTS,
    modelRunId,
    repaired,
    article,
    stopped: true,
    operations,
    successValidation,
    llmCallUsed,
  };
}
