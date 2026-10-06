/**
 * Daily-ops X slot execution: official FANZA/DMM product URL only.
 * Affiliate URLs and WordPress URLs are not scheduled.
 */

import { createHash } from "node:crypto";
import type { AppConfig } from "@ai-affiliate/config";
import { ContentRepository, type DatabaseClient } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import type { LLMProvider } from "../adapters/types.js";
import {
  officialIdentityFromRaw,
  publishingPauseActive,
  resolveNormalXProductUrl,
} from "../x/x-normal-destination.js";
import {
  adaptLoadedCanonicalToX,
  loadCanonicalXSource,
  type CanonicalXSource,
} from "../x/canonical-x-source.js";
import {
  createPrismaXCopyArtifactStore,
  createPrismaXCopyLedger,
  ledgeringXCopyProvider,
} from "../x/x-copy-ledger.js";
import {
  beginXCopyGeneration,
  readXCopyArtifact,
  xCopyInputFingerprint,
} from "../x/x-copy-artifact.js";
import { resolveXCopyArtifact, xCopyIdentityFromSource, xScheduleGate } from "../x/x-copy-reuse.js";
import { orderCandidatesByPublicationPriority, runXCandidateRefill, type XRefillMetrics } from "../x/x-copy-refill.js";
import { XPublicationService } from "../x/publication-service.js";
import type { ChannelCandidate } from "./channel-selection.js";
import { allocateXPostSlots, isFutureXSlotInstant, planXPostScheduleHorizon } from "./x-post-schedule.js";
import type {
  XScheduleCandidate,
  XSlotAssignment,
  XPostTimeSlot,
  XHorizonAssignment,
  XPostExtraSlotTime,
} from "./x-post-schedule.js";

/**
 * Published WordPress articles can reach X without ever being selected as a
 * blog ContentCandidate (for example REQUIRES_CONFIRMATION analyses).
 * XPublication still requires that foreign key. This links the latest existing
 * ProductAnalysis; it does not publish a new article or bypass X review.
 */
