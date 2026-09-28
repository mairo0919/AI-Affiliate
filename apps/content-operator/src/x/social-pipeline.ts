/**
 * X Social production pipeline (single route):
 * Claims/title/identity → X Planner → X Writer (LLM preferred) → X Review → optional rewrite(s) → assemble.
 */

import type { LLMProvider } from "../adapters/types.js";
import type { XSocialPlan, XPlanSkip } from "./social-plan.js";
import { planXSocial } from "./social-plan.js";
import { composeGroundedIntro, writeXSocialCopy } from "./social-write.js";
import {
  reviewXSocialCopy,
  rewriteXSocialCopyOnce,
  type SocialReviewFinding,
  type SocialReviewResult,
} from "./social-review.js";

/** Existing reason vocabulary — mapped for ops reporting (no new classifier layer). */
export type SocialFailureClass =
  | "SOURCE_INSUFFICIENT"
  | "GENERATION_FAILURE"
  | "QUALITY_FAILURE";

export type SocialPipelineSkip = XPlanSkip | {
  reason: "SOCIAL_CONTENT_TOO_THIN" | "SOCIAL_REVIEW_FAILED";
  detail: string;
  failureClass?: SocialFailureClass;
};

export type SocialPipelineOk = {
  ok: true;
  plan: XSocialPlan;
  draftBody: string;
  finalBody: string;
  reviewFindings: SocialReviewFinding[];
  review: SocialReviewResult;
  rewritten: boolean;
  writerMode: "llm" | "editorial_synthesize";
  rewriteAttempts: number;
};

export type SocialPipelineResult =
  | SocialPipelineOk
  | {
      ok: false;
      skip: SocialPipelineSkip;
      plan: XSocialPlan | null;
      reviewFindings: SocialReviewFinding[];
      review: SocialReviewResult | null;
    };

export type SocialPipelineInput = {
  canonicalTitle: string;
  productTitle?: string | null;
  performerNames?: string[];
  seriesName?: string | null;
  claimStatements?: Array<{ id?: string; statement: string }>;
  groundedPlanFacts?: string[];
  officialDescription?: string | null;
  maxBodyChars?: number;
  llm?: LLMProvider | null;
  model?: string;
  /** Max rewrite attempts after first draft (default 4 when LLM present, 1 offline). */
  maxRewrites?: number;
};

export function classifySocialFailure(
  codes: string[],
  plan: XSocialPlan | null,
): SocialFailureClass {
  if (!plan) return "SOURCE_INSUFFICIENT";
  const set = new Set(codes);
  const dropped = plan.canonicalContext.droppedAdultCount ?? 0;
  const claimN = plan.canonicalContext.claimCount ?? 0;
  const adultHeavy = dropped >= 2 && (claimN === 0 || dropped >= Math.ceil(claimN * 0.5));
  const hasIdentity = Boolean(plan.subject) || Boolean(plan.canonicalContext.seriesName);
  const hasCatalogHook = plan.allowedClaims.some((c) =>
    /\d+時間|\d+作品|シリーズ|BEST|ベスト|総集|第\d+弾|VR作品|8K|タクシー|ドライバー|エステ/u.test(c),
  );
  const thinPlan =
    plan.allowedClaims.length <= 1 &&
    !hasIdentity &&
    !hasCatalogHook &&
    (!plan.primaryAppeal || /近作として公式設定|としての収録焦点/.test(plan.primaryAppeal));
  if (thinPlan && (set.has("THIN_WORK_INTRO") || set.has("LOW_INFORMATION") || set.has("TOO_THIN") || set.has("EMPTY_BODY"))) {
    return "SOURCE_INSUFFICIENT";
  }
  // Adult-heavy AND no usable identity/catalog salvage → source insufficient.
  if (
    adultHeavy &&
    !hasIdentity &&
    !hasCatalogHook &&
    plan.allowedClaims.length <= 1 &&
    (set.has("EMPTY_BODY") || set.has("ADULT_EXPRESSION") || set.has("THIN_WORK_INTRO"))
  ) {
    return "SOURCE_INSUFFICIENT";
  }
  if (set.has("EMPTY_BODY") && codes.every((c) => c === "EMPTY_BODY" || c === "THIN_WORK_INTRO" || c === "LOW_INFORMATION")) {
    return "GENERATION_FAILURE";
  }
  return "QUALITY_FAILURE";
}

