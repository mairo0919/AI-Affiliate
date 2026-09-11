/**
 * One-time initial publish boost: grow WordPress publish count to a target.
 * Does NOT change permanent scheduler settings (still 12/21/23 JST × 3/day).
 *
 * Usage:
 *   node dist/cli.js initial-publish-boost --target=30
 *   node dist/cli.js initial-publish-boost --target=30 --apply
 *
 * Priority:
 *   1) unused APPROVED (PUBLIC-eligible)
 *   2) generate new via stock pipeline (preserve future inventory)
 *   3) promote farthest future only if still short (leave minFutureRemain)
 */

import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  createDatabaseClient,
  type DatabaseClient,
} from "@ai-affiliate/database";
import {
  assertWordPressLivePublishAllowed,
  createDefaultWordPressPublisher,
  publishContentVersionToWordPress,
} from "../wordpress/wordpress-publish-path.js";
import { resolveWordPressPostDates } from "../wordpress/wordpress-datetime.js";
import { listApprovedStock } from "./approved-stock.js";
import { loadStockRuntimeConfig } from "./stock-config.js";
import { runStockGenerationBatch } from "./stock-generation-worker.js";
import { runPublishSlotScheduler } from "./publish-slot-scheduler.js";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) {
      flags[body] = "true";
      continue;
    }
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function tokyoParts(d: Date): { y: number; m: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
  };
}

function slotKeyFromDate(d: Date): string {
  const p = tokyoParts(d);
  return `${p.y}-${pad2(p.m)}-${pad2(p.day)}T${pad2(p.hour)}:00:00+09:00`;
}

async function wpAuth(config: {
  wordpressBaseUrl?: string | null;
  wordpressUsername?: string | null;
  wordpressApplicationPassword?: string | null;
}): Promise<{ base: string; auth: string }> {
  const base = (config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername ?? "";
  const pass = config.wordpressApplicationPassword ?? "";
  if (!base || !user || !pass) {
    throw new Error("WORDPRESS credentials incomplete");
  }
  return { base, auth: Buffer.from(`${user}:${pass}`).toString("base64") };
}

async function wpCount(
  base: string,
  auth: string,
  status: string,
): Promise<number> {
  const res = await fetch(
    `${base}/wp-json/wp/v2/posts?status=${status}&per_page=1&context=edit`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) throw new Error(`WP count ${status} failed: ${res.status}`);
  return Number(res.headers.get("x-wp-total") || 0);
}

async function wpList(
  base: string,
  auth: string,
  status: string,
): Promise<Array<{ id: number; date: string; link: string }>> {
  const out: Array<{ id: number; date: string; link: string }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(
      `${base}/wp-json/wp/v2/posts?status=${status}&per_page=100&page=${page}&context=edit&_fields=id,date,link`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!res.ok) break;
    const batch = (await res.json()) as Array<{ id?: number; date?: string; link?: string }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const row of batch) {
      if (row.id == null) continue;
      out.push({ id: Number(row.id), date: String(row.date ?? ""), link: String(row.link ?? "") });
    }
    const pages = Number(res.headers.get("x-wp-totalpages") || 1);
    if (page >= pages) break;
  }
  return out;
}

