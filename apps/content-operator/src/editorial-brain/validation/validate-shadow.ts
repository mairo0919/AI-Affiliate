/**
 * Editorial Brain Shadow Validation — read-only.
 * Compares Brain review vs provisional human judgments across claim profiles.
 * Does NOT write DB / LearningRule / Prompt / Experience (observation-only CLI).
 */

import type { EditorialBrainRepository, LifecycleRepository } from "@ai-affiliate/database";
import { buildClaimProfileFingerprint } from "../core/claim-profile.js";
import { buildCoreEditorialPlan } from "../core/planner.js";
import type { BrainDecision, EditorialReviewReport } from "../core/types.js";
import {
  reviewArtifactShadow,
  type ReviewableBlogArtifact,
  type ReviewableXArtifact,
} from "../shadow/reviewer.js";
import {
  classifyClaimProfiles,
  inferClaimKindFromStatement,
  type ValidationClaimProfileTag,
} from "./claim-profile-tags.js";
import { VALIDATION_FIXTURES, type ValidationFixture } from "./fixtures.js";

export type HumanAxis = "ok" | "weak" | "fail";
export type HumanOverall = "PASS" | "REPAIR" | "REGEN";

export type HumanJudgment = {
  overall: HumanOverall;
  grounding: HumanAxis;
  repetition: HumanAxis;
  inference: HumanAxis;
  filler: HumanAxis;
  informationGain: HumanAxis;
  notes: string;
  judgedBy: "provisional_editorial_review";
};

export type MismatchClass =
  | "assertion_extraction_error"
  | "entailment_error"
  | "repetition_equivalence_error"
  | "role_awareness_error"
  | "information_gain_accounting_error"
  | "taxonomy_mapping_error"
  | "channel_responsibility_error"
  | "genuinely_ambiguous_or_needs_semantic_model"
  | "none";

export type ValidationSampleResult = {
  sampleId: string;
  source: "production" | "fixture";
  contentVersionId: string | null;
  brainRunId: string | null;
  formatKey: string;
  channel: "BLOG" | "X";
  claimProfile: string;
  profileTags: ValidationClaimProfileTag[] | string[];
  selectionReason: string;
  selectedClaimIds: string[];
  assignedClaimIds: string[];
  claimKinds: Record<string, number>;
  assertionCount: number;
  supportedNovelAssertionCount: number;
  unsupportedAssertionCount: number;
  repetitionCount: number;
  inferenceClasses: {
    nameDerived: number;
    interpretive: number;
    evaluative: number;
    socialProof: number;
    unsupported: number;
  };
  informationGainTarget: number;
  informationGainActual: number;
  brainDecision: BrainDecision;
  failureCodes: string[];
  humanJudgment: HumanJudgment;
  agreement: {
    overallDecision: boolean;
    grounding: boolean;
    repetition: boolean;
    inference: boolean;
    filler: boolean;
    informationGain: boolean;
  };
  falsePositiveCandidate: boolean;
  falseNegativeCandidate: boolean;
  mismatchClasses: MismatchClass[];
  failingAssertionSamples: Array<{
    supportType: string;
    sourceSegment: string;
    failureCodes: string[];
    assertionPreview: string;
  }>;
  bodyUnits: number;
};

export type ShadowValidationReport = {
  phase: "EDITORIAL_BRAIN_SHADOW_VALIDATION";
  readOnly: true;
  llmCalls: 0;
  sampleCount: number;
  samples: ValidationSampleResult[];
  byClaimProfile: Record<string, string[]>;
  brainDecisions: Record<string, number>;
  failureCodeCounts: Record<string, number>;
  falsePositiveCandidates: Array<{ sampleId: string; reason: string }>;
  falseNegativeCandidates: Array<{ sampleId: string; reason: string }>;
  groundingAgreement: { agree: number; disagree: number; disagreeSampleIds: string[] };
  repetitionAgreement: { agree: number; disagree: number; disagreeSampleIds: string[] };
  inferenceAgreement: { agree: number; disagree: number; disagreeSampleIds: string[] };
  fillerAgreement: { agree: number; disagree: number; disagreeSampleIds: string[] };
  informationGainAgreement: { agree: number; disagree: number; disagreeSampleIds: string[] };
  overallDecisionAgreement: { agree: number; disagree: number; disagreeSampleIds: string[] };
  coverageNotes: string[];
  activeCandidateRecommendation: "YES" | "NO";
  nextGeneralIssues: Array<{ priority: number; class: MismatchClass; summary: string }>;
};

