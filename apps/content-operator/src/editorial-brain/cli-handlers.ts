import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import {
  buildBlogChannelPlan,
  buildCoreEditorialPlan,
  inspectEditorialBrainRun,
} from "./index.js";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) {
      flags[body] = "true";
      continue;
    }
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/**
 * Read-only: editorial-brain-inspect-run --brain-run-id= | --content-version-id=
 * Never writes to DB.
 */
export async function runEditorialBrainInspectRun(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["brain-run-id"] && !flags["content-version-id"]) {
    console.error(
      "Usage: editorial-brain-inspect-run -- --brain-run-id=<id> | --content-version-id=<id> [--re-review]",
    );
    process.exitCode = 1;
    return;
  }

  loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const repo = new LifecycleRepository(database.prisma);
    const brainRepo = repo.createEditorialBrainRepository();
    const beforeRuns = await database.prisma.editorialBrainRun.count();
    const beforeExps = await database.prisma.editorialExperience.count();
    const beforeLearning = await database.prisma.learningRule.count();
    const beforePrompts = await database.prisma.promptDefinition.count();
    const beforeFormats = await database.prisma.articleFormatDefinition.count();

    const report = await inspectEditorialBrainRun({
      brainRepo,
      lifecycle: repo,
      brainRunId: flags["brain-run-id"],
      contentVersionId: flags["content-version-id"],
      reReview: flags["re-review"] === "1" || flags["re-review"] === "true" || "re-review" in flags,
    });

    const afterRuns = await database.prisma.editorialBrainRun.count();
    const afterExps = await database.prisma.editorialExperience.count();
    const afterLearning = await database.prisma.learningRule.count();
    const afterPrompts = await database.prisma.promptDefinition.count();
    const afterFormats = await database.prisma.articleFormatDefinition.count();

    printJson({
      ...report,
      dbWriteGuard: {
        editorialBrainRunCountUnchanged: beforeRuns === afterRuns,
        editorialExperienceCountUnchanged: beforeExps === afterExps,
        learningRuleCountUnchanged: beforeLearning === afterLearning,
        promptDefinitionCountUnchanged: beforePrompts === afterPrompts,
        articleFormatDefinitionCountUnchanged: beforeFormats === afterFormats,
      },
    });
  } finally {
    await database.disconnect();
  }
}

/**
 * Read-only: editorial-brain-inspect-repair --brain-run-id=
 * Compares initial vs repaired versions + A–G classification. No DB writes.
 */
