/**
 * Identity and reuse rules for one X copy generation.
 * The writer, prompt, and review stay the same. Only repeated generation is skipped.
 */

import { createHash } from "node:crypto";
import type { XAdaptedPost, XSocialAdaptationResult } from "./x-social-adaptation.js";
import type { XSocialPlan } from "./social-plan.js";

export const X_COPY_ARTIFACT_KEY = "xCopyArtifact";
export const X_COPY_REUSE_POLICY_VERSION = "x-copy-reuse-v1";

/** Logical generations of the same fingerprint. Internal writer rewrites stay inside one generation. */
export const MAX_LOGICAL_X_COPY_GENERATIONS = 3;
export const X_COPY_GENERATING_TTL_MS = 3 * 60 * 1000;
export const X_COPY_QUALITY_RETRY_MS = 6 * 60 * 60 * 1000;
export const X_COPY_TRANSIENT_RETRY_MS = 5 * 60 * 1000;

export type XCopyArtifactState = "PASS" | "REJECTED_QUALITY" | "FAILED_TRANSIENT" | "GENERATING";

export type XCopyIdentity = {
  cid: string;
  contentVersionId: string;
  destinationUrl: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  canonicalTitle: string;
  performerNames: string[];
  seriesName: string | null;
  claimStatements: Array<{ id: string; statement: string }>;
  articlePlanFactTexts: string[];
  productTitle: string | null;
  officialDescription: string | null;
  mediaUrls: string[];
};

export type StoredXSocialPlan = {
  whatIsInteresting: string;
  angle: string;
  publicationIntent: XSocialPlan["publicationIntent"];
  subject: string | null;
};

export type StoredXAdaptation = {
  threadShape: XSocialAdaptationResult["threadShape"];
  threadReason: string;
  linkMode: XSocialAdaptationResult["linkMode"];
  publicationStrategy: XSocialAdaptationResult["publicationStrategy"];
  publicationStrategyReason: string;
  posts: XAdaptedPost[];
  parentBody: string | null;
  publicationIntent: XSocialAdaptationResult["publicationIntent"];
  canonicalTitleUsed: string;
  hooks: string[];
  skip: XSocialAdaptationResult["skip"];
  wpUrl: string | null;
  fanzaUrl: string | null;
  mediaMode: XSocialAdaptationResult["mediaMode"];
  mediaUrl: string | null;
  mediaReason: string;
  mediaRole: XSocialAdaptationResult["mediaRole"];
  warnings: string[];
  tracking: XSocialAdaptationResult["tracking"];
  writerMode: XSocialAdaptationResult["writerMode"];
  socialPlan: StoredXSocialPlan | null;
};

export type XCopyArtifact = {
  version: 1;
  fingerprint: string;
  state: XCopyArtifactState;
  cid: string;
  contentVersionId: string;
  destinationUrl: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
  logicalGenerationCount: number;
  nextRetryAt: string | null;
  generatingUntil: string | null;
  ownerToken: string | null;
  logicalGenerationId: string | null;
  skipReason: string | null;
  failureClass: string | null;
  adaptation: StoredXAdaptation | null;
};

export type XCopyClaim =
  | { action: "reuse"; artifact: XCopyArtifact }
  | { action: "wait"; artifact: XCopyArtifact }
  | { action: "exhausted"; artifact: XCopyArtifact }
  | { action: "claim"; artifact: XCopyArtifact };

