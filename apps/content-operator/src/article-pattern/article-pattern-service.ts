import type {
  ArticleFormatDefinition,
  ArticlePatternRepository,
  ArticleStructureObservation,
  LifecycleRepository,
  P5Repository,
  P6Repository,
} from "@ai-affiliate/database";
import type { AppConfig } from "@ai-affiliate/config";
import { safeFetchText, SafeFetchError, SsrfBlockedError } from "@ai-affiliate/shared";
import { LearningGovernanceService } from "../ops-p6/learning-governance.js";
import { aggregateArticlePatterns, type AggregationThresholds } from "./pattern-aggregation.js";
import {
  assertFeaturesAreStructuralOnly,
  extractArticleStructureFeatures,
} from "./structure-extraction.js";
import {
  parseSourceKind,
  resolveObservationSourceKind,
  type ArticlePatternSourceKind,
} from "./source-kind.js";
import {
  evaluateSingleArticleLearningSuitability,
  type LearningSuitabilityResult,
} from "./learning-suitability.js";
import {
  prepareObservationsForLearning,
  type LearningInputPreparation,
} from "./observation-dedupe.js";
import { canonicalizeArticlePatternUrl } from "./canonical-url.js";
import { buildAnalysisVersions } from "./analysis-versions.js";
import { INFORMATION_DENSITY_VERSION } from "./information-density.js";
import type { ArticleFormatSpec, ArticleStructureFeatures } from "./types.js";
import { normalizeFormatKey } from "./types.js";
import type { ArticleWritingFeatures } from "./types.js";
import type { WritingFeatureLlmExtractor } from "./writing-extraction.js";
import {
  assertWritingFeaturesAreAbstract,
  mergeWritingFeatures,
} from "./writing-extraction.js";
import { extractReferenceEditorialBlueprint } from "./reference-editorial-blueprint.js";
import {
  buildClassifyObservationsSummary,
  type ClassifyObservationSummaryInput,
  type ClassifyObservationsSummary,
} from "./classify-observations-summary.js";
import {
  clusterStructurePatterns,
  type StructurePattern,
} from "./structure-pattern.js";

export class ArticlePatternError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ArticlePatternError";
  }
}

export class ArticlePatternService {
  private readonly governance: LearningGovernanceService;

  constructor(
    private readonly patterns: ArticlePatternRepository,
    private readonly lifecycle: LifecycleRepository,
    private readonly p5: P5Repository,
    private readonly p6: P6Repository,
    private readonly thresholds: AggregationThresholds = {
      minimumSampleCount: 3,
      minimumDomainDiversity: 2,
    },
    private readonly writingLlmExtractor?: WritingFeatureLlmExtractor,
  ) {
    this.governance = new LearningGovernanceService(p5, p6);
  }