async function wpSettings(base: string, auth: string): Promise<{
  timezone: string | null;
  gmt_offset: number | null;
}> {
  const res = await fetch(`${base}/wp-json/wp/v2/settings`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return { timezone: null, gmt_offset: null };
  const json = (await res.json()) as { timezone?: string; gmt_offset?: number };
  return {
    timezone: json.timezone ?? null,
    gmt_offset: json.gmt_offset ?? null,
  };
}

function buildPastBoostSlots(input: {
  now: Date;
  hours: number[];
  lookbackDays: number;
  occupiedKeys: Set<string>;
  count: number;
}): Date[] {
  const hours = [...input.hours].sort((a, b) => a - b);
  const today = tokyoParts(input.now);
  const midnight = new Date(
    `${today.y}-${pad2(today.m)}-${pad2(today.day)}T00:00:00+09:00`,
  );
  const candidates: Date[] = [];
  for (let d = input.lookbackDays; d >= 0; d -= 1) {
    const dayAnchor = new Date(midnight.getTime() - d * 86_400_000);
    const ymd = tokyoParts(new Date(dayAnchor.getTime() + 12 * 3600_000));
    for (const hour of hours) {
      const at = new Date(
        `${ymd.y}-${pad2(ymd.m)}-${pad2(ymd.day)}T${pad2(hour)}:00:00+09:00`,
      );
      if (at.getTime() > input.now.getTime()) continue;
      const key = slotKeyFromDate(at);
      if (input.occupiedKeys.has(key)) continue;
      candidates.push(at);
    }
  }
  // Prefer more recent past slots (site formation looks natural).
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return candidates.slice(0, input.count).sort((a, b) => a.getTime() - b.getTime());
}

type BoostItem = {
  source: "approved" | "generated" | "future";
  contentVersionId: string;
  updateExisting: boolean;
  externalId?: string | null;
};

async function listFutureTargets(prisma: DatabaseClient["prisma"]): Promise<
  Array<{
    contentVersionId: string;
    publishedExternalId: string | null;
    slotAt: Date | null;
  }>
> {
  const rows = await prisma.publicationTarget.findMany({
    where: { platform: "WORDPRESS", status: "SCHEDULED", publishedExternalId: { not: null } },
    select: {
      contentVersionId: true,
      publishedExternalId: true,
      platformMetadata: true,
    },
    take: 500,
  });
  const publishedCvs = new Set(
    (
      await prisma.publicationTarget.findMany({
        where: {
          platform: "WORDPRESS",
          status: "PUBLISHED",
          contentVersionId: { in: rows.map((r) => r.contentVersionId) },
        },
        select: { contentVersionId: true },
      })
    ).map((r) => r.contentVersionId),
  );
  return rows
    .filter((r) => !publishedCvs.has(r.contentVersionId))
    .map((r) => {
      const meta = (r.platformMetadata ?? {}) as Record<string, unknown>;
      const raw =
        (typeof meta.scheduledAt === "string" && meta.scheduledAt) ||
        (typeof meta.publishSlotKey === "string" && meta.publishSlotKey) ||
        null;
      const slotAt = raw ? new Date(raw) : null;
      return {
        contentVersionId: r.contentVersionId,
        publishedExternalId: r.publishedExternalId,
        slotAt: slotAt && Number.isFinite(slotAt.getTime()) ? slotAt : null,
      };
    })
    .sort((a, b) => {
      const at = a.slotAt?.getTime() ?? 0;
      const bt = b.slotAt?.getTime() ?? 0;
      return bt - at; // farthest first
    });
}

async function ensureGeneratedStock(deps: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: ReturnType<typeof loadConfig>;
  need: number;
  batchSize: number;
}): Promise<{
  generatedApprovedIds: string[];
  rightsExcluded: number;
  duplicateExcluded: number;
  generationRuns: unknown[];
}> {
  const generatedApprovedIds: string[] = [];
  const generationRuns: unknown[] = [];
  let rightsExcluded = 0;
  let duplicateExcluded = 0;
  let guard = 0;
  while (generatedApprovedIds.length < deps.need && guard < 40) {
    guard += 1;
    const remaining = deps.need - generatedApprovedIds.length;
    const batch = Math.min(deps.batchSize, remaining, 8);
    const result = await runStockGenerationBatch({
      database: deps.database,
      lifecycle: deps.lifecycle,
      config: deps.config,
      forceBatch: batch,
    });
    generationRuns.push({
      skipped: result.skipped,
      skipReason: result.skipReason ?? null,
      generated: result.generated,
      reviewPassed: result.reviewPassed,
      excludedAsDuplicate: result.excludedAsDuplicate,
      approved: result.approvedVersionIds.length,
    });
    if (result.skipped) break;
    duplicateExcluded += result.excludedAsDuplicate;
    for (const id of result.approvedVersionIds) {
      if (!generatedApprovedIds.includes(id)) generatedApprovedIds.push(id);
    }
    const unused = await listApprovedStock(deps.database.prisma, {
      unusedOnly: true,
      limit: 500,
    });
    const publicOk = unused.filter((r) => r.publicEligible);
    rightsExcluded = unused.filter((r) => !r.publicEligible).length;
    if (publicOk.length >= deps.need) break;
    if (result.generated === 0 && result.reviewPassed === 0) break;
  }
  return { generatedApprovedIds, rightsExcluded, duplicateExcluded, generationRuns };
}