export async function runEditorialBrainInspectRepair(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["brain-run-id"]) {
    console.error("Usage: editorial-brain-inspect-repair -- --brain-run-id=<id>");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig({ requireDatabaseUrl: true });
  void config;
  const database = createDatabaseClient();
  await database.connect();
  try {
    const repo = new LifecycleRepository(database.prisma);
    const brainRepo = repo.createEditorialBrainRepository();
    const run = await brainRepo.findBrainRun(flags["brain-run-id"]!);
    if (!run) {
      console.error(`BrainRun not found: ${flags["brain-run-id"]}`);
      process.exitCode = 1;
      return;
    }
    const { classifyRepairRun } = await import("./generation/repair-diagnostics.js");
    const meta = (run.metadata && typeof run.metadata === "object"
      ? run.metadata
      : {}) as Record<string, unknown>;
    const reviewResult = run.reviewResult as Record<string, unknown> | null;
    const initialReview =
      (reviewResult?.initial as import("./core/types.js").EditorialReviewReport | undefined) ??
      (run.reviewResult as import("./core/types.js").EditorialReviewReport | null);
    const postRepair =
      (reviewResult?.postRepair as import("./core/types.js").EditorialReviewReport | undefined) ??
      null;

    const repairedVid = run.contentVersionId;
    const repaired = repairedVid
      ? await database.prisma.contentVersion.findUnique({ where: { id: repairedVid } })
      : null;
    const parentId = repaired?.parentVersionId;
    const initial = parentId
      ? await database.prisma.contentVersion.findUnique({ where: { id: parentId } })
      : repaired;
    const ia = (initial?.structuredContent as { article?: Record<string, unknown> } | null)?.article;
    const ra = (repaired?.structuredContent as { article?: Record<string, unknown> } | null)?.article;
    const brainRepair = (
      repaired?.structuredContent as { brainRepair?: Record<string, unknown> } | null
    )?.brainRepair;

    const targetSegs = Array.isArray(meta.repairTargetSegments)
      ? (meta.repairTargetSegments as string[])
      : Array.isArray(brainRepair?.targets)
        ? (brainRepair!.targets as string[])
        : [];
    const operations = Array.isArray(meta.repairOperations)
      ? (meta.repairOperations as Array<{ segmentId: string; operation: string }>)
      : Array.isArray(brainRepair?.operations)
        ? (brainRepair!.operations as Array<{ segmentId: string; operation: string }>)
        : [];

    const getSeg = (article: Record<string, unknown> | undefined, seg: string): string => {
      if (!article) return "";
      if (seg === "title") return String(article.title ?? "");
      if (seg === "summary") return String(article.summary ?? "");
      if (seg === "lead") return String(article.lead ?? "");
      const m = /^section:(\d+):p(\d+)$/.exec(seg);
      if (m) {
        const sections = article.sections as Array<{ paragraphs?: string[] }> | undefined;
        return sections?.[Number(m[1])]?.paragraphs?.[Number(m[2])] ?? "";
      }
      return "";
    };

    if (!initialReview) {
      printJson({ error: "No initial review on BrainRun", brainRunId: run.id });
      return;
    }

    const diag = classifyRepairRun({
      initialReview,
      postRepairReview: postRepair,
      leadText: String(ia?.lead ?? ra?.lead ?? ""),
      targets: targetSegs.map((segmentId) => ({
        segmentId,
        originalText: getSeg(ia, segmentId),
        repairedText: getSeg(ra, segmentId),
        allowedClaimIds: [],
        operation: (operations.find((o) => o.segmentId === segmentId)?.operation ??
          null) as import("./generation/repair-operation.js").RepairOperation | null,
      })),
    });

    printJson({
      brainRunId: run.id,
      mode: run.mode,
      readOnly: true,
      initialDecision: meta.initialReview ?? initialReview.decision,
      repairTargetSegments: targetSegs,
      repairOperations: operations,
      repairModelRunId: meta.repairModelRunId ?? brainRepair?.repairModelRunId ?? null,
      finalShadowDecision: meta.finalShadowDecision ?? run.finalDecision,
      successValidation: meta.successValidation ?? brainRepair?.successValidation ?? null,
      diagnostics: diag,
      initialArtifact: ia
        ? { title: ia.title, lead: ia.lead, summary: ia.summary, sections: ia.sections }
        : null,
      repairedArtifact: ra
        ? { title: ra.title, lead: ra.lead, summary: ra.summary, sections: ra.sections }
        : null,
      note: "A–G classification is diagnostic only; no new quality rules applied.",
    });
  } finally {
    await database.disconnect();
  }
}

/**
 * Read-only ACTIVE cutover impact audit. Never writes DB.
 */
export async function runEditorialBrainAuditActiveCutover(_argv: string[]): Promise<void> {
  loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const beforeLearning = await database.prisma.learningRule.count();
    const beforePrompts = await database.prisma.promptDefinition.count();
    const { auditActiveCutover } = await import("./cutover/audit-active-cutover.js");
    const report = await auditActiveCutover(database.prisma);
    const afterLearning = await database.prisma.learningRule.count();
    const afterPrompts = await database.prisma.promptDefinition.count();
    printJson({
      ...report,
      productionModeUnchanged: true,
      editorialBrainModeDefaultRemainsShadow: true,
      dbWriteGuard: {
        learningRuleCountUnchanged: beforeLearning === afterLearning,
        promptDefinitionCountUnchanged: beforePrompts === afterPrompts,
      },
    });
  } finally {
    await database.disconnect();
  }
}

/**
 * Dry-run cutover plan for REVIEWING_PRE_BRAIN. Writes plan JSON for execute.
 * Usage: editorial-brain-plan-active-cutover [-- --out=/tmp/cutover-plan.json]
 */
