export { FanzaResearchProvider } from "./fanza-provider.js";
export type { FanzaCollectOptions, FanzaCollectStats, FanzaProviderDeps } from "./fanza-provider.js";
export { DmmApiClient } from "./dmm-api-client.js";
export type { DmmApiClientOptions } from "./dmm-api-client.js";
export {
  DmmError,
  DmmApiError,
  ConfigurationError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  ApiResponseError,
  ValidationError,
  sanitizeForLog,
  toSafeErrorMessage,
  isConfigurationIncomplete,
} from "./dmm-api-error.js";
export type { DmmErrorCode, DmmErrorKind } from "./dmm-api-error.js";
export { mapDmmItemToCollected, mapDmmItemsToCollected } from "./fanza-mapper.js";
export {
  clampHits,
  resolveFanzaQuery,
  toItemListParams,
  computeNextOffset,
} from "./fanza-query.js";
export {
  extractFanzaPageEvidenceFromHtml,
  mergeItemListAndPageImages,
  toSourceDocumentPageEvidenceMeta,
  withMergedItemListCatalog,
  mergeCanonicalCatalog,
  FANZA_PAGE_EVIDENCE_SOURCE,
} from "./fanza-page-evidence.js";
export type {
  FanzaPageEvidence,
  PageEvidenceImage,
  MergedProductImageEvidence,
  PageCatalogEvidence,
  CatalogFieldProvenance,
} from "./fanza-page-evidence.js";
export { fetchFanzaPageEvidence } from "./fanza-page-evidence-fetch.js";
export type {
  FetchFanzaPageEvidenceOptions,
  PageEvidenceFetchResult,
} from "./fanza-page-evidence-fetch.js";