export async function runInitialPublishBoostCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const apply = flags.apply === "true" || flags.apply === "1";
  const target = Math.max(1, Number(flags.target ?? "30") || 30);
  const lookbackDays = Math.max(3, Number(flags.lookbackDays ?? "10") || 10);
  const minFutureRemain = Math.max(0, Number(flags.minFutureRemain ?? "12") || 12);
  const maxFutureUse = Math.max(0, Number(flags.maxFutureUse ?? "8") || 8);
  const genBatch = Math.max(1, Number(flags.genBatch ?? "5") || 5);

  // Soft raise daily generation budget for this one-time session only.
  if (apply) {
    process.env.STOCK_MAX_GENERATIONS_PER_DAY = String(
      Math.max(Number(process.env.STOCK_MAX_GENERATIONS_PER_DAY ?? "48") || 48, 80),
    );
    process.env.STOCK_CONTINUOUS = "true";
  }

  const config = loadConfig({ requireDatabaseUrl: true });
  const runtime = loadStockRuntimeConfig();
  const { base, auth } = await wpAuth(config);
  const settings = await wpSettings(base, auth);
  const beforePublish = await wpCount(base, auth, "publish");
  const beforeFuture = await wpCount(base, auth, "future");
  const publishedList = await wpList(base, auth, "publish");
  const futureList = await wpList(base, auth, "future");
  const need = Math.max(0, target - beforePublish);

  const occupiedKeys = new Set<string>();
  for (const p of publishedList) {
    if (p.date) {
      // WP `date` is site-local (Asia/Tokyo) without offset — treat as JST wall clock.
      const local = p.date.length >= 16 ? `${p.date.slice(0, 16)}:00+09:00` : null;
      if (local) occupiedKeys.add(slotKeyFromDate(new Date(local)));
    }
  }
  for (const f of futureList) {
    if (f.date) {
      const local = f.date.length >= 16 ? `${f.date.slice(0, 16)}:00+09:00` : null;
      if (local) occupiedKeys.add(slotKeyFromDate(new Date(local)));
    }
  }

  const database = createDatabaseClient();
  await database.connect();
  const lifecycle = new LifecycleRepository(database.prisma);

  try {
    const unused = await listApprovedStock(database.prisma, { unusedOnly: true, limit: 500 });
    const unusedPublic = unused.filter((r) => r.publicEligible);
    const unusedBlocked = unused.filter((r) => !r.publicEligible);
    const futures = await listFutureTargets(database.prisma);
    const researchItemCount = await database.prisma.researchItem.count();

    const planItems: BoostItem[] = [];
    for (const row of unusedPublic) {
      if (planItems.length >= need) break;
      planItems.push({
        source: "approved",
        contentVersionId: row.contentVersionId,
        updateExisting: false,
      });
    }

    let generatedApprovedIds: string[] = [];
    let generationRuns: unknown[] = [];
    let rightsExcluded = unusedBlocked.length;
    let duplicateExcluded = 0;
    const stillNeedAfterApproved = Math.max(0, need - planItems.length);

    if (apply && stillNeedAfterApproved > 0) {
      const gen = await ensureGeneratedStock({
        database,
        lifecycle,
        config,
        need: stillNeedAfterApproved,
        batchSize: genBatch,
      });
      generatedApprovedIds = gen.generatedApprovedIds;
      generationRuns = gen.generationRuns;
      rightsExcluded += gen.rightsExcluded;
      duplicateExcluded += gen.duplicateExcluded;

      // Terms already verified in production env — promote RC→ALLOWED on unused stock.
      if (process.env.FANZA_AFFILIATE_IMAGE_TERMS_VERIFIED === "true") {
        const { confirmFanzaAffiliateImageTerms } = await import(
          "./confirm-fanza-image-terms.js"
        );
        await confirmFanzaAffiliateImageTerms({
          prisma: database.prisma,
          iConfirmChecklist: true,
          actor: "initial-publish-boost",
          contentVersionLimit: 500,
        });
      }

      const unusedAfter = await listApprovedStock(database.prisma, {
        unusedOnly: true,
        limit: 500,
      });
      const publicAfter = unusedAfter.filter((r) => r.publicEligible);
      rightsExcluded = unusedAfter.filter((r) => !r.publicEligible).length;
      for (const row of publicAfter) {
        if (planItems.length >= need) break;
        if (planItems.some((p) => p.contentVersionId === row.contentVersionId)) continue;
        planItems.push({
          source: generatedApprovedIds.includes(row.contentVersionId)
            ? "generated"
            : "approved",
          contentVersionId: row.contentVersionId,
          updateExisting: false,
        });
      }
    } else if (!apply && stillNeedAfterApproved > 0) {
      // Dry-run: reserve slots for intended generation count.
      for (let i = 0; i < stillNeedAfterApproved; i += 1) {
        planItems.push({
          source: "generated",
          contentVersionId: `PENDING_GENERATE_${i + 1}`,
          updateExisting: false,
        });
      }
    }

    let futureUsed = 0;
    const shortfall = Math.max(0, need - planItems.filter((p) => !p.contentVersionId.startsWith("PENDING_")).length);
    if (apply && shortfall > 0) {
      const usable = Math.min(
        shortfall,
        maxFutureUse,
        Math.max(0, futures.length - minFutureRemain),
      );
      for (let i = 0; i < usable; i += 1) {
        const f = futures[i]!;
        if (planItems.some((p) => p.contentVersionId === f.contentVersionId)) continue;
        planItems.push({
          source: "future",
          contentVersionId: f.contentVersionId,
          updateExisting: true,
          externalId: f.publishedExternalId,
        });
        futureUsed += 1;
      }
    } else if (!apply && stillNeedAfterApproved > 0) {
      // Dry-run note only — prefer generate; future is fallback.
    }

    const publishCandidates = planItems
      .filter((p) => !p.contentVersionId.startsWith("PENDING_"))
      .slice(0, need);
    const slotCount = apply ? publishCandidates.length : need;
    const slots = buildPastBoostSlots({
      now: new Date(),
      hours: runtime.publishSlotHoursJst,
      lookbackDays,
      occupiedKeys,
      count: slotCount,
    });

    const preflight = {
      ok: true,
      apply,
      wordpressTimezone: settings.timezone,
      publicationTimezone: config.publicationTimezone || "Asia/Tokyo",
      schedulerSlotsJst: runtime.publishSlotHoursJst,
      stockPublishSchedulerEnabled: runtime.stockPublishSchedulerEnabled,
      before: {
        publish: beforePublish,
        future: beforeFuture,
        unusedApproved: unused.length,
        publicEligibleUnused: unusedPublic.length,
        publicBlockedUnused: unusedBlocked.length,
        researchItemCount,
        factoryScheduledTargets: futures.length,
      },
      need,
      plan: {
        approved: publishCandidates.filter((p) => p.source === "approved").length,
        generated: publishCandidates.filter((p) => p.source === "generated").length,
        future: publishCandidates.filter((p) => p.source === "future").length,
        pendingGeneratePlaceholders: planItems.filter((p) =>
          p.contentVersionId.startsWith("PENDING_"),
        ).length,
        slots: slots.map((s) => slotKeyFromDate(s)),
        minFutureRemain,
        maxFutureUse,
      },
      generationRuns,
      note:
        "One-time boost only. Permanent scheduler remains 12/21/23 JST (3/day). Existing publish dates are never rewritten.",
    };

    if (!apply) {
      printJson(preflight);
      return;
    }

    if (settings.timezone && settings.timezone !== "Asia/Tokyo" && settings.timezone !== "Japan") {
      printJson({
        ok: false,
        reason: "WORDPRESS_TIMEZONE_NOT_TOKYO",
        timezone: settings.timezone,
        hint: "Aborting to avoid future-date publish accidents",
      });
      process.exitCode = 1;
      return;
    }

    const gate = assertWordPressLivePublishAllowed({
      mode: "publish",
      explicitPublishMode: true,
      allowDirectPublish: true,
      liveConfirm: true,
    });
    if (!gate.ok) {
      printJson({ ok: false, reason: gate.reason });
      process.exitCode = 1;
      return;
    }

    const sessionConfig = {
      ...config,
      wordpressAllowDirectPublish: true,
      wordpressAllowExternalRequests: true,
      wordpressDefaultPublishMode: "publish" as const,
    };
    const publisher = createDefaultWordPressPublisher(sessionConfig);

    const publishedResults: Array<{
      source: string;
      contentVersionId: string;
      externalId?: string;
      url?: string;
      slot?: string;
      ok: boolean;
      reason?: string;
    }> = [];

    for (let i = 0; i < publishCandidates.length; i += 1) {
      const item = publishCandidates[i]!;
      const slot = slots[i];
      if (!slot) {
        publishedResults.push({
          source: item.source,
          contentVersionId: item.contentVersionId,
          ok: false,
          reason: "NO_SLOT",
        });
        continue;
      }
      const dates = resolveWordPressPostDates(slot, "Asia/Tokyo");
      const one = await publishContentVersionToWordPress(
        {
          config: sessionConfig,
          lifecycle,
          publisher,
          prisma: database.prisma,
        },
        {
          contentVersionId: item.contentVersionId,
          mode: "publish",
          scheduledAt: slot,
          updateExistingDraft: item.updateExisting,
          route: "INITIAL_PUBLISH_BOOST",
          platformMetadata: {
            publishSlotKey: slotKeyFromDate(slot),
            initialPublishBoost: true,
            wpDate: dates.date,
            wpDateGmt: dates.date_gmt,
          },
        },
      );
      publishedResults.push({
        source: item.source,
        contentVersionId: item.contentVersionId,
        externalId: one.ok && "externalId" in one ? one.externalId : item.externalId ?? undefined,
        url: one.ok && "url" in one ? one.url : undefined,
        slot: slotKeyFromDate(slot),
        ok: Boolean(one.ok && "published" in one && one.published),
        reason: !one.ok ? one.reason : one.skipped ? one.reason : undefined,
      });
    }

    // Refill future inventory for normal 3/day ops (does not change slot hours).
    const refill = await runPublishSlotScheduler({
      database,
      lifecycle,
      config: {
        ...config,
        wordpressAllowFutureSchedule: true,
        wordpressAllowExternalRequests: true,
      },
      days: runtime.scheduleHorizonDays,
    });

    const afterPublish = await wpCount(base, auth, "publish");
    const afterFuture = await wpCount(base, auth, "future");
    const afterPublishedList = await wpList(base, auth, "publish");
    const unusedAfterFinal = await listApprovedStock(database.prisma, {
      unusedOnly: true,
      limit: 500,
    });
    const newlyPublishedIds = afterPublishedList
      .map((p) => p.id)
      .filter((id) => !publishedList.some((b) => b.id === id))
      .sort((a, b) => a - b);

    printJson({
      ...preflight,
      apply: true,
      publishedResults,
      refill: {
        skipped: refill.skipped,
        skipReason: refill.skipReason,
        reserved: refill.reserved.length,
        publicBlocked: refill.publicBlocked.length,
      },
      after: {
        publish: afterPublish,
        future: afterFuture,
        unusedApproved: unusedAfterFinal.length,
        publicEligibleUnused: unusedAfterFinal.filter((r) => r.publicEligible).length,
      },
      report: {
        A_beforePublish: beforePublish,
        B_afterPublish: afterPublish,
        C_newlyPublished: Math.max(0, afterPublish - beforePublish),
        D_fromApproved: publishedResults.filter((r) => r.ok && r.source === "approved").length,
        E_fromFuture: publishedResults.filter((r) => r.ok && r.source === "future").length,
        F_fromGenerated: publishedResults.filter((r) => r.ok && r.source === "generated").length,
        G_remainingApproved: unusedAfterFinal.filter((r) => r.publicEligible).length,
        H_remainingFuture: afterFuture,
        I_rightsGateExcluded: rightsExcluded,
        J_duplicateExcluded: duplicateExcluded,
        K_sitemap: "verify wp-sitemap.xml after publish",
        L_newPostIds: newlyPublishedIds,
        M_schedulerRestored: {
          slotsJst: runtime.publishSlotHoursJst,
          enabled: runtime.stockPublishSchedulerEnabled,
          unchanged: true,
        },
        N_errors: publishedResults.filter((r) => !r.ok),
        futureUsedPlanned: futureUsed,
        generationApprovedIds: generatedApprovedIds,
      },
    });

    if (afterPublish < target || publishedResults.some((r) => !r.ok)) {
      process.exitCode = 1;
    }
  } finally {
    await database.disconnect();
  }
}
