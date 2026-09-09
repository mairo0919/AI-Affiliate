/**
 * X publishing DRY_RUN payload builder — production-shaped, no live createPost.
 * Does not change article Writer prompts. Uses X_SOCIAL_CONTENT / X_SOCIAL_MEDIA surfaces.
 */

import type { AppConfig } from "@ai-affiliate/config";
import { chooseXPostRoute, type XPostRoute } from "../daily-ops/x-route.js";
import { resolvePublicationOffer } from "../publication/offer-resolution.js";
import { FANZA_PROVIDER_KEY } from "../publication/provider-registry-meta.js";
import { XCharacterCounter } from "../x/character-counter.js";
import { CONTENT_POLICY_SURFACE } from "./content-policy-surfaces.js";
import { detectXAdultExpressions } from "./x-social-content-policy.js";
import {
  evaluateXSocialMedia,
  type XSocialMediaCandidate,
  type XSocialMediaCandidateReport,
  type XSocialMediaDecision,
} from "./x-social-media-gate.js";

export type XDryRunPayload = {
  format: "x-dry-run-payload-v1";
  releaseMode: string;
  apiEnabled: boolean;
  killSwitch: boolean;
  autoPublicationEnabled: boolean;
  wouldCallCreatePost: false;
  route: XPostRoute;
  destinationUrl: string;
  affiliateLinkReady: boolean;
  offerKind: string;
  monetizationStatus: string;
  body: string;
  weightedLength: number;
  maxWeightedLength: number;
  withinLimit: boolean;
  disclosurePresent: boolean;
  contentPolicySurface: typeof CONTENT_POLICY_SURFACE.X_SOCIAL_CONTENT;
  mediaDecision: XSocialMediaDecision;
  mediaReason: string;
  mediaSelectedUrl: string | null;
  mediaSelectedSampleIndex: number | null;
  mediaSelectedReason: string | null;
  mediaCandidates: XSocialMediaCandidateReport[];
  /** Material-eligible official samples that reached X_SOCIAL_MEDIA visual gate. */
  mediaMaterialEligibleCount: number;
  fanzaXSiteApproved: boolean;
  adultExpressionHit: boolean;
  warnings: string[];
  generatedAt: string;
};

/**
 * Build a production-equivalent X payload for DRY_RUN verification.
 * Never posts. Never invents affiliate URLs.
 */