export async function ensureContentCandidateForPublishedWpX(
  prisma: DatabaseClient["prisma"],
  researchItemId: string,
): Promise<string | null> {
  const analysis = await prisma.productAnalysis.findFirst({
    where: { researchItemId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      analysisRunId: true,
      researchItemId: true,
      totalScore: true,
    },
  });
  if (!analysis) return null;
  try {
    const created = await prisma.contentCandidate.create({
      data: {
        analysisRunId: analysis.analysisRunId,
        researchItemId: analysis.researchItemId,
        productAnalysisId: analysis.id,
        candidateType: "EDITORIAL",
        rank: 1,
        selectionScore: analysis.totalScore,
        selectionReasons: {
          source: "published_wordpress_x_schedule",
        },
        targetChannel: "X",
        status: "SELECTED",
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    const again = await prisma.contentCandidate.findFirst({
      where: { researchItemId },
      orderBy: [{ rank: "asc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    return again?.id ?? null;
  }
}

export type XSlotLiveOutcome = {
  hour: number;
  role: string;
  status: string;
  canonicalId: string | null;
  contentVersionId: string | null;
  reason: string;
  publicationId: string | null;
  scheduledAt: string | null;
  published: boolean;
  held: boolean;
};

async function resolveSlotNormalUrl(
  prisma: DatabaseClient["prisma"],
  cid: string,
): Promise<ReturnType<typeof resolveNormalXProductUrl>> {
  const item = await prisma.researchItem.findFirst({
    where: { externalId: { equals: cid, mode: "insensitive" } },
    select: { externalId: true, rawData: true },
  });
  const identity = officialIdentityFromRaw(item?.rawData);
  return resolveNormalXProductUrl({
    canonicalCid: item?.externalId ?? cid,
    officialContentId: identity.contentId,
    officialProductUrl: identity.productUrl,
  });
}

async function adaptCanonicalForXSchedule(input: {
  prisma: DatabaseClient["prisma"];
  researchItemId: string;
  source: CanonicalXSource;
  destinationUrl: string;
  llm?: LLMProvider | null;
  model: string;
  trigger: "probe" | "execute";
}): Promise<{ result: Awaited<ReturnType<typeof adaptLoadedCanonicalToX>>; generated: boolean }> {
  const identity = xCopyIdentityFromSource({
    source: input.source,
    destinationUrl: input.destinationUrl,
    model: input.model,
  });
  const ledger = createPrismaXCopyLedger(input.prisma);
  const resolved = await resolveXCopyArtifact({
    store: createPrismaXCopyArtifactStore(input.prisma, input.researchItemId),
    identity,
    now: new Date(),
    trigger: input.trigger,
    generate: async (ctx) =>
      await adaptLoadedCanonicalToX(input.source, {
        preferredRoute: "DIRECT_AFFILIATE",
        disclosure: null,
        preferWpTraffic: false,
        allowDirectAffiliate: true,
        allowCombined: false,
        affiliateThreadMode: false,
        normalProductUrl: input.destinationUrl,
        llm: input.llm
          ? ledgeringXCopyProvider(input.llm, ledger, { ...ctx, cid: identity.cid })
          : input.llm,
        llmModel: input.model,
      }),
  });
  return { result: resolved.result, generated: resolved.generated };
}

/**
 * X admission uses the official product source.
 * A WordPress ContentVersion is not required, and its absence is not a block.
 */
export function xAdmissionBlock(input: {
  hasVerifiedProductSource: boolean;
  contentVersionId: string | null;
  usedContentVersionIds: ReadonlySet<string>;
  officialUrl: { ok: true } | { ok: false; reason: string };
}): string | null {
  if (!input.hasVerifiedProductSource) return "NO_VERIFIED_X_SOURCE";
  if (input.contentVersionId && input.usedContentVersionIds.has(input.contentVersionId)) {
    return "DUPLICATE_CONTENT_VERSION";
  }
  if (!input.officialUrl.ok) return input.officialUrl.reason;
  return null;
}

export async function probeXScheduleCandidates(input: {
  prisma: DatabaseClient["prisma"];
  ranked: ChannelCandidate[];
  config: AppConfig;
  usedCanonicalIds: Set<string>;
  usedContentVersionIds: Set<string>;
  slotsNeeded: number;
  maxNewGenerations: number;
  llm?: import("../adapters/types.js").LLMProvider | null;
}): Promise<{ probes: XScheduleCandidate[]; metrics: XRefillMetrics }> {
  const rawById = new Map<string, unknown>();
  const passIds = new Set<string>();
  if (input.ranked.length > 0 && input.slotsNeeded > 0) {
    const rows = await input.prisma.researchItem.findMany({
      where: { id: { in: input.ranked.map((candidate) => candidate.researchItemId) } },
      select: { id: true, rawData: true },
    });
    for (const row of rows) {
      rawById.set(row.id, row.rawData);
      if (readXCopyArtifact(row.rawData)?.state === "PASS") passIds.add(row.id);
    }
  }
  const ordered = orderCandidatesByPublicationPriority(input.ranked, passIds);
  const refilled = await runXCandidateRefill({
    slotsNeeded: input.slotsNeeded,
    maxNewGenerations: input.maxNewGenerations,
    candidates: ordered,
    prepare: async (selected) => {
      const cid = selected.canonicalId.trim().toLowerCase();
      if (!cid || input.usedCanonicalIds.has(cid)) {
        return { kind: "hard_block", probe: { canonicalId: cid || selected.canonicalId, pass: false, skipReason: "DUPLICATE_CID" } };
      }
      const canonicalSource = await loadCanonicalXSource(input.prisma, selected.canonicalId);
      const cvId = canonicalSource?.contentVersionId ?? null;
      const direct = canonicalSource
        ? await resolveSlotNormalUrl(input.prisma, cid)
        : { ok: false as const, reason: "NORMAL_URL_NOT_VERIFIED" };
      const admission = xAdmissionBlock({
        hasVerifiedProductSource: canonicalSource != null,
        contentVersionId: cvId,
        usedContentVersionIds: input.usedContentVersionIds,
        officialUrl: direct,
      });
      if (admission || !canonicalSource || !direct.ok) {
        return {
          kind: "hard_block",
          probe: { canonicalId: cid, contentVersionId: cvId, pass: false, skipReason: admission ?? "NO_VERIFIED_X_SOURCE" },
        };
      }
      const identity = xCopyIdentityFromSource({
        source: canonicalSource,
        destinationUrl: direct.url,
        model: input.config.llmModelWriter,
      });
      const decision = beginXCopyGeneration({
        existing: readXCopyArtifact(rawById.get(selected.researchItemId)),
        identity,
        fingerprint: xCopyInputFingerprint(identity),
        now: new Date(),
        ownerToken: "peek",
        logicalGenerationId: "peek",
      });
      if (decision.action === "reuse" && decision.artifact.state === "REJECTED_QUALITY") {
        return {
          kind: "cached_reject",
          probe: {
            canonicalId: cid,
            contentVersionId: cvId,
            pass: false,
            skipReason: decision.artifact.skipReason ?? "REJECTED_QUALITY",
          },
        };
      }
      if (decision.action === "wait" || decision.action === "exhausted") {
        return decision.action === "wait"
          ? { kind: "transient_wait" }
          : {
              kind: "cached_reject",
              probe: {
                canonicalId: cid,
                contentVersionId: cvId,
                pass: false,
                skipReason: decision.artifact.skipReason ?? decision.artifact.state,
              },
            };
      }
      return { kind: "spend", willGenerate: decision.action === "claim" };
    },
    materialize: async (selected) => {
      const cid = selected.canonicalId.trim().toLowerCase();
      const canonicalSource = await loadCanonicalXSource(input.prisma, selected.canonicalId);
      const cvId = canonicalSource?.contentVersionId ?? null;
      const direct = canonicalSource
        ? await resolveSlotNormalUrl(input.prisma, cid)
        : { ok: false as const, reason: "NORMAL_URL_NOT_VERIFIED" };
      const admission = xAdmissionBlock({
        hasVerifiedProductSource: canonicalSource != null,
        contentVersionId: cvId,
        usedContentVersionIds: new Set(),
        officialUrl: direct,
      });
      if (admission || !canonicalSource || !direct.ok) {
        return {
          generated: false,
          transient: false,
          probe: {
            canonicalId: cid,
            contentVersionId: cvId,
            pass: false,
            skipReason: admission ?? "NO_VERIFIED_X_SOURCE",
          },
        };
      }
      const adapted = await adaptCanonicalForXSchedule({
        prisma: input.prisma,
        researchItemId: selected.researchItemId,
        source: canonicalSource,
        destinationUrl: direct.url,
        llm: input.llm,
        model: input.config.llmModelWriter,
        trigger: "probe",
      });
      const gate = xScheduleGate(adapted.result);
      return {
        generated: adapted.generated,
        transient: !gate.pass && adapted.result.skip?.failureClass === "GENERATION_FAILURE",
        probe: {
          canonicalId: cid,
          contentVersionId: cvId,
          pass: gate.pass,
          skipReason: gate.pass ? null : gate.skipReason,
        },
      };
    },
  });
  return {
    metrics: refilled.metrics,
    probes: refilled.probes.map((probe, rank) => ({ ...probe, rank })),
  };
}

export async function executeAssignedXSlots(input: {
  assignments: XSlotAssignment[];
  rankedByCid: Map<string, ChannelCandidate>;
  prisma: DatabaseClient["prisma"];
  config: AppConfig;
  xPublicationService: XPublicationService;
  logger: Logger;
  dayKey: string;
  xMixSlot: string;
  analysisRunId: string | null;
  now: Date;
  dryRun: boolean;
  llm?: import("../adapters/types.js").LLMProvider | null;
}): Promise<{
  outcomes: XSlotLiveOutcome[];
  xPublishCalls: number;
  primary: XSlotLiveOutcome | null;
}> {
  const pause = await input.prisma.xRuntimeControl.findUnique({
    where: { key: "PUBLISHING_PAUSED" },
  });
  if (publishingPauseActive(pause?.value)) {
    return { outcomes: [], xPublishCalls: 0, primary: null };
  }

  const outcomes: XSlotLiveOutcome[] = [];
  const xPublishCalls = 0;
  const contents = new ContentRepository(input.prisma);

  for (const assignment of input.assignments) {
    if (assignment.status !== "ASSIGNED" || !assignment.candidate) {
      outcomes.push({
        hour: assignment.hour,
        role: assignment.role,
        status: assignment.status,
        canonicalId: assignment.candidate?.canonicalId ?? null,
        contentVersionId: assignment.candidate?.contentVersionId ?? null,
        reason: assignment.reason,
        publicationId: null,
        scheduledAt: assignment.scheduledAt.toISOString(),
        published: false,
        held: true,
      });
      continue;
    }

    const selected = input.rankedByCid.get(assignment.candidate.canonicalId);
    if (!selected) {
      outcomes.push({
        hour: assignment.hour,
        role: assignment.role,
        status: "EMPTY",
        canonicalId: assignment.candidate.canonicalId,
        contentVersionId: assignment.candidate.contentVersionId ?? null,
        reason: "candidate_missing_from_pool",
        publicationId: null,
        scheduledAt: assignment.scheduledAt.toISOString(),
        published: false,
        held: true,
      });
      continue;
    }

    if (input.dryRun) {
      outcomes.push({
        hour: assignment.hour,
        role: assignment.role,
        status: "ASSIGNED",
        canonicalId: selected.canonicalId,
        contentVersionId: assignment.candidate.contentVersionId ?? null,
        reason: "DAILY_OPS_DRY_RUN",
        publicationId: null,
        scheduledAt: assignment.scheduledAt.toISOString(),
        published: false,
        held: true,
      });
      continue;
    }

    if (!input.config.xApiEnabled && input.config.xApiProvider !== "mock") {
      outcomes.push({
        hour: assignment.hour,
        role: assignment.role,
        status: "ASSIGNED",
        canonicalId: selected.canonicalId,
        contentVersionId: assignment.candidate.contentVersionId ?? null,
        reason: "X_API_DISABLED",
        publicationId: null,
        scheduledAt: assignment.scheduledAt.toISOString(),
        published: false,
        held: true,
      });
      continue;
    }

    if (
      input.config.xReleaseMode !== "LIMITED" &&
      input.config.xReleaseMode !== "FULL" &&
      input.config.xApiProvider !== "mock"
    ) {
      outcomes.push({
        hour: assignment.hour,
        role: assignment.role,
        status: "ASSIGNED",
        canonicalId: selected.canonicalId,
        contentVersionId: assignment.candidate.contentVersionId ?? null,
        reason: `X_RELEASE_MODE_${input.config.xReleaseMode}`,
        publicationId: null,
        scheduledAt: assignment.scheduledAt.toISOString(),
        published: false,
        held: true,
      });
      continue;
    }

    try {
      const canonicalSource = await loadCanonicalXSource(
        input.prisma,
        selected.canonicalId,
      );
      if (!canonicalSource) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: null,
          reason: "NO_VERIFIED_X_SOURCE",
          publicationId: null,
          scheduledAt: assignment.scheduledAt.toISOString(),
          published: false,
          held: true,
        });
        continue;
      }

      const direct = await resolveSlotNormalUrl(input.prisma, selected.canonicalId);
      if (!direct.ok) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: canonicalSource.contentVersionId,
          reason: direct.reason,
          publicationId: null,
          scheduledAt: assignment.scheduledAt.toISOString(),
          published: false,
          held: true,
        });
        continue;
      }
      const adapted = (
        await adaptCanonicalForXSchedule({
          prisma: input.prisma,
          researchItemId: selected.researchItemId,
          source: canonicalSource,
          destinationUrl: direct.url,
          llm: input.llm,
          model: input.config.llmModelWriter,
          trigger: "execute",
        })
      ).result;
      const gate = xScheduleGate(adapted);
      if (!gate.pass) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: canonicalSource.contentVersionId,
          reason: gate.skipReason,
          publicationId: null,
          scheduledAt: assignment.scheduledAt.toISOString(),
          published: false,
          held: true,
        });
        continue;
      }

      let candidateId: string | null = null;
      if (input.analysisRunId) {
        const cand = await input.prisma.contentCandidate.findFirst({
          where: {
            analysisRunId: input.analysisRunId,
            researchItemId: selected.researchItemId,
          },
          orderBy: { rank: "asc" },
        });
        candidateId = cand?.id ?? null;
      }
      // WP-published / Factory-backfill inventory often has candidates on older
      // analysis runs only — fall back so a FANZA direct slot can still schedule.
      if (!candidateId) {
        const anyCand = await input.prisma.contentCandidate.findFirst({
          where: { researchItemId: selected.researchItemId },
          orderBy: [{ rank: "asc" }, { createdAt: "desc" }],
        });
        candidateId = anyCand?.id ?? null;
      }
      if (!candidateId) {
        candidateId = await ensureContentCandidateForPublishedWpX(
          input.prisma,
          selected.researchItemId,
        );
      }
      if (!candidateId) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: canonicalSource.contentVersionId,
          reason: "NO_CONTENT_CANDIDATE_FOR_RESEARCH_ITEM",
          publicationId: null,
          scheduledAt: assignment.scheduledAt.toISOString(),
          published: false,
          held: true,
        });
        continue;
      }

      const primaryUrl = adapted.fanzaUrl ?? "";
      const rootBody = adapted.posts[0]?.body ?? "";
      const created = await contents.createGeneratedContent({
        contentCandidateId: candidateId,
        researchItemId: selected.researchItemId,
        contentType: "X_POST",
        targetChannel: "X",
        status: "READY_TO_PUBLISH",
        title: adapted.canonicalTitleUsed.slice(0, 120),
        body: rootBody,
        summary: adapted.hooks.slice(0, 3).join(" / "),
        hashtags: [],
        callToAction: primaryUrl,
        affiliateUrl: primaryUrl,
        promptVersion: "x-social-adaptation-v1",
        generationProvider: "canonical-adapt",
        generationModel: "none",
        inputSnapshot: {
          source: canonicalSource.contentVersionId ? "canonical_content_version" : "official_product_source",
          contentVersionId: canonicalSource.contentVersionId,
          dailyXRoute: "BLOG_TRAFFIC",
          destinationUrl: primaryUrl,
          secondaryUrl: adapted.fanzaUrl,
          xSlotHour: assignment.hour,
          xSlotKey: assignment.slotKey,
          xSocialAdaptation: {
            threadShape: adapted.threadShape,
            linkMode: adapted.linkMode,
            publicationStrategy: adapted.publicationStrategy,
            posts: adapted.posts,
            parentBody: adapted.parentBody,
            publicationIntent: adapted.publicationIntent,
            wpUrl: adapted.wpUrl,
            tracking: adapted.tracking,
            warnings: adapted.warnings,
            mediaMode: adapted.mediaMode,
            mediaUrl: adapted.mediaUrl,
            mediaReason: adapted.mediaReason,
            mediaRole: adapted.mediaRole,
            socialPlan: adapted.socialPlan
              ? {
                  whatIsInteresting: adapted.socialPlan.whatIsInteresting,
                  angle: adapted.socialPlan.angle,
                  publicationIntent: adapted.socialPlan.publicationIntent,
                  subject: adapted.socialPlan.subject,
                }
              : null,
          },
        },
        contentHash: createHash("sha256").update(rootBody).digest("hex"),
        version: 1,
        generatedAt: input.now,
      });

      const idempotencyKey = `x-daily:${assignment.slotKey}:${selected.canonicalId}:FANZA_NORMAL`;
      const existing = await input.prisma.xPublication.findUnique({
        where: { idempotencyKey },
      });
      if (
        existing?.status === "PUBLISHED" ||
        existing?.status === "PARTIALLY_PUBLISHED" ||
        existing?.status === "PUBLISHED_UNVERIFIED" ||
        existing?.status === "SCHEDULED"
      ) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "SKIP_SLOT",
          canonicalId: selected.canonicalId,
          contentVersionId: canonicalSource.contentVersionId,
          reason: "idempotent_already_scheduled_or_published",
          publicationId: existing.id,
          scheduledAt: existing.scheduledAt?.toISOString() ?? assignment.scheduledAt.toISOString(),
          published:
            existing.status === "PUBLISHED" ||
            existing.status === "PARTIALLY_PUBLISHED" ||
            existing.status === "PUBLISHED_UNVERIFIED",
          held: true,
        });
        continue;
      }

      // Never late-publish: past slots must not trigger publishNow.
      // Only schedule future Instant; runDue delivers at the intended JST wall clock.
      if (!isFutureXSlotInstant(assignment.scheduledAt, input.now)) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: canonicalSource.contentVersionId,
          reason: "past_slot_not_backfilled",
          publicationId: null,
          scheduledAt: assignment.scheduledAt.toISOString(),
          published: false,
          held: true,
        });
        continue;
      }

      const pub = await input.xPublicationService.createFromContent({
        contentId: created.id,
        strategy: "AUTO",
        publishNow: false,
        scheduledAt: assignment.scheduledAt,
      });

      await input.prisma.xPublication
        .update({
          where: { id: pub.id },
          data: {
            strategyVersion: `${input.xMixSlot}|AUTO|slotKey=${assignment.slotKey}|slotHour=${assignment.hour}|slotKind=${assignment.kind ?? "STANDARD"}|FANZA_NORMAL`,
            idempotencyKey,
            scheduledAt: assignment.scheduledAt,
          },
        })
        .catch(() => undefined);

      outcomes.push({
        hour: assignment.hour,
        role: assignment.role,
        status: "SCHEDULED",
        canonicalId: selected.canonicalId,
        contentVersionId: canonicalSource.contentVersionId,
        reason: "scheduled_for_slot",
        publicationId: pub.id,
        scheduledAt: assignment.scheduledAt.toISOString(),
        published: false,
        held: true,
      });
    } catch (error) {
      const note = error instanceof Error ? error.message.slice(0, 240) : String(error);
      input.logger.warn(`daily x slot h${assignment.hour} error: ${note}`);
      outcomes.push({
        hour: assignment.hour,
        role: assignment.role,
        status: "EMPTY",
        canonicalId: selected.canonicalId,
        contentVersionId: assignment.candidate.contentVersionId ?? null,
        reason: note,
        publicationId: null,
        scheduledAt: assignment.scheduledAt.toISOString(),
        published: false,
        held: true,
      });
    }
  }

  const primary =
    outcomes.find((o) => o.role === "MAIN" && (o.published || o.status === "SCHEDULED" || o.status === "ASSIGNED")) ??
    outcomes.find((o) => o.published || o.status === "SCHEDULED" || o.status === "ASSIGNED") ??
    outcomes[0] ??
    null;

  return { outcomes, xPublishCalls, primary };
}

