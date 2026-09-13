import type { ChannelEditorialPlan, CoreEditorialPlan } from "../../core/types.js";
import type { ChannelEditorialModule } from "../../core/channel-module.js";

/** Variable X structure — not a fixed 4-post template. */
export type XPostMode = "single" | "short_thread" | "rich_thread";

export type XChannelPlanSpecifics = {
  objective: string;
  hookClaimIds: string[];
  supportClaimIds: string[];
  omittedClaimIds: string[];
  hookStrategy: string;
  editorialAngle: string;
  postMode: XPostMode;
  threadPostCount: number;
  ctaStrategy: string;
  linkStrategy: string;
  /** Hard platform constraint vs editorial quality — separate concerns */
  characterBudget: {
    hardMaxWeighted: number;
    optimizeFor: "information_gain_within_budget";
  };
  inferencePolicy: CoreEditorialPlan["inferencePolicy"];
  retrievedExperienceIds: string[];
  /** Blog body is never a required input */
  requiresBlogBody: false;
  reviewAxes: string[];
};

export function buildXChannelPlan(core: CoreEditorialPlan): ChannelEditorialPlan {
  const hookClaimIds = core.openingDriverClaimIds.length
    ? core.openingDriverClaimIds
    : core.claimAllocation.filter((a) => a.role === "opening").map((a) => a.claimId);
  const supportClaimIds = core.claimAllocation
    .filter((a) => a.role === "development" || a.role === "support")
    .map((a) => a.claimId);
  const omittedClaimIds = core.omittedClaimIds.map((o) => o.claimId);

  // Variable length from information density — never a fixed 4-post template
  let postMode: XPostMode = "single";
  if (!core.scarcityMode && core.informationGainTarget >= 4) {
    postMode = "rich_thread";
  } else if (!core.scarcityMode && core.informationGainTarget >= 2) {
    postMode = "short_thread";
  }
  const threadPostCount =
    postMode === "rich_thread" ? Math.min(3, core.informationGainTarget) : postMode === "short_thread" ? 2 : 1;

  const specifics: XChannelPlanSpecifics = {
    objective: "attention_then_interest_then_optional_cta",
    hookClaimIds,
    supportClaimIds,
    omittedClaimIds,
    hookStrategy: "strongest_concrete_trait_first_line",
    editorialAngle: core.scarcityMode ? "single_concrete_fact" : "trait_then_support",
    postMode,
    threadPostCount,
    ctaStrategy: "link_efficient_no_generic_hype",
    linkStrategy: "optional_product_or_blog_url_not_required_from_blog_body",
    characterBudget: {
      hardMaxWeighted: 140,
      optimizeFor: "information_gain_within_budget",
    },
    inferencePolicy: core.inferencePolicy,
    retrievedExperienceIds: core.retrievedExperienceIds,
    requiresBlogBody: false,
    reviewAxes: [
      "grounding",
      "semantic_repetition",
      "hook_strength",
      "first_line_value",
      "character_efficiency",
      "standalone_clarity",
      "thread_progression",
      "generic_promotion",
      "cta_efficiency",
      "template_fatigue",
    ],
  };

  return {
    channel: "X",
    corePlan: { ...core, channel: "X" },
    specifics,
  };
}

export const xChannelModule: ChannelEditorialModule = {
  channel: "X",
  capabilities: { targetedRepair: false },
  buildChannelPlan: buildXChannelPlan,
};
