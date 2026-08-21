export {
  PRODUCT_LINK_TYPES,
  AFFILIATE_REPLACEMENT_STATUSES,
  LINK_REPLACE_PRIORITY,
  DEFAULT_LINK_POLICY,
  UNAVAILABLE_LINK_STATES,
} from "./link-types.js";
export type {
  ProductLinkTypeKey,
  AffiliateReplacementStatusKey,
  LinkReplacePriority,
  LinkPolicyConfig,
  AffiliateReplacementState,
  ProductLinkCandidate,
  ResolvedProductLink,
  ProviderLinkOffer,
  LinkCandidateInput,
} from "./link-types.js";
export {
  LinkResolver,
  buildProductLinkCandidates,
  resolvePrimaryLink,
  applyAffiliateReplacement,
  proposeAffiliateCandidate,
  isValidHttpUrl,
  isLinkAvailable,
} from "./link-resolver.js";
export { PublicationPlanner } from "./publication-planner.js";
export type { PublicationPlanInput, PublicationPlanResult } from "./publication-planner.js";
export { LinkReplacementService } from "./link-replacement-service.js";
export type {
  ProposeLinkReplacementInput,
  ApplyLinkReplacementInput,
  ApplyLinkReplacementResult,
} from "./link-replacement-service.js";
export {
  sanitizePublicBody,
  assertPublicBodyClean,
  containsInternalLinkMarkers,
} from "./public-body-sanitizer.js";
export type { PublicBodySanitizeResult } from "./public-body-sanitizer.js";
