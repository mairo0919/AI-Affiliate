import type { CollectionResult } from "@ai-affiliate/shared";
import type { ResearchProvider } from "../types.js";
import { ProviderNotImplementedError } from "../types.js";

export class TikTokResearchProvider implements ResearchProvider {
  readonly providerName = "tiktok";

  async collect(): Promise<CollectionResult> {
    throw new ProviderNotImplementedError(this.providerName);
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}
