import type { P6Repository } from "@ai-affiliate/database";
import { createHash } from "node:crypto";
import { JsonAnalyticsImportAdapter } from "./analytics-import-adapter.js";

/**
 * Future affiliate conversion CSV/JSON boundary.
 * Keeps revenue metrics separate from engagement AnalyticsSnapshot path.
 */
export class AffiliateResultImportService {
  constructor(private readonly p6: P6Repository) {}

  async importJson(content: string, provider = "future-affiliate"): Promise<{
    imported: number;
    skipped: number;
  }> {
    const adapter = new JsonAnalyticsImportAdapter();
    // Reuse JSON parser shape but map affiliate-specific fields from raw objects
    const data: unknown = JSON.parse(content);
    const rows = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)
        ? (data as { rows: unknown[] }).rows
        : [data];

    let imported = 0;
    let skipped = 0;
    const fileHash = createHash("sha256").update(content).digest("hex");

    for (const raw of rows) {
      const row = (raw ?? {}) as Record<string, unknown>;
      const transactionId =
        typeof row.transactionId === "string"
          ? row.transactionId
          : typeof row.transaction_id === "string"
            ? row.transaction_id
            : null;
      const rowHash = createHash("sha256")
        .update(JSON.stringify([provider, transactionId, row]))
        .digest("hex");

      try {
        await this.p6.upsertAffiliateResult({
          provider: typeof row.provider === "string" ? row.provider : provider,
          transactionId,
          clickedAt: row.clickedAt ? new Date(String(row.clickedAt)) : null,
          convertedAt: row.convertedAt ? new Date(String(row.convertedAt)) : null,
          productId: typeof row.productId === "string" ? row.productId : null,
          productMatchKey: typeof row.productMatchKey === "string" ? row.productMatchKey : null,
          normalUrl: typeof row.normalUrl === "string" ? row.normalUrl : null,
          affiliateUrl: typeof row.affiliateUrl === "string" ? row.affiliateUrl : null,
          orderAmount: typeof row.orderAmount === "number" ? row.orderAmount : null,
          commissionAmount: typeof row.commissionAmount === "number" ? row.commissionAmount : null,
          status: typeof row.status === "string" ? row.status : "pending",
          cancelled: row.cancelled === true,
          attributionMetadata: {
            metricClass: "revenue",
            note: "Separated from engagement AnalyticsSnapshot",
          },
          sourceFileHash: fileHash,
          rowHash,
        });
        imported += 1;
      } catch {
        skipped += 1;
      }
    }

    await this.p6.createAuditEvent({
      eventType: "affiliate.import",
      actor: "system",
      targetType: "AffiliateResult",
      targetId: fileHash.slice(0, 12),
      action: "import",
      summary: `AffiliateResult import imported=${imported} skipped=${skipped}`,
      details: { provider, metricClass: "revenue" },
    });

    void adapter;
    return { imported, skipped };
  }
}
