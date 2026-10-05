/**
 * Probe and execute share one persisted X copy.
 * A cache miss still runs the existing writer, review, and official-URL gate.
 */

import { randomUUID } from "node:crypto";
import { textContainsWordPressUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import type { CanonicalXSource } from "./canonical-x-source.js";
import { classifyXDestination } from "./x-normal-destination.js";
import {
  X_COPY_REUSE_POLICY_VERSION,
  beginXCopyGeneration,
  classifyXCopyOutcome,
  completeXCopyGeneration,
  readXCopyArtifact,
  type XCopyClaim,
  restoreXAdaptation,
  snapshotXAdaptation,
  writeXCopyArtifact,
  xCopyInputFingerprint,
  type XCopyArtifact,
  type XCopyArtifactStore,
  type XCopyIdentity,
} from "./x-copy-artifact.js";
import { X_SOCIAL_ADAPTATION_FORMAT, type XSocialAdaptationResult } from "./x-social-adaptation.js";
import { X_SOCIAL_WRITER_PROMPT_VERSION } from "./social-write.js";

export type { XCopyArtifactStore } from "./x-copy-artifact.js";

export type XCopyGenerationContext = {
  logicalGenerationId: string;
  fingerprint: string;
  trigger: "probe" | "execute";
};

export function xCopyIdentityFromSource(input: {
  source: CanonicalXSource;
  destinationUrl: string;
  model: string;
}): XCopyIdentity {
  return {
    cid: input.source.cid,
    contentVersionId: input.source.contentVersionId ?? "",
    destinationUrl: input.destinationUrl,
    model: input.model,
    promptVersion: X_SOCIAL_WRITER_PROMPT_VERSION,
    policyVersion: `${X_COPY_REUSE_POLICY_VERSION}:${X_SOCIAL_ADAPTATION_FORMAT}`,
    canonicalTitle: input.source.canonicalTitle,
    performerNames: input.source.performerNames,
    seriesName: input.source.seriesName,
    claimStatements: input.source.claimStatements,
    articlePlanFactTexts: input.source.articlePlanFacts.map((fact) => fact.text),
    productTitle: input.source.productTitle,
    officialDescription: input.source.officialDescription,
    mediaUrls: input.source.articleImages.map(
      (image) => `${image.researchImageId ?? ""}|${image.sourceUrl}`,
    ),
  };
}

export function xScheduleGate(adapted: {
  skip: { reason: string; detail?: string } | null;
  posts: Array<{ body: string }>;
  publicationStrategy: string;
  fanzaUrl: string | null;
}): { pass: true } | { pass: false; skipReason: string } {
  if (adapted.skip?.detail === "X_COPY_GENERATION_IN_PROGRESS") {
    return { pass: false, skipReason: "X_COPY_GENERATION_IN_PROGRESS" };
  }
  if (adapted.skip || adapted.posts.length === 0) {
    return { pass: false, skipReason: adapted.skip?.reason ?? "SOCIAL_CONTENT_TOO_THIN" };
  }
  if (
    adapted.publicationStrategy !== "FANZA_NORMAL" ||
    adapted.posts.some((post) => textContainsWordPressUrl(post.body)) ||
    !postsUseNormalDestination(adapted.posts) ||
    !adapted.fanzaUrl
  ) {
    return { pass: false, skipReason: "BLOCKED_INVALID_X_DESTINATION" };
  }
  return { pass: true };
}

function postsUseNormalDestination(posts: Array<{ body: string }>): boolean {
  return posts.every((post) => {
    const urls = post.body.match(/https?:\/\/\S+/gu) ?? [];
    return urls.every((raw) => {
      const kind = classifyXDestination(raw.replace(/[)\].,]+$/u, ""));
      return kind === "FANZA_NORMAL" || kind === "DMM_NORMAL";
    });
  });
}

