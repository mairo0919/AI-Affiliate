import { loadConfig } from "@ai-affiliate/config";
import {
  FANZA_DIRECT_MIGRATION_MARKER,
  createDatabaseClient,
} from "@ai-affiliate/database";
import { createLogger } from "@ai-affiliate/shared";
import { createLiveStack } from "./live/live-stack.js";
import { XPublishError } from "./types.js";

type ThreadRow = {
  id: string;
  status: string;
  strategyVersion: string;
  researchItem: { externalId: string };
  posts: Array<{ id: string; role: string; sequence: number; xPostId: string | null; body: string }>;
};

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

async function tweetExists(
  stack: ReturnType<typeof createLiveStack>,
  accountId: string,
  token: string,
  postId: string,
): Promise<"PRESENT" | "MISSING"> {
  const response = await stack.http.request({
    method: "GET",
    path: `/2/tweets/${postId}`,
    endpointKey: "tweets.get",
    requestType: "TWEETS_GET",
    accessToken: token,
    accountId,
    xPostId: postId,
    acceptErrorResponse: true,
    disableRetry: true,
  });
  if (response.statusCode === 404) return "MISSING";
  if (response.ok) return "PRESENT";
  throw new Error(`tweet lookup failed status=${response.statusCode}`);
}

async function deleteOne(
  stack: ReturnType<typeof createLiveStack>,
  accountId: string,
  postId: string,
): Promise<"DELETED" | "ALREADY_MISSING"> {
  const token = await stack.tokens.getValidAccessToken(accountId);
  const before = await tweetExists(stack, accountId, token, postId);
  if (before === "MISSING") return "ALREADY_MISSING";
  try {
    await stack.provider.deletePost(postId);
  } catch (error) {
    if (error instanceof XPublishError && error.httpStatus === 404) return "ALREADY_MISSING";
    throw error;
  }
  const afterToken = await stack.tokens.getValidAccessToken(accountId);
  const after = await tweetExists(stack, accountId, afterToken, postId);
  if (after !== "MISSING") throw new Error(`delete not confirmed post=${postId}`);
  return "DELETED";
}

