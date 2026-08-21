import type {
  AnalyticsImportBatch,
  LifecycleRepository,
  P6Repository,
} from "@ai-affiliate/database";
import {
  CsvAnalyticsImportAdapter,
  FutureApiAnalyticsImportAdapter,
  JsonAnalyticsImportAdapter,
  hashFileContent,
  type AnalyticsImportAdapter,
  type NormalizedImportRow,
} from "./analytics-import-adapter.js";

export class AnalyticsImportService {
  constructor(
    private readonly lifecycle: LifecycleRepository,
    private readonly p6: P6Repository,
  ) {}

  async importContent(input: {
    format: "csv" | "json" | "api-future";
    content: string;
    source?: string;
    platform?: string;
    fileName?: string;
  }): Promise<{
    batch: AnalyticsImportBatch;
    duplicateFile: boolean;
    rows: Array<{ id: string; attributionStatus: string; duplicateStatus: string }>;
  }> {
    const fileHash = hashFileContent(input.content);
    const existing = await this.p6.findImportBatchByHash(fileHash);
    if (existing) {
      await this.p6.createAuditEvent({
        eventType: "analytics.import",
        actor: "system",
        targetType: "AnalyticsImportBatch",
        targetId: existing.id,
        action: "duplicate_file_rejected",
        summary: "Duplicate source file hash — existing Analytics left untouched",
        details: { sourceFileHash: fileHash },
      });
      return { batch: existing, duplicateFile: true, rows: [] };
    }

    const adapter = this.resolveAdapter(input.format, input.platform);
    let parsed: NormalizedImportRow[];
    try {
      parsed = adapter.parse(input.content);
    } catch (error) {
      const batch = await this.p6.createImportBatch({
        source: input.source ?? adapter.sourceKey,
        platform: input.platform,
        format: input.format,
        sourceFileHash: fileHash,
        fileName: input.fileName,
      });
      await this.p6.updateImportBatch(batch.id, {
        status: "FAILED",
        validationIssues: [
          { code: "parse_error", message: error instanceof Error ? error.message : "parse failed" },
        ],
        rejectedCount: 1,
      });
      throw error;
    }

    const batch = await this.p6.createImportBatch({
      source: input.source ?? adapter.sourceKey,
      platform: input.platform,
      format: input.format,
      sourceFileHash: fileHash,
      fileName: input.fileName,
      metadata: { importSource: adapter.sourceKey },
    });

    let accepted = 0;
    let duplicate = 0;
    let rejected = 0;
    let unmatched = 0;
    const batchIssues: unknown[] = [];
    const rowSummaries: Array<{ id: string; attributionStatus: string; duplicateStatus: string }> =
      [];
    const seenHashes = new Set<string>();

    for (const row of parsed) {
      if (row.validationIssues.includes("missing_metrics") || row.validationIssues.includes("invalid_measuredAt") && Object.keys(row.normalizedMetrics).length === 0) {
        rejected += 1;
        batchIssues.push({ rowIndex: row.rowIndex, issues: row.validationIssues });
        const created = await this.p6.createImportRow({
          batchId: batch.id,
          rowIndex: row.rowIndex,
          rowHash: row.rowHash,
          externalPublicationId: row.externalPublicationId,
          measuredAt: row.measuredAt,
          rawMetrics: row.rawMetrics,
          normalizedMetrics: row.normalizedMetrics,
          unit: row.unit,
          attributionWindowHours: row.attributionWindowHours,
          duplicateStatus: "rejected",
          validationIssues: row.validationIssues,
          attributionStatus: "rejected",
        });
        rowSummaries.push({
          id: created.id,
          attributionStatus: "rejected",
          duplicateStatus: "rejected",
        });
        continue;
      }

      if (seenHashes.has(row.rowHash)) {
        duplicate += 1;
        const created = await this.p6.createImportRow({
          batchId: batch.id,
          rowIndex: row.rowIndex,
          rowHash: `${row.rowHash}:dup:${row.rowIndex}`,
          externalPublicationId: row.externalPublicationId,
          measuredAt: row.measuredAt,
          rawMetrics: row.rawMetrics,
          normalizedMetrics: row.normalizedMetrics,
          duplicateStatus: "duplicate_row",
          validationIssues: [...row.validationIssues, "duplicate_row"],
          attributionStatus: "rejected",
        });
        rowSummaries.push({
          id: created.id,
          attributionStatus: "rejected",
          duplicateStatus: "duplicate_row",
        });
        continue;
      }
      seenHashes.add(row.rowHash);

      const attribution = await this.attributeRow(row, input.platform);
      let snapshotId: string | null = null;
      if (attribution.status === "matched" && attribution.contentId) {
        const snap = await this.lifecycle.createAnalyticsSnapshot({
          platform: row.platform ?? input.platform ?? "BLOGGER",
          contentId: attribution.contentId,
          publicationTargetId: attribution.publicationTargetId,
          publicationRecordId: attribution.publicationRecordId,
          externalId: row.externalPublicationId,
          measuredAt: row.measuredAt ?? new Date(),
          metrics: row.normalizedMetrics,
          source: `import:${adapter.sourceKey}`,
          notes: `batch=${batch.id}`,
          metadata: {
            importBatchId: batch.id,
            attributionStatus: attribution.status,
            engagementMetricsOnly: true,
          },
        });
        snapshotId = snap.id;
        accepted += 1;
      } else if (attribution.status === "partially_matched" || attribution.status === "awaiting_review") {
        unmatched += 1;
        accepted += 1; // row accepted for review; no destructive snapshot guess
      } else {
        unmatched += 1;
      }

      const created = await this.p6.createImportRow({
        batchId: batch.id,
        rowIndex: row.rowIndex,
        rowHash: row.rowHash,
        externalPublicationId: row.externalPublicationId,
        measuredAt: row.measuredAt,
        rawMetrics: row.rawMetrics,
        normalizedMetrics: row.normalizedMetrics,
        unit: row.unit,
        attributionWindowHours: row.attributionWindowHours,
        duplicateStatus: "unique",
        validationIssues: row.validationIssues,
        attributionStatus: attribution.status,
        snapshotId,
        metadata: { platform: row.platform ?? input.platform },
      });

      await this.p6.createAttribution({
        importRowId: created.id,
        snapshotId,
        status: attribution.status,
        confidence: attribution.confidence,
        matchReason: attribution.matchReason,
        publicationRecordId: attribution.publicationRecordId,
        publicationTargetId: attribution.publicationTargetId,
        contentVersionId: attribution.contentVersionId,
        contentId: attribution.contentId,
        productLinkId: attribution.productLinkId,
        candidates: attribution.candidates,
        platformAccount: attribution.platformAccount,
      });

      rowSummaries.push({
        id: created.id,
        attributionStatus: attribution.status,
        duplicateStatus: "unique",
      });
    }

    const updated = await this.p6.updateImportBatch(batch.id, {
      status: rejected > 0 && accepted === 0 ? "FAILED" : "COMPLETED",
      rowCount: parsed.length,
      acceptedCount: accepted,
      duplicateCount: duplicate,
      rejectedCount: rejected,
      unmatchedCount: unmatched,
      validationIssues: batchIssues,
    });

    await this.p6.createAuditEvent({
      eventType: "analytics.import",
      actor: "system",
      targetType: "AnalyticsImportBatch",
      targetId: updated.id,
      action: "completed",
      summary: `Imported ${accepted} rows (${unmatched} unmatched, ${duplicate} dup, ${rejected} rejected)`,
      details: { format: input.format, platform: input.platform },
    });

    return { batch: updated, duplicateFile: false, rows: rowSummaries };
  }

