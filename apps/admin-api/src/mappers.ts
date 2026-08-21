import type {
  AdminJobViewDto,
  AnalyticsAttributionDto,
  AuditEventDto,
  ContentVersionDetailDto,
  ContentVersionListItemDto,
  ExperimentDto,
  LearningConflictDto,
  LearningRuleDto,
  LinkReplacementDto,
  PublicationTargetDto,
  ProviderMappingProfileDto,
  SystemSettingDto,
} from "@ai-affiliate/admin-contracts";

export function mapContentVersionListItem(v: {
  id: string;
  contentId: string;
  versionNumber: number;
  revisionType: string;
  title: string;
  status: string;
  createdAt: Date;
  createdBy: string | null;
}): ContentVersionListItemDto {
  return {
    id: v.id,
    contentId: v.contentId,
    versionNumber: v.versionNumber,
    revisionType: v.revisionType,
    title: v.title,
    status: v.status,
    createdAt: v.createdAt.toISOString(),
    createdBy: v.createdBy ?? "system",
  };
}

export function mapContentVersionDetail(input: {
  version: {
    id: string;
    contentId: string;
    versionNumber: number;
    revisionType: string;
    title: string;
    summary: string | null;
    body: string;
    status: string;
    structuredContent: unknown;
    modelRunId: string | null;
    parentVersionId: string | null;
    createdAt: Date;
    createdBy: string | null;
  };
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
}): ContentVersionDetailDto {
  const v = input.version;
  return {
    ...mapContentVersionListItem(v),
    summary: v.summary,
    bodyPreview: v.body.slice(0, 500),
    body: v.body,
    bodyLength: v.body.length,
    structuredContent: (v.structuredContent as Record<string, unknown> | null) ?? null,
    modelRunId: v.modelRunId,
    parentVersionId: v.parentVersionId,
    isLatest: input.isLatest,
    claims: input.claims,
    reviews: input.reviews,
    policyResults: input.policyResults,
    parentDiffSummary: input.parentDiffSummary ?? null,
  };
}

export function mapPublicationTarget(t: {
  id: string;
  contentId: string;
  contentVersionId: string;
  platform: string;
  status: string;
  approvalMode: string;
  publishedExternalId: string | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  scheduledAt: Date | null;
}): PublicationTargetDto {
  return {
    id: t.id,
    contentId: t.contentId,
    contentVersionId: t.contentVersionId,
    platform: t.platform,
    status: t.status,
    approvalMode: t.approvalMode,
    publishedExternalId: t.publishedExternalId,
    publishedUrl: t.publishedUrl,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    scheduledAt: t.scheduledAt?.toISOString() ?? null,
  };
}

export function mapAttribution(a: {
  id: string;
  importRowId: string | null;
  status: string;
  confidence: number;
  matchReason: string;
  contentId: string | null;
  publicationTargetId: string | null;
  externalPublicationId?: string | null;
  candidates: unknown;
  createdAt: Date;
}): AnalyticsAttributionDto {
  return {
    id: a.id,
    importRowId: a.importRowId,
    status: a.status,
    confidence: a.confidence,
    matchReason: a.matchReason,
    contentId: a.contentId,
    publicationTargetId: a.publicationTargetId,
    externalPublicationId: a.externalPublicationId ?? null,
    candidates: a.candidates,
    createdAt: a.createdAt.toISOString(),
  };
}