export function xCopyInputFingerprint(identity: XCopyIdentity): string {
  const payload = {
    cid: identity.cid.trim().toLowerCase(),
    contentVersionId: identity.contentVersionId,
    destinationUrl: identity.destinationUrl.trim(),
    model: identity.model,
    promptVersion: identity.promptVersion,
    policyVersion: identity.policyVersion,
    canonicalTitle: identity.canonicalTitle,
    performerNames: [...identity.performerNames].sort(),
    seriesName: identity.seriesName,
    claims: identity.claimStatements.map((claim) => `${claim.id}\t${claim.statement}`).sort(),
    facts: [...identity.articlePlanFactTexts].sort(),
    productTitle: identity.productTitle,
    officialDescription: identity.officialDescription,
    media: [...identity.mediaUrls].sort(),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readXCopyArtifact(rawData: unknown): XCopyArtifact | null {
  const root = asRecord(rawData);
  const raw = root?.[X_COPY_ARTIFACT_KEY];
  const artifact = asRecord(raw);
  if (!artifact) return null;
  if (artifact.version !== 1) return null;
  if (typeof artifact.fingerprint !== "string" || typeof artifact.state !== "string") return null;
  if (typeof artifact.logicalGenerationCount !== "number") return null;
  const parsed = artifact as unknown as XCopyArtifact;
  if (parsed.state === "PASS") {
    const posts = parsed.adaptation?.posts;
    if (!Array.isArray(posts) || posts.length === 0) return null;
  }
  return parsed;
}

export function writeXCopyArtifact(
  rawData: unknown,
  artifact: XCopyArtifact,
): Record<string, unknown> {
  const root = asRecord(rawData) ?? {};
  return { ...root, [X_COPY_ARTIFACT_KEY]: artifact };
}

export function snapshotXAdaptation(result: XSocialAdaptationResult): StoredXAdaptation {
  const plan = result.socialPlan;
  return {
    threadShape: result.threadShape,
    threadReason: result.threadReason,
    linkMode: result.linkMode,
    publicationStrategy: result.publicationStrategy,
    publicationStrategyReason: result.publicationStrategyReason,
    posts: result.posts,
    parentBody: result.parentBody,
    publicationIntent: result.publicationIntent,
    canonicalTitleUsed: result.canonicalTitleUsed,
    hooks: result.hooks,
    skip: result.skip,
    wpUrl: result.wpUrl,
    fanzaUrl: result.fanzaUrl,
    mediaMode: result.mediaMode,
    mediaUrl: result.mediaUrl,
    mediaReason: result.mediaReason,
    mediaRole: result.mediaRole,
    warnings: result.warnings,
    tracking: result.tracking,
    writerMode: result.writerMode,
    socialPlan: plan
      ? {
          whatIsInteresting: plan.whatIsInteresting,
          angle: plan.angle,
          publicationIntent: plan.publicationIntent,
          subject: plan.subject,
        }
      : null,
  };
}

export function restoreXAdaptation(stored: StoredXAdaptation): XSocialAdaptationResult {
  return {
    threadShape: stored.threadShape,
    threadReason: stored.threadReason,
    linkMode: stored.linkMode,
    publicationStrategy: stored.publicationStrategy,
    publicationStrategyReason: stored.publicationStrategyReason,
    posts: stored.posts,
    parentBody: stored.parentBody,
    publicationIntent: stored.publicationIntent,
    canonicalTitleUsed: stored.canonicalTitleUsed,
    wpTitleUsedAsSoleInput: false,
    titleDivergence: false,
    hooks: stored.hooks ?? [],
    selectedFacts: [],
    discardedTaxonomy: [],
    realizedLines: [],
    productNameCopyRate: 0,
    skip: stored.skip,
    socialPlan: stored.socialPlan as XSocialPlan | null,
    reviewFindings: [],
    review: null,
    writerMode: stored.writerMode,
    wpUrl: stored.wpUrl,
    fanzaUrl: stored.fanzaUrl,
    relatedXPost: null,
    mediaMode: stored.mediaMode,
    mediaUrl: stored.mediaUrl,
    mediaReason: stored.mediaReason,
    mediaRole: stored.mediaRole,
    warnings: stored.warnings ?? [],
    tracking: stored.tracking,
  };
}

export function beginXCopyGeneration(input: {
  existing: XCopyArtifact | null;
  identity: XCopyIdentity;
  fingerprint: string;
  now: Date;
  ownerToken: string;
  logicalGenerationId: string;
}): XCopyClaim {
  const nowMs = input.now.getTime();
  const existing = input.existing;
  const same = existing?.fingerprint === input.fingerprint ? existing : null;

  if (same?.state === "GENERATING") {
    const until = same.generatingUntil ? Date.parse(same.generatingUntil) : 0;
    if (Number.isFinite(until) && until > nowMs) return { action: "wait", artifact: same };
  }
  if (same?.state === "PASS") return { action: "reuse", artifact: same };
  if (same && same.state !== "GENERATING") {
    const retryAt = same.nextRetryAt ? Date.parse(same.nextRetryAt) : 0;
    if (Number.isFinite(retryAt) && retryAt > nowMs) return { action: "reuse", artifact: same };
    if (same.logicalGenerationCount >= MAX_LOGICAL_X_COPY_GENERATIONS) {
      return { action: "exhausted", artifact: same };
    }
  }
  if (same?.state === "GENERATING" && same.logicalGenerationCount >= MAX_LOGICAL_X_COPY_GENERATIONS) {
    return { action: "exhausted", artifact: same };
  }

  const priorCount = same?.logicalGenerationCount ?? 0;
  const artifact: XCopyArtifact = {
    version: 1,
    fingerprint: input.fingerprint,
    state: "GENERATING",
    cid: input.identity.cid.trim().toLowerCase(),
    contentVersionId: input.identity.contentVersionId,
    destinationUrl: input.identity.destinationUrl.trim(),
    model: input.identity.model,
    promptVersion: input.identity.promptVersion,
    policyVersion: input.identity.policyVersion,
    createdAt: same?.createdAt ?? input.now.toISOString(),
    updatedAt: input.now.toISOString(),
    logicalGenerationCount: priorCount + 1,
    nextRetryAt: null,
    generatingUntil: new Date(nowMs + X_COPY_GENERATING_TTL_MS).toISOString(),
    ownerToken: input.ownerToken,
    logicalGenerationId: input.logicalGenerationId,
    skipReason: null,
    failureClass: null,
    adaptation: null,
  };
  return { action: "claim", artifact };
}

export function completeXCopyGeneration(input: {
  current: XCopyArtifact | null;
  ownerToken: string;
  now: Date;
  state: Exclude<XCopyArtifactState, "GENERATING">;
  adaptation: StoredXAdaptation | null;
  skipReason: string | null;
  failureClass: string | null;
}): { artifact: XCopyArtifact | null; committed: boolean } {
  const current = input.current;
  if (!current || current.ownerToken !== input.ownerToken || current.state !== "GENERATING") {
    return { artifact: current, committed: false };
  }
  const nextRetryAt =
    input.state === "PASS"
      ? null
      : new Date(
          input.now.getTime() +
            (input.state === "FAILED_TRANSIENT" ? X_COPY_TRANSIENT_RETRY_MS : X_COPY_QUALITY_RETRY_MS),
        ).toISOString();
  return {
    committed: true,
    artifact: {
      ...current,
      state: input.state,
      updatedAt: input.now.toISOString(),
      nextRetryAt,
      generatingUntil: null,
      ownerToken: null,
      skipReason: input.skipReason,
      failureClass: input.failureClass,
      adaptation: input.adaptation,
    },
  };
}

export function classifyXCopyOutcome(input: {
  passesGate: boolean;
  failureClass: string | null;
}): Exclude<XCopyArtifactState, "GENERATING"> {
  if (input.passesGate) return "PASS";
  if (input.failureClass === "GENERATION_FAILURE") return "FAILED_TRANSIENT";
  return "REJECTED_QUALITY";
}

export type XCopyStoreMutation<T> = {
  rawData?: Record<string, unknown>;
  value: T;
};

/** Short critical section. Callers must not run the model while this is held. */
export type XCopyArtifactStore = {
  transact<T>(
    fn: (rawData: unknown) => Promise<XCopyStoreMutation<T>> | XCopyStoreMutation<T>,
  ): Promise<T>;
};
