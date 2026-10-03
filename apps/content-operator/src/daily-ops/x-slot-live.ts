/**
 * Daily-ops X slot execution: official FANZA/DMM product URL only.
 * Affiliate URLs and WordPress URLs are not scheduled.
 */

import { createHash } from "node:crypto";
import type { AppConfig } from "@ai-affiliate/config";
import { ContentRepository, type DatabaseClient } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { textContainsWordPressUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import {
  classifyXDestination,
  officialIdentityFromRaw,
  publishingPauseActive,
  resolveNormalXProductUrl,
} from "../x/x-normal-destination.js";
import {
  adaptLoadedCanonicalToX,
  loadCanonicalXSource,
} from "../x/canonical-x-source.js";
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

function postsUseNormalDestination(posts: Array<{ body: string }>): boolean {
  return posts.every((post) => {
    const urls = post.body.match(/https?:\/\/\S+/gu) ?? [];
    return urls.every((raw) => {
      const kind = classifyXDestination(raw.replace(/[)\].,]+$/u, ""));
      return kind === "FANZA_NORMAL" || kind === "DMM_NORMAL";
    });
  });
}

export async function probeXScheduleCandidates(input: {
  prisma: DatabaseClient["prisma"];
  ranked: ChannelCandidate[];
  config: AppConfig;
  usedCanonicalIds: Set<string>;
  usedContentVersionIds: Set<string>;
  llm?: import("../adapters/types.js").LLMProvider | null;
}): Promise<XScheduleCandidate[]> {
  const out: XScheduleCandidate[] = [];
  let rank = 0;
  for (const selected of input.ranked) {
    const cid = selected.canonicalId.trim().toLowerCase();
    if (!cid || input.usedCanonicalIds.has(cid)) {
      out.push({
        canonicalId: cid || selected.canonicalId,
        pass: false,
        skipReason: "DUPLICATE_CID",
        rank: rank++,
      });
      continue;
    }
    const canonicalSource = await loadCanonicalXSource(input.prisma, selected.canonicalId);
    const cvId = canonicalSource?.contentVersionId ?? null;
    if (cvId && input.usedContentVersionIds.has(cvId)) {
      out.push({
        canonicalId: cid,
        contentVersionId: cvId,
        pass: false,
        skipReason: "DUPLICATE_CONTENT_VERSION",
        rank: rank++,
      });
      continue;
    }
    if (!canonicalSource?.contentVersionId) {
      out.push({
        canonicalId: cid,
        contentVersionId: null,
        pass: false,
        skipReason: "NO_CANONICAL_CONTENT_VERSION",
        rank: rank++,
      });
      continue;
    }
    const direct = await resolveSlotNormalUrl(input.prisma, cid);
    if (!direct.ok) {
      out.push({
        canonicalId: cid,
        contentVersionId: cvId,
        pass: false,
        skipReason: direct.reason,
        rank: rank++,
      });
      continue;
    }
    const adapted = await adaptLoadedCanonicalToX(canonicalSource, {
      preferredRoute: "DIRECT_AFFILIATE",
      disclosure: null,
      preferWpTraffic: false,
      allowDirectAffiliate: true,
      allowCombined: false,
      affiliateThreadMode: false,
      normalProductUrl: direct.url,
      llm: input.llm,
      llmModel: input.config.llmModelWriter,
    });
    if (adapted.skip || adapted.posts.length === 0) {
      out.push({
        canonicalId: cid,
        contentVersionId: cvId,
        pass: false,
        skipReason: adapted.skip?.reason ?? "SOCIAL_CONTENT_TOO_THIN",
        rank: rank++,
      });
      continue;
    }
    if (
      adapted.publicationStrategy !== "FANZA_NORMAL" ||
      adapted.posts.some((post) => textContainsWordPressUrl(post.body)) ||
      !postsUseNormalDestination(adapted.posts) ||
      !adapted.fanzaUrl
    ) {
      out.push({
        canonicalId: cid,
        contentVersionId: cvId,
        pass: false,
        skipReason: "BLOCKED_INVALID_X_DESTINATION",
        rank: rank++,
      });
      continue;
    }
    out.push({
      canonicalId: cid,
      contentVersionId: cvId,
      pass: true,
      rank: rank++,
    });
  }
  return out;
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
      if (!canonicalSource?.contentVersionId) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: null,
          reason: "NO_CANONICAL_CONTENT_VERSION",
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
      const adapted = await adaptLoadedCanonicalToX(canonicalSource, {
        preferredRoute: "DIRECT_AFFILIATE",
        disclosure: null,
        preferWpTraffic: false,
        allowDirectAffiliate: true,
        allowCombined: false,
        affiliateThreadMode: false,
        normalProductUrl: direct.url,
        llm: input.llm,
        llmModel: input.config.llmModelWriter,
      });

      if (adapted.skip || adapted.posts.length === 0) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: canonicalSource.contentVersionId,
          reason: adapted.skip?.reason ?? "SOCIAL_CONTENT_TOO_THIN",
          publicationId: null,
          scheduledAt: assignment.scheduledAt.toISOString(),
          published: false,
          held: true,
        });
        continue;
      }
      if (
        adapted.publicationStrategy !== "FANZA_NORMAL" ||
        !postsUseNormalDestination(adapted.posts) ||
        adapted.posts.some((post) => textContainsWordPressUrl(post.body)) ||
        !adapted.fanzaUrl
      ) {
        outcomes.push({
          hour: assignment.hour,
          role: assignment.role,
          status: "EMPTY",
          canonicalId: selected.canonicalId,
          contentVersionId: canonicalSource.contentVersionId,
          reason: "BLOCKED_INVALID_X_DESTINATION",
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
          source: "canonical_content_version",
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