/** Production ContentVersions selected for multi-profile coverage (same lineage OK as regression + quality variants). */
const PRODUCTION_SAMPLE_SPECS: Array<{
  contentVersionId: string;
  selectionReason: string;
  humanJudgment: Omit<HumanJudgment, "judgedBy">;
}> = [
  {
    contentVersionId: "cmsv7ivlt000fs7hoojm5ks6l",
    selectionReason:
      "Regression: BrainRun SHADOW sample — naming-risk + evaluation/interpretive (v9)",
    humanJudgment: {
      overall: "REPAIR",
      grounding: "fail",
      repetition: "weak",
      inference: "fail",
      filler: "ok",
      informationGain: "weak",
      notes:
        "シリーズ名からの水着/ナンパ設定推論、存在感が魅力、清楚系ながらの解釈はSUPPORTED外。REPAIR相当。",
    },
  },
  {
    contentVersionId: "cmsumcu8m000fs7aexc8zli38",
    selectionReason: "Evaluation-risk heavy production prose (v7)",
    humanJudgment: {
      overall: "REGEN",
      grounding: "fail",
      repetition: "weak",
      inference: "fail",
      filler: "fail",
      informationGain: "weak",
      notes:
        "プール舞台推論、見た目とは裏腹、適した作品、楽しめます、CTA filler。REGEN寄り。",
    },
  },
  {
    contentVersionId: "cmsujmtp7000fs7r0zp10csl6",
    selectionReason: "Identity-forward + evaluative pitch (v6)",
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "weak",
      inference: "fail",
      filler: "fail",
      informationGain: "weak",
      notes: "向いています/魅力を活かした等の評価とfiller。identity中心だが推論過多。",
    },
  },
  {
    contentVersionId: "cmsubf6rq000fs7kobt1n86vn",
    selectionReason: "Catalog + name-derived setting (v3)",
    humanJudgment: {
      overall: "REPAIR",
      grounding: "fail",
      repetition: "weak",
      inference: "fail",
      filler: "ok",
      informationGain: "ok",
      notes: "屋外水着テーマ推論 + カタログ一覧。REPAIR。",
    },
  },
  {
    contentVersionId: "cmsrp0io6000hs79uwaj1189d",
    selectionReason: "Early catalog/title-paste baseline (v1 APPROVED)",
    humanJudgment: {
      overall: "REGEN",
      grounding: "weak",
      repetition: "fail",
      inference: "weak",
      filler: "ok",
      informationGain: "weak",
      notes: "タイトル全文貼り付け + カタログ。editorial value低。REGEN相当。",
    },
  },
  {
    contentVersionId: "cmsueyr4v000fs7tsvwss4ozn",
    selectionReason: "Recommendation/eval-heavy mid version (v4)",
    humanJudgment: {
      overall: "REPAIR",
      grounding: "weak",
      repetition: "fail",
      inference: "fail",
      filler: "weak",
      informationGain: "weak",
      notes: "適した作品/向いています系の評価とリスト再掲。REPAIR。",
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function brainOverallBucket(decision: BrainDecision): "PASS" | "NON_PASS" {
  return decision === "PASS" ? "PASS" : "NON_PASS";
}

function humanOverallBucket(overall: HumanOverall): "PASS" | "NON_PASS" {
  return overall === "PASS" ? "PASS" : "NON_PASS";
}

function axisAgree(human: HumanAxis, brainFail: boolean): boolean {
  // human ok → brain should not fail that axis; human fail → brain should fail; weak = soft agree either way
  if (human === "weak") return true;
  if (human === "ok") return !brainFail;
  return brainFail;
}

function classifyMismatches(sample: {
  agreement: ValidationSampleResult["agreement"];
  falsePositiveCandidate: boolean;
  falseNegativeCandidate: boolean;
  failureCodes: string[];
  humanJudgment: HumanJudgment;
  channel: "BLOG" | "X";
  profileTags: string[];
}): MismatchClass[] {
  if (
    sample.agreement.overallDecision &&
    sample.agreement.grounding &&
    sample.agreement.inference &&
    sample.agreement.repetition &&
    sample.agreement.filler &&
    sample.agreement.informationGain
  ) {
    return ["none"];
  }
  const out: MismatchClass[] = [];
  if (!sample.agreement.inference || !sample.agreement.grounding) {
    out.push("entailment_error");
  }
  if (!sample.agreement.repetition) {
    if (sample.falsePositiveCandidate) out.push("role_awareness_error");
    else out.push("repetition_equivalence_error");
  }
  if (!sample.agreement.informationGain) out.push("information_gain_accounting_error");
  if (
    sample.channel === "X" &&
    sample.failureCodes.some((c) =>
      ["NAME_DERIVED_INFERENCE", "GROUNDING"].includes(c),
    ) === false &&
    sample.humanJudgment.grounding === "ok" &&
    !sample.agreement.filler
  ) {
    out.push("channel_responsibility_error");
  }
  if (out.length === 0) out.push("genuinely_ambiguous_or_needs_semantic_model");
  return [...new Set(out)];
}

function reviewFromClaims(input: {
  channel: "BLOG" | "X";
  formatKey: string;
  contentType: string;
  claims: Array<{ id: string; statement: string; kind: string }>;
  openingClaimIds: string[];
  developmentClaimIds: string[];
  artifact: ReviewableBlogArtifact | ReviewableXArtifact;
}): { review: EditorialReviewReport; corePlan: ReturnType<typeof buildCoreEditorialPlan> } {
  const corePlan = buildCoreEditorialPlan({
    channel: input.channel,
    formatKey: input.formatKey,
    contentType: input.contentType,
    availableClaims: input.claims,
    selectedClaims: input.claims,
    openingClaimIds: input.openingClaimIds,
    hookClaimIds: input.openingClaimIds,
    developmentClaimIds: input.developmentClaimIds,
    structurePatternId: null,
    editorialPatternId: null,
  });
  const review = reviewArtifactShadow({
    artifact: input.artifact,
    corePlan,
    claimStatements: input.claims,
  });
  return { review, corePlan };
}

function toSampleResult(input: {
  sampleId: string;
  source: "production" | "fixture";
  contentVersionId: string | null;
  brainRunId: string | null;
  formatKey: string;
  channel: "BLOG" | "X";
  claims: Array<{ id: string; statement: string; kind: string }>;
  openingClaimIds: string[];
  developmentClaimIds: string[];
  profileTags: string[];
  selectionReason: string;
  humanJudgment: HumanJudgment;
  review: EditorialReviewReport;
  corePlan: ReturnType<typeof buildCoreEditorialPlan>;
}): ValidationSampleResult {
  const stats = input.review.metrics.assertionSupportStats;
  const codes = input.review.failures.map((f) => f.code);
  const groundingFail = codes.some((c) =>
    [
      "GROUNDING",
      "UNSUPPORTED_INFERENCE",
      "NAME_DERIVED_INFERENCE",
      "INTERPRETIVE_INFERENCE",
      "EVALUATIVE_INFERENCE",
      "SOCIAL_PROOF",
    ].includes(c),
  );
  const repetitionFail = codes.includes("REPETITION");
  const inferenceFail = codes.some((c) =>
    [
      "UNSUPPORTED_INFERENCE",
      "NAME_DERIVED_INFERENCE",
      "INTERPRETIVE_INFERENCE",
      "EVALUATIVE_INFERENCE",
    ].includes(c),
  );
  const fillerFail = codes.includes("FILLER") || codes.includes("CTA");
  const gainFail =
    codes.includes("INFORMATION_GAIN_LOW") || codes.includes("INFORMATION_DENSITY_LOW");

  const agreement = {
    overallDecision:
      brainOverallBucket(input.review.decision) ===
      humanOverallBucket(input.humanJudgment.overall),
    grounding: axisAgree(input.humanJudgment.grounding, groundingFail),
    repetition: axisAgree(input.humanJudgment.repetition, repetitionFail),
    inference: axisAgree(input.humanJudgment.inference, inferenceFail),
    filler: axisAgree(input.humanJudgment.filler, fillerFail),
    informationGain: axisAgree(input.humanJudgment.informationGain, gainFail),
  };

  const falsePositiveCandidate =
    humanOverallBucket(input.humanJudgment.overall) === "PASS" &&
    brainOverallBucket(input.review.decision) === "NON_PASS";
  const falseNegativeCandidate =
    humanOverallBucket(input.humanJudgment.overall) === "NON_PASS" &&
    brainOverallBucket(input.review.decision) === "PASS";

  const kindCounts: Record<string, number> = {};
  for (const c of input.claims) {
    kindCounts[c.kind] = (kindCounts[c.kind] ?? 0) + 1;
  }

  const assigned = [
    ...new Set([...input.openingClaimIds, ...input.developmentClaimIds]),
  ];

  const base = {
    sampleId: input.sampleId,
    source: input.source,
    contentVersionId: input.contentVersionId,
    brainRunId: input.brainRunId,
    formatKey: input.formatKey,
    channel: input.channel,
    claimProfile: input.corePlan.claimProfile,
    profileTags: input.profileTags,
    selectionReason: input.selectionReason,
    selectedClaimIds: input.claims.map((c) => c.id),
    assignedClaimIds: assigned,
    claimKinds: kindCounts,
    assertionCount: stats.assertionCount,
    supportedNovelAssertionCount: stats.supportedNovelAssertionCount,
    unsupportedAssertionCount: stats.unsupportedAssertionCount,
    repetitionCount: stats.repetitionCount,
    inferenceClasses: {
      nameDerived: stats.nameDerivedCount,
      interpretive: stats.interpretiveCount,
      evaluative: stats.evaluativeCount,
      socialProof: stats.socialProofCount,
      unsupported: stats.unsupportedAssertionCount,
    },
    informationGainTarget: input.corePlan.informationGainTarget,
    informationGainActual: stats.supportedNovelAssertionCount,
    brainDecision: input.review.decision,
    failureCodes: codes,
    humanJudgment: input.humanJudgment,
    agreement,
    falsePositiveCandidate,
    falseNegativeCandidate,
    mismatchClasses: [] as MismatchClass[],
    failingAssertionSamples: (input.review.semanticAssertions ?? [])
      .filter((a) => a.failureCodes.length > 0)
      .slice(0, 8)
      .map((a) => ({
        supportType: a.supportType,
        sourceSegment: a.sourceSegment,
        failureCodes: a.failureCodes,
        assertionPreview: a.assertion.slice(0, 140),
      })),
    bodyUnits: input.review.metrics.bodyUnits,
  };
  base.mismatchClasses = classifyMismatches(base);
  return base;
}

async function evaluateProductionSample(
  lifecycle: LifecycleRepository,
  brainRepo: EditorialBrainRepository,
  spec: (typeof PRODUCTION_SAMPLE_SPECS)[number],
): Promise<ValidationSampleResult> {
  const version = await lifecycle.findContentVersion(spec.contentVersionId);
  if (!version) throw new Error(`ContentVersion not found: ${spec.contentVersionId}`);

  const brainRun = await brainRepo.findLatestBrainRunByContentVersion(spec.contentVersionId);
  const detail = await lifecycle.inspectContentLifecycle(version.contentId);
  const full = detail?.versions.find((v) => v.id === version.id);
  const rawClaims =
    full?.versionClaims?.map((vc) => vc.claim).filter((c) => c.status === "SUPPORTED") ?? [];

  const claims = rawClaims.map((c) => ({
    id: c.id,
    statement: c.statement,
    kind: inferClaimKindFromStatement(c.statement),
  }));
  if (claims.length === 0) {
    throw new Error(`No SUPPORTED claims on ${spec.contentVersionId}`);
  }

  const structured = asRecord(version.structuredContent);
  const article = asRecord(structured?.article);
  if (!article) throw new Error(`No structured article on ${spec.contentVersionId}`);

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

  // Prefer stored brain allocation when present; else heuristic: first trait/performer opening
  let openingClaimIds: string[] = [];
  let developmentClaimIds: string[] = [];
  const coreStored = asRecord(brainRun?.corePlan);
  if (Array.isArray(coreStored?.openingDriverClaimIds)) {
    openingClaimIds = (coreStored!.openingDriverClaimIds as unknown[])
      .map(String)
      .filter((id) => claims.some((c) => c.id === id));
  }
  if (Array.isArray(coreStored?.claimAllocation)) {
    developmentClaimIds = (coreStored!.claimAllocation as unknown[])
      .map((row) => asRecord(row))
      .filter((row): row is Record<string, unknown> => row !== null && row.role === "development")
      .map((row) => String(row.claimId))
      .filter((id) => claims.some((c) => c.id === id));
  }
  if (openingClaimIds.length === 0) {
    const trait = claims.find((c) => c.kind === "trait_or_scene");
    openingClaimIds = [trait?.id ?? claims[0]!.id];
  }
  if (developmentClaimIds.length === 0) {
    developmentClaimIds = claims
      .map((c) => c.id)
      .filter((id) => !openingClaimIds.includes(id));
  }

  const formatKey =
    typeof brainRun?.formatKey === "string" && brainRun.formatKey
      ? brainRun.formatKey
      : "NEW_RELEASE_SINGLE";
  const contentType = "blogger-article";
  const profileTags = classifyClaimProfiles(claims);

  const { review, corePlan } = reviewFromClaims({
    channel: "BLOG",
    formatKey,
    contentType,
    claims,
    openingClaimIds,
    developmentClaimIds,
    artifact,
  });

  return toSampleResult({
    sampleId: `prod-${version.versionNumber}-${spec.contentVersionId.slice(-6)}`,
    source: "production",
    contentVersionId: spec.contentVersionId,
    brainRunId: brainRun?.id ?? null,
    formatKey,
    channel: "BLOG",
    claims,
    openingClaimIds,
    developmentClaimIds,
    profileTags,
    selectionReason: spec.selectionReason,
    humanJudgment: { ...spec.humanJudgment, judgedBy: "provisional_editorial_review" },
    review,
    corePlan,
  });
}

function evaluateFixture(fx: ValidationFixture): ValidationSampleResult {
  const { review, corePlan } = reviewFromClaims({
    channel: fx.channel,
    formatKey: fx.formatKey,
    contentType: fx.contentType,
    claims: fx.claims,
    openingClaimIds: fx.openingClaimIds,
    developmentClaimIds: fx.developmentClaimIds,
    artifact: fx.artifact,
  });
  return toSampleResult({
    sampleId: fx.sampleId,
    source: "fixture",
    contentVersionId: null,
    brainRunId: null,
    formatKey: fx.formatKey,
    channel: fx.channel,
    claims: fx.claims,
    openingClaimIds: fx.openingClaimIds,
    developmentClaimIds: fx.developmentClaimIds,
    profileTags: fx.profileTags,
    selectionReason: fx.selectionReason,
    humanJudgment: { ...fx.humanJudgment, judgedBy: "provisional_editorial_review" },
    review,
    corePlan,
  });
}

function tallyAxis(
  samples: ValidationSampleResult[],
  key: keyof ValidationSampleResult["agreement"],
) {
  const disagreeSampleIds: string[] = [];
  let agree = 0;
  let disagree = 0;
  for (const s of samples) {
    if (s.agreement[key]) agree += 1;
    else {
      disagree += 1;
      disagreeSampleIds.push(s.sampleId);
    }
  }
  return { agree, disagree, disagreeSampleIds };
}

function recommendActive(samples: ValidationSampleResult[]): {
  recommendation: "YES" | "NO";
  nextGeneralIssues: ShadowValidationReport["nextGeneralIssues"];
} {
  const fps = samples.filter((s) => s.falsePositiveCandidate);
  const fns = samples.filter((s) => s.falseNegativeCandidate);
  const scarcePassOk = samples.some(
    (s) =>
      s.profileTags.includes("scarce") &&
      s.humanJudgment.overall === "PASS" &&
      s.brainDecision === "PASS",
  );
  const richPassOk = samples.some(
    (s) =>
      s.profileTags.includes("rich") &&
      s.humanJudgment.overall === "PASS" &&
      s.brainDecision === "PASS",
  );
  const namingDetected = samples.some(
    (s) =>
      s.humanJudgment.inference === "fail" &&
      s.failureCodes.includes("NAME_DERIVED_INFERENCE"),
  );
  const xBoundaryOk = samples
    .filter((s) => s.sampleId === "fixture-x-boundary-ok")
    .every((s) => !s.failureCodes.includes("NAME_DERIVED_INFERENCE"));

  const nextGeneralIssues: ShadowValidationReport["nextGeneralIssues"] = [];
  if (fps.length > 0) {
    nextGeneralIssues.push({
      priority: 1,
      class: "role_awareness_error",
      summary: `False positives (${fps.map((f) => f.sampleId).join(", ")}): tighten role-aware repetition / over-refusal before ACTIVE`,
    });
  }
  if (fns.length > 0) {
    nextGeneralIssues.push({
      priority: 1,
      class: "entailment_error",
      summary: `False negatives (${fns.map((f) => f.sampleId).join(", ")}): grounding miss on bad prose`,
    });
  }
  if (!scarcePassOk || !richPassOk) {
    nextGeneralIssues.push({
      priority: 2,
      class: "information_gain_accounting_error",
      summary: "Scarcity/rich normal-path PASS not both confirmed under Brain decision",
    });
  }
  const axisDisagreements = samples.filter(
    (s) =>
      !s.agreement.inference ||
      !s.agreement.repetition ||
      !s.agreement.filler ||
      !s.agreement.grounding,
  );
  if (axisDisagreements.length > 0) {
    nextGeneralIssues.unshift({
      priority: 1,
      class: axisDisagreements.some((s) => !s.agreement.repetition)
        ? "repetition_equivalence_error"
        : "entailment_error",
      summary: `Axis-level disagreements (overall still aligned): ${axisDisagreements
        .map((s) => s.sampleId)
        .join(", ")}`,
    });
  }

  // Only one production lineage in DB — coverage gap
  nextGeneralIssues.push({
    priority: 3,
    class: "genuinely_ambiguous_or_needs_semantic_model",
    summary:
      "Production DB has a single product lineage; need additional real ContentVersions across topics before ACTIVE",
  });

  const ok =
    fps.length === 0 &&
    fns.filter((s) => s.humanJudgment.grounding === "fail" || s.humanJudgment.inference === "fail")
      .length === 0 &&
    scarcePassOk &&
    richPassOk &&
    namingDetected &&
    xBoundaryOk &&
    axisDisagreements.length === 0 &&
    false; // force NO until multi-topic production coverage exists

  return {
    recommendation: ok ? "YES" : "NO",
    nextGeneralIssues: nextGeneralIssues.slice(0, 3),
  };
}

export async function runShadowValidation(input: {
  lifecycle: LifecycleRepository;
  brainRepo: EditorialBrainRepository;
  includeFixtures?: boolean;
}): Promise<ShadowValidationReport> {
  const samples: ValidationSampleResult[] = [];
  const coverageNotes: string[] = [];

  for (const spec of PRODUCTION_SAMPLE_SPECS) {
    samples.push(await evaluateProductionSample(input.lifecycle, input.brainRepo, spec));
  }
  coverageNotes.push(
    `Production samples=${PRODUCTION_SAMPLE_SPECS.length} from one blogger-article lineage (quality variants / regression).`,
  );

  if (input.includeFixtures !== false) {
    for (const fx of VALIDATION_FIXTURES) {
      samples.push(evaluateFixture(fx));
    }
    coverageNotes.push(
      `Fixtures=${VALIDATION_FIXTURES.length} fill scarce/rich/identity/naming/eval/X profiles without LLM generation.`,
    );
  }

  // Ensure fingerprint helper remains used (profile already from planner)
  void buildClaimProfileFingerprint;

  const byClaimProfile: Record<string, string[]> = {};
  for (const s of samples) {
    for (const tag of s.profileTags) {
      byClaimProfile[tag] = [...new Set([...(byClaimProfile[tag] ?? []), s.sampleId])];
    }
  }

  const brainDecisions: Record<string, number> = {};
  const failureCodeCounts: Record<string, number> = {};
  for (const s of samples) {
    brainDecisions[s.brainDecision] = (brainDecisions[s.brainDecision] ?? 0) + 1;
    for (const c of s.failureCodes) {
      failureCodeCounts[c] = (failureCodeCounts[c] ?? 0) + 1;
    }
  }

  const { recommendation, nextGeneralIssues } = recommendActive(samples);

  return {
    phase: "EDITORIAL_BRAIN_SHADOW_VALIDATION",
    readOnly: true,
    llmCalls: 0,
    sampleCount: samples.length,
    samples,
    byClaimProfile,
    brainDecisions,
    failureCodeCounts,
    falsePositiveCandidates: samples
      .filter((s) => s.falsePositiveCandidate)
      .map((s) => ({
        sampleId: s.sampleId,
        reason: `human PASS but Brain ${s.brainDecision}: ${s.failureCodes.join(",")}`,
      })),
    falseNegativeCandidates: samples
      .filter((s) => s.falseNegativeCandidate)
      .map((s) => ({
        sampleId: s.sampleId,
        reason: `human ${s.humanJudgment.overall} but Brain PASS`,
      })),
    groundingAgreement: tallyAxis(samples, "grounding"),
    repetitionAgreement: tallyAxis(samples, "repetition"),
    inferenceAgreement: tallyAxis(samples, "inference"),
    fillerAgreement: tallyAxis(samples, "filler"),
    informationGainAgreement: tallyAxis(samples, "informationGain"),
    overallDecisionAgreement: tallyAxis(samples, "overallDecision"),
    coverageNotes,
    activeCandidateRecommendation: recommendation,
    nextGeneralIssues,
  };
}
