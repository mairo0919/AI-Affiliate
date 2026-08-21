import type { PublicationPlatform } from "@ai-affiliate/database";

export interface AffiliateProductNormalized {
  externalProductId: string;
  title: string;
  url?: string | null;
  affiliateUrl?: string | null;
  locale?: string;
  currency?: string | null;
  adultFlag?: boolean;
  availability?: string;
  normalized: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export interface AffiliateProviderCapabilities {
  apiSearch: boolean;
  apiProductFetch: boolean;
  productFeed: boolean;
  manualImport: boolean;
  htmlFetch: boolean;
  affiliateLinkGeneration: boolean;
  conversionReport: boolean;
  /** @deprecated use apiSearch */
  search?: boolean;
  /** @deprecated use apiProductFetch */
  fetchById?: boolean;
  /** @deprecated use productFeed */
  feed?: boolean;
}

export interface AffiliateProvider {
  readonly providerKey: string;
  readonly capabilities: AffiliateProviderCapabilities;
  searchProducts(query: string, limit?: number): Promise<AffiliateProductNormalized[]>;
  fetchProduct(externalProductId: string): Promise<AffiliateProductNormalized | null>;
  normalizeProduct(raw: Record<string, unknown>): AffiliateProductNormalized;
}

export interface SourceDocumentPayload {
  externalId?: string | null;
  url?: string | null;
  title?: string | null;
  documentType: string;
  contentHash?: string | null;
  publishedAt?: Date | null;
  freshnessScore?: number | null;
  robotsAllowed?: boolean | null;
  termsNotes?: string | null;
  rateLimitNotes?: string | null;
  normalizedText?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResearchSourceAdapter {
  readonly sourceKey: string;
  fetchDocument(ref: string): Promise<SourceDocumentPayload>;
}

export interface PublisherCapabilities {
  longForm: boolean;
  shortForm: boolean;
  thread: boolean;
  draft: boolean;
  schedule: boolean;
  update: boolean;
  delete: boolean;
  affiliateLinks: boolean;
  adultContent: boolean;
  publish: boolean;
  metrics: boolean;
  createDraft?: boolean;
}

export interface PublisherValidateInput {
  title: string;
  body: string;
  targetFormat?: string | null;
  destinationRef?: string | null;
}

export interface PublisherPrepareInput extends PublisherValidateInput {
  contentVersionId: string;
  metadata?: Record<string, unknown>;
}

export interface PublisherPrepareResult {
  payload: Record<string, unknown>;
  warnings: string[];
}

export interface PublisherPublishInput {
  prepared: PublisherPrepareResult;
  destinationRef?: string | null;
}

export interface PublisherPublishResult {
  externalId: string;
  url: string;
  status: string;
  responseSummary?: Record<string, unknown>;
}

export interface PublisherStatusResult {
  externalId: string;
  status: string;
  url?: string | null;
}

export interface PublisherUpdateInput {
  externalId: string;
  prepared: PublisherPrepareResult;
}

export interface PublisherDraftInput {
  prepared: PublisherPrepareResult;
  destinationRef?: string | null;
}

export interface PublisherAdapter {
  readonly platform: PublicationPlatform;
  readonly capabilities: PublisherCapabilities;
  validate(input: PublisherValidateInput): Promise<{ ok: boolean; errors: string[] }>;
  prepare(input: PublisherPrepareInput): Promise<PublisherPrepareResult>;
  publish(input: PublisherPublishInput): Promise<PublisherPublishResult>;
  createDraft?(input: PublisherDraftInput): Promise<PublisherPublishResult>;
  update?(input: PublisherUpdateInput): Promise<PublisherPublishResult>;
  delete?(externalId: string): Promise<{ ok: boolean }>;
  getStatus(externalId: string): Promise<PublisherStatusResult>;
}

export interface LLMTaskRequest {
  taskType: string;
  promptIdentifier?: string;
  promptVersion?: string;
  systemInstruction?: string;
  userPrompt?: string;
  input: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  model?: string;
  timeoutMs?: number;
}

export type LLMErrorClass =
  | "none"
  | "timeout"
  | "retryable"
  | "non_retryable"
  | "auth"
  | "rate_limit"
  | "malformed_output"
  | "schema_mismatch"
  | "policy_refusal"
  | "budget_blocked"
  | "missing_credentials";

export interface LLMTaskResult {
  output: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  estimatedCost: number;
  actualCost?: number | null;
  currency: string;
  provider: string;
  model: string;
  finishReason?: string | null;
  errorClass?: LLMErrorClass;
  errorDetail?: string | null;
  structuredOutputValid?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LLMProvider {
  readonly providerKey: string;
  executeTask(request: LLMTaskRequest): Promise<LLMTaskResult>;
}

export class LLMProviderError extends Error {
  readonly errorClass: LLMErrorClass;
  readonly retryable: boolean;

  constructor(message: string, errorClass: LLMErrorClass, retryable = false) {
    super(message);
    this.name = "LLMProviderError";
    this.errorClass = errorClass;
    this.retryable = retryable;
  }
}

export interface AnalyticsMetricInput {
  platform?: string;
  relatedType: string;
  relatedId: string;
  metrics: Record<string, number>;
  capturedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsAdapter {
  ingestMetrics(input: AnalyticsMetricInput): Promise<{ accepted: boolean; id?: string }>;
}

export interface NotificationPayload {
  eventType: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationAdapter {
  notify(payload: NotificationPayload): Promise<void>;
}

export class NoopNotificationAdapter implements NotificationAdapter {
  async notify(): Promise<void> {
    // intentionally no-op
  }
}