  async listUnmatched(limit = 50) {
    return this.p6.listUnmatchedImportRows(limit);
  }

  async matchRow(input: {
    importRowId: string;
    contentId: string;
    publicationTargetId?: string;
    publicationRecordId?: string;
    contentVersionId?: string;
    productLinkId?: string;
    experimentVariantId?: string;
    reviewedBy: string;
  }) {
    const row = await this.p6.findImportRow(input.importRowId);
    if (!row) throw new Error(`Import row not found: ${input.importRowId}`);
    const attribution = await this.p6.findAttributionByImportRow(row.id);
    if (!attribution) throw new Error(`Attribution not found for row ${row.id}`);

    const metrics = (row.normalizedMetrics as Record<string, number> | null) ?? {};
    const snap = await this.lifecycle.createAnalyticsSnapshot({
      platform: (row.metadata as { platform?: string } | null)?.platform ?? "BLOGGER",
      contentId: input.contentId,
      publicationTargetId: input.publicationTargetId ?? null,
      publicationRecordId: input.publicationRecordId ?? null,
      externalId: row.externalPublicationId,
      measuredAt: row.measuredAt ?? new Date(),
      metrics,
      source: "import:manual-match",
      metadata: { importRowId: row.id, matchedBy: input.reviewedBy },
    });

    await this.p6.updateImportRow(row.id, {
      attributionStatus: "matched",
      snapshotId: snap.id,
    });
    const updated = await this.p6.updateAttribution(attribution.id, {
      status: "matched",
      confidence: 1,
      matchReason: "human_confirmed",
      contentId: input.contentId,
      publicationTargetId: input.publicationTargetId ?? null,
      publicationRecordId: input.publicationRecordId ?? null,
      contentVersionId: input.contentVersionId ?? null,
      productLinkId: input.productLinkId ?? null,
      experimentVariantId: input.experimentVariantId ?? null,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
    });

    await this.p6.createAuditEvent({
      eventType: "analytics.attribution",
      actor: input.reviewedBy,
      targetType: "AnalyticsAttribution",
      targetId: updated.id,
      action: "matched",
      summary: `Human matched import row to content ${input.contentId}`,
    });
    return updated;
  }

