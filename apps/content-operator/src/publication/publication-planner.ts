import type { PublicationApprovalMode, PublicationPlatform } from "@ai-affiliate/database";
import { LinkResolver } from "./link-resolver.js";
import {
  DEFAULT_LINK_POLICY,
  type LinkCandidateInput,
  type LinkPolicyConfig,
  type ProductLinkCandidate,
  type ResolvedProductLink,
} from "./link-types.js";

export interface PublicationPlanInput {
  contentId: string;
  contentVersionId: string;
  platform: PublicationPlatform;
  destinationRef?: string | null;
  targetFormat?: string | null;
  approvalMode?: PublicationApprovalMode;
  planning?: {
    targetPerDay?: number;
    maximumPerDay?: number;
    minimumIntervalMinutes?: number;
    qualityOverride?: boolean;
    pauseWhenNoQualifiedContent?: boolean;
  };
  linkInput: LinkCandidateInput;
}

export interface PublicationPlanResult {
  platform: PublicationPlatform;
  approvalMode: PublicationApprovalMode;
  selectedLink: ResolvedProductLink;
  linkCandidates: ProductLinkCandidate[];
  /** Internal planning metadata — never embed raw into public body. */
  platformMetadata: Record<string, unknown>;
}

/**
 * PublicationPlanner: destination / approval / planning soft targets + CTA selection.
 * LinkResolver: pure link ranking / filtering.
 */
export class PublicationPlanner {
  private readonly resolver: LinkResolver;
  private readonly policy: LinkPolicyConfig;

  constructor(policy: LinkPolicyConfig = DEFAULT_LINK_POLICY) {
    this.policy = policy;
    this.resolver = new LinkResolver(policy);
  }

  plan(input: PublicationPlanInput): PublicationPlanResult {
    const { candidates, primary } = this.resolver.resolve(input.linkInput);
    const approvalMode = input.approvalMode ?? "MANUAL";

    const platformMetadata: Record<string, unknown> = {
      linkPolicy: {
        preferredAffiliateProvider: this.policy.preferredAffiliateProvider,
        futureAspProviders: this.policy.futureAspProviders,
        priorityOrder: [
          "preferred-affiliate",
          "preferred-product",
          "future-asp-affiliate",
          "future-asp-product",
          "official",
          "trusted-product",
          "none",
        ],
      },
      selectedLink: {
        url: primary.url,
        preferredAffiliateProvider: primary.preferredAffiliateProvider,
        currentLinkProvider: primary.currentLinkProvider,
        currentLinkType: primary.currentLinkType,
        replacePriority: primary.replacePriority,
        productMatchKey: primary.productMatchKey,
        replacementStatus: primary.replacement.replacementStatus,
        selectionReason: primary.selectionReason,
      },
      linkCandidates: candidates.map((c) => ({
        url: c.url,
        preferredAffiliateProvider: c.preferredAffiliateProvider,
        currentLinkProvider: c.currentLinkProvider,
        currentLinkType: c.currentLinkType,
        replacePriority: c.replacePriority,
        availability: c.availability,
        productMatchKey: c.productMatchKey,
        replacement: c.replacement,
        metadata: c.metadata ?? null,
      })),
      planning: {
        targetPerDay: input.planning?.targetPerDay ?? null,
        maximumPerDay: input.planning?.maximumPerDay ?? null,
        minimumIntervalMinutes: input.planning?.minimumIntervalMinutes ?? null,
        qualityOverride: input.planning?.qualityOverride ?? false,
        pauseWhenNoQualifiedContent: input.planning?.pauseWhenNoQualifiedContent ?? true,
      },
    };

    return {
      platform: input.platform,
      approvalMode,
      selectedLink: primary,
      linkCandidates: candidates,
      platformMetadata,
    };
  }
}
