import type {
  ContentGenerationRequest,
  ContentGenerationResult,
} from "../types.js";

export interface ContentGenerationProvider {
  readonly providerName: string;
  generate(request: ContentGenerationRequest): Promise<ContentGenerationResult>;
}
