/**
 * Full API-era repair campaign:
 * 1) Audit all universe CIDs → NORMAL / REPAIR_REQUIRED / NEEDS_ENRICHMENT
 * 2) Enrich NEEDS_ENRICHMENT (official page only)
 * 3) Re-classify after enrichment
 * 4) Canonical repair REPAIR_REQUIRED only
 * 5) Final audit → NORMAL / REPAIRED / NEEDS_ENRICHMENT / APPLY_REJECTED
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { ResearchRepository } from "@ai-affiliate/database";
import { createLogger, type Logger } from "@ai-affiliate/shared";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import {
  auditApiEraArticlesBatch,
  listApiEraUniverseCids,
  type ApiEraAuditRow,
  type AuditClass,
} from "./audit-api-era-articles.js";
import { ensureOfficialEnrichmentForStockItem } from "./ensure-official-enrichment.js";
import { repairApiArticleQualityInPlace } from "./repair-api-article-quality.js";

export type FinalClass = "NORMAL" | "REPAIRED" | "NEEDS_ENRICHMENT" | "APPLY_REJECTED";

export type CampaignResult = {
  auditedAt: string;
  completedAt: string;
  universeSize: number;
  initialCounts: Record<AuditClass, number>;
  enrichment: {
    attempted: number;
    pageEnriched: number;
    alreadyPresent: number;
    stillNeeds: number;
  };
  repair: Awaited<ReturnType<typeof repairApiArticleQualityInPlace>> | null;
  finalByCid: Record<string, FinalClass>;
  finalCounts: Record<FinalClass, number>;
  residual: {
    thin: number;
    factualMisframe: number;
    multiPerformerMisframe: number;
    genericTitle: number;
  };
  initialRows: ApiEraAuditRow[];
  finalRows: ApiEraAuditRow[];
  dryRun: boolean;
};

async function enrichNeeds(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  logger: Logger;
  rows: ApiEraAuditRow[];
  dryRun: boolean;
}): Promise<CampaignResult["enrichment"]> {
  const research = new ResearchRepository(input.database.prisma);
  const needs = input.rows.filter((r) => r.classification === "NEEDS_ENRICHMENT");
  const out = {
    attempted: 0,
    pageEnriched: 0,
    alreadyPresent: 0,
    stillNeeds: 0,
  };
  for (const row of needs) {
    out.attempted += 1;
    if (input.dryRun) {
      out.stillNeeds += 1;
      continue;
    }
    const item = await input.database.prisma.researchItem.findFirst({
      where: { externalId: row.cid },
    });
    if (!item) {
      out.stillNeeds += 1;
      continue;
    }
    const ctaUrl = buildFanzaCanonicalProductUrl(row.cid);
    try {
      const enrichment = await ensureOfficialEnrichmentForStockItem({
        lifecycle: input.lifecycle,
        research,
        config: input.config,
        logger: input.logger,
        canonicalId: row.cid,
        productUrl: ctaUrl,
        researchItemId: item.id,
        productTitle: item.title,
        rawData: item.rawData,
      });
      if (enrichment.status === "PAGE_ENRICHED") out.pageEnriched += 1;
      else if (enrichment.status === "ALREADY_PRESENT") out.alreadyPresent += 1;
      else out.stillNeeds += 1;
    } catch (e) {
      input.logger.warn(
        `enrichment failed cid=${row.cid}: ${e instanceof Error ? e.message : String(e)}`,
      );
      out.stillNeeds += 1;
    }
  }
  return out;
}

function residualFromRows(rows: ApiEraAuditRow[]): CampaignResult["residual"] {
  return {
    thin: rows.filter((r) => r.reasons.some((x) => /THIN/.test(x)) || r.bodyLen < 280).length,
    factualMisframe: rows.filter((r) => r.reasons.some((x) => /FACTUAL|LOW_FACTUAL/.test(x))).length,
    multiPerformerMisframe: rows.filter((r) =>
      r.reasons.some((x) => /MULTI_PERFORMER/.test(x)),
    ).length,
    genericTitle: rows.filter((r) =>
      r.reasons.some((x) => /MECHANICAL|GENERIC|PERFORMER_GENRE|SCOPE_TITLE/.test(x)),
    ).length,
  };
}

export async function runApiEraRepairCampaign(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  dryRun?: boolean;
  /** Limit CIDs (tests). Default: full universe. */
  cids?: string[];
}): Promise<CampaignResult> {
  const logger = createLogger("info");
  const dryRun = input.dryRun === true;
  const auditedAt = new Date().toISOString();

  const cids =
    input.cids && input.cids.length > 0
      ? input.cids
      : await listApiEraUniverseCids({ database: input.database });

  const initial = await auditApiEraArticlesBatch({
    database: input.database,
    lifecycle: input.lifecycle,
    config: input.config,
    logger,
    cids,
  });

  const enrichment = await enrichNeeds({
    database: input.database,
    lifecycle: input.lifecycle,
    config: input.config,
    logger,
    rows: initial.rows,
    dryRun,
  });

  // Re-audit after enrichment so repaired set is accurate
  const afterEnrich = await auditApiEraArticlesBatch({
    database: input.database,
    lifecycle: input.lifecycle,
    config: input.config,
    logger,
    cids,
  });

  const repairCids = afterEnrich.rows
    .filter((r) => r.classification === "REPAIR_REQUIRED")
    .map((r) => r.cid);

  const repair =
    repairCids.length === 0
      ? null
      : await repairApiArticleQualityInPlace({
          database: input.database,
          lifecycle: input.lifecycle,
          config: input.config,
          productCanonicalIds: repairCids,
          dryRun,
        });

  const finalAudit = await auditApiEraArticlesBatch({
    database: input.database,
    lifecycle: input.lifecycle,
    config: input.config,
    logger,
    cids,
  });

  const repairedSet = new Set(
    (repair?.repaired ?? [])
      .filter((r) => !dryRun && r.finalClass === "REPAIRED")
      .map((r) => String(r.cid)),
  );
  const wouldRepairSet = new Set(repairCids);
  const applyRejectedSet = new Set(
    (repair?.applyRejected ?? []).map((r) => String(r.cid)),
  );

  const needsEnrichSet = new Set([
    ...afterEnrich.rows.filter((r) => r.classification === "NEEDS_ENRICHMENT").map((r) => r.cid),
    ...(repair?.needsEnrichment ?? []).map((r) => String(r.cid)),
  ]);

  const finalByCid: Record<string, FinalClass> = {};
  for (const row of finalAudit.rows) {
    if (dryRun) {
      if (needsEnrichSet.has(row.cid) || row.classification === "NEEDS_ENRICHMENT") {
        finalByCid[row.cid] = "NEEDS_ENRICHMENT";
      } else if (wouldRepairSet.has(row.cid)) {
        finalByCid[row.cid] = "REPAIRED";
      } else {
        finalByCid[row.cid] = "NORMAL";
      }
      continue;
    }

    if (repairedSet.has(row.cid) && row.classification === "NORMAL") {
      finalByCid[row.cid] = "REPAIRED";
    } else if (repairedSet.has(row.cid) && row.classification !== "NORMAL") {
      finalByCid[row.cid] =
        row.classification === "NEEDS_ENRICHMENT" ? "NEEDS_ENRICHMENT" : "APPLY_REJECTED";
    } else if (applyRejectedSet.has(row.cid)) {
      finalByCid[row.cid] = "APPLY_REJECTED";
    } else if (needsEnrichSet.has(row.cid) || row.classification === "NEEDS_ENRICHMENT") {
      finalByCid[row.cid] = "NEEDS_ENRICHMENT";
    } else if (row.classification === "NORMAL") {
      finalByCid[row.cid] = "NORMAL";
    } else {
      finalByCid[row.cid] = "APPLY_REJECTED";
    }
  }

  // Ensure every universe cid has a final class
  for (const cid of cids) {
    if (!finalByCid[cid]) {
      finalByCid[cid] = needsEnrichSet.has(cid) ? "NEEDS_ENRICHMENT" : "APPLY_REJECTED";
    }
  }

  const finalCounts: Record<FinalClass, number> = {
    NORMAL: 0,
    REPAIRED: 0,
    NEEDS_ENRICHMENT: 0,
    APPLY_REJECTED: 0,
  };
  for (const v of Object.values(finalByCid)) finalCounts[v] += 1;

  // Residual quality on non-NORMAL final rows (post-state audit)
  const residualRows = finalAudit.rows.filter((r) => finalByCid[r.cid] !== "NORMAL" && finalByCid[r.cid] !== "REPAIRED");

  return {
    auditedAt,
    completedAt: new Date().toISOString(),
    universeSize: cids.length,
    initialCounts: initial.counts,
    enrichment,
    repair,
    finalByCid,
    finalCounts,
    residual: residualFromRows(
      dryRun
        ? afterEnrich.rows.filter((r) => r.classification !== "NORMAL")
        : residualRows.length
          ? residualRows
          : finalAudit.rows.filter((r) => finalByCid[r.cid] === "APPLY_REJECTED" || finalByCid[r.cid] === "NEEDS_ENRICHMENT"),
    ),
    initialRows: initial.rows,
    finalRows: finalAudit.rows,
    dryRun,
  };
}
