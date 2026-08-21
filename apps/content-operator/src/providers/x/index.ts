import type { CollectionResult } from "@ai-affiliate/shared";
import type { ResearchProvider } from "../types.js";
import { ProviderNotImplementedError } from "../types.js";

export class XResearchProvider implements ResearchProvider {
  readonly providerName = "x";

  async collect(): Promise<CollectionResult> {
    throw new ProviderNotImplementedError(this.providerName);
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}
