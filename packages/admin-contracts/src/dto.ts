import type { AdminRole } from "./roles.js";
import type { PageResult } from "./pagination.js";

export interface AdminUserDto {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
}

export interface AuthSessionDto {
  token: string;
  expiresAt: string;
  user: AdminUserDto;
}

export interface DashboardDto {
  awaitingContentApprovals: number;
  awaitingPublicationApprovals: number;
  unmatchedAttributions: number;
  awaitingLearningRules: number;
  openRuleConflicts: number;
  awaitingExperiments: number;
  awaitingLinkReplacements: number;
  manualReviewJobs: number;
  failedJobs: number;
  budget: { currency: string; spentToday: number; hardLimit: number | null };
  bloggerDraftPending: number;
  xExportPending: number;
  monetizationCounts: Record<string, number>;
}

export interface ContentVersionListItemDto {
  id: string;
  contentId: string;
  versionNumber: number;
  revisionType: string;
  title: string;
  status: string;
  createdAt: string;
  createdBy: string;
}

export interface ContentVersionDetailDto extends ContentVersionListItemDto {
  summary: string | null;
  bodyPreview: string;
  /** Full body for internal reviewers only (never public) */
  body: string;
  bodyLength: number;
  structuredContent: Record<string, unknown> | null;
  modelRunId: string | null;
  parentVersionId: string | null;
  isLatest: boolean;
  claims: Array<{
    id: string;
    statement: string;
    status: string;
    sources?: Array<{ url: string | null; label: string | null }>;
  }>;
  reviews: Array<{
    id: string;
    reviewType: string;
    result: string;
    score: number | null;
    findings?: unknown;
  }>;
  policyResults: Array<{ result: string; message: string | null }>;
  parentDiffSummary?: string | null;
}

export interface PublicationTargetDto {
  id: string;
  contentId: string;
  contentVersionId: string;
  platform: string;
  status: string;
  approvalMode: string;
  publishedExternalId: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
}

export interface AnalyticsAttributionDto {
  id: string;
  importRowId: string | null;
  status: string;
  confidence: number;
  matchReason: string;
  contentId: string | null;
  publicationTargetId: string | null;
  externalPublicationId: string | null;
  candidates: unknown;
  createdAt: string;
}

export interface LearningRuleDto {
  id: string;
  status: string;
  ruleType: string;
  statement: string;
  confidence: number;
  sampleCount: number;
  successRate: number | null;
  minimumSampleCount: number;
  minimumConfidence: number;
  minimumSuccessRate: number;
  applicablePlatform: string | null;
  applicableContentType: string | null;
  applicableGenre: string | null;
  applicableProvider: string | null;
  validFrom: string;
  validUntil: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  supersedesRuleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningConflictDto {
  id: string;
  ruleAId: string;
  ruleBId: string;
  conflictType: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface ExperimentDto {
  id: string;
  contentId: string;
  name: string;
  hypothesis: string;
  status: string;
  platform: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface LinkReplacementDto {
  id: string;
  contentId: string;
  productLinkId: string;
  replacementStatus: string;
  previousUrl: string;
  nextUrl: string;
  changeReason: string | null;
  approvedBy: string | null;
  createdAt: string;
}

export interface AdminJobViewDto {
  jobType: string;
  sourceModel: "OperationJob" | "ResearchJob" | "OperatorJob";
  jobId: string;
  cycle: string | null;
  status: string;
  progress: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  retryCount: number;
  checkpointSummary: string | null;
  failureClassification: string | null;
  errorSummary: string | null;
  idempotencyKey: string | null;
  manualActionRequired: boolean;
}

export interface AuditEventDto {
  id: string;
  eventType: string;
  actor: string;
  targetType: string;
  targetId: string;
  action: string;
  summary: string;
  details: Record<string, unknown> | null;
  relatedJobId: string | null;
  createdAt: string;
}

export interface SystemSettingDto {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export interface SecretStatusDto {
  key: string;
  configured: boolean;
}

export interface ProviderMappingProfileDto {
  id: string;
  profileKey: string;
  provider: string;
  label: string;
  isSample: boolean;
  columnMapping: Record<string, string>;
  statusMapping: Record<string, string>;
  currencyMapping: Record<string, string>;
  dateFormat: string;
  notes: string | null;
}

export interface ApprovalDecisionDto {
  id: string;
  targetType: string;
  targetId: string;
  decision: string;
  reason: string | null;
  actorUserId: string;
  actorEmail: string;
  createdAt: string;
}

export interface ImportPreviewDto {
  format: string;
  platform: string | null;
  rowCount: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  sampleIssues: string[];
  fileHash: string;
}

export interface XExportPayloadDto {
  format: string;
  contentId: string;
  contentVersionId: string;
  title: string;
  body: string;
  mainPost: string;
  reply: string | null;
  bloggerUrl: string | null;
  productUrl: string | null;
  scheduledRecommendation: string | null;
  claimReferences: string[];
  warnings: string[];
  characterCount: number;
  exportedAt: string;
  instructions: string[];
}

export type { PageResult };
