import type { ChannelEditorialPlan, CoreEditorialPlan } from "../../core/types.js";
import type { ChannelEditorialModule } from "../../core/channel-module.js";

export type BlogChannelPlanSpecifics = {
  omitCtaBridge: boolean;
  omitInterestDevelopment: boolean;
  effectiveMinArticleSections: number;
  effectiveMaxArticleSections: number;
  articleDepth: "scarce" | "standard" | "rich";
  imageStrategy: "prefer_structure_layout";
  reviewAxes: string[];
  titleStrategy: string;
  summaryStrategy: string;
  ctaStrategy: string;
};

/**
 * CTA bridge is NOT a global fixed policy.
 * Omit when bridge would add no new editorial value (scarcity / no development claims).
 */
export function decideOmitCtaBridge(core: CoreEditorialPlan): boolean {
  const hasDev = core.claimAllocation.some((a) => a.role === "development");
  if (!hasDev) return true;
  if (core.scarcityMode) return true;
  // Bridge allowed only when development exists AND depth is not scarce
  return false;
}

export function buildBlogChannelPlan(core: CoreEditorialPlan): ChannelEditorialPlan {
  const omitCtaBridge = decideOmitCtaBridge(core);
  const omitInterestDevelopment = !core.claimAllocation.some((a) => a.role === "development");
  const specifics: BlogChannelPlanSpecifics = {
    omitCtaBridge,
    omitInterestDevelopment,
    effectiveMinArticleSections: 1,
    effectiveMaxArticleSections: omitCtaBridge ? 1 : 2,
    articleDepth: core.developmentDepth,
    imageStrategy: "prefer_structure_layout",
    reviewAxes: [
      "grounding",
      "semantic_repetition",
      "information_gain",
      "filler",
      "catalog_narration",
      "unsupported_inference",
      "title",
      "opening",
      "cta",
      "summary",
      "coherence",
    ],
    titleStrategy: core.titleStrategy,
    summaryStrategy: core.summaryStrategy,
    ctaStrategy: omitCtaBridge
      ? "widget_only_no_generic_bridge"
      : "bridge_only_if_editorial_value",
  };

  return {
    channel: "BLOG",
    corePlan: { ...core, channel: "BLOG" },
    specifics,
  };
}

export const blogChannelModule: ChannelEditorialModule = {
  channel: "BLOG",
  capabilities: { targetedRepair: true },
  buildChannelPlan: buildBlogChannelPlan,
};
