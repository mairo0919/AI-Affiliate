import { Prisma, type PrismaClient } from "@prisma/client";

/** Newest completed/partial runs kept in full, plus the protections below. */
export const DEFAULT_ANALYSIS_RETENTION_KEEP_RUNS = 48;
export const DEFAULT_ANALYSIS_RETENTION_BATCH_SIZE = 200;
/** One scheduler tick may delete at most this many batches per table. */
export const ANALYSIS_RETENTION_AUTO_MAX_BATCHES = 25;
const ADVISORY_LOCK_KEY = 84201501;
const MAX_KEEP_RUNS = 200;

export interface RetentionCommand {
  mode: "dry-run" | "apply" | "refuse";
  reason?: string;
}

export function clampKeepRuns(value: number | undefined): number {
  const parsed = value ?? DEFAULT_ANALYSIS_RETENTION_KEEP_RUNS;
  if (!Number.isFinite(parsed)) return DEFAULT_ANALYSIS_RETENTION_KEEP_RUNS;
  return Math.max(1, Math.min(MAX_KEEP_RUNS, Math.floor(parsed)));
}

export function clampBatchSize(value: number | undefined): number {
  const parsed = value ?? DEFAULT_ANALYSIS_RETENTION_BATCH_SIZE;
  if (!Number.isFinite(parsed)) return DEFAULT_ANALYSIS_RETENTION_BATCH_SIZE;
  return Math.max(1, Math.min(1000, Math.floor(parsed)));
}

/**
 * `--apply` alone does not delete. `--dry-run` wins when both are present.
 * Apply also needs `--confirm-prune` equal to the current ProductAnalysis prune count.
 */
export function resolveRetentionCommand(input: {
  dryRun: boolean;
  apply: boolean;
  confirmPrune?: number;
}): RetentionCommand {
  if (input.dryRun || !input.apply) {
    return { mode: "dry-run" };
  }
  if (input.confirmPrune === undefined || !Number.isFinite(input.confirmPrune)) {
    return {
      mode: "refuse",
      reason: "refusing to delete without --confirm-prune=<ProductAnalysis prune count>",
    };
  }
  return { mode: "apply" };
}

export function shouldAutoPruneAfterAnalysis(input: {
  autoPrune: boolean;
  skipped: boolean;
}): boolean {
  return input.autoPrune && !input.skipped;
}

export interface AnalysisRetentionReport {
  keepRuns: number;
  databaseBytes: bigint;
  productAnalysisBytes: bigint;
  contentCandidateBytes: bigint;
  analysisRunBytes: bigint;
  productAnalysis: { total: number; keep: number; prune: number };
  contentCandidate: { total: number; keep: number; prune: number };
  analysisRun: { total: number; keep: number; fullyPruned: number; retainedForProtectedChild: number };
  oldestKeptCompletedAt: Date | null;
  newestPrunedCompletedAt: Date | null;
  protectedContentCandidates: number;
  protectedLatestAnalysesOutsideWindow: number;
  blockedCandidateRows: number;
  inProgressRuns: number;
  latestCompletedRunId: string | null;
  latestCompletedAt: Date | null;
  productAnalysesCreatedLast24h: number;
  analysisRunsCreatedLast24h: number;
  estimatedReclaimableBytes: bigint;
  keepRunIds: string[];
  cutoff: Date | null;
}

interface ReportRow {
  database_bytes: bigint;
  pa_bytes: bigint;
  cc_bytes: bigint;
  run_bytes: bigint;
  pa_total: number;
  pa_keep: number;
  pa_prune: number;
  cc_total: number;
  cc_keep: number;
  cc_prune: number;
  run_total: number;
  run_keep: number;
  run_fully_pruned: number;
  run_retained_for_child: number;
  oldest_kept: Date | null;
  newest_pruned: Date | null;
  protected_content_candidates: number;
  latest_outside_window: number;
  blocked_candidates: number;
  in_progress_runs: number;
  latest_completed_id: string | null;
  latest_completed_at: Date | null;
  pa_last_24h: number;
  runs_last_24h: number;
  keep_run_ids: string[] | null;
  cutoff: Date | null;
}

