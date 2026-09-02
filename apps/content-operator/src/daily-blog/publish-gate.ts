/**
 * Auto-publish gate — ALL must pass before Blogger LIVE publish.
 *
 * R117: Brain / Reviewer / brainDecision are NOT publish blockers.
 * Safety + ops controls only.
 */

export interface PublishGateInput {
  schemaPass: boolean;
  defer: boolean;
  claimValidationPass: boolean;
  integrityPass: boolean;
  formatterPass: boolean;
  affiliateUrlValid: boolean;
  imagePipelinePass: boolean;
  bloggerAuthPass: boolean;
  /**
   * When set, used instead of bloggerAuthPass (WordPress / future channels).
   * Failure code becomes CHANNEL_AUTH_FAIL.
   */
  channelAuthPass?: boolean;
  duplicate: boolean;
  dryRun?: boolean;
  autoPublishEnabled?: boolean;
  allowDirectPublish?: boolean;
}

export interface PublishGateResult {
  allowPublish: boolean;
  failureCodes: string[];
  decision: "PUBLISH" | "HOLD" | "DRY_RUN_OK";
}

export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  const failureCodes: string[] = [];
  if (!input.schemaPass) failureCodes.push("SCHEMA_FAIL");
  if (input.defer) failureCodes.push("DEFER");
  if (!input.claimValidationPass) failureCodes.push("CLAIM_VALIDATION_FAIL");
  if (!input.integrityPass) failureCodes.push("INTEGRITY_FAIL");
  if (!input.formatterPass) failureCodes.push("FORMATTER_FAIL");
  if (!input.affiliateUrlValid) failureCodes.push("AFFILIATE_URL_INVALID");
  if (!input.imagePipelinePass) failureCodes.push("IMAGE_PIPELINE_FAIL");
  const authPass = input.channelAuthPass ?? input.bloggerAuthPass;
  if (!authPass) {
    failureCodes.push(
      input.channelAuthPass !== undefined ? "CHANNEL_AUTH_FAIL" : "BLOGGER_AUTH_FAIL",
    );
  }
  if (input.duplicate) failureCodes.push("DUPLICATE_PRODUCT");

  if (failureCodes.length > 0) {
    return { allowPublish: false, failureCodes, decision: "HOLD" };
  }
  if (input.dryRun || input.autoPublishEnabled === false) {
    return { allowPublish: false, failureCodes: [], decision: "DRY_RUN_OK" };
  }
  if (!input.allowDirectPublish) {
    return {
      allowPublish: false,
      failureCodes: ["DIRECT_PUBLISH_DISABLED"],
      decision: "HOLD",
    };
  }
  return { allowPublish: true, failureCodes: [], decision: "PUBLISH" };
}
