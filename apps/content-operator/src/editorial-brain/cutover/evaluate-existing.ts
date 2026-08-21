/**
 * Shared evaluate-only logic for existing ContentVersion cutover.
 * Never mutates body. Persist is separate (stamp).
 */

import type { LifecycleRepository } from "@ai-affiliate/database";
import { detectBadInputClaims } from "../generation/bad-claim-input.js";
import { blogChannelModule } from "../channels/blog/adapter.js";
import { applyBrainProductionAuthority } from "../core/production-authority.js";
import type { BrainLifecycleRecord } from "../core/active-lifecycle.js";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import { parseBloggerArticle } from "../../generation/structured-article.js";

export type CutoverBucket =
  | "ACCEPTABLE_EXISTING"
  | "REQUIRES_REGEN"
  | "BAD_INPUT"
  | "UNSAFE_AMBIGUOUS"
  | "SKIP_ALREADY_MANAGED"
  | "SKIP_PUBLISHED_HISTORICAL"
  | "SKIP_OBSOLETE"
  | "SKIP_SUPERSEDED";

export type ProductionRelevance =
  | "CURRENT_PUBLICATION_CANDIDATE"
  | "HUMAN_APPROVAL_QUEUE"
  | "DRAFT_TARGET"
  | "OTHER_REVIEWING"
  | "SUPERSEDED"
  | "OBSOLETE_EXPERIMENT"
  | "PUBLISHED_HISTORICAL";

export type EvaluateExistingResult = {
  contentVersionId: string;
  contentId: string;
  title: string;
  channel: string;
  currentStatus: string;
  brainDecision: string;
  failureCodes: string[];
  hasRequiredProvenance: boolean;
  stampEligible: boolean;
  bucket: CutoverBucket;
  regenerationReason: string | null;
  hardValidationOk: boolean;
  proposedLifecycle: BrainLifecycleRecord | null;
  bodyMutated: false;
};