export function mapLearningRule(r: {
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
  validFrom: Date;
  validUntil: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  supersedesRuleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LearningRuleDto {
  return {
    id: r.id,
    status: r.status,
    ruleType: r.ruleType,
    statement: r.statement,
    confidence: r.confidence,
    sampleCount: r.sampleCount,
    successRate: r.successRate,
    minimumSampleCount: r.minimumSampleCount,
    minimumConfidence: r.minimumConfidence,
    minimumSuccessRate: r.minimumSuccessRate,
    applicablePlatform: r.applicablePlatform,
    applicableContentType: r.applicableContentType,
    applicableGenre: r.applicableGenre,
    applicableProvider: r.applicableProvider,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil?.toISOString() ?? null,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    supersedesRuleId: r.supersedesRuleId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function mapConflict(c: {
  id: string;
  ruleAId: string;
  ruleBId: string;
  conflictType: string;
  reason: string;
  status: string;
  createdAt: Date;
}): LearningConflictDto {
  return {
    id: c.id,
    ruleAId: c.ruleAId,
    ruleBId: c.ruleBId,
    conflictType: c.conflictType,
    reason: c.reason,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  };
}

export function mapExperiment(e: {
  id: string;
  contentId: string;
  name: string;
  hypothesis: string;
  status: string;
  platform: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}): ExperimentDto {
  return {
    id: e.id,
    contentId: e.contentId,
    name: e.name,
    hypothesis: e.hypothesis,
    status: e.status,
    platform: e.platform,
    approvedBy: e.approvedBy,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

export function mapLinkReplacement(e: {
  id: string;
  contentId: string;
  productLinkId: string | null;
  status: string;
  previousUrl: string;
  nextUrl: string;
  changeReason: string | null;
  approvedBy: string | null;
  createdAt: Date;
}): LinkReplacementDto {
  return {
    id: e.id,
    contentId: e.contentId,
    productLinkId: e.productLinkId ?? "",
    replacementStatus: e.status,
    previousUrl: e.previousUrl,
    nextUrl: e.nextUrl,
    changeReason: e.changeReason,
    approvedBy: e.approvedBy,
    createdAt: e.createdAt.toISOString(),
  };
}

export function mapAudit(e: {
  id: string;
  eventType: string;
  actor: string;
  targetType: string;
  targetId: string;
  action: string;
  summary: string;
  details: unknown;
  relatedJobId: string | null;
  createdAt: Date;
}): AuditEventDto {
  return {
    id: e.id,
    eventType: e.eventType,
    actor: e.actor,
    targetType: e.targetType,
    targetId: e.targetId,
    action: e.action,
    summary: e.summary,
    details: (e.details as Record<string, unknown> | null) ?? null,
    relatedJobId: e.relatedJobId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function mapSetting(s: {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
}): SystemSettingDto {
  return {
    key: s.key,
    value: s.value,
    description: s.description,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function mapMappingProfile(p: {
  id: string;
  profileKey: string;
  provider: string;
  label: string;
  isSample: boolean;
  columnMapping: unknown;
  statusMapping: unknown;
  currencyMapping: unknown;
  dateFormat: string;
  notes: string | null;
}): ProviderMappingProfileDto {
  return {
    id: p.id,
    profileKey: p.profileKey,
    provider: p.provider,
    label: p.label,
    isSample: p.isSample,
    columnMapping: (p.columnMapping as Record<string, string>) ?? {},
    statusMapping: (p.statusMapping as Record<string, string>) ?? {},
    currencyMapping: (p.currencyMapping as Record<string, string>) ?? {},
    dateFormat: p.dateFormat,
    notes: p.notes,
  };
}

export function mapOperationJob(j: {
  id: string;
  cycleType: string;
  status: string;
  attempts: number;
  error: string | null;
  errorClass: string | null;
  idempotencyKey: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  payload?: unknown;
}): AdminJobViewDto {
  return {
    jobType: j.cycleType,
    sourceModel: "OperationJob",
    jobId: j.id,
    cycle: j.cycleType,
    status: j.status,
    progress: null,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.completedAt?.toISOString() ?? null,
    retryCount: j.attempts,
    checkpointSummary: null,
    failureClassification: j.errorClass,
    errorSummary: j.error ? j.error.slice(0, 280) : null,
    idempotencyKey: j.idempotencyKey,
    manualActionRequired: j.status === "MANUAL_REVIEW_REQUIRED",
  };
}

export function mapResearchJob(j: {
  id: string;
  type: string;
  status: string;
  retryCount?: number;
  attempts?: number;
  errorMessage?: string | null;
  error?: string | null;
  startedAt: Date | null;
  finishedAt?: Date | null;
  completedAt?: Date | null;
  idempotencyKey?: string | null;
}): AdminJobViewDto {
  return {
    jobType: j.type,
    sourceModel: "ResearchJob",
    jobId: j.id,
    cycle: null,
    status: j.status,
    progress: null,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: (j.finishedAt ?? j.completedAt)?.toISOString() ?? null,
    retryCount: j.retryCount ?? j.attempts ?? 0,
    checkpointSummary: null,
    failureClassification: null,
    errorSummary: (j.errorMessage ?? j.error)?.slice(0, 280) ?? null,
    idempotencyKey: j.idempotencyKey ?? null,
    manualActionRequired: false,
  };
}
