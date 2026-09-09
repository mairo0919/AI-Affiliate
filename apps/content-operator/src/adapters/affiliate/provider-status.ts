/**
 * Affiliate provider runtime status — capability ≠ availability.
 * Missing FANZA API credentials must isolate to that provider, not halt the factory.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type {
  AffiliateProvider,
  AffiliateProviderRuntimeSnapshot,
  AffiliateProviderRuntimeStatus,
} from "../types.js";

export function dmmApiCredentialsPresent(config: Pick<AppConfig, "dmmApiId" | "dmmAffiliateId">): boolean {
  return Boolean(config.dmmApiId?.trim() && config.dmmAffiliateId?.trim());
}

export function buildRuntimeSnapshot(input: {
  providerKey: string;
  apiAvailable: boolean;
  affiliateLinkReady: boolean;
  sourceAcquisitionAvailable: boolean;
  reasons: string[];
  now?: Date;
}): AffiliateProviderRuntimeSnapshot {
  let status: AffiliateProviderRuntimeStatus;
  if (!input.sourceAcquisitionAvailable && !input.apiAvailable && !input.affiliateLinkReady) {
    status = "DISABLED";
  } else if (input.apiAvailable && input.affiliateLinkReady) {
    status = "READY";
  } else if (!input.apiAvailable) {
    status = "API_UNAVAILABLE";
  } else if (!input.affiliateLinkReady) {
    status = "AFFILIATE_PENDING";
  } else {
    status = "PARTIAL";
  }

  return {
    providerKey: input.providerKey,
    status,
    apiAvailable: input.apiAvailable,
    affiliateLinkReady: input.affiliateLinkReady,
    sourceAcquisitionAvailable: input.sourceAcquisitionAvailable,
    reasons: input.reasons,
    checkedAt: (input.now ?? new Date()).toISOString(),
  };
}

export async function readAffiliateProviderRuntimeStatus(
  provider: AffiliateProvider,
): Promise<AffiliateProviderRuntimeSnapshot> {
  if (typeof provider.getRuntimeStatus === "function") {
    return provider.getRuntimeStatus();
  }
  return buildRuntimeSnapshot({
    providerKey: provider.providerKey,
    apiAvailable: provider.capabilities.apiSearch || provider.capabilities.apiProductFetch,
    affiliateLinkReady: provider.capabilities.affiliateLinkGeneration,
    sourceAcquisitionAvailable:
      provider.capabilities.htmlFetch ||
      provider.capabilities.manualImport ||
      provider.capabilities.productFeed,
    reasons: ["runtime_status_not_implemented_assume_capability"],
  });
}

/**
 * Research/collection schedule readiness — skip this provider only.
 * Does not imply the whole pipeline must stop.
 */
export function researchProviderAvailability(
  providerName: string,
  config: Pick<AppConfig, "dmmApiId" | "dmmAffiliateId">,
): { available: boolean; skipReason: string | null } {
  const key = providerName.trim().toLowerCase();
  if (key === "mock") return { available: true, skipReason: null };
  if (key === "fanza") {
    if (dmmApiCredentialsPresent(config)) return { available: true, skipReason: null };
    return {
      available: false,
      skipReason:
        "FANZA_API_UNAVAILABLE: DMM credentials missing or approval pending — skip FANZA API discovery only",
    };
  }
  if (key === "fanza-page" || key === "fanza_page_evidence") {
    // Official product page / JSON-LD ingest — no ItemList API required.
    return { available: true, skipReason: null };
  }
  // Unknown future ASP: do not invent credentials; leave schedule as unsupported.
  return {
    available: false,
    skipReason: `unsupported_or_unconfigured_provider:${key}`,
  };
}
