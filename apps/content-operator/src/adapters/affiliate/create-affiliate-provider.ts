/**
 * AffiliateProvider factory — FANZA is one provider; future ASPs plug in here.
 * Never invents credentials or affiliate URLs.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { AffiliateProvider } from "../types.js";
import { MockAffiliateProvider } from "./mock-affiliate-provider.js";
import {
  FanzaAffiliateProvider,
  UnconfiguredAffiliateProvider,
} from "./fanza-affiliate-provider.js";
import { FANZA_PROVIDER_KEY } from "../../publication/provider-registry-meta.js";

export function createAffiliateProviderFromConfig(
  config: Pick<AppConfig, "preferredAffiliateProvider" | "dmmApiId" | "dmmAffiliateId">,
  opts?: { knownAffiliateUrlByProductId?: Record<string, string> },
): AffiliateProvider {
  const key = (config.preferredAffiliateProvider || FANZA_PROVIDER_KEY).trim().toLowerCase();
  if (key === "mock" || key === "mock-affiliate") {
    return new MockAffiliateProvider();
  }
  if (key === FANZA_PROVIDER_KEY || key === "dmm" || key === "dmm-fanza") {
    return new FanzaAffiliateProvider({
      config,
      knownAffiliateUrlByProductId: opts?.knownAffiliateUrlByProductId,
    });
  }
  return new UnconfiguredAffiliateProvider(key);
}

export function listKnownAffiliateProviderKeys(): string[] {
  return [FANZA_PROVIDER_KEY, "mock-affiliate", "dmm-general"];
}
