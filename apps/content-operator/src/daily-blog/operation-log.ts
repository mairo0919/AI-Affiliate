/**
 * Daily run operation log shape — persist via OperationJob.payload/result.
 */

export interface DailyBlogOperationLog {
  runId: string;
  startedAt: string;
  completedAt?: string;
  timezone: string;
  articleKind: "PRODUCT" | "RANKING" | null;
  candidateCount: number;
  selectedCid: string | null;
  selectionReason: string | null;
  generationResult: "SKIPPED" | "DEFER" | "SUCCESS" | "FAIL" | "DRY_RUN";
  brainDecision: string | null;
  publishResult: "NOT_ATTEMPTED" | "HELD" | "PUBLISHED" | "FAILED" | "DRY_RUN_OK";
  bloggerPostId: string | null;
  publishedUrl: string | null;
  affiliateUrl: string | null;
  llmCalls: number;
  llmCost: number | null;
  llmCurrency: string | null;
  externalApiCalls: number;
  failureCode: string | null;
  idempotencyKey: string;
  xHandoffStored: boolean;
  dryRun: boolean;
}

export function emptyOperationLog(input: {
  runId: string;
  timezone: string;
  idempotencyKey: string;
  dryRun: boolean;
  now?: Date;
}): DailyBlogOperationLog {
  return {
    runId: input.runId,
    startedAt: (input.now ?? new Date()).toISOString(),
    timezone: input.timezone,
    articleKind: null,
    candidateCount: 0,
    selectedCid: null,
    selectionReason: null,
    generationResult: "SKIPPED",
    brainDecision: null,
    publishResult: "NOT_ATTEMPTED",
    bloggerPostId: null,
    publishedUrl: null,
    affiliateUrl: null,
    llmCalls: 0,
    llmCost: null,
    llmCurrency: null,
    externalApiCalls: 0,
    failureCode: null,
    idempotencyKey: input.idempotencyKey,
    xHandoffStored: false,
    dryRun: input.dryRun,
  };
}