  async rejectMatch(importRowId: string, reviewedBy: string, reason: string) {
    const row = await this.p6.findImportRow(importRowId);
    if (!row) throw new Error(`Import row not found: ${importRowId}`);
    const attribution = await this.p6.findAttributionByImportRow(row.id);
    if (!attribution) throw new Error(`Attribution not found for row ${row.id}`);
    await this.p6.updateImportRow(row.id, { attributionStatus: "rejected" });
    const updated = await this.p6.updateAttribution(attribution.id, {
      status: "rejected",
      matchReason: reason,
      reviewedBy,
      reviewedAt: new Date(),
    });
    await this.p6.createAuditEvent({
      eventType: "analytics.attribution",
      actor: reviewedBy,
      targetType: "AnalyticsAttribution",
      targetId: updated.id,
      action: "rejected",
      summary: reason,
    });
    return updated;
  }

  private resolveAdapter(format: string, platform?: string): AnalyticsImportAdapter {
    if (format === "csv") return new CsvAnalyticsImportAdapter(platform);
    if (format === "api-future") return new FutureApiAnalyticsImportAdapter();
    return new JsonAnalyticsImportAdapter(platform);
  }

  private async attributeRow(
    row: NormalizedImportRow,
    defaultPlatform?: string,
  ): Promise<{
    status: string;
    confidence: number;
    matchReason: string;
    publicationRecordId: string | null;
    publicationTargetId: string | null;
    contentVersionId: string | null;
    contentId: string | null;
    productLinkId: string | null;
    platformAccount: string | null;
    candidates: unknown;
  }> {
    if (!row.externalPublicationId) {
      return {
        status: "unmatched",
        confidence: 0,
        matchReason: "missing_external_publication_id",
        publicationRecordId: null,
        publicationTargetId: null,
        contentVersionId: null,
        contentId: null,
        productLinkId: null,
        platformAccount: null,
        candidates: [],
      };
    }

    const records = await this.p6.findPublicationRecordsByExternalId(row.externalPublicationId);
    const targets = await this.p6.findPublicationTargetsByExternalId(row.externalPublicationId);
    const candidates = [
      ...records.map((r) => ({
        type: "PublicationRecord",
        id: r.id,
        publicationTargetId: r.publicationTargetId,
      })),
      ...targets.map((t) => ({
        type: "PublicationTarget",
        id: t.id,
        contentId: t.contentId,
        contentVersionId: t.contentVersionId,
      })),
    ];

    if (targets.length === 1 && records.length <= 1) {
      const t = targets[0]!;
      return {
        status: "matched",
        confidence: 0.95,
        matchReason: "exact_publishedExternalId",
        publicationRecordId: records[0]?.id ?? null,
        publicationTargetId: t.id,
        contentVersionId: t.contentVersionId,
        contentId: t.contentId,
        productLinkId: null,
        platformAccount: defaultPlatform ?? null,
        candidates,
      };
    }

    if (candidates.length > 1) {
      return {
        status: "awaiting_review",
        confidence: 0.4,
        matchReason: "multiple_candidates",
        publicationRecordId: null,
        publicationTargetId: null,
        contentVersionId: null,
        contentId: null,
        productLinkId: null,
        platformAccount: null,
        candidates,
      };
    }

    if (candidates.length === 1 && targets.length === 0 && records.length === 1) {
      return {
        status: "partially_matched",
        confidence: 0.55,
        matchReason: "record_without_target_join",
        publicationRecordId: records[0]!.id,
        publicationTargetId: records[0]!.publicationTargetId,
        contentVersionId: null,
        contentId: null,
        productLinkId: null,
        platformAccount: null,
        candidates,
      };
    }

    return {
      status: "unmatched",
      confidence: 0,
      matchReason: "no_publication_found",
      publicationRecordId: null,
      publicationTargetId: null,
      contentVersionId: null,
      contentId: null,
      productLinkId: null,
      platformAccount: null,
      candidates: [],
    };
  }
}
