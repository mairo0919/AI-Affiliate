/**
 * Adult Research Provider Registry — expand here when adding FC2 / MGS / APEX / etc.
 * Do not scatter `if (provider === ...)` across Analysis/Writer/WP.
 */

import type { AppConfig } from "@ai-affiliate/config";
import {
  RESEARCH_PROVIDER_CATALOG,
  classifyResearchProviderStatus,
  findResearchProviderDescriptor,
  type ResearchAcquisitionStatus,
  type ResearchProviderDescriptor,
} from "../adapters/affiliate/research-availability.js";
import type { AdultResearchProvider, AdultProviderHealth } from "./adult-research-provider.js";

export type AdultRegistryEntry = ResearchProviderDescriptor & {
  planned: boolean;
};

/** Catalog is SSOT in research-availability; planned = !implemented. */
export function listAdultProviderRegistry(): AdultRegistryEntry[] {
  return RESEARCH_PROVIDER_CATALOG.map((p) => ({
    ...p,
    planned: !p.implemented,
  }));
}

const adapters = new Map<string, AdultResearchProvider>();

/** Register a runtime adapter (tests / future FC2). */
export function registerAdultResearchProvider(provider: AdultResearchProvider): void {
  adapters.set(provider.providerKey.trim().toLowerCase(), provider);
}

export function getAdultResearchProvider(key: string): AdultResearchProvider | null {
  return adapters.get(key.trim().toLowerCase()) ?? null;
}

export function listEnabledAdultProviderKeys(config: AppConfig): string[] {
  const enabled = (config.researchEnabledProviders ?? []).map((p) => p.toLowerCase());
  if (enabled.length === 0) return ["fanza"];
  return enabled;
}

/**
 * Probe each enabled provider independently — one failure never halts others.
 */
export async function probeEnabledAdultProviders(config: AppConfig): Promise<
  Array<{
    key: string;
    status: ResearchAcquisitionStatus | AdultProviderHealth["status"];
    skipReason: string | null;
    health: AdultProviderHealth | null;
  }>
> {
  const keys = listEnabledAdultProviderKeys(config);
  const results: Array<{
    key: string;
    status: ResearchAcquisitionStatus | AdultProviderHealth["status"];
    skipReason: string | null;
    health: AdultProviderHealth | null;
  }> = [];

  for (const key of keys) {
    const classified = classifyResearchProviderStatus(key, config);
    const adapter = getAdultResearchProvider(key);
    let health: AdultProviderHealth | null = null;
    if (adapter) {
      try {
        health = await adapter.healthCheck();
      } catch (e) {
        health = {
          providerKey: key,
          status: "API_UNAVAILABLE",
          ok: false,
          reasons: [e instanceof Error ? e.message.slice(0, 160) : String(e)],
          checkedAt: new Date().toISOString(),
        };
      }
    } else if (!findResearchProviderDescriptor(key)) {
      results.push({
        key,
        status: "NOT_IMPLEMENTED",
        skipReason: `NOT_IMPLEMENTED: unknown provider:${key}`,
        health: null,
      });
      continue;
    }
    results.push({
      key,
      status: health?.status ?? classified.status,
      skipReason: health && !health.ok ? health.reasons.join("; ") : classified.skipReason,
      health,
    });
  }
  return results;
}

/**
 * How to add a new adult provider:
 * 1. Implement AdultResearchProvider under providers/<key>/
 * 2. Add RESEARCH_PROVIDER_CATALOG row + registerAdultResearchProvider()
 * 3. Enable RESEARCH_ENABLED_PROVIDERS=fanza,<key>
 * 4. Do NOT change Analysis / Brain / Writer / Review / WP scheduler
 */
export const NEW_ADULT_PROVIDER_CHECKLIST = [
  "Implement AdultResearchProvider (normalize → ResearchItem)",
  "Register in RESEARCH_PROVIDER_CATALOG",
  "Add AffiliateProvider offer URL validator if needed",
  "Enable in RESEARCH_ENABLED_PROVIDERS",
  "Leave Analysis/Writer/Review/WP untouched",
] as const;
