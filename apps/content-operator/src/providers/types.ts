import type { CollectionResult } from "@ai-affiliate/shared";

export interface ResearchProvider {
  readonly providerName: string;
  collect(): Promise<CollectionResult>;
  healthCheck(): Promise<boolean>;
}

export class ProviderNotImplementedError extends Error {
  constructor(providerName: string) {
    super(`${providerName} provider is not implemented yet`);
    this.name = "ProviderNotImplementedError";
  }
}