export function buildXDryRunPayload(input: {
  config: Pick<
    AppConfig,
    | "xApiEnabled"
    | "xReleaseMode"
    | "xGlobalKillSwitch"
    | "xAutoPublicationEnabled"
    | "xMaxWeightedLength"
    | "xAffiliateDisclosure"
    | "fanzaXSiteApproved"
    | "fanzaDefaultService"
    | "fanzaDefaultFloor"
  >;
  body: string;
  productId?: string | null;
  affiliateUrl?: string | null;
  publishedBlogUrl?: string | null;
  preferredRoute?: XPostRoute | null;
  mediaCandidates?: XSocialMediaCandidate[] | null;
  researchImages?: Array<{
    sourceUrl: string;
    imageType?: string | null;
    usageStatus?: string | null;
  }> | null;
  /** Explicit ops confirmation only — never invent true for X convenience. */
  fanzaAffiliateImageTermsVerified?: boolean;
  /** Override config; default false. Never invent true. */
  fanzaXSiteApproved?: boolean;
  earlySamplePreferCount?: number;
  announceCardAvailable?: boolean;
  announceCardUrl?: string | null;
}): XDryRunPayload {
  const offer = resolvePublicationOffer({
    providerKey: FANZA_PROVIDER_KEY,
    productId: input.productId,
    affiliateUrl: input.affiliateUrl,
    canonicalProductUrl: input.productId
      ? `https://video.dmm.co.jp/av/content/?id=${input.productId}`
      : null,
  });
  const route = chooseXPostRoute({
    affiliateUrl: offer.url ?? input.affiliateUrl ?? "",
    publishedBlogUrl: input.publishedBlogUrl,
    preferredRoute: input.preferredRoute,
    affiliateLinkReady: offer.affiliateLinkReady,
    canonicalProductUrl: offer.kind === "CANONICAL_PRODUCT" ? offer.url : null,
  });

  const counter = new XCharacterCounter();
  const counted = counter.count(input.body);
  const weightedLength = counted.weightedLength;
  const maxWeightedLength = input.config.xMaxWeightedLength ?? 280;
  const disclosure = (input.config.xAffiliateDisclosure ?? "").trim();
  const disclosurePresent =
    !disclosure ||
    input.body.includes(disclosure) ||
    /#PR|アフィリエイト/u.test(input.body);

  const adult = detectXAdultExpressions(input.body);
  const fanzaXSiteApproved =
    input.fanzaXSiteApproved === true || input.config.fanzaXSiteApproved === true;
  const media = evaluateXSocialMedia({
    candidates: input.mediaCandidates ?? [],
    researchImages: input.researchImages ?? null,
    productCanonicalId: input.productId ?? null,
    fanzaAffiliateImageTermsVerified: input.fanzaAffiliateImageTermsVerified === true,
    fanzaXSiteApproved,
    fanzaService: input.config.fanzaDefaultService,
    fanzaFloor: input.config.fanzaDefaultFloor,
    earlySamplePreferCount: input.earlySamplePreferCount,
    announceCardAvailable: input.announceCardAvailable,
    announceCardUrl: input.announceCardUrl,
  });
  const mediaMaterialEligibleCount = media.candidates.filter(
    (c) => c.materialRightsStatus === "ELIGIBLE",
  ).length;

  const warnings: string[] = [];
  if (input.config.xReleaseMode !== "DRY_RUN" && input.config.xReleaseMode !== "DISABLED") {
    warnings.push(`releaseMode=${input.config.xReleaseMode} — dry-run helper does not enable live post`);
  }
  if (!offer.affiliateLinkReady) {
    warnings.push("affiliate_pending: destination is blog or canonical product URL only");
  }
  if (!input.publishedBlogUrl && route.route === "BLOG_TRAFFIC") {
    warnings.push("blog_url_missing");
  }
  if (weightedLength > maxWeightedLength) {
    warnings.push(`weighted_length ${weightedLength} exceeds max ${maxWeightedLength}`);
  }
  if (!disclosurePresent) {
    warnings.push("affiliate_disclosure_missing");
  }
  if (adult.hit) {
    warnings.push(`x_adult_expression_gate_hit:${adult.matches.map((m) => m.id).join(",")}`);
  }
  if (!fanzaXSiteApproved && mediaMaterialEligibleCount > 0) {
    warnings.push(
      "publication_block:WAITING_FOR_AFFILIATE_SITE_APPROVAL (material rights may still be ELIGIBLE)",
    );
  }
  if (media.decision !== "SAFE_IMAGE") {
    warnings.push(`x_media=${media.decision}:${media.reason}`);
  }

  return {
    format: "x-dry-run-payload-v1",
    releaseMode: input.config.xReleaseMode,
    apiEnabled: input.config.xApiEnabled,
    killSwitch: input.config.xGlobalKillSwitch,
    autoPublicationEnabled: input.config.xAutoPublicationEnabled,
    wouldCallCreatePost: false,
    route: route.route,
    destinationUrl: route.destinationUrl,
    affiliateLinkReady: route.affiliateLinkReady,
    offerKind: offer.kind,
    monetizationStatus: offer.monetizationStatus,
    body: input.body,
    weightedLength,
    maxWeightedLength,
    withinLimit: weightedLength <= maxWeightedLength,
    disclosurePresent,
    contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_CONTENT,
    mediaDecision: media.decision,
    mediaReason: media.reason,
    mediaSelectedUrl: media.selectedUrl,
    mediaSelectedSampleIndex: media.selectedSampleIndex,
    mediaSelectedReason: media.selectedReason,
    mediaCandidates: media.candidates,
    mediaMaterialEligibleCount,
    fanzaXSiteApproved,
    adultExpressionHit: adult.hit,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

/** True when env/config forbids live X createPost (safe default). */
export function isXLivePostBlocked(
  config: Pick<
    AppConfig,
    "xApiEnabled" | "xReleaseMode" | "xGlobalKillSwitch" | "xAutoPublicationEnabled"
  >,
): { blocked: true; reasons: string[] } | { blocked: false; reasons: [] } {
  const reasons: string[] = [];
  if (!config.xApiEnabled) reasons.push("X_API_ENABLED=false");
  if (config.xGlobalKillSwitch) reasons.push("X_GLOBAL_KILL_SWITCH=true");
  if (config.xReleaseMode === "DISABLED") reasons.push("X_RELEASE_MODE=DISABLED");
  if (config.xReleaseMode === "DRY_RUN") reasons.push("X_RELEASE_MODE=DRY_RUN");
  if (!config.xAutoPublicationEnabled) reasons.push("X_AUTO_PUBLICATION_ENABLED=false");
  if (reasons.length > 0) return { blocked: true, reasons };
  return { blocked: false, reasons: [] };
}