export async function runFanzaDirectMigration(argv: string[]): Promise<void> {
  const apply = hasFlag(argv, "apply");
  if (apply) process.env.X_DELETE_POST_ENABLED = "true";
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = createDatabaseClient();
  await database.connect();
  const prisma = database.prisma;
  try {
    const publications = await prisma.xPublication.findMany({
      where: { status: { in: ["PUBLISHED", "SCHEDULED", "PUBLISHING", "PARTIALLY_PUBLISHED"] } },
      select: {
        id: true,
        status: true,
        strategyVersion: true,
        researchItem: { select: { externalId: true } },
        posts: {
          select: { id: true, role: true, sequence: true, xPostId: true, body: true },
          orderBy: { sequence: "desc" },
        },
      },
    });
    const published = publications.filter((row) => row.status === "PUBLISHED");
    const scheduled = publications.filter((row) => row.status === "SCHEDULED");
    const wpPosts = publications.flatMap((row) =>
      row.posts.filter((post) => /otonaselect\.net|記事はこちら/u.test(post.body)),
    );
    const stack = createLiveStack({ config, prisma, allowWrites: true });
    const account = await stack.provider.getAuthenticatedAccount();
    const token = await stack.tokens.getValidAccessToken(account.accountId);
    const managedIds = new Set(
      publications.flatMap((row) => row.posts.map((post) => post.xPostId).filter((id): id is string => Boolean(id))),
    );
    const timeline: Array<{ id: string; wordpress: boolean; affiliateHint: boolean }> = [];
    let pagination: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const tweetPath: string = pagination
        ? `/2/users/${account.accountId}/tweets?max_results=100&tweet.fields=text&pagination_token=${encodeURIComponent(pagination)}`
        : `/2/users/${account.accountId}/tweets?max_results=100&tweet.fields=text`;
      const pageResult = await stack.http.request<{
        data?: Array<{ id: string; text?: string }>;
        meta?: { next_token?: string };
      }>({
        method: "GET",
        path: tweetPath,
        endpointKey: "tweets.get",
        requestType: "TWEETS_GET",
        accessToken: token,
        accountId: account.accountId,
        acceptErrorResponse: true,
        disableRetry: true,
      });
      if (!pageResult.ok) break;
      for (const tweet of pageResult.data?.data ?? []) {
        const text = tweet.text ?? "";
        timeline.push({
          id: tweet.id,
          wordpress: /otonaselect\.net|記事はこちら/u.test(text),
          affiliateHint: /[?&]af_id=|al\.fanza\.co\.jp|al\.dmm\.co\.jp/iu.test(text),
        });
      }
      pagination = pageResult.data?.meta?.next_token ?? null;
      if (!pagination) break;
    }
    const unmanaged = timeline.filter((tweet) => !managedIds.has(tweet.id));
    console.log(
      JSON.stringify({
        mode: apply ? "APPLY" : "DRY_RUN",
        publishedThreads: published.length,
        scheduledThreads: scheduled.length,
        postsWithWordPressInduction: wpPosts.length,
        timelinePosts: timeline.length,
        unmanagedPosts: unmanaged.length,
        unmanagedWordpressPosts: unmanaged.filter((tweet) => tweet.wordpress).length,
        unmanagedAffiliatePosts: unmanaged.filter((tweet) => tweet.affiliateHint).length,
        unmanagedIds: unmanaged.map((tweet) => tweet.id),
        xAffiliateConfigured: Boolean(config.dmmXAffiliateId?.trim()),
        xAffiliateDistinct:
          Boolean(config.dmmXAffiliateId?.trim()) &&
          config.dmmXAffiliateId?.trim() !== config.dmmAffiliateId?.trim(),
      }),
    );
    if (!apply) return;

    const cancelledPublications = await prisma.xPublication.updateMany({
      where: { status: "SCHEDULED" },
      data: { status: "CANCELLED", lastErrorType: "FANZA_DIRECT_MIGRATION", lastErrorMessage: "legacy payload cancelled" },
    });
    const scheduledIds = scheduled.map((row) => row.id);
    if (scheduledIds.length > 0) {
      await prisma.xPublicationPost.updateMany({
        where: { publicationId: { in: scheduledIds }, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    }
    const cancelledReservations = await prisma.xProductPublicationReservation.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });

    let deletedCta = 0;
    let deletedRoot = 0;
    let alreadyMissing = 0;
    const failures: string[] = [];

    for (const row of published as ThreadRow[]) {
      const ordered = [...row.posts].sort((a, b) => b.sequence - a.sequence);
      try {
        for (const post of ordered) {
          if (!post.xPostId) continue;
          const result = await deleteOne(stack, account.accountId, post.xPostId);
          if (result === "ALREADY_MISSING") alreadyMissing += 1;
          else if (post.role === "CTA") deletedCta += 1;
          else if (post.role === "ROOT") deletedRoot += 1;
        }
        const version = row.strategyVersion.includes(FANZA_DIRECT_MIGRATION_MARKER)
          ? row.strategyVersion
          : `${row.strategyVersion}|${FANZA_DIRECT_MIGRATION_MARKER}`;
        await prisma.xPublication.update({
          where: { id: row.id },
          data: { status: "DELETED", strategyVersion: version },
        });
        await prisma.xOperationalAuditLog.create({
          data: {
            action: "FANZA_DIRECT_MIGRATION_DELETE",
            actorType: "ADMIN",
            actorId: "migration",
            entityType: "XPublication",
            entityId: row.id,
            publicationId: row.id,
            result: "SUCCESS",
            reason: row.researchItem.externalId,
          },
        });
      } catch (error) {
        const note = error instanceof Error ? error.message.slice(0, 180) : "delete failed";
        failures.push(`${row.id}:${note}`);
        console.log(JSON.stringify({ stoppedAt: row.id, cid: row.researchItem.externalId, error: note }));
        break;
      }
    }

    if (failures.length === 0) {
      await prisma.xProductPublicationState.updateMany({
        where: { lastPublicationId: { in: published.map((row) => row.id) } },
        data: { nextEligibleAt: null, activeReservationCount: 0 },
      });
    }

    console.log(
      JSON.stringify({
        cancelledPublications: cancelledPublications.count,
        cancelledReservations: cancelledReservations.count,
        deletedCta,
        deletedRoot,
        alreadyMissing,
        failures: failures.length,
        repostBlocked: !config.dmmXAffiliateId?.trim(),
      }),
    );
  } finally {
    await database.disconnect();
  }
  void logger;
}