export async function runEditorialBrainPlanActiveCutover(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const outPath = flags.out ?? "/tmp/editorial-brain-active-cutover-plan.json";
  loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const beforeLearning = await database.prisma.learningRule.count();
    const beforePrompts = await database.prisma.promptDefinition.count();
    const repo = new LifecycleRepository(database.prisma);
    const { planActiveCutover } = await import("./cutover/plan-active-cutover.js");
    const { ensureChannelModulesRegistered } = await import("./shadow/observe.js");
    ensureChannelModulesRegistered();
    const plan = await planActiveCutover({ prisma: database.prisma, repo });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
    const afterLearning = await database.prisma.learningRule.count();
    const afterPrompts = await database.prisma.promptDefinition.count();
    printJson({
      readOnly: true,
      planId: plan.planId,
      snapshotHash: plan.snapshotHash,
      outPath,
      totalReviewed: plan.totalReviewed,
      acceptableExisting: plan.acceptableExisting,
      requiresRegen: plan.requiresRegen,
      badInput: plan.badInput,
      unsafeAmbiguous: plan.unsafeAmbiguous,
      skippedAlreadyManaged: plan.skippedAlreadyManaged,
      skippedPublishedHistorical: plan.skippedPublishedHistorical,
      skippedObsolete: plan.skippedObsolete,
      skippedSuperseded: plan.skippedSuperseded,
      currentPublicationCandidateCount: plan.currentPublicationCandidateCount,
      obsoleteOrSupersededCount: plan.obsoleteOrSupersededCount,
      inScopeCount: plan.inScopeCount,
      executableVersionIds: plan.executableVersionIds,
      bucketSummaries: {
        ACCEPTABLE_EXISTING: plan.buckets.ACCEPTABLE_EXISTING.map((i) => ({
          contentVersionId: i.contentVersionId,
          contentId: i.contentId,
          title: i.title,
          brainDecision: i.brainDecision,
          failureCodes: i.failureCodes,
          stampEligible: i.stampEligible,
          productionRelevance: i.productionRelevance,
        })),
        REQUIRES_REGEN: plan.buckets.REQUIRES_REGEN.map((i) => ({
          contentVersionId: i.contentVersionId,
          contentId: i.contentId,
          title: i.title,
          brainDecision: i.brainDecision,
          regenerationReason: i.regenerationReason,
          failureCodes: i.failureCodes,
          productionRelevance: i.productionRelevance,
        })),
        BAD_INPUT: plan.buckets.BAD_INPUT.map((i) => ({
          contentVersionId: i.contentVersionId,
          title: i.title,
          failureCodes: i.failureCodes,
        })),
        UNSAFE_AMBIGUOUS: plan.buckets.UNSAFE_AMBIGUOUS.map((i) => ({
          contentVersionId: i.contentVersionId,
          title: i.title,
          brainDecision: i.brainDecision,
        })),
      },
      dbWriteGuard: {
        learningRuleCountUnchanged: beforeLearning === afterLearning,
        promptDefinitionCountUnchanged: beforePrompts === afterPrompts,
        note: "Plan file written to disk only; no LearningRule/Prompt/DB content writes",
      },
    });
  } finally {
    await database.disconnect();
  }
}

/**
 * Execute cutover plan (per-version stamp). Does not flip EDITORIAL_BRAIN_MODE.
 * Usage: editorial-brain-execute-active-cutover -- --plan-file=/tmp/...json
 */
export async function runEditorialBrainExecuteActiveCutover(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const planFile = flags["plan-file"] ?? flags.plan ?? "/tmp/editorial-brain-active-cutover-plan.json";
  if (flags["plan-id"] && !flags["plan-file"] && !flags.plan) {
    // plan-id alone is not enough without file — require plan-file
  }
  loadConfig({ requireDatabaseUrl: true });
  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync(planFile)) {
    console.error(`Plan file not found: ${planFile}. Run plan-active-cutover first.`);
    process.exitCode = 1;
    return;
  }
  const plan = JSON.parse(readFileSync(planFile, "utf8")) as import("./cutover/plan-active-cutover.js").ActiveCutoverPlan;
  if (flags["plan-id"] && flags["plan-id"] !== plan.planId) {
    console.error(`Plan id mismatch: flag=${flags["plan-id"]} file=${plan.planId}`);
    process.exitCode = 1;
    return;
  }

  const database = createDatabaseClient();
  await database.connect();
  try {
    const beforeLearning = await database.prisma.learningRule.count();
    const beforePrompts = await database.prisma.promptDefinition.count();
    const repo = new LifecycleRepository(database.prisma);
    const { executeActiveCutover } = await import("./cutover/execute-active-cutover.js");
    const { ensureChannelModulesRegistered } = await import("./shadow/observe.js");
    ensureChannelModulesRegistered();
    const report = await executeActiveCutover({
      prisma: database.prisma,
      repo,
      plan,
      requireSnapshotMatch: true,
    });
    const afterLearning = await database.prisma.learningRule.count();
    const afterPrompts = await database.prisma.promptDefinition.count();
    printJson({
      ...report,
      editorialBrainModeUnchanged: true,
      learningRuleUnchanged: beforeLearning === afterLearning,
      promptUnchanged: beforePrompts === afterPrompts,
    });
  } finally {
    await database.disconnect();
  }
}