function num(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

export async function loadAnalysisRetentionReport(
  prisma: PrismaClient,
  keepRunsInput?: number,
): Promise<AnalysisRetentionReport> {
  const keepRuns = clampKeepRuns(keepRunsInput);
  const rows = await prisma.$queryRaw<ReportRow[]>`
    WITH completed AS (
      SELECT id, status::text AS status, "completedAt",
             row_number() OVER (ORDER BY "completedAt" DESC, id DESC) AS rn
      FROM "AnalysisRun"
      WHERE status::text IN ('COMPLETED', 'PARTIALLY_COMPLETED')
        AND "completedAt" IS NOT NULL
    ),
    keep_window AS (
      SELECT id, "completedAt" FROM completed WHERE rn <= ${keepRuns}
    ),
    latest_completed AS (
      SELECT id, "completedAt"
      FROM "AnalysisRun"
      WHERE status::text = 'COMPLETED' AND "completedAt" IS NOT NULL
      ORDER BY "completedAt" DESC, id DESC
      LIMIT 1
    ),
    in_progress AS (
      SELECT id FROM "AnalysisRun" WHERE status::text IN ('PENDING', 'RUNNING')
    ),
    keep_runs AS (
      SELECT id FROM keep_window
      UNION
      SELECT id FROM latest_completed
      UNION
      SELECT id FROM in_progress
    ),
    protected_candidates AS (
      SELECT "contentCandidateId" AS id FROM "GeneratedContent"
      UNION
      SELECT "contentCandidateId" AS id FROM "XPublication"
    ),
    latest_analysis AS (
      SELECT DISTINCT ON ("researchItemId") id, "analysisRunId"
      FROM "ProductAnalysis"
      ORDER BY "researchItemId", "analyzedAt" DESC, id DESC
    ),
    protected_analyses AS (
      SELECT p.id
      FROM "ProductAnalysis" p
      WHERE p."analysisRunId" IN (SELECT id FROM keep_runs)
      UNION
      SELECT id FROM latest_analysis
      UNION
      SELECT c."productAnalysisId"
      FROM "ContentCandidate" c
      WHERE c.id IN (SELECT id FROM protected_candidates)
    ),
    protected_candidate_rows AS (
      SELECT c.id, c."analysisRunId"
      FROM "ContentCandidate" c
      WHERE c."analysisRunId" IN (SELECT id FROM keep_runs)
         OR c.id IN (SELECT id FROM protected_candidates)
    ),
    prunable_runs AS (
      SELECT r.id, r."completedAt"
      FROM "AnalysisRun" r
      WHERE r.status::text IN ('COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED')
        AND r.id NOT IN (SELECT id FROM keep_runs)
        AND NOT EXISTS (
          SELECT 1 FROM "ProductAnalysis" p
          WHERE p."analysisRunId" = r.id
            AND p.id IN (SELECT id FROM protected_analyses)
        )
        AND NOT EXISTS (
          SELECT 1 FROM protected_candidate_rows c
          WHERE c."analysisRunId" = r.id
        )
    )
    SELECT
      pg_database_size(current_database()) AS database_bytes,
      pg_total_relation_size('"ProductAnalysis"'::regclass) AS pa_bytes,
      pg_total_relation_size('"ContentCandidate"'::regclass) AS cc_bytes,
      pg_total_relation_size('"AnalysisRun"'::regclass) AS run_bytes,
      (SELECT count(*)::int FROM "ProductAnalysis") AS pa_total,
      (SELECT count(*)::int FROM protected_analyses) AS pa_keep,
      (SELECT count(*)::int FROM "ProductAnalysis" p WHERE p.id NOT IN (SELECT id FROM protected_analyses)) AS pa_prune,
      (SELECT count(*)::int FROM "ContentCandidate") AS cc_total,
      (SELECT count(*)::int FROM protected_candidate_rows) AS cc_keep,
      (SELECT count(*)::int FROM "ContentCandidate" c WHERE c.id NOT IN (SELECT id FROM protected_candidate_rows)) AS cc_prune,
      (SELECT count(*)::int FROM "AnalysisRun") AS run_total,
      (SELECT count(*)::int FROM keep_runs) AS run_keep,
      (SELECT count(*)::int FROM prunable_runs) AS run_fully_pruned,
      (
        SELECT count(*)::int FROM "AnalysisRun" r
        WHERE r.id NOT IN (SELECT id FROM keep_runs)
          AND r.id NOT IN (SELECT id FROM prunable_runs)
          AND r.status::text NOT IN ('PENDING', 'RUNNING')
      ) AS run_retained_for_child,
      (SELECT min("completedAt") FROM keep_window) AS oldest_kept,
      (SELECT max("completedAt") FROM prunable_runs) AS newest_pruned,
      (SELECT count(*)::int FROM protected_candidates) AS protected_content_candidates,
      (
        SELECT count(*)::int FROM latest_analysis l
        WHERE l."analysisRunId" NOT IN (SELECT id FROM keep_runs)
      ) AS latest_outside_window,
      (
        SELECT count(*)::int FROM protected_candidates pc
        JOIN "ContentCandidate" c ON c.id = pc.id
        WHERE c."analysisRunId" NOT IN (SELECT id FROM keep_runs)
      ) AS blocked_candidates,
      (SELECT count(*)::int FROM in_progress) AS in_progress_runs,
      (SELECT id FROM latest_completed) AS latest_completed_id,
      (SELECT "completedAt" FROM latest_completed) AS latest_completed_at,
      (SELECT count(*)::int FROM "ProductAnalysis" WHERE "createdAt" >= now() - interval '24 hours') AS pa_last_24h,
      (SELECT count(*)::int FROM "AnalysisRun" WHERE "createdAt" >= now() - interval '24 hours') AS runs_last_24h,
      (SELECT coalesce(array_agg(id), ARRAY[]::text[]) FROM keep_runs) AS keep_run_ids,
      (SELECT min("completedAt") FROM keep_window) AS cutoff
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("analysis retention report returned no row");
  }
  const paTotal = num(row.pa_total);
  const paPrune = num(row.pa_prune);
  const ccTotal = num(row.cc_total);
  const ccPrune = num(row.cc_prune);
  const paBytes = BigInt(row.pa_bytes ?? 0);
  const ccBytes = BigInt(row.cc_bytes ?? 0);
  const estimated =
    (paTotal > 0 ? (paBytes * BigInt(paPrune)) / BigInt(paTotal) : 0n) +
    (ccTotal > 0 ? (ccBytes * BigInt(ccPrune)) / BigInt(ccTotal) : 0n);
  return {
    keepRuns,
    databaseBytes: BigInt(row.database_bytes ?? 0),
    productAnalysisBytes: paBytes,
    contentCandidateBytes: ccBytes,
    analysisRunBytes: BigInt(row.run_bytes ?? 0),
    productAnalysis: { total: paTotal, keep: num(row.pa_keep), prune: paPrune },
    contentCandidate: { total: ccTotal, keep: num(row.cc_keep), prune: ccPrune },
    analysisRun: {
      total: num(row.run_total),
      keep: num(row.run_keep),
      fullyPruned: num(row.run_fully_pruned),
      retainedForProtectedChild: num(row.run_retained_for_child),
    },
    oldestKeptCompletedAt: row.oldest_kept,
    newestPrunedCompletedAt: row.newest_pruned,
    protectedContentCandidates: num(row.protected_content_candidates),
    protectedLatestAnalysesOutsideWindow: num(row.latest_outside_window),
    blockedCandidateRows: num(row.blocked_candidates),
    inProgressRuns: num(row.in_progress_runs),
    latestCompletedRunId: row.latest_completed_id,
    latestCompletedAt: row.latest_completed_at,
    productAnalysesCreatedLast24h: num(row.pa_last_24h),
    analysisRunsCreatedLast24h: num(row.runs_last_24h),
    estimatedReclaimableBytes: estimated,
    keepRunIds: row.keep_run_ids ?? [],
    cutoff: row.cutoff,
  };
}

export function formatAnalysisRetentionReport(report: AnalysisRetentionReport): string {
  const lines = [
    "plan: analysis-retention",
    `policy: keep newest ${report.keepRuns} COMPLETED/PARTIALLY_COMPLETED runs`,
    "policy: also keep latest COMPLETED run, PENDING/RUNNING runs",
    "policy: also keep ContentCandidate rows referenced by GeneratedContent or XPublication",
    "policy: also keep each ResearchItem's latest ProductAnalysis",
    `pg_database_size_bytes: ${report.databaseBytes.toString()}`,
    `product_analysis_relation_bytes: ${report.productAnalysisBytes.toString()}`,
    `content_candidate_relation_bytes: ${report.contentCandidateBytes.toString()}`,
    `analysis_run_relation_bytes: ${report.analysisRunBytes.toString()}`,
    `ProductAnalysis total: ${report.productAnalysis.total}`,
    `ProductAnalysis keep: ${report.productAnalysis.keep}`,
    `ProductAnalysis prune: ${report.productAnalysis.prune}`,
    `ContentCandidate total: ${report.contentCandidate.total}`,
    `ContentCandidate keep: ${report.contentCandidate.keep}`,
    `ContentCandidate prune: ${report.contentCandidate.prune}`,
    `AnalysisRun total: ${report.analysisRun.total}`,
    `AnalysisRun keep: ${report.analysisRun.keep}`,
    `AnalysisRun fully_pruned: ${report.analysisRun.fullyPruned}`,
    `AnalysisRun retained_for_protected_child: ${report.analysisRun.retainedForProtectedChild}`,
    `oldest_kept_completed_at: ${report.oldestKeptCompletedAt?.toISOString() ?? "null"}`,
    `newest_pruned_completed_at: ${report.newestPrunedCompletedAt?.toISOString() ?? "null"}`,
    `protected_content_or_x_candidates: ${report.protectedContentCandidates}`,
    `latest_analyses_outside_window: ${report.protectedLatestAnalysesOutsideWindow}`,
    `blocked_candidate_rows: ${report.blockedCandidateRows}`,
    `in_progress_runs: ${report.inProgressRuns}`,
    `latest_completed_run_id: ${report.latestCompletedRunId ?? "null"}`,
    `latest_completed_at: ${report.latestCompletedAt?.toISOString() ?? "null"}`,
    `product_analyses_created_last_24h: ${report.productAnalysesCreatedLast24h}`,
    `analysis_runs_created_last_24h: ${report.analysisRunsCreatedLast24h}`,
    `estimated_reclaimable_logical_bytes: ${report.estimatedReclaimableBytes.toString()}`,
    "disk: DELETE does not return relation files to the OS. Railway volume used will not drop by this estimate.",
    "disk: a later plain VACUUM can mark dead tuples reusable. VACUUM FULL is not used.",
  ];
  return lines.join("\n");
}

export interface AnalysisRetentionApplyResult {
  deletedCandidates: number;
  deletedAnalyses: number;
  deletedRuns: number;
  batches: number;
}

function textArray(ids: string[]): Prisma.Sql {
  if (ids.length === 0) return Prisma.sql`ARRAY[]::text[]`;
  return Prisma.sql`ARRAY[${Prisma.join(ids)}]::text[]`;
}

async function deleteBatch(
  prisma: PrismaClient,
  sql: Prisma.Sql,
): Promise<number | "busy"> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '20s'`;
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS locked
    `;
    if (!lock[0]?.locked) return "busy";
    return tx.$executeRaw(sql);
  }, { maxWait: 20_000, timeout: 200_000 });
}

/**
 * Batch-delete prunable rows. Does nothing unless `apply` is true.
 * When `requireConfirm` is set, `confirmPrune` must match the current ProductAnalysis prune count.
 */
export async function applyAnalysisRetention(
  prisma: PrismaClient,
  options: {
    apply: boolean;
    keepRuns?: number;
    batchSize?: number;
    maxBatches?: number;
    confirmPrune?: number;
    requireConfirm?: boolean;
  },
): Promise<AnalysisRetentionApplyResult> {
  if (!options.apply) {
    return { deletedCandidates: 0, deletedAnalyses: 0, deletedRuns: 0, batches: 0 };
  }
  const keepRuns = clampKeepRuns(options.keepRuns);
  const batchSize = clampBatchSize(options.batchSize);
  const maxBatches = Math.max(1, options.maxBatches ?? 20_000);
  const before = await loadAnalysisRetentionReport(prisma, keepRuns);
  if (options.requireConfirm) {
    if (options.confirmPrune !== before.productAnalysis.prune) {
      throw new Error(
        `confirm-prune mismatch expected ${before.productAnalysis.prune} got ${options.confirmPrune ?? "missing"}`,
      );
    }
  }
  if (before.keepRunIds.length === 0 || before.cutoff === null) {
    return { deletedCandidates: 0, deletedAnalyses: 0, deletedRuns: 0, batches: 0 };
  }
  const keepIds = textArray(before.keepRunIds);
  const cutoff = before.cutoff;
  let deletedCandidates = 0;
  let deletedAnalyses = 0;
  let deletedRuns = 0;
  let batches = 0;

  const runOnce = async (sql: Prisma.Sql): Promise<number> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const deleted = await deleteBatch(prisma, sql);
      if (deleted === "busy") {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      return deleted;
    }
    throw new Error("ANALYSIS_RETENTION_BUSY");
  };

  const pruneWhere = Prisma.sql`
    r.status::text IN ('COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED')
    AND (
      r."completedAt" < ${cutoff}
      OR (r.status::text = 'FAILED' AND COALESCE(r."completedAt", r."createdAt") < ${cutoff})
    )
    AND r.id <> ALL(${keepIds})
  `;

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_analysis_retention_prune"`);
  await prisma.$executeRawUnsafe(
    `CREATE UNLOGGED TABLE "_analysis_retention_prune" (id text PRIMARY KEY)`,
  );
  try {
    const fill = async (sql: Prisma.Sql): Promise<void> => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '180s'`;
        const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS locked
        `;
        if (!lock[0]?.locked) throw new Error("ANALYSIS_RETENTION_BUSY");
        await tx.$executeRaw`TRUNCATE "_analysis_retention_prune"`;
        await tx.$executeRaw(sql);
      }, { maxWait: 20_000, timeout: 200_000 });
    };

    await fill(Prisma.sql`
      INSERT INTO "_analysis_retention_prune" (id)
      SELECT c.id
      FROM "ContentCandidate" c
      JOIN "AnalysisRun" r ON r.id = c."analysisRunId"
      WHERE ${pruneWhere}
        AND NOT EXISTS (
          SELECT 1 FROM "GeneratedContent" g WHERE g."contentCandidateId" = c.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM "XPublication" x WHERE x."contentCandidateId" = c.id
        )
    `);
    for (let i = 0; i < maxBatches; i += 1) {
      const deleted = await runOnce(Prisma.sql`
        WITH doomed AS (
          SELECT w.id
          FROM "_analysis_retention_prune" w
          WHERE NOT EXISTS (
            SELECT 1 FROM "GeneratedContent" g WHERE g."contentCandidateId" = w.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM "XPublication" x WHERE x."contentCandidateId" = w.id
          )
          LIMIT ${batchSize}
        ),
        removed AS (
          DELETE FROM "ContentCandidate" c
          USING doomed
          WHERE c.id = doomed.id
          RETURNING c.id
        )
        DELETE FROM "_analysis_retention_prune" w
        USING removed
        WHERE w.id = removed.id
      `);
      deletedCandidates += deleted;
      batches += 1;
      if (batches % 1000 === 0) {
        console.log(`retention_progress phase=candidates deleted=${deletedCandidates}`);
      }
      if (deleted === 0) break;
    }

    await fill(Prisma.sql`
      INSERT INTO "_analysis_retention_prune" (id)
      SELECT p.id
      FROM "ProductAnalysis" p
      JOIN "AnalysisRun" r ON r.id = p."analysisRunId"
      WHERE ${pruneWhere}
        AND NOT EXISTS (
          SELECT 1 FROM "ContentCandidate" c WHERE c."productAnalysisId" = p.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM (
            SELECT DISTINCT ON ("researchItemId") id
            FROM "ProductAnalysis"
            ORDER BY "researchItemId", "analyzedAt" DESC, id DESC
          ) latest
          WHERE latest.id = p.id
        )
    `);
    for (let i = 0; i < maxBatches; i += 1) {
      const deleted = await runOnce(Prisma.sql`
        WITH doomed AS (
          SELECT w.id
          FROM "_analysis_retention_prune" w
          WHERE NOT EXISTS (
            SELECT 1 FROM "ContentCandidate" c WHERE c."productAnalysisId" = w.id
          )
          LIMIT ${batchSize}
        ),
        removed AS (
          DELETE FROM "ProductAnalysis" p
          USING doomed
          WHERE p.id = doomed.id
          RETURNING p.id
        )
        DELETE FROM "_analysis_retention_prune" w
        USING removed
        WHERE w.id = removed.id
      `);
      deletedAnalyses += deleted;
      batches += 1;
      if (batches % 1000 === 0) {
        console.log(`retention_progress phase=analyses deleted=${deletedAnalyses}`);
      }
      if (deleted === 0) break;
    }

    await fill(Prisma.sql`
      INSERT INTO "_analysis_retention_prune" (id)
      SELECT r.id
      FROM "AnalysisRun" r
      WHERE ${pruneWhere}
        AND NOT EXISTS (
          SELECT 1 FROM "ProductAnalysis" p WHERE p."analysisRunId" = r.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM "ContentCandidate" c WHERE c."analysisRunId" = r.id
        )
    `);
    for (let i = 0; i < maxBatches; i += 1) {
      const deleted = await runOnce(Prisma.sql`
        WITH doomed AS (
          SELECT w.id
          FROM "_analysis_retention_prune" w
          WHERE NOT EXISTS (
            SELECT 1 FROM "ProductAnalysis" p WHERE p."analysisRunId" = w.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM "ContentCandidate" c WHERE c."analysisRunId" = w.id
          )
          LIMIT ${batchSize}
        ),
        removed AS (
          DELETE FROM "AnalysisRun" r
          USING doomed
          WHERE r.id = doomed.id
          RETURNING r.id
        )
        DELETE FROM "_analysis_retention_prune" w
        USING removed
        WHERE w.id = removed.id
      `);
      deletedRuns += deleted;
      batches += 1;
      if (batches % 1000 === 0) {
        console.log(`retention_progress phase=runs deleted=${deletedRuns}`);
      }
      if (deleted === 0) break;
    }
  } finally {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_analysis_retention_prune"`);
  }

  return { deletedCandidates, deletedAnalyses, deletedRuns, batches };
}
