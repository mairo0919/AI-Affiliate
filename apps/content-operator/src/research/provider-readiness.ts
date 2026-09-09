/**
 * Research-facing re-exports for multi-ASP acquisition readiness.
 */

export {
  RESEARCH_PROVIDER_CATALOG,
  listResearchProviderCatalog,
  findResearchProviderDescriptor,
  classifyResearchProviderStatus,
  systemResearchScheduleName,
} from "../adapters/affiliate/research-availability.js";
export type {
  ResearchAcquisitionStatus,
  ResearchProviderDescriptor,
} from "../adapters/affiliate/research-availability.js";