/**
 * Explicit single-version lifecycle stamp (no body mutation, no bulk accept).
 * Use --as-active=1 to apply ACTIVE authority semantics without flipping env default.
 */
export async function runEditorialBrainStampExisting(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-version-id"]) {
    console.error(
      "Usage: editorial-brain-stamp-existing -- --content-version-id=<id> [--as-active=1]",
    );
    process.exitCode = 1;
    return;
  }
  loadConfig({ requireDatabaseUrl: true });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const repo = new LifecycleRepository(database.prisma);
    const { stampExistingContentVersion } = await import("./cutover/stamp-existing.js");
    const result = await stampExistingContentVersion({
      repo,
      contentVersionId: flags["content-version-id"]!,
      asActive:
        flags["as-active"] === "1" ||
        flags["as-active"] === "true" ||
        "as-active" in flags,
    });
    printJson({
      ...result,
      note: "Does not mutate article body; does not auto-approve/publish; does not flip EDITORIAL_BRAIN_MODE default",
    });
  } finally {
    await database.disconnect();
  }
}

/** Pure preview used by preflight — no DB writes. */
export function previewBrainPlansFromPreflight(input: {
  formatKey: string;
  contentType?: string;
  structurePatternId: string | null;
  editorialPatternId: string | null;
  availableClaims: Array<{ id: string; statement: string; kind: string }>;
  selectedClaims: Array<{ id: string; statement: string; kind: string }>;
  deferredClaimIds: string[];
  openingClaimIds: string[];
  hookClaimIds: string[];
  developmentClaimIds: string[];
  softLengthGuidance?: { targetMaxCharsApprox: number; targetMaxParagraphs: number };
}) {
  const corePlan = buildCoreEditorialPlan({
    channel: "BLOG",
    formatKey: input.formatKey,
    contentType: input.contentType ?? "blogger-article",
    availableClaims: input.availableClaims,
    selectedClaims: input.selectedClaims,
    deferredClaimIds: input.deferredClaimIds,
    openingClaimIds: input.openingClaimIds,
    hookClaimIds: input.hookClaimIds,
    developmentClaimIds: input.developmentClaimIds,
    structurePatternId: input.structurePatternId,
    editorialPatternId: input.editorialPatternId,
    softLengthGuidance: input.softLengthGuidance,
  });
  const channelPlan = buildBlogChannelPlan(corePlan);
  const hook = new Set(
    corePlan.claimAllocation.filter((a) => a.role === "opening").map((a) => a.claimId),
  );
  const overlap = corePlan.claimAllocation
    .filter((a) => a.role === "development" && hook.has(a.claimId))
    .map((a) => a.claimId);
  return {
    corePlanPreview: {
      openingDriverClaimIds: corePlan.openingDriverClaimIds,
      claimAllocation: corePlan.claimAllocation,
      developmentDepth: corePlan.developmentDepth,
      informationGainTarget: corePlan.informationGainTarget,
      scarcityMode: corePlan.scarcityMode,
      titleStrategy: corePlan.titleStrategy,
      summaryStrategy: corePlan.summaryStrategy,
      ctaStrategy: corePlan.ctaStrategy,
      claimProfile: corePlan.claimProfile,
    },
    blogChannelPlanPreview: {
      channel: channelPlan.channel,
      specifics: channelPlan.specifics,
    },
    claimAllocationOverlap: overlap,
    brainShadowObservationPossible: true,
  };
}
