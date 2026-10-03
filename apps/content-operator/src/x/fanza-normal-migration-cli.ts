import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadConfig } from "@ai-affiliate/config";
import {
  ContentRepository,
  XOpsRepository,
  XOptimizationRepository,
  XPublicationRepository,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { createLiveStack } from "./live/live-stack.js";
import { XPublishError } from "./types.js";
import { XPublicationService } from "./publication-service.js";
import { officialMediaMatchesCanonicalCid } from "./publication-media-plan.js";
import { ensureContentCandidateForPublishedWpX } from "../daily-ops/x-slot-live.js";
import {
  NORMAL_LINK_MIGRATION_MARKER,
  appendNormalLinkMarker,
  classifyXDestination,
  composeNormalLinkPosts,
  nextFutureJstSlots,
  officialIdentityFromRaw,
  resolveNormalXProductUrl,
  urlsInText,
} from "./x-normal-destination.js";

type PostRow = {
  id: string;
  role: string;
  sequence: number;
  xPostId: string | null;
  body: string;
};

type ThreadRow = {
  id: string;
  status: string;
  strategyVersion: string;
  researchItemId: string;
  generatedContentId: string;
  researchItem: { externalId: string; rawData: unknown };
  generatedContent: { title: string | null; inputSnapshot: unknown };
  posts: PostRow[];
};

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function slotKeyFromDate(slot: Date): string {
  const jst = new Date(slot.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:00:00+09:00`;
}

function mediaUrlFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const adapted = (snapshot as { xSocialAdaptation?: { mediaUrl?: unknown } }).xSocialAdaptation;
  return typeof adapted?.mediaUrl === "string" && adapted.mediaUrl.trim() ? adapted.mediaUrl.trim() : null;
}

function destinationClassCounts(posts: PostRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const post of posts) {
    for (const raw of urlsInText(post.body)) {
      const kind = classifyXDestination(raw.replace(/[.,]+$/u, ""));
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}

async function loadTimeline(
  stack: ReturnType<typeof createLiveStack>,
  accountId: string,
  token: string,
): Promise<{ ids: Map<string, string>; pages: number }> {
  const ids = new Map<string, string>();
  let pagination: string | null = null;
  let pages = 0;
  for (let page = 0; page < 10; page += 1) {
    const tweetPath: string = pagination
      ? `/2/users/${accountId}/tweets?max_results=100&tweet.fields=text&pagination_token=${encodeURIComponent(pagination)}`
      : `/2/users/${accountId}/tweets?max_results=100&tweet.fields=text`;
    const pageResult = await stack.http.request<{
      data?: Array<{ id: string; text?: string }>;
      meta?: { next_token?: string };
    }>({
      method: "GET",
      path: tweetPath,
      endpointKey: "tweets.get",
      requestType: "TWEETS_GET",
      accessToken: token,
      accountId,
      acceptErrorResponse: true,
      disableRetry: true,
    });
    pages += 1;
    if (pageResult.statusCode === 402) throw new Error("X API payment required (status=402)");
    if (!pageResult.ok) throw new Error(`timeline lookup failed status=${pageResult.statusCode}`);
    for (const tweet of pageResult.data?.data ?? []) ids.set(tweet.id, tweet.text ?? "");
    pagination = pageResult.data?.meta?.next_token ?? null;
    if (!pagination) break;
  }
  return { ids, pages };
}

async function deleteOne(
  stack: ReturnType<typeof createLiveStack>,
  accountId: string,
  postId: string,
): Promise<"DELETED" | "ALREADY_MISSING"> {
  const token = await stack.tokens.getValidAccessToken(accountId);
  const before = await loadTimeline(stack, accountId, token);
  if (!before.ids.has(postId)) return "ALREADY_MISSING";
  try {
    await stack.provider.deletePost(postId);
  } catch (error) {
    if (error instanceof XPublishError && error.httpStatus === 404) return "ALREADY_MISSING";
    throw error;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const afterToken = await stack.tokens.getValidAccessToken(accountId);
    const after = await loadTimeline(stack, accountId, afterToken);
    if (!after.ids.has(postId)) return "DELETED";
  }
  throw new Error(`DELETE_FAILED post=${postId}`);
}

export async function runFanzaNormalMigration(argv: string[]): Promise<void> {
  const apply = hasFlag(argv, "apply");
  if (apply) process.env.X_DELETE_POST_ENABLED = "true";
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  const prisma = database.prisma;
  const openaiCalls = 0;
  try {
    const publications = (await prisma.xPublication.findMany({
      where: { status: { in: ["PUBLISHED", "SCHEDULED", "PUBLISHING", "PARTIALLY_PUBLISHED"] } },
      select: {
        id: true,
        status: true,
        strategyVersion: true,
        researchItemId: true,
        generatedContentId: true,
        researchItem: { select: { externalId: true, rawData: true } },
        generatedContent: { select: { title: true, inputSnapshot: true } },
        posts: {
          select: { id: true, role: true, sequence: true, xPostId: true, body: true },
          orderBy: { sequence: "asc" },
        },
      },
    })) as ThreadRow[];
    const reservations = await prisma.xProductPublicationReservation.findMany({
      where: { publicationId: { in: publications.map((row) => row.id) } },
      select: { id: true, publicationId: true, status: true },
    });
    const reservationByPublication = new Map(reservations.map((row) => [row.publicationId, row]));
    const wpBefore = await prisma.publicationTarget.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    const snapshot = publications.map((row) => {
      const root = row.posts.find((post) => post.role === "ROOT");
      const cta = row.posts.find((post) => post.role === "CTA");
      const urls = row.posts.flatMap((post) => urlsInText(post.body));
      const wpUrl = urls.find((url) => classifyXDestination(url) === "WORDPRESS") ?? null;
      return {
        canonicalCid: row.researchItem.externalId,
        xPublicationId: row.id,
        reservationId: reservationByPublication.get(row.id)?.id ?? null,
        publicationStatus: row.status,
        rootExternalId: root?.xPostId ?? null,
        ctaExternalId: cta?.xPostId ?? null,
        mediaUrl: mediaUrlFromSnapshot(row.generatedContent.inputSnapshot),
        oldText: row.posts.map((post) => ({ role: post.role, body: post.body })),
        oldUrls: urls,
        wpUrl,
      };
    });
    await writeFile("/tmp/x-normal-link-snapshot.json", JSON.stringify(snapshot), { mode: 0o600 });

    const stack = createLiveStack({ config, prisma, allowWrites: true });
    const account = await stack.provider.getAuthenticatedAccount();
    const token = await stack.tokens.getValidAccessToken(account.accountId);
    const timeline = await loadTimeline(stack, account.accountId, token);
    const managedIds = new Set(
      publications.flatMap((row) => row.posts.map((post) => post.xPostId).filter((id): id is string => Boolean(id))),
    );
    const unmanaged = [...timeline.ids.keys()].filter((id) => !managedIds.has(id));
    const classCounts = destinationClassCounts(publications.flatMap((row) => row.posts));
    const published = publications.filter((row) => row.status === "PUBLISHED");
    const scheduled = publications.filter((row) => row.status === "SCHEDULED");
    console.log(
      JSON.stringify({
        mode: apply ? "APPLY" : "DRY_RUN",
        snapshot: "/tmp/x-normal-link-snapshot.json",
        publishedThreads: published.length,
        scheduledThreads: scheduled.length,
        urlClasses: classCounts,
        timelinePosts: timeline.ids.size,
        timelinePages: timeline.pages,
        unmanagedPosts: unmanaged.length,
        unmanagedIds: unmanaged,
        wordpressTargets: wpBefore.map((row) => ({ status: row.status, count: row._count._all })),
        openaiCalls,
      }),
    );
    if (!apply) return;

    const cancelledPublications = await prisma.xPublication.updateMany({
      where: { status: "SCHEDULED" },
      data: {
        status: "CANCELLED",
        lastErrorType: "NORMAL_LINK_MIGRATION",
        lastErrorMessage: "legacy payload cancelled",
      },
    });
    const scheduledIds = scheduled.map((row) => row.id);
    if (scheduledIds.length > 0) {
      await prisma.xPublicationPost.updateMany({
        where: { publicationId: { in: scheduledIds }, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      for (const row of scheduled) {
        await prisma.xPublication.update({
          where: { id: row.id },
          data: { strategyVersion: appendNormalLinkMarker(row.strategyVersion) },
        });
      }
    }
    const cancelledReservations = await prisma.xProductPublicationReservation.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "CANCELLED", reason: NORMAL_LINK_MIGRATION_MARKER },
    });

    let deletedCta = 0;
    let deletedRoot = 0;
    let alreadyMissing = 0;
    const failures: string[] = [];
    const deletedIds: string[] = [];
    let apiDeletes = 0;

    for (const row of published) {
      const ordered = [...row.posts].sort((a, b) => {
        if (a.role === "CTA" && b.role !== "CTA") return -1;
        if (b.role === "CTA" && a.role !== "CTA") return 1;
        return b.sequence - a.sequence;
      });
      try {
        for (const post of ordered) {
          if (!post.xPostId) continue;
          apiDeletes += 1;
          const result = await deleteOne(stack, account.accountId, post.xPostId);
          if (result === "ALREADY_MISSING") alreadyMissing += 1;
          else if (post.role === "CTA") deletedCta += 1;
          else if (post.role === "ROOT") deletedRoot += 1;
        }
        await prisma.xPublication.update({
          where: { id: row.id },
          data: { status: "DELETED", strategyVersion: appendNormalLinkMarker(row.strategyVersion) },
        });
        await prisma.xOperationalAuditLog.create({
          data: {
            action: "NORMAL_LINK_MIGRATION_DELETE",
            actorType: "ADMIN",
            actorId: "migration",
            entityType: "XPublication",
            entityId: row.id,
            publicationId: row.id,
            result: "SUCCESS",
            reason: row.researchItem.externalId,
          },
        });
        deletedIds.push(row.id);
      } catch (error) {
        const note = error instanceof Error ? error.message.slice(0, 180) : "DELETE_FAILED";
        failures.push(`${row.id}:${note}`);
        console.log(JSON.stringify({ stoppedAt: row.id, cid: row.researchItem.externalId, error: note }));
        break;
      }
    }

    const rebuilt: string[] = [];
    const blocked: string[] = [];
    if (failures.length === 0) {
      const contents = new ContentRepository(prisma);
      const service = new XPublicationService({
        logger,
        config,
        contents,
        publications: new XPublicationRepository(prisma),
        ops: new XOpsRepository(prisma),
        optimization: new XOptimizationRepository(prisma),
        provider: stack.provider,
        now: () => new Date(),
        loadResearchExternalId: async (id) => {
          const item = await prisma.researchItem.findUnique({
            where: { id },
            select: { externalId: true },
          });
          return item?.externalId;
        },
        loadOfficialProductIdentity: async (id) => {
          const item = await prisma.researchItem.findUnique({
            where: { id },
            select: { rawData: true },
          });
          return officialIdentityFromRaw(item?.rawData);
        },
      });
      const ready = published.filter((row) => deletedIds.includes(row.id));
      const slots = nextFutureJstSlots(ready.length, new Date());
      for (let index = 0; index < ready.length; index += 1) {
        const row = ready[index]!;
        const slot = slots[index];
        if (!slot) {
          blocked.push(`${row.researchItem.externalId}:NO_FUTURE_SLOT`);
          continue;
        }
        const root = row.posts.find((post) => post.role === "ROOT")?.body ?? "";
        const identity = officialIdentityFromRaw(row.researchItem.rawData);
        const normal = resolveNormalXProductUrl({
          canonicalCid: row.researchItem.externalId,
          officialContentId: identity.contentId,
          officialProductUrl: identity.productUrl,
        });
        if (!normal.ok) {
          blocked.push(`${row.researchItem.externalId}:NORMAL_URL_NOT_VERIFIED`);
          continue;
        }
        const composed = composeNormalLinkPosts({
          rootBody: root,
          url: normal.url,
          canonicalCid: row.researchItem.externalId,
        });
        if (!composed.ok) {
          blocked.push(`${row.researchItem.externalId}:${composed.reason}`);
          continue;
        }
        const mediaUrl = mediaUrlFromSnapshot(row.generatedContent.inputSnapshot);
        const officialMedia =
          mediaUrl && officialMediaMatchesCanonicalCid(mediaUrl, row.researchItem.externalId)
            ? mediaUrl
            : null;
        let candidateId = (
          await prisma.contentCandidate.findFirst({
            where: { researchItemId: row.researchItemId },
            orderBy: [{ rank: "asc" }, { createdAt: "desc" }],
            select: { id: true },
          })
        )?.id ?? null;
        if (!candidateId) {
          candidateId = await ensureContentCandidateForPublishedWpX(prisma, row.researchItemId);
        }
        if (!candidateId) {
          blocked.push(`${row.researchItem.externalId}:NO_CONTENT_CANDIDATE`);
          continue;
        }
        const created = await contents.createGeneratedContent({
          contentCandidateId: candidateId,
          researchItemId: row.researchItemId,
          contentType: "X_POST",
          targetChannel: "X",
          status: "READY_TO_PUBLISH",
          title: (row.generatedContent.title ?? row.researchItem.externalId).slice(0, 120),
          body: composed.rootBody,
          summary: "",
          hashtags: [],
          callToAction: normal.url,
          affiliateUrl: normal.url,
          promptVersion: "normal-link-migration",
          generationProvider: "stored-review-pass",
          generationModel: "none",
          inputSnapshot: {
            source: "normal_link_migration",
            destinationUrl: normal.url,
            xSocialAdaptation: {
              publicationStrategy: "FANZA_NORMAL",
              parentBody: composed.rootBody,
              posts: [
                { sequence: 1, role: "ROOT", body: composed.rootBody },
                { sequence: 2, role: "CTA", body: composed.ctaBody },
              ],
              mediaUrl: officialMedia,
              mediaMode: officialMedia ? "SAFE_IMAGE" : "TEXT_ONLY",
            },
          },
          contentHash: createHash("sha256").update(composed.rootBody).digest("hex"),
          version: 1,
          generatedAt: new Date(),
        });
        const hour = Number(slotKeyFromDate(slot).slice(11, 13));
        const pub = await service.createFromContent({
          contentId: created.id,
          strategy: "AUTO",
          publishNow: false,
          scheduledAt: slot,
          actorType: "CLI",
          actorId: "normal-link-migration",
        });
        await prisma.xPublication.update({
          where: { id: pub.id },
          data: {
            idempotencyKey: `x-daily:${slotKeyFromDate(slot)}:${row.researchItem.externalId}:FANZA_NORMAL`,
            strategyVersion: `${pub.strategyVersion}|slotHour=${hour}|FANZA_NORMAL`,
          },
        });
        rebuilt.push(row.researchItem.externalId);
      }
      if (rebuilt.length > 0) {
        await prisma.xRuntimeControl.upsert({
          where: { key: "PUBLISHING_PAUSED" },
          create: {
            key: "PUBLISHING_PAUSED",
            value: "false",
            reason: NORMAL_LINK_MIGRATION_MARKER,
            changedBy: "migration",
          },
          update: {
            value: "false",
            reason: NORMAL_LINK_MIGRATION_MARKER,
            changedBy: "migration",
            changedAt: new Date(),
          },
        });
      }
    }

    const wpAfter = await prisma.publicationTarget.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    console.log(
      JSON.stringify({
        cancelledPublications: cancelledPublications.count,
        cancelledReservations: cancelledReservations.count,
        deletedCta,
        deletedRoot,
        alreadyMissing,
        deleteFailures: failures,
        rebuilt: rebuilt.length,
        blocked,
        apiDeletes,
        timelinePages: timeline.pages,
        openaiCalls,
        wordpressChanged:
          JSON.stringify(wpBefore.map((row) => [row.status, row._count._all])) !==
          JSON.stringify(wpAfter.map((row) => [row.status, row._count._all])),
      }),
    );
  } finally {
    await database.disconnect();
  }
}