export function planXSlotsFromProbes(input: {
  slots: XPostTimeSlot[];
  probes: XScheduleCandidate[];
  maxPostsPerDay: number;
  filledHours: Set<number>;
  usedCanonicalIds: Set<string>;
  usedContentVersionIds: Set<string>;
}): XSlotAssignment[] {
  return allocateXPostSlots({
    slots: input.slots,
    candidates: input.probes,
    maxPostsPerDay: input.maxPostsPerDay,
    filledHours: input.filledHours,
    usedCanonicalIds: input.usedCanonicalIds,
    usedContentVersionIds: input.usedContentVersionIds,
  });
}

/** Boundary-aware multi-day plan (future slots only; MAIN reserved per day). */
export function planXHorizonFromProbes(input: {
  now: Date;
  probes: XScheduleCandidate[];
  maxPostsPerDay: number;
  maxStandardPostsPerDay?: number;
  maxExtraPostsPerDay?: number;
  hardCapPerDay?: number;
  hours?: readonly number[];
  mainHour?: number;
  filledSlotKeys?: ReadonlySet<string> | Iterable<string>;
  usedCanonicalIds: Set<string>;
  usedContentVersionIds: Set<string>;
  dayCount?: number;
  extraDayKey?: string | null;
  extraTimes?: readonly XPostExtraSlotTime[];
}): XHorizonAssignment[] {
  return planXPostScheduleHorizon({
    now: input.now,
    candidates: input.probes,
    maxPostsPerDay: input.maxPostsPerDay,
    maxStandardPostsPerDay: input.maxStandardPostsPerDay,
    maxExtraPostsPerDay: input.maxExtraPostsPerDay,
    hardCapPerDay: input.hardCapPerDay,
    hours: input.hours,
    mainHour: input.mainHour,
    filledSlotKeys: input.filledSlotKeys,
    usedCanonicalIds: input.usedCanonicalIds,
    usedContentVersionIds: input.usedContentVersionIds,
    dayCount: input.dayCount ?? 3,
    extraDayKey: input.extraDayKey,
    extraTimes: input.extraTimes,
  });
}