function inProgressResult(): XSocialAdaptationResult {
  return restoreXAdaptation({
    threadShape: "SINGLE",
    threadReason: "generation_in_progress",
    linkMode: "DIRECT_AFFILIATE",
    publicationStrategy: "FANZA_NORMAL",
    publicationStrategyReason: "generation_in_progress",
    posts: [],
    parentBody: null,
    publicationIntent: null,
    canonicalTitleUsed: "",
    hooks: [],
    skip: {
      reason: "SOCIAL_CONTENT_TOO_THIN",
      detail: "X_COPY_GENERATION_IN_PROGRESS",
      failureClass: "GENERATION_FAILURE",
    },
    wpUrl: null,
    fanzaUrl: null,
    mediaMode: "TEXT_ONLY",
    mediaUrl: null,
    mediaReason: "generation_in_progress",
    mediaRole: null,
    warnings: [],
    tracking: {
      format: X_SOCIAL_ADAPTATION_FORMAT,
      cid: "",
      linkMode: "DIRECT_AFFILIATE",
      threadShape: "SINGLE",
      publicationStrategy: "FANZA_NORMAL",
      replyOrder: null,
      hookCount: 0,
      factSources: [],
      skipped: true,
      mediaMode: "TEXT_ONLY",
      writerMode: null,
    },
    writerMode: null,
    socialPlan: null,
  });
}

function resultFromArtifact(artifact: XCopyArtifact): XSocialAdaptationResult {
  if (!artifact.adaptation) return inProgressResult();
  return restoreXAdaptation(artifact.adaptation);
}

export async function resolveXCopyArtifact(input: {
  store: XCopyArtifactStore;
  identity: XCopyIdentity;
  now: Date;
  trigger: "probe" | "execute";
  generate: (ctx: XCopyGenerationContext) => Promise<XSocialAdaptationResult>;
}): Promise<{ result: XSocialAdaptationResult; generated: boolean }> {
  const fingerprint = xCopyInputFingerprint(input.identity);
  const ownerToken = randomUUID();
  const logicalGenerationId = randomUUID();
  const claim = await input.store.transact<XCopyClaim>((rawData) => {
    const decision = beginXCopyGeneration({
      existing: readXCopyArtifact(rawData),
      identity: input.identity,
      fingerprint,
      now: input.now,
      ownerToken,
      logicalGenerationId,
    });
    if (decision.action !== "claim") return { value: decision };
    return { rawData: writeXCopyArtifact(rawData, decision.artifact), value: decision };
  });

  if (claim.action === "wait") return { result: inProgressResult(), generated: false };
  if (claim.action === "reuse" || claim.action === "exhausted") {
    return { result: resultFromArtifact(claim.artifact), generated: false };
  }

  let generated: XSocialAdaptationResult;
  try {
    generated = await input.generate({
      logicalGenerationId,
      fingerprint,
      trigger: input.trigger,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "x_copy_generation_failed";
    await input.store.transact((rawData) => {
      const done = completeXCopyGeneration({
        current: readXCopyArtifact(rawData),
        ownerToken,
        now: input.now,
        state: "FAILED_TRANSIENT",
        adaptation: snapshotXAdaptation(inProgressResult()),
        skipReason: "GENERATION_FAILURE",
        failureClass: "GENERATION_FAILURE",
      });
      if (!done.committed || !done.artifact) return { value: done };
      done.artifact.adaptation = {
        ...done.artifact.adaptation!,
        skip: {
          reason: "SOCIAL_REVIEW_FAILED",
          detail: message,
          failureClass: "GENERATION_FAILURE",
        },
      };
      return { rawData: writeXCopyArtifact(rawData, done.artifact), value: done };
    });
    return {
      result: restoreXAdaptation({
        ...snapshotXAdaptation(inProgressResult()),
        skip: {
          reason: "SOCIAL_REVIEW_FAILED",
          detail: message,
          failureClass: "GENERATION_FAILURE",
        },
      }),
      generated: true,
    };
  }

  const gate = xScheduleGate(generated);
  const failureClass = generated.skip?.failureClass ?? null;
  const state = classifyXCopyOutcome({ passesGate: gate.pass, failureClass });
  await input.store.transact((rawData) => {
    const done = completeXCopyGeneration({
      current: readXCopyArtifact(rawData),
      ownerToken,
      now: input.now,
      state,
      adaptation: snapshotXAdaptation(generated),
      skipReason: gate.pass ? null : gate.skipReason,
      failureClass,
    });
    if (!done.committed || !done.artifact) return { value: done };
    return { rawData: writeXCopyArtifact(rawData, done.artifact), value: done };
  });
  return { result: generated, generated: true };
}