/**
 * Run Planner → Writer → Review (up to maxRewrites LLM rewrites).
 * Does not synthesize a publish body to force PASS when LLM is available.
 */
export async function runXSocialPipeline(
  input: SocialPipelineInput,
): Promise<SocialPipelineResult> {
  const planned = planXSocial({
    canonicalTitle: input.canonicalTitle,
    productTitle: input.productTitle,
    performerNames: input.performerNames,
    seriesName: input.seriesName,
    claimStatements: input.claimStatements,
    groundedPlanFacts: input.groundedPlanFacts,
    officialDescription: input.officialDescription,
  });

  if (!planned.ok) {
    return {
      ok: false,
      skip: {
        ...planned.skip,
        failureClass: "SOURCE_INSUFFICIENT",
      },
      plan: null,
      reviewFindings: [],
      review: null,
    };
  }

  const plan = planned.plan;
  if (plan.viability === "X_INSUFFICIENT_MATERIAL") {
    return {
      ok: false,
      skip: {
        reason: "SOCIAL_CONTENT_TOO_THIN",
        detail: "X_INSUFFICIENT_MATERIAL",
        failureClass: "SOURCE_INSUFFICIENT",
      },
      plan,
      reviewFindings: [],
      review: null,
    };
  }

  let draft = await writeXSocialCopy(plan, { llm: input.llm, model: input.model });
  let review = reviewXSocialCopy(draft.body, plan, { maxChars: input.maxBodyChars ?? 240 });
  let rewritten = false;
  const maxRewrites = input.maxRewrites ?? (input.llm ? 4 : 1);

  let attempts = 0;
  let previousBody = draft.body;
  while (!review.ok && review.canRewrite && attempts < maxRewrites) {
    attempts += 1;
    const once = await rewriteXSocialCopyOnce(previousBody, plan, review.findings, {
      llm: input.llm,
      model: input.model,
    });
    if (!once) break;
    if (once === draft.body && previousBody === draft.body) break;
    rewritten = true;
    previousBody = draft.body;
    draft = {
      body: once,
      sentences: once.split(/。/u).filter(Boolean).map((s) => `${s}。`),
      mode: draft.mode,
    };
    review = reviewXSocialCopy(draft.body, plan, { maxChars: input.maxBodyChars ?? 240 });
  }

  if (!review.ok) {
    const grounded = composeGroundedIntro(plan);
    if (grounded && grounded !== draft.body) {
      const groundedReview = reviewXSocialCopy(grounded, plan, { maxChars: input.maxBodyChars ?? 240 });
      if (groundedReview.ok) {
        return {
          ok: true,
          plan,
          draftBody: draft.body,
          finalBody: grounded,
          reviewFindings: groundedReview.findings,
          review: groundedReview,
          rewritten: true,
          writerMode: draft.mode,
          rewriteAttempts: attempts,
        };
      }
    }
  }

  if (!review.ok) {
    const blockingCodes = review.findings
      .filter((f) => f.severity === "BLOCKING")
      .map((f) => f.code);
    const failureClass = classifySocialFailure(blockingCodes, plan);
    return {
      ok: false,
      skip: {
        reason:
          failureClass === "SOURCE_INSUFFICIENT"
            ? "SOCIAL_CONTENT_TOO_THIN"
            : "SOCIAL_REVIEW_FAILED",
        detail: blockingCodes.join(",") || "X_INSUFFICIENT_MATERIAL",
        failureClass,
      },
      plan,
      reviewFindings: review.findings,
      review,
    };
  }

  return {
    ok: true,
    plan,
    draftBody: draft.body,
    finalBody: draft.body,
    reviewFindings: review.findings,
    review,
    rewritten,
    writerMode: draft.mode,
    rewriteAttempts: attempts,
  };
}

/** @deprecated Navigation is composeXThreadPublication responsibility — do not append WP URL to parent. */
export function assembleWpTrafficPost(body: string, _wpUrl: string | null): string {
  return body.trim();
}

/** Architecture invariant marker — production copy path must import this module. */
export const X_COPY_PRODUCTION_PATH = "Claims→XPlanner→XWriter→XReview→compose→XPublication" as const;