  /**
   * Persist observation from in-memory HTML. Does not store HTML/body on Observation.
   * SourceDocument.normalizedText is left null. Writing features are abstracted.
   */
  async observeFromHtml(input: {
    sourceUrl: string;
    html: string;
    title?: string | null;
    sourceKey?: string;
    /** SSOT for aggregation filter. Defaults to fixture (local/html-file path). */
    sourceKind?: ArticlePatternSourceKind;
    /** Optional discovery provenance (no long snippets). */
    discovery?: {
      discoverySource?: string;
      targetFormatKey?: string;
      searchQuery?: string;
    };
    /** Analysis/scope refresh provenance (no body). */
    refresh?: {
      reason: "scope_upgrade" | "density_upgrade" | "analysis_upgrade";
      previousObservationId: string;
      previousScopeVersion: string | null;
      previousInformationDensityVersion?: string | null;
    };
  }): Promise<ArticleStructureObservation> {
    const sourceKind: ArticlePatternSourceKind = input.sourceKind ?? "fixture";
    const targetFormatKey = input.discovery?.targetFormatKey ?? "NEW_RELEASE_SINGLE";
    let domain = "unknown";
    try {
      domain = new URL(input.sourceUrl).hostname.toLowerCase();
    } catch {
      throw new ArticlePatternError("Invalid sourceUrl", "invalid_url");
    }

    const extracted = extractArticleStructureFeatures({
      html: input.html,
      title: input.title,
      sourceUrl: input.sourceUrl,
    });

    // ReferenceEditorialBlueprint: paragraph editorial functions (no prose persisted).
    // Fixes FIRST_LOSS where writingFeatures discarded segment progression.
    const referenceEditorialBlueprint = extractReferenceEditorialBlueprint({
      html: extracted.scope?.scopedHtml || input.html,
      title: input.title,
      sourceUrl: input.sourceUrl,
      articleType: "NEW_RELEASE_SINGLE",
    });

    let writingExtractionStatus:
      | "deterministic_only"
      | "llm_merged"
      | "llm_failed_fallback"
      | "llm_schema_invalid_fallback" = "deterministic_only";
    let writingModelRunId: string | null = null;
    let writingLlmFallbackReason: string | null = null;

    // Optional LLM overlay on ephemeral plain text — discard text after merge.
    // Prefer article-scope text when available (same SSOT as structure/hash).
    if (this.writingLlmExtractor) {
      const plainText = (extracted.scope.scopedHtml || input.html)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 12_000);
      try {
        const overlay = await this.writingLlmExtractor({
          title: input.title,
          plainText,
        });
        const featureOverlay = { ...overlay } as Partial<ArticleWritingFeatures> & {
          _modelRunId?: string;
          _fallbackReason?: string;
          _schemaValid?: boolean;
        };
        const modelRunId = featureOverlay._modelRunId;
        delete featureOverlay._modelRunId;
        delete featureOverlay._fallbackReason;
        delete featureOverlay._schemaValid;
        extracted.features.writingFeatures = mergeWritingFeatures(
          extracted.features.writingFeatures,
          featureOverlay,
        );
        writingExtractionStatus = "llm_merged";
        writingModelRunId = typeof modelRunId === "string" ? modelRunId : null;
      } catch (error) {
        // Deterministic features remain authoritative — never persist body / invalid overlay.
        const msg = error instanceof Error ? error.message : "llm_failed";
        if (msg.startsWith("writing_features_schema_invalid:")) {
          writingExtractionStatus = "llm_schema_invalid_fallback";
          writingLlmFallbackReason = msg.replace("writing_features_schema_invalid:", "");
        } else {
          writingExtractionStatus = "llm_failed_fallback";
          writingLlmFallbackReason = msg.slice(0, 120);
        }
      }
    }
    assertWritingFeaturesAreAbstract(extracted.features.writingFeatures);
    assertFeaturesAreStructuralOnly(extracted.features);

    const suitability = evaluateSingleArticleLearningSuitability(
      {
        articleTypeHint: extracted.articleTypeHint,
        features: extracted.features,
        sourceUrl: input.sourceUrl,
        sourceDomain: domain,
      },
      { targetFormatKey },
    );

    const analysisVersions = buildAnalysisVersions({
      articleScope: extracted.articleScope.scopeVersion,
      informationDensity: extracted.densityDiagnostics.version ?? INFORMATION_DENSITY_VERSION,
    });

    const refreshMeta = input.refresh
      ? {
          reason: input.refresh.reason,
          previousObservationId: input.refresh.previousObservationId,
          previousScopeVersion: input.refresh.previousScopeVersion,
          currentScopeVersion: extracted.articleScope.scopeVersion,
          previousInformationDensityVersion:
            input.refresh.previousInformationDensityVersion ?? null,
          currentInformationDensityVersion: analysisVersions.informationDensity,
        }
      : null;

    const source = await this.lifecycle.createSourceDocument({
      sourceKey:
        input.sourceKey ??
        (input.refresh
          ? `article-pattern:${sourceKind}:${domain}:refresh:${input.refresh.previousObservationId.slice(0, 12)}:${extracted.contentHash.slice(0, 16)}`
          : `article-pattern:${sourceKind}:${domain}:${extracted.contentHash.slice(0, 24)}`),
      url: input.sourceUrl,
      title: input.title ?? null,
      documentType: "external-article-structure",
      contentHash: extracted.contentHash,
      normalizedText: null,
      metadata: {
        purpose: "article_structure_observation",
        storesFullBody: false,
        sourceKind,
        articleTypeHint: extracted.articleTypeHint,
        hashAlgorithm: extracted.hashAlgorithm,
        hashBasis: extracted.hashBasis,
        articleScope: extracted.articleScope,
        analysisVersions,
        ...(refreshMeta ? { refresh: refreshMeta } : {}),
      },
    });