function hardValidateArticle(input: {
  title: string;
  body: string;
  article: { title: string; lead: string; summary: string; sections: unknown[] };
}): { ok: boolean; reason: string | null } {
  if (!input.title.trim() || input.body.trim().length < 40) {
    return { ok: false, reason: "HARD_SCHEMA_INCOMPLETE" };
  }
  if (/\[\[|__PRODUCT_LINK_|placeholder:/i.test(input.body)) {
    return { ok: false, reason: "HARD_INTERNAL_PLACEHOLDER" };
  }
  if (!Array.isArray(input.article.sections) || input.article.sections.length < 1) {
    return { ok: false, reason: "HARD_STRUCTURE_MISSING_SECTIONS" };
  }
  return { ok: true, reason: null };
}

/**
 * Read-only Brain evaluation of an existing ContentVersion for cutover.
 */
export async function evaluateExistingContentVersion(input: {
  repo: LifecycleRepository;
  contentVersionId: string;
}): Promise<EvaluateExistingResult> {
  const version = await input.repo.findContentVersion(input.contentVersionId);
  if (!version) {
    return {
      contentVersionId: input.contentVersionId,
      contentId: "",
      title: "",
      channel: "UNKNOWN",
      currentStatus: "MISSING",
      brainDecision: "ESCALATE",
      failureCodes: ["CONTENT_VERSION_NOT_FOUND"],
      hasRequiredProvenance: false,
      stampEligible: false,
      bucket: "UNSAFE_AMBIGUOUS",
      regenerationReason: "CONTENT_VERSION_NOT_FOUND",
      hardValidationOk: false,
      proposedLifecycle: null,
      bodyMutated: false,
    };
  }

  const structured =
    version.structuredContent && typeof version.structuredContent === "object"
      ? (version.structuredContent as Record<string, unknown>)
      : null;
  const channel =
    typeof structured?.channel === "string"
      ? structured.channel === "X"
        ? "X"
        : "BLOG"
      : "BLOG";

  const base = {
    contentVersionId: version.id,
    contentId: version.contentId,
    title: version.title,
    channel,
    currentStatus: version.status,
    bodyMutated: false as const,
  };

  const articleRaw = structured?.article;
  if (!articleRaw || typeof articleRaw !== "object") {
    const lifecycle = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: blogChannelModule.capabilities,
      brainDecision: "FULL_REGEN",
      repairAttempted: true,
      repairOutcome: "REGEN_CANDIDATE",
      legacyDecision: "CUTOVER_EVAL",
      initialContentVersionId: version.id,
    }).lifecycle;
    return {
      ...base,
      brainDecision: "FULL_REGEN",
      failureCodes: ["MISSING_STRUCTURED_ARTICLE"],
      hasRequiredProvenance: false,
      stampEligible: false,
      bucket: "REQUIRES_REGEN",
      regenerationReason: "MISSING_STRUCTURED_ARTICLE",
      hardValidationOk: false,
      proposedLifecycle: lifecycle,
    };
  }

  let article;
  try {
    article = parseBloggerArticle(articleRaw as Record<string, unknown>);
  } catch {
    const lifecycle = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: blogChannelModule.capabilities,
      brainDecision: "FULL_REGEN",
      repairAttempted: true,
      repairOutcome: "REGEN_CANDIDATE",
      legacyDecision: "CUTOVER_EVAL",
      initialContentVersionId: version.id,
    }).lifecycle;
    return {
      ...base,
      brainDecision: "FULL_REGEN",
      failureCodes: ["ARTICLE_PARSE_FAILED"],
      hasRequiredProvenance: false,
      stampEligible: false,
      bucket: "REQUIRES_REGEN",
      regenerationReason: "ARTICLE_PARSE_FAILED",
      hardValidationOk: false,
      proposedLifecycle: lifecycle,
    };
  }

  const hard = hardValidateArticle({
    title: version.title,
    body: version.body,
    article,
  });
  if (!hard.ok) {
    const lifecycle = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: blogChannelModule.capabilities,
      brainDecision: "FULL_REGEN",
      repairAttempted: true,
      repairOutcome: "REGEN_CANDIDATE",
      legacyDecision: "CUTOVER_EVAL",
      initialContentVersionId: version.id,
    }).lifecycle;
    return {
      ...base,
      brainDecision: "FULL_REGEN",
      failureCodes: [hard.reason ?? "HARD_FAIL"],
      hasRequiredProvenance: true,
      stampEligible: false,
      bucket: "REQUIRES_REGEN",
      regenerationReason: hard.reason,
      hardValidationOk: false,
      proposedLifecycle: lifecycle,
    };
  }

  const content = await input.repo.findContent(version.contentId);
  const claims = content?.strategyId
    ? await input.repo.listClaimsForStrategy(content.strategyId)
    : [];
  const supported = claims.filter((c) => c.status === "SUPPORTED");
  if (supported.length === 0) {
    const lifecycle = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: blogChannelModule.capabilities,
      brainDecision: "FULL_REGEN",
      repairAttempted: true,
      repairOutcome: "REGEN_CANDIDATE",
      legacyDecision: "CUTOVER_EVAL",
      initialContentVersionId: version.id,
    }).lifecycle;
    return {
      ...base,
      brainDecision: "FULL_REGEN",
      failureCodes: ["MISSING_SUPPORTED_CLAIMS"],
      hasRequiredProvenance: false,
      stampEligible: false,
      bucket: "REQUIRES_REGEN",
      regenerationReason: "MISSING_SUPPORTED_CLAIMS",
      hardValidationOk: true,
      proposedLifecycle: lifecycle,
    };
  }

  const claimRefs = supported.map((c) => ({
    id: c.id,
    statement: c.statement,
    kind: "other" as const,
  }));
  const bad = detectBadInputClaims(claimRefs);
  if (bad.length > 0) {
    const lifecycle = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: blogChannelModule.capabilities,
      brainDecision: "ESCALATE",
      badInput: true,
      legacyDecision: "CUTOVER_EVAL",
      initialContentVersionId: version.id,
    }).lifecycle;
    return {
      ...base,
      brainDecision: "ESCALATE",
      failureCodes: ["BAD_INPUT_CLAIM", ...bad.map((b) => b.code)],
      hasRequiredProvenance: true,
      stampEligible: false,
      bucket: "BAD_INPUT",
      regenerationReason: "BAD_INPUT_CLAIM",
      hardValidationOk: true,
      proposedLifecycle: lifecycle,
      bodyMutated: false,
    };
  }

  const opening = claimRefs.slice(0, 2).map((c) => c.id);
  const development = claimRefs.slice(2).map((c) => c.id);
  const corePlan = buildCoreEditorialPlan({
    channel: "BLOG",
    formatKey: null,
    contentType: "blogger-article",
    availableClaims: claimRefs,
    selectedClaims: claimRefs,
    openingClaimIds: opening,
    hookClaimIds: opening,
    developmentClaimIds: development,
    structurePatternId: null,
    editorialPatternId: null,
  });

  const review = reviewArtifactShadow({
    artifact: {
      channel: "BLOG",
      title: article.title,
      summary: article.summary,
      lead: article.lead,
      sections: article.sections.map((s) => ({
        paragraphs: s.paragraphs,
        lists: s.lists,
      })),
      bodyText: version.body,
    },
    corePlan,
    claimStatements: claimRefs.map((c) => ({ id: c.id, statement: c.statement })),
  });

  const failureCodes = review.failures.map((f) => f.code);

  if (review.decision === "PASS") {
    const lifecycle = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: blogChannelModule.capabilities,
      brainDecision: "PASS",
      legacyDecision: "CUTOVER_EVAL",
      initialContentVersionId: version.id,
    }).lifecycle;
    return {
      ...base,
      brainDecision: "PASS",
      failureCodes,
      hasRequiredProvenance: true,
      stampEligible: true,
      bucket: "ACCEPTABLE_EXISTING",
      regenerationReason: null,
      hardValidationOk: true,
      proposedLifecycle: lifecycle,
    };
  }

  if (review.decision === "TARGETED_REPAIR" || review.decision === "FULL_REGEN" || review.decision === "REPLAN") {
    const lifecycle = applyBrainProductionAuthority({
      mode: "ACTIVE",
      channel: "BLOG",
      channelCapabilities: blogChannelModule.capabilities,
      brainDecision: "TARGETED_REPAIR",
      repairAttempted: true,
      repairOutcome: "REGEN_CANDIDATE",
      legacyDecision: "CUTOVER_EVAL",
      initialContentVersionId: version.id,
    }).lifecycle;
    return {
      ...base,
      brainDecision: review.decision,
      failureCodes,
      hasRequiredProvenance: true,
      stampEligible: false,
      bucket: "REQUIRES_REGEN",
      regenerationReason: `BRAIN_${review.decision}`,
      hardValidationOk: true,
      proposedLifecycle: lifecycle,
    };
  }

  const lifecycle = applyBrainProductionAuthority({
    mode: "ACTIVE",
    channel: "BLOG",
    channelCapabilities: blogChannelModule.capabilities,
    brainDecision: review.decision,
    legacyDecision: "CUTOVER_EVAL",
    initialContentVersionId: version.id,
  }).lifecycle;
  return {
    ...base,
    brainDecision: review.decision,
    failureCodes,
    hasRequiredProvenance: true,
    stampEligible: false,
    bucket: "UNSAFE_AMBIGUOUS",
    regenerationReason: `BRAIN_${review.decision}`,
    hardValidationOk: true,
    proposedLifecycle: lifecycle,
  };
}