    return this.patterns.createObservation({
      sourceDocumentId: source.id,
      sourceUrl: input.sourceUrl,
      sourceDomain: domain,
      contentHash: extracted.contentHash,
      articleTypeHint: extracted.articleTypeHint,
      features: extracted.features,
      confidence: extracted.confidence,
      metadata: {
        storesFullBody: false,
        hasWritingFeatures: true,
        sourceKind,
        writingExtractionStatus,
        ...(writingModelRunId ? { writingModelRunId } : {}),
        ...(writingLlmFallbackReason ? { writingLlmFallbackReason } : {}),
        hashAlgorithm: extracted.hashAlgorithm,
        hashBasis: extracted.hashBasis,
        articleScope: extracted.articleScope,
        analysisVersions,
        densityDiagnostics: extracted.densityDiagnostics,
        ...(refreshMeta ? { refresh: refreshMeta } : {}),
        ...(input.discovery?.discoverySource
          ? { discoverySource: input.discovery.discoverySource }
          : {}),
        ...(input.discovery?.searchQuery
          ? { discoveryQuery: input.discovery.searchQuery.slice(0, 120) }
          : {}),
        targetFormatKey,
        learningSuitability: {
          classification: suitability.classification,
          score: suitability.score,
          reasons: suitability.reasons.slice(0, 24),
          targetFormatKey: suitability.targetFormatKey,
        },
        referenceEditorialBlueprint,
      },
    });
  }

  /**
   * Fetch a public URL via safeFetchText, extract structure/writing features, persist Observation.
   * HTML is ephemeral — never stored. Tests may inject mockHtml (skips network).
   */
  async observeFromUrl(input: {
    sourceUrl: string;
    confirmExternal: boolean;
    config: AppConfig;
    title?: string | null;
    /** Test-only: skip network */
    mockHtml?: string;
    discovery?: {
      discoverySource?: string;
      targetFormatKey?: string;
      searchQuery?: string;
    };
    refresh?: {
      reason: "scope_upgrade" | "density_upgrade" | "analysis_upgrade";
      previousObservationId: string;
      previousScopeVersion: string | null;
      previousInformationDensityVersion?: string | null;
    };
  }): Promise<ArticleStructureObservation> {
    const allow =
      input.confirmExternal &&
      (input.config.researchAllowExternalRequests || Boolean(input.mockHtml));
    if (!allow) {
      throw new ArticlePatternError(
        "External observation fetch denied — set RESEARCH_ALLOW_EXTERNAL_REQUESTS=true and pass --confirm-external (or use mockHtml in tests)",
        "external_fetch_denied",
      );
    }

    let html = input.mockHtml ?? "";
    if (!input.mockHtml) {
      try {
        const fetched = await safeFetchText(input.sourceUrl, {
          timeoutMs: input.config.researchFetchTimeoutMs ?? 15_000,
          maxBytes: input.config.researchFetchMaxBytes ?? 512_000,
        });
        html = fetched.text;
      } catch (error) {
        if (error instanceof SsrfBlockedError || error instanceof SafeFetchError) {
          throw new ArticlePatternError(error.message, "fetch_failed");
        }
        throw new ArticlePatternError(
          error instanceof Error ? error.message.slice(0, 200) : "fetch failed",
          "fetch_failed",
        );
      }
    }

    try {
      return await this.observeFromHtml({
        sourceUrl: input.sourceUrl,
        html,
        title: input.title,
        sourceKind: "live_url",
        discovery: input.discovery,
        refresh: input.refresh,
      });
    } finally {
      html = "";
    }
  }

  async aggregateAndProposeFormat(input?: {
    observationIds?: string[];
    formatKey?: string;
    forceProposeBelowThreshold?: boolean;
    /**
     * Aggregation provenance filter. Default: live_url (production).
     * Pass fixture for test/fixture-only aggregates. Pass "all" only for diagnostics.
     */
    sourceKind?: ArticlePatternSourceKind | "all";
    /**
     * For NEW_RELEASE_SINGLE (default when formatKey is that), only suitability=A is used.
     * Pass false only for diagnostics.
     */
    suitabilityAOnly?: boolean;
  }): Promise<{
    aggregation: NonNullable<ReturnType<typeof aggregateArticlePatterns>>;
    format: ArticleFormatDefinition | null;
    learningInputDiagnostics: LearningInputPreparation["diagnostics"];
  }> {
    const sourceKindFilter: ArticlePatternSourceKind | "all" = input?.sourceKind ?? "live_url";
    const formatKeyHint = input?.formatKey ? normalizeFormatKey(input.formatKey) : null;
    // Production live NEW_RELEASE_SINGLE aggregates use suitability=A only.
    // Fixture aggregates keep prior behavior unless suitabilityAOnly is forced.
    const aOnly =
      input?.suitabilityAOnly === true ||
      (input?.suitabilityAOnly !== false &&
        formatKeyHint === "NEW_RELEASE_SINGLE" &&
        sourceKindFilter === "live_url");
    // Live NEW_RELEASE_SINGLE aggregates must not mix outdated analysis revisions.
    const requireCurrentAnalysisVersions =
      sourceKindFilter === "live_url" &&
      (formatKeyHint === null || formatKeyHint === "NEW_RELEASE_SINGLE");

    let observations = input?.observationIds?.length
      ? await this.patterns.listObservationsByIds(input.observationIds)
      : await this.patterns.listObservations({
          limit: 200,
          sourceKind: sourceKindFilter === "all" ? undefined : sourceKindFilter,
        });

    if (sourceKindFilter !== "all") {
      observations = observations.filter(
        (o) => resolveObservationSourceKind(o.metadata) === sourceKindFilter,
      );
    }

    const prepared = prepareObservationsForLearning(observations, {
      suitabilityAOnly: aOnly,
      targetFormatKey: formatKeyHint ?? "NEW_RELEASE_SINGLE",
      sourceKind: "all", // already filtered above
      requireCurrentAnalysisVersions,
    });
    observations = prepared.selected;

    const aggregation = aggregateArticlePatterns(observations, this.thresholds, {
      formatKeyOverride: formatKeyHint ?? "NEW_RELEASE_SINGLE",
    });
    if (!aggregation) {
      throw new ArticlePatternError(
        aOnly
          ? "No suitability=A observations to aggregate for NEW_RELEASE_SINGLE"
          : "No observations to aggregate",
        "no_observations",
      );
    }

    if (!aggregation.meetsThresholds && !input?.forceProposeBelowThreshold) {
      if (requireCurrentAnalysisVersions) {
        throw new ArticlePatternError(
          `insufficient_current_analysis_evidence:currentA=${aggregation.sampleCount};domains=${aggregation.domainDiversity};requiredSample=${this.thresholds.minimumSampleCount};requiredDomains=${this.thresholds.minimumDomainDiversity}`,
          "pattern_validation_failed",
        );
      }
      return {
        aggregation,
        format: null,
        learningInputDiagnostics: prepared.diagnostics,
      };
    }

    const formatKey = normalizeFormatKey(input?.formatKey ?? aggregation.suggestedFormatKey);
    const existing = await this.patterns.findFormatByKey(formatKey);
    const structurePatterns = clusterStructurePatterns(
      observations.map((o) => ({
        id: o.id,
        sourceDomain: o.sourceDomain,
        features: o.features as unknown as ArticleStructureFeatures,
      })),
    );
    const { clusterEditorialPatterns } = await import("./editorial-pattern.js");
    const editorialPatterns = clusterEditorialPatterns(
      observations.map((o) => ({
        id: o.id,
        sourceDomain: o.sourceDomain,
        features: o.features as unknown as ArticleStructureFeatures,
      })),
    );

    const formatMetadata = {
      articleTypeHint: aggregation.articleTypeHint,
      domains: aggregation.domains,
      meetsThresholds: aggregation.meetsThresholds,
      sourceKind: sourceKindFilter === "all" ? "mixed" : sourceKindFilter,
      sampleCount: aggregation.sampleCount,
      domainDiversity: aggregation.domainDiversity,
      suitabilityFilter: aOnly ? "A" : "none",
      analysisVersionFilter: requireCurrentAnalysisVersions ? "current" : "none",
      structurePatterns,
      structurePatternCount: structurePatterns.length,
      editorialPatterns,
      editorialPatternCount: editorialPatterns.length,
      learningDedupe: {
        inputCount: prepared.diagnostics.inputCount,
        afterCanonicalLatestCount: prepared.diagnostics.afterCanonicalLatestCount,
        afterContentHashDedupeCount: prepared.diagnostics.afterContentHashDedupeCount,
        afterAnalysisVersionFilterCount: prepared.diagnostics.afterAnalysisVersionFilterCount,
        afterSuitabilityFilterCount: prepared.diagnostics.afterSuitabilityFilterCount,
        duplicateCanonicalExcluded: prepared.diagnostics.duplicateCanonicalExcluded,
        duplicateContentHashExcluded: prepared.diagnostics.duplicateContentHashExcluded,
        outdatedAnalysisExcluded: prepared.diagnostics.outdatedAnalysisExcluded,
        requiredAnalysisVersions: prepared.diagnostics.requiredAnalysisVersions,
      },
    };

    if (existing) {
      const updated = await this.patterns.updateFormat(existing.id, {
        status: existing.status === "ACTIVE" ? existing.status : "PROPOSED",
        sampleExternal: aggregation.sampleCount,
        domainDiversity: aggregation.domainDiversity,
        confidence: aggregation.confidence,
        derivedFromObservationIds: aggregation.observationIds,
        metricsSummary: aggregation.featureSummary,
        spec: aggregation.proposedSpec,
        externalPriorWeight: existing.externalPriorWeight,
        ownPerformanceWeight: existing.ownPerformanceWeight,
        effectiveWeight: existing.effectiveWeight,
        metadata: formatMetadata,
      });
      return {
        aggregation,
        format: updated,
        learningInputDiagnostics: prepared.diagnostics,
      };
    }

    const format = await this.patterns.createFormat({
      formatKey,
      formatCategory: aggregation.suggestedCategory,
      displayName: aggregation.suggestedDisplayName,
      status: "PROPOSED",
      spec: aggregation.proposedSpec,
      sampleExternal: aggregation.sampleCount,
      domainDiversity: aggregation.domainDiversity,
      confidence: aggregation.confidence,
      derivedFromObservationIds: aggregation.observationIds,
      metricsSummary: aggregation.featureSummary,
      externalPriorWeight: 0.5,
      ownPerformanceWeight: 0,
      effectiveWeight: 0.5,
      metadata: formatMetadata,
    });
    return {
      aggregation,
      format,
      learningInputDiagnostics: prepared.diagnostics,
    };
  }

  /**
   * List live_url observations for Discovery eligibility accounting (no body).
   */
  async listLiveObservations(limit = 200): Promise<ArticleStructureObservation[]> {
    return this.patterns.listObservations({ limit, sourceKind: "live_url" });
  }

  /**
   * Re-evaluate learning suitability on existing observations (no re-fetch, no body).
   */
  async classifyObservations(input?: {
    sourceKind?: ArticlePatternSourceKind | "all";
    formatKey?: string;
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      sourceDomain: string;
      sourceUrl: string;
      canonicalUrl: string | null;
      suitability: LearningSuitabilityResult;
      writingExtractionStatus?: string | null;
      writingLlmFallbackReason?: string | null;
      isLatestForCanonical?: boolean;
    }>;
    summary: ClassifyObservationsSummary;
  }> {
    const sourceKind = input?.sourceKind ?? "live_url";
    const targetFormatKey = input?.formatKey ?? "NEW_RELEASE_SINGLE";
    const rows =
      sourceKind === "all"
        ? await this.patterns.listObservations({ limit: input?.limit ?? 200 })
        : await this.patterns.listObservations({
            limit: input?.limit ?? 200,
            sourceKind,
          });

    const prepared = prepareObservationsForLearning(rows, {
      suitabilityAOnly: false,
      targetFormatKey,
      sourceKind: "all",
    });
    const latestIds = new Set(prepared.selected.map((o) => o.id));

    const out: Array<{
      id: string;
      sourceDomain: string;
      sourceUrl: string;
      canonicalUrl: string | null;
      suitability: LearningSuitabilityResult;
      writingExtractionStatus?: string | null;
      writingLlmFallbackReason?: string | null;
      isLatestForCanonical?: boolean;
    }> = [];
    const summaryInputs: ClassifyObservationSummaryInput[] = [];

    for (const row of rows) {
      const suitability = evaluateSingleArticleLearningSuitability(row, { targetFormatKey });
      const prev =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const writingExtractionStatus =
        typeof prev.writingExtractionStatus === "string" ? prev.writingExtractionStatus : null;
      const writingLlmFallbackReason =
        typeof prev.writingLlmFallbackReason === "string" ? prev.writingLlmFallbackReason : null;
      await this.patterns.updateObservationMetadata(row.id, {
        ...prev,
        storesFullBody: false,
        targetFormatKey,
        learningSuitability: {
          classification: suitability.classification,
          score: suitability.score,
          reasons: suitability.reasons.slice(0, 24),
          targetFormatKey: suitability.targetFormatKey,
        },
      });
      const isLatestForCanonical = latestIds.has(row.id);
      out.push({
        id: row.id,
        sourceDomain: row.sourceDomain,
        sourceUrl: row.sourceUrl,
        canonicalUrl: canonicalizeArticlePatternUrl(row.sourceUrl),
        suitability,
        writingExtractionStatus,
        writingLlmFallbackReason,
        isLatestForCanonical,
      });
      summaryInputs.push({
        isLatestForCanonical,
        classification: suitability.classification,
        sourceDomain: row.sourceDomain,
        metadata: row.metadata,
      });
    }
    return {
      items: out,
      summary: buildClassifyObservationsSummary(summaryInputs),
    };
  }

  async approveFormat(formatId: string, approvedBy: string): Promise<ArticleFormatDefinition> {
    const format = await this.requireFormat(formatId);
    if (!["PROPOSED", "AWAITING_APPROVAL"].includes(format.status)) {
      throw new ArticlePatternError(
        `Cannot approve format in status ${format.status}`,
        "invalid_status",
      );
    }
    if (
      format.domainDiversity < this.thresholds.minimumDomainDiversity ||
      format.sampleExternal < this.thresholds.minimumSampleCount
    ) {
      throw new ArticlePatternError(
        `Format evidence below thresholds (sample=${format.sampleExternal}, domains=${format.domainDiversity})`,
        "below_threshold",
      );
    }
    const updated = await this.patterns.updateFormat(formatId, {
      status: "AWAITING_APPROVAL",
      approvedBy,
      approvedAt: new Date(),
    });
    await this.p6.createAuditEvent({
      eventType: "article_format",
      actor: approvedBy,
      targetType: "ArticleFormatDefinition",
      targetId: formatId,
      action: "approve",
      summary: "ArticleFormat marked awaiting activation",
    });
    return updated;
  }

  async activateFormat(formatId: string, actor: string): Promise<ArticleFormatDefinition> {
    const format = await this.requireFormat(formatId);
    if (format.status !== "AWAITING_APPROVAL" && !(format.status === "PROPOSED" && format.approvedAt)) {
      throw new ArticlePatternError(
        `Cannot activate format in status ${format.status} without approval`,
        "approval_required",
      );
    }
    if (!format.approvedBy || !format.approvedAt) {
      throw new ArticlePatternError("Human approval required before ACTIVE", "approval_required");
    }
    if (
      format.domainDiversity < this.thresholds.minimumDomainDiversity ||
      format.sampleExternal < this.thresholds.minimumSampleCount
    ) {
      throw new ArticlePatternError(
        `Cannot activate: sample/domain thresholds not met`,
        "below_threshold",
      );
    }

    let ruleId = format.linkedLearningRuleId;
    if (!ruleId) {
      const rule = await this.p5.createLearningRule({
        ruleType: "article_format",
        statement: `ACTIVE ArticleFormat ${format.formatKey} may be used as Strategy formatKey (below Claim/Policy)`,
        confidence: format.confidence ?? 0.7,
        sampleCount: format.sampleExternal,
        successRate: 0.5,
        minimumSampleCount: this.thresholds.minimumSampleCount,
        minimumConfidence: 0.5,
        minimumSuccessRate: 0.4,
        applicablePlatform: "BLOGGER",
        applicableContentType: "article",
        status: "PROPOSED",
        sourceEvaluationIds: [],
        metadata: {
          formatKey: format.formatKey,
          formatId: format.id,
          priorityBelowClaimAndPolicy: true,
          autoRewriteForbidden: true,
        },
      });
      ruleId = rule.id;
      await this.governance.approve(ruleId, actor);
      await this.governance.activate(ruleId, actor);
    } else {
      const existing = await this.p6.findLearningRule(ruleId);
      if (existing && existing.status !== "ACTIVE") {
        if (!existing.approvedAt) await this.governance.approve(ruleId, actor);
        await this.governance.activate(ruleId, actor);
      }
    }

    const updated = await this.patterns.updateFormat(formatId, {
      status: "ACTIVE",
      linkedLearningRuleId: ruleId,
      approvedBy: format.approvedBy ?? actor,
      approvedAt: format.approvedAt ?? new Date(),
      effectiveWeight: format.externalPriorWeight,
    });
    await this.p6.createAuditEvent({
      eventType: "article_format",
      actor,
      targetType: "ArticleFormatDefinition",
      targetId: formatId,
      action: "activate",
      summary: `ArticleFormat ${format.formatKey} activated`,
      details: { linkedLearningRuleId: ruleId },
    });
    return updated;
  }

  async suspendFormat(formatId: string, actor: string, reason: string): Promise<ArticleFormatDefinition> {
    const format = await this.requireFormat(formatId);
    if (format.status !== "ACTIVE") {
      throw new ArticlePatternError("Only ACTIVE formats can be suspended", "invalid_status");
    }
    if (format.linkedLearningRuleId) {
      await this.governance.suspend(format.linkedLearningRuleId, actor, reason).catch(() => undefined);
    }
    const updated = await this.patterns.updateFormat(formatId, {
      status: "SUSPENDED",
      suspendedAt: new Date(),
    });
    await this.p6.createAuditEvent({
      eventType: "article_format",
      actor,
      targetType: "ArticleFormatDefinition",
      targetId: formatId,
      action: "suspend",
      summary: reason,
    });
    return updated;
  }

  async listFormats(status?: string) {
    return this.patterns.listFormats(status);
  }

  async getFormat(id: string) {
    return this.requireFormat(id);
  }

  async getActiveFormatByKey(formatKey: string): Promise<ArticleFormatDefinition | null> {
    const format = await this.patterns.findFormatByKey(normalizeFormatKey(formatKey));
    if (!format || format.status !== "ACTIVE") return null;
    return format;
  }

  /**
   * Extract Structure Patterns from A-rated observations and attach to an existing Format.
   * Does NOT rewrite ArticleFormatSpec / writingPolicy (keeps ACTIVE generation constraints intact).
   */
  async extractAndAttachStructurePatterns(input: {
    formatKey: string;
    observationIds?: string[];
    sourceKind?: ArticlePatternSourceKind | "all";
  }): Promise<{
    format: ArticleFormatDefinition;
    structurePatterns: StructurePattern[];
    editorialPatterns: import("./editorial-pattern.js").EditorialPattern[];
  }> {
    const formatKey = normalizeFormatKey(input.formatKey);
    const format = await this.patterns.findFormatByKey(formatKey);
    if (!format) {
      throw new ArticlePatternError(`Format not found: ${formatKey}`, "not_found");
    }

    const sourceKindFilter: ArticlePatternSourceKind | "all" = input.sourceKind ?? "live_url";
    let observations = input.observationIds?.length
      ? await this.patterns.listObservationsByIds(input.observationIds)
      : format.derivedFromObservationIds && Array.isArray(format.derivedFromObservationIds)
        ? await this.patterns.listObservationsByIds(
            (format.derivedFromObservationIds as unknown[]).filter(
              (id): id is string => typeof id === "string",
            ),
          )
        : await this.patterns.listObservations({
            limit: 200,
            sourceKind: sourceKindFilter === "all" ? undefined : sourceKindFilter,
          });

    if (!input.observationIds?.length && sourceKindFilter !== "all") {
      observations = observations.filter(
        (o) => resolveObservationSourceKind(o.metadata) === sourceKindFilter,
      );
    }

    const prepared = prepareObservationsForLearning(observations, {
      suitabilityAOnly: true,
      targetFormatKey: formatKey,
      sourceKind: "all",
      requireCurrentAnalysisVersions: sourceKindFilter === "live_url",
    });
    const structurePatterns = clusterStructurePatterns(
      prepared.selected.map((o) => ({
        id: o.id,
        sourceDomain: o.sourceDomain,
        features: o.features as unknown as ArticleStructureFeatures,
      })),
    );
    if (structurePatterns.length === 0) {
      throw new ArticlePatternError(
        "No Structure Patterns extracted from suitability=A observations",
        "no_structure_patterns",
      );
    }

    const { clusterEditorialPatterns } = await import("./editorial-pattern.js");
    const editorialPatterns = clusterEditorialPatterns(
      prepared.selected.map((o) => ({
        id: o.id,
        sourceDomain: o.sourceDomain,
        features: o.features as unknown as ArticleStructureFeatures,
      })),
    );

    const prevMeta =
      format.metadata && typeof format.metadata === "object" && !Array.isArray(format.metadata)
        ? (format.metadata as Record<string, unknown>)
        : {};
    const updated = await this.patterns.updateFormat(format.id, {
      metadata: {
        ...prevMeta,
        structurePatterns,
        structurePatternCount: structurePatterns.length,
        structurePatternsExtractedAt: new Date().toISOString(),
        structurePatternsSourceObservationIds: prepared.selected.map((o) => o.id),
        editorialPatterns,
        editorialPatternCount: editorialPatterns.length,
        editorialPatternsExtractedAt: new Date().toISOString(),
        editorialPatternsSourceObservationIds: prepared.selected.map((o) => o.id),
      },
    });
    return { format: updated, structurePatterns, editorialPatterns };
  }

  /**
   * Bind ContentStrategy.formatKey to an ACTIVE ArticleFormat (no full strategy regen).
   * Requires ACTIVE format for the given key — does not invent / legacy-map to another key.
   */
  async setStrategyFormatKey(
    strategyId: string,
    formatKey: string,
  ): Promise<{ strategy: Awaited<ReturnType<LifecycleRepository["updateStrategyFormatKey"]>>; format: ArticleFormatDefinition }> {
    const strategy = await this.lifecycle.findContentStrategy(strategyId);
    if (!strategy) {
      throw new ArticlePatternError(`Strategy not found: ${strategyId}`, "not_found");
    }
    const active = await this.getActiveFormatByKey(formatKey);
    if (!active) {
      throw new ArticlePatternError(
        `No ACTIVE ArticleFormat for formatKey=${formatKey}`,
        "format_not_active",
      );
    }
    // Persist the ACTIVE definition's exact formatKey (never a legacy alias).
    const updated = await this.lifecycle.updateStrategyFormatKey(strategyId, active.formatKey);
    return { strategy: updated, format: active };
  }

  parseSpec(format: ArticleFormatDefinition): ArticleFormatSpec | null {
    const raw = format.spec;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as ArticleFormatSpec;
  }

  /** Human-readable writingPolicy summary for Admin (no body). */
  summarizeWritingPolicy(format: ArticleFormatDefinition): Record<string, unknown> | null {
    const spec = this.parseSpec(format);
    const wp = spec?.writingPolicy;
    if (!wp) return null;
    const meta =
      format.metadata && typeof format.metadata === "object" && !Array.isArray(format.metadata)
        ? (format.metadata as Record<string, unknown>)
        : {};
    return {
      sourceKind: meta.sourceKind ?? null,
      sampleCount: format.sampleExternal,
      domainDiversity: format.domainDiversity,
      confidence: format.confidence,
      introRole: wp.introRole,
      preferredHookTypes: wp.preferredHookTypes,
      targetParagraphLength: wp.targetParagraphLength,
      factOpinionBalance: wp.factOpinionBalance,
      recommendationRequired: wp.recommendationRequired,
      audienceFraming: wp.audienceFraming,
      benefitFraming: wp.benefitFraming,
      sectionPurposeSequence: wp.sectionPurposeSequence,
      ctaLeadInPolicy: wp.ctaLeadInPolicy,
      informationDensity: wp.informationDensity,
      forbidGenericPraise: wp.forbidGenericPraise,
      requireEditorialValue: wp.requireEditorialValue,
      repetitionMaxOverlap: wp.repetitionPolicy?.maxOverlapScore ?? null,
    };
  }

  private async requireFormat(id: string): Promise<ArticleFormatDefinition> {
    const format = await this.patterns.findFormatById(id);
    if (!format) throw new ArticlePatternError(`Format not found: ${id}`, "not_found");
    return format;
  }
}

export { parseSourceKind };
