import type { AppConfig } from "@ai-affiliate/config";
import type {
  ContentRepository,
  PublicationWithPosts,
  XOpsRepository,
  XOptimizationRepository,
  XPublicationRepository,
  XPublicationStrategyType,
} from "@ai-affiliate/database";
import {
  hashNormalizedBody,
  hashProductKey,
} from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { computeNextRetryAt } from "../schedules/backoff.js";
import { XCharacterCounter } from "./character-counter.js";
import { XPublicationBuilder } from "./publication-builder.js";
import { XRelatedPostSelector } from "./related-selector.js";
import { XStrategySelector } from "./strategy-selector.js";
import type { XPublishingProvider } from "./providers/index.js";
import { createXPublishingProvider } from "./providers/index.js";
import { XPublishError, type GeneratedXPublication } from "./types.js";
import { STRATEGY_VERSION } from "./types.js";
import { XPrePublishGuard } from "./ops/pre-publish-guard.js";
import {
  buildProductKey,
  extractProviderProductId,
} from "./ops/product-key.js";

export interface XPublicationServiceDeps {
  logger: Logger;
  config: AppConfig;
  contents: ContentRepository;
  publications: XPublicationRepository;
  provider?: XPublishingProvider;
  ops?: XOpsRepository;
  optimization?: XOptimizationRepository;
  now?: () => Date;
  random?: () => number;
  notifications?: {
    emitXEvent?: (
      eventType:
        | "X_PUBLICATION_FAILED"
        | "X_PUBLICATION_PARTIALLY_PUBLISHED"
        | "X_PUBLICATION_PUBLISHED"
        | "X_REPLY_FAILED"
        | "X_PUBLICATION_BLOCKED"
        | "X_PRODUCT_COOLDOWN_BLOCKED"
        | "X_PUBLICATION_LIMIT_REACHED"
        | "X_DUPLICATE_CONTENT_BLOCKED"
        | "X_RESERVATION_EXPIRED"
        | "X_POST_PUBLISHED_UNVERIFIED"
        | "X_LIVE_POST_PUBLISHED"
        | "X_API_HARD_BUDGET_REACHED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
  /** Optional live budget gate (API_BUDGET_PAUSED — not BLOCKED). */
  checkApiBudget?: (accountId?: string | null) => Promise<{
    allowed: boolean;
    reason?: string;
  }>;
  /** Scheduler/ALLOWLIST: refuse live provider posts unless explicitly allowed. */
  allowSchedulerLivePublish?: boolean;
  livePublishConfirmed?: boolean;
  loadItemTags?: (researchItemId: string) => Promise<{
    actress: string[];
    genre: string[];
    maker: string[];
    series: string[];
  }>;
  loadCandidateType?: (contentCandidateId: string) => Promise<string | undefined>;
  loadResearchExternalId?: (researchItemId: string) => Promise<string | undefined>;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof XPublishError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorTypeOf(error: unknown): string {
  if (error instanceof XPublishError) return error.errorType;
  return "Unknown";
}

function isRetryable(error: unknown): boolean {
  if (error instanceof XPublishError) return error.retryable;
  return false;
}

export class XPublicationService {
  private readonly logger: Logger;
  private readonly config: AppConfig;
  private readonly contents: ContentRepository;
  private readonly publications: XPublicationRepository;
  private readonly provider: XPublishingProvider;
  private readonly builder: XPublicationBuilder;
  private readonly selector: XStrategySelector;
  private readonly related: XRelatedPostSelector;
  private readonly counter: XCharacterCounter;
  private readonly now: () => Date;
  private readonly notifications: XPublicationServiceDeps["notifications"];
  private readonly loadItemTags: XPublicationServiceDeps["loadItemTags"];
  private readonly loadCandidateType: XPublicationServiceDeps["loadCandidateType"];
  private readonly loadResearchExternalId: XPublicationServiceDeps["loadResearchExternalId"];
  private readonly random: () => number;
  private readonly ops?: XOpsRepository;
  private readonly optimization?: XOptimizationRepository;
  private readonly guard?: XPrePublishGuard;
  private readonly checkApiBudget?: XPublicationServiceDeps["checkApiBudget"];
  private readonly allowSchedulerLivePublish: boolean;
  private readonly livePublishConfirmed: boolean;

  constructor(deps: XPublicationServiceDeps) {
    this.logger = deps.logger;
    this.config = deps.config;
    this.contents = deps.contents;
    this.publications = deps.publications;
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.notifications = deps.notifications;
    this.loadItemTags = deps.loadItemTags;
    this.loadCandidateType = deps.loadCandidateType;
    this.loadResearchExternalId = deps.loadResearchExternalId;
    this.ops = deps.ops;
    this.optimization = deps.optimization;
    this.checkApiBudget = deps.checkApiBudget;
    this.allowSchedulerLivePublish = deps.allowSchedulerLivePublish ?? false;
    this.livePublishConfirmed = deps.livePublishConfirmed ?? false;
    this.provider =
      deps.provider ??
      createXPublishingProvider(deps.config.xApiProvider, {
        enabled: deps.config.xApiEnabled,
        accessToken: deps.config.xApiAccessToken,
        accountId: deps.config.xApiAccountId,
        baseUrl: deps.config.xApiBaseUrl,
        timeoutMs: deps.config.xApiTimeoutMs,
      });
    this.builder = new XPublicationBuilder(deps.config);
    this.selector = new XStrategySelector(deps.config, deps.publications, this.random);
    this.related = new XRelatedPostSelector(
      deps.publications,
      deps.config.xRelatedLookbackDays,
    );
    this.counter = new XCharacterCounter(deps.config.xUrlWeightedLength);
    if (deps.ops) {
      this.guard = new XPrePublishGuard({
        config: deps.config,
        contents: deps.contents,
        publications: deps.publications,
        ops: deps.ops,
        optimization: deps.optimization,
        now: this.now,
      });
    }
  }

  async createFromContent(options: {
    contentId: string;
    strategy?: XPublicationStrategyType | "AUTO";
    scheduledAt?: Date | null;
    publishNow?: boolean;
    cooldownOverrideReason?: string;
    actorType?: "SYSTEM" | "ADMIN" | "SCHEDULER" | "CLI";
    actorId?: string;
  }): Promise<PublicationWithPosts> {
    const content = await this.contents.findGeneratedContentById(options.contentId);
    if (!content) {
      throw new Error(`content not found: ${options.contentId}`);
    }
    if (content.contentType !== "X_POST") {
      throw new Error("only X_POST content can create X publications");
    }
    if (content.status !== "READY_TO_PUBLISH") {
      throw new Error(
        `content status must be READY_TO_PUBLISH (got ${content.status})`,
      );
    }

    if (this.ops) {
      const existing = await this.ops.findActivePublicationForContent(content.id);
      if (existing) {
        throw new Error(
          `active publication already exists for content ${content.id} (${existing.id})`,
        );
      }
    }

    const externalId = await this.loadResearchExternalId?.(content.researchItemId);
    const productKey = buildProductKey({
      provider: "fanza",
      providerProductId: extractProviderProductId({
        externalId,
        affiliateUrl: content.affiliateUrl,
      }),
      contentId: content.id,
      affiliateUrl: content.affiliateUrl,
      researchItemId: content.researchItemId,
      externalId,
    });

    if (this.ops) {
      await this.ops.expireDueReservations(this.now());
      await this.ops.upsertProductState({
        productKey,
        provider: "fanza",
        researchItemId: content.researchItemId,
        contentCandidateId: content.contentCandidateId,
      });
      const state = await this.ops.findProductState(productKey);
      if (
        state?.nextEligibleAt &&
        state.nextEligibleAt.getTime() > this.now().getTime() &&
        !options.cooldownOverrideReason
      ) {
        await this.ops.writeAudit({
          action: "PRODUCT_COOLDOWN_BLOCK",
          actorType: options.actorType ?? "CLI",
          actorId: options.actorId ?? null,
          entityType: "GeneratedContent",
          entityId: content.id,
          productKeyHash: hashProductKey(productKey),
          releaseMode: this.config.xReleaseMode,
          result: "BLOCKED",
          reason: "product cooldown active",
        });
        await this.notifications?.emitXEvent?.("X_PRODUCT_COOLDOWN_BLOCKED", {
          productKeyHash: hashProductKey(productKey),
        });
        throw new Error(
          `product cooldown active until ${state.nextEligibleAt.toISOString()}`,
        );
      }
      if (options.cooldownOverrideReason) {
        if (!options.actorId) {
          throw new Error("cooldown override requires actorId and reason");
        }
        await this.ops.writeAudit({
          action: "COOLDOWN_OVERRIDE",
          actorType: "ADMIN",
          actorId: options.actorId,
          entityType: "GeneratedContent",
          entityId: content.id,
          productKeyHash: hashProductKey(productKey),
          releaseMode: this.config.xReleaseMode,
          result: "SUCCESS",
          reason: options.cooldownOverrideReason,
        });
      }
    }

    const tags = (await this.loadItemTags?.(content.researchItemId)) ?? {
      actress: [],
      genre: [],
      maker: [],
      series: [],
    };
    const candidateType = await this.loadCandidateType?.(content.contentCandidateId);

    const relatedCandidates = await this.publications.findRelatedPublications({
      excludeResearchItemId: content.researchItemId,
      lookbackDays: this.config.xRelatedLookbackDays,
    });

    let bestRelated: PublicationWithPosts | null = null;
    let bestScore = -1;
    for (const candidate of relatedCandidates) {
      const candidateTags =
        (await this.loadItemTags?.(candidate.researchItemId)) ?? {
          actress: [],
          genre: [],
          maker: [],
          series: [],
        };
      const candType = await this.loadCandidateType?.(candidate.contentCandidateId);
      const scored = this.related.scoreWithTags(
        { ...candidateTags, candidateType: candType },
        {
          researchItemId: content.researchItemId,
          actressTags: tags.actress,
          genreTags: tags.genre,
          makerTags: tags.maker,
          seriesTags: tags.series,
          candidateType,
        },
        0,
      );
      if (scored.score > bestScore) {
        bestScore = scored.score;
        bestRelated = candidate;
      }
    }

    const hasRelated = bestRelated != null && bestScore > 0 && !!bestRelated.rootPostUrl;

    const selection = await this.selector.select({
      hasRelated,
      forceType:
        options.strategy && options.strategy !== "AUTO" ? options.strategy : undefined,
    });

    let strategyType = selection.strategyType;
    if (strategyType === "RELATED_POST_LINK" && !hasRelated) {
      strategyType = "SINGLE_POST";
    }

    const facts: string[] = [];
    const snapshot = content.inputSnapshot as Record<string, unknown>;
    if (snapshot && typeof snapshot === "object") {
      for (const key of ["rankingPosition", "reviewAverage", "price", "publishedAt"]) {
        const value = snapshot[key];
        if (value != null) facts.push(`${key}:${String(value)}`);
      }
      const tagObj = snapshot.tags as Record<string, string[]> | undefined;
      if (tagObj?.actress?.[0]) facts.push(`actress:${tagObj.actress[0]}`);
    }

    const built: GeneratedXPublication = this.builder.build(
      strategyType,
      {
        title: content.title,
        affiliateUrl: content.affiliateUrl,
        hashtags: Array.isArray(content.hashtags)
          ? (content.hashtags as string[])
          : [],
        summary: content.summary,
        callToAction: content.callToAction,
        facts,
        relatedPostUrl: hasRelated ? bestRelated!.rootPostUrl : null,
        relatedPublicationId: hasRelated ? bestRelated!.id : null,
        maxPosts: this.config.xAutoMaxPostsPerPublication,
      },
      selection.experimentGroup,
    );

    const scheduledAt = options.publishNow
      ? this.now()
      : (options.scheduledAt ?? null);

    const created = await this.publications.createPublication({
      generatedContentId: content.id,
      contentCandidateId: content.contentCandidateId,
      researchItemId: content.researchItemId,
      strategyType: built.strategyType,
      strategyVersion: built.strategyVersion ?? STRATEGY_VERSION,
      experimentGroup: built.experimentGroup,
      scheduledAt,
      status: options.publishNow || scheduledAt ? "SCHEDULED" : "DRAFT",
      posts: built.posts.map((post) => ({
        sequence: post.sequence,
        role: post.role,
        body: post.body,
        bodyHash: hashNormalizedBody(post.body),
        weightedLength: this.counter.count(post.body).weightedLength,
        replyToSequence: post.replyToSequence,
        relatedPublicationId: post.relatedPublicationId,
      })),
    });

    if (this.ops) {
      const nextEligibleAt = new Date(
        this.now().getTime() + this.config.xProductCooldownHours * 60 * 60 * 1000,
      );
      const expiresAt = new Date(
        this.now().getTime() + this.config.xProductReservationTtlMinutes * 60 * 1000,
      );
      try {
        await this.ops.reserveProduct({
          productKey,
          publicationId: created.id,
          expiresAt,
          scheduledAt,
          nextEligibleAt,
          reason: options.cooldownOverrideReason ?? "publication-create",
        });
      } catch (error) {
        await this.publications.cancel(created.id);
        throw error;
      }

      await this.ops.writeAudit({
        action: "PUBLICATION_CREATE",
        actorType: options.actorType ?? "CLI",
        actorId: options.actorId ?? null,
        entityType: "XPublication",
        entityId: created.id,
        publicationId: created.id,
        productKeyHash: hashProductKey(productKey),
        releaseMode: this.config.xReleaseMode,
        result: "SUCCESS",
        metadata: { strategyType: created.strategyType },
      });
    }

    if (options.publishNow) {
      return this.publishOne(created.id, {
        actorType: options.actorType,
        actorId: options.actorId,
        cooldownOverrideReason: options.cooldownOverrideReason,
      });
    }
    return created;
  }

  async publishOne(
    publicationId: string,
    options?: {
      actorType?: "SYSTEM" | "ADMIN" | "SCHEDULER" | "CLI";
      actorId?: string;
      cooldownOverrideReason?: string;
      phase?: "publish" | "retry";
    },
  ): Promise<PublicationWithPosts> {
    if (!this.config.xApiEnabled && this.provider.providerName !== "mock") {
      throw new XPublishError("X API disabled — refusing real publish", "Configuration", {
        retryable: false,
      });
    }

    const ownerId = this.publications.newOwnerId();
    const locked = await this.publications.acquireLock(publicationId, ownerId);
    if (!locked) {
      this.logger.info(`publication lock busy id=${publicationId}`);
      const current = await this.publications.findById(publicationId);
      if (!current) throw new Error(`publication not found: ${publicationId}`);
      return current;
    }

    try {
      let publication = await this.publications.findById(publicationId);
      if (!publication) {
        throw new Error(`publication not found: ${publicationId}`);
      }

      if (
        publication.status === "CANCELLED" ||
        publication.status === "DELETED" ||
        publication.status === "PUBLISHED" ||
        publication.status === "PUBLISHED_UNVERIFIED"
      ) {
        // Never re-post the same body after API success (verified or not)
        return publication;
      }

      if (publication.status === "BLOCKED") {
        // Policy blocks do not auto-retry
        return publication;
      }

      const content = await this.contents.findGeneratedContentById(
        publication.generatedContentId,
      );
      const externalId = await this.loadResearchExternalId?.(publication.researchItemId);
      const productKey = buildProductKey({
        provider: "fanza",
        providerProductId: extractProviderProductId({
          externalId,
          affiliateUrl: content?.affiliateUrl,
        }),
        contentId: publication.generatedContentId,
        affiliateUrl: content?.affiliateUrl,
        researchItemId: publication.researchItemId,
        externalId,
      });
      const candidateType = await this.loadCandidateType?.(
        publication.contentCandidateId,
      );

      // ALLOWLIST: scheduler must not live-post; CLI must pass --live confirmation
      if (
        this.config.xReleaseMode === "ALLOWLIST" &&
        this.provider.providerName !== "mock"
      ) {
        const actor = options?.actorType ?? "SYSTEM";
        if (actor === "SCHEDULER" || !this.livePublishConfirmed) {
          await this.ops?.writeAudit({
            action: "PUBLISH_SKIPPED",
            actorType: options?.actorType ?? "SYSTEM",
            actorId: options?.actorId ?? null,
            publicationId: publication.id,
            productKeyHash: hashProductKey(productKey),
            releaseMode: this.config.xReleaseMode,
            result: "SKIPPED",
            reason: "ALLOWLIST_LIVE_REQUIRED",
            metadata: { actor },
          });
          return publication;
        }
      }

      if (this.ops) {
        await this.ops.expireDueReservations(this.now());
      }

      if (this.guard && this.ops) {
        const account = await this.provider.getAuthenticatedAccount().catch(() => ({
          accountId: this.config.xApiAccountId ?? "mock",
        }));
        const guardResult = await this.guard.evaluate({
          publication,
          productKey,
          candidateType,
          accountId: account.accountId,
          phase: options?.phase ?? "publish",
          actorType: options?.actorType,
          cooldownOverrideReason: options?.cooldownOverrideReason,
        });

        const policySkip = guardResult.issues.some((i) =>
          ["KILL_SWITCH", "RELEASE_DISABLED"].includes(i.code),
        );
        const hardBlock = !guardResult.ok;

        if (hardBlock) {
          const reason = guardResult.issues
            .filter((i) => i.blocking)
            .map((i) => i.code)
            .join(",");
          await this.ops.markPublicationBlocked(publication.id, reason);
          await this.ops.releaseReservation(publication.id, "RELEASED");
          await this.ops.writeAudit({
            action: "PRE_PUBLISH_BLOCK",
            actorType: options?.actorType ?? "SYSTEM",
            actorId: options?.actorId ?? null,
            publicationId: publication.id,
            productKeyHash: hashProductKey(productKey),
            releaseMode: this.config.xReleaseMode,
            result: "BLOCKED",
            reason,
            metadata: { issues: guardResult.issues.map((i) => i.code) },
          });
          if (guardResult.issues.some((i) => i.code === "DUPLICATE_BODY")) {
            await this.notifications?.emitXEvent?.("X_DUPLICATE_CONTENT_BLOCKED", {
              publicationId: publication.id,
            });
          } else if (guardResult.issues.some((i) => i.code === "PRODUCT_COOLDOWN")) {
            await this.notifications?.emitXEvent?.("X_PRODUCT_COOLDOWN_BLOCKED", {
              publicationId: publication.id,
            });
          } else if (
            guardResult.issues.some((i) => i.code === "DAILY_LIMIT" || i.code === "HOURLY_LIMIT")
          ) {
            await this.notifications?.emitXEvent?.("X_PUBLICATION_LIMIT_REACHED", {
              publicationId: publication.id,
            });
          } else {
            await this.notifications?.emitXEvent?.("X_PUBLICATION_BLOCKED", {
              publicationId: publication.id,
              status: "BLOCKED",
            });
          }
          return (await this.publications.findById(publication.id))!;
        }

        if (policySkip || guardResult.dryRun) {
          await this.ops.writeAudit({
            action: guardResult.dryRun ? "PUBLISH_DRY_RUN" : "PUBLISH_SKIPPED",
            actorType: options?.actorType ?? "SYSTEM",
            actorId: options?.actorId ?? null,
            publicationId: publication.id,
            productKeyHash: hashProductKey(productKey),
            releaseMode: this.config.xReleaseMode,
            result: "SKIPPED",
            reason: guardResult.issues.map((i) => i.code).join(",") || "policy",
            metadata: {
              dryRun: guardResult.dryRun,
              killSwitch: guardResult.killSwitch,
              postCount: publication.posts.length,
            },
          });
          // Keep SCHEDULED — do not FAILED/retry loop
          return publication;
        }
      } else {
        // No ops wiring: still honor env kill / disabled for safety
        if (
          this.config.xGlobalKillSwitch ||
          this.config.xReleaseMode === "DISABLED"
        ) {
          await this.notifications?.emitXEvent?.("X_PUBLICATION_BLOCKED", {
            publicationId: publication.id,
            status: "SKIPPED",
          });
          return publication;
        }
        if (this.config.xReleaseMode === "DRY_RUN") {
          return publication;
        }
      }

      if (this.checkApiBudget) {
        const budget = await this.checkApiBudget(this.config.xApiAccountId);
        if (!budget.allowed) {
          await this.ops?.writeAudit({
            action: "PUBLISH_SKIPPED",
            actorType: options?.actorType ?? "SYSTEM",
            actorId: options?.actorId ?? null,
            publicationId: publication.id,
            productKeyHash: hashProductKey(productKey),
            releaseMode: this.config.xReleaseMode,
            result: "SKIPPED",
            reason: budget.reason ?? "API_BUDGET_PAUSED",
            metadata: { apiBudgetPaused: true },
          });
          await this.notifications?.emitXEvent?.("X_API_HARD_BUDGET_REACHED", {
            publicationId: publication.id,
          });
          // Distinguish from BLOCKED — keep status for later resume
          return publication;
        }
      }

      publication = await this.publications.markPublishing(publicationId);
      const account = await this.provider.getAuthenticatedAccount();

      const sequenceToPostId = new Map<number, string>();
      let rootFailed = false;
      let replyFailed = false;
      let lastErrorType: string | null = null;
      let lastErrorMessage: string | null = null;
      let anyUnverified = false;

      for (const post of publication.posts) {
        if (post.xPostId) {
          sequenceToPostId.set(post.sequence, post.xPostId);
          continue;
        }
        if (post.status === "PUBLISHED") {
          if (post.xPostId) sequenceToPostId.set(post.sequence, post.xPostId);
          continue;
        }
        if (post.status === "CANCELLED" || post.status === "SKIPPED") {
          continue;
        }

        if (rootFailed) {
          await this.publications.markPostSkipped(post.id, "root failed — not posting");
          continue;
        }

        await this.publications.markPostPublishing(post.id);

        let replyToPostId: string | undefined;
        if (post.replyToSequence != null) {
          replyToPostId = sequenceToPostId.get(post.replyToSequence);
          if (!replyToPostId) {
            await this.publications.markPostFailed(
              post.id,
              "Validation",
              `missing reply target for sequence ${post.replyToSequence}`,
            );
            replyFailed = true;
            lastErrorType = "Validation";
            lastErrorMessage = "missing reply target";
            continue;
          }
        }

        try {
          const result = await this.provider.createPost({
            text: post.body,
            replyToPostId,
            idempotencyKey: `${publication.idempotencyKey}:seq:${post.sequence}`,
          });
          if (result.verified === false) {
            anyUnverified = true;
          }
          await this.publications.markPostPublished(post.id, {
            xPostId: result.postId,
            xPostUrl: result.postUrl ?? result.formalPostUrl ?? null,
            publishedAt: result.createdAt ?? this.now(),
          });
          sequenceToPostId.set(post.sequence, result.postId);
          if (post.sequence === 1) {
            await this.publications.setRootFields(publication.id, {
              rootPostId: result.postId,
              rootPostUrl: result.postUrl ?? null,
              conversationId: result.conversationId ?? result.postId,
              accountId: account.accountId,
            });
          }
        } catch (error) {
          const type = errorTypeOf(error);
          const message = safeErrorMessage(error);
          await this.publications.markPostFailed(post.id, type, message);
          lastErrorType = type;
          lastErrorMessage = message;
          if (post.sequence === 1 || post.role === "ROOT") {
            rootFailed = true;
          } else {
            replyFailed = true;
            await this.notifications?.emitXEvent?.("X_REPLY_FAILED", {
              publicationId: publication.id,
              postId: post.id,
              error: message,
            });
          }
          if (!isRetryable(error)) {
            if (post.role === "ROOT") rootFailed = true;
          }
        }
      }

      const refreshed = await this.publications.findById(publicationId);
      if (!refreshed) throw new Error("publication disappeared");

      const publishedPosts = refreshed.posts.filter((p) => p.status === "PUBLISHED");
      const failedPosts = refreshed.posts.filter((p) => p.status === "FAILED");
      const pendingRetry = failedPosts.some((p) =>
        ["Timeout", "Network", "RateLimit", "ServerError", "AuthTransient"].includes(
          p.lastErrorType ?? "",
        ),
      );

      let finalStatus: "PUBLISHED" | "PUBLISHED_UNVERIFIED" | "PARTIALLY_PUBLISHED" | "FAILED";
      if (publishedPosts.length === refreshed.posts.length) {
        finalStatus = anyUnverified ? "PUBLISHED_UNVERIFIED" : "PUBLISHED";
      } else if (publishedPosts.length === 0) {
        finalStatus = "FAILED";
      } else {
        finalStatus = "PARTIALLY_PUBLISHED";
      }

      const nextRetryAt =
        pendingRetry &&
        finalStatus !== "PUBLISHED" &&
        finalStatus !== "PUBLISHED_UNVERIFIED"
          ? computeNextRetryAt({
              now: this.now(),
              retryAttempt: refreshed.attemptCount,
              baseDelaySeconds: this.config.researchRetryBaseDelaySeconds,
              maxDelaySeconds: this.config.researchRetryMaxDelaySeconds,
              random: this.random,
            })
          : null;

      const root = refreshed.posts.find((p) => p.sequence === 1);
      const completed = await this.publications.completePublication(refreshed.id, {
        status: finalStatus,
        rootPostId: root?.xPostId ?? refreshed.rootPostId,
        rootPostUrl: root?.xPostUrl ?? refreshed.rootPostUrl,
        conversationId: refreshed.conversationId,
        accountId: account.accountId,
        errorType: lastErrorType,
        errorMessage: lastErrorMessage,
        nextRetryAt,
      });

      if (this.ops) {
        if (finalStatus === "PUBLISHED" || finalStatus === "PUBLISHED_UNVERIFIED") {
          await this.ops.consumeReservation(completed.id);
        } else if (finalStatus === "FAILED") {
          await this.ops.releaseReservation(completed.id, "RELEASED");
        }
        // PARTIALLY_PUBLISHED: keep reservation for retry
        await this.ops.writeAudit({
          action: "PUBLISH_ATTEMPT",
          actorType: options?.actorType ?? "SYSTEM",
          actorId: options?.actorId ?? null,
          publicationId: completed.id,
          productKeyHash: hashProductKey(productKey),
          releaseMode: this.config.xReleaseMode,
          result:
            finalStatus === "PUBLISHED" || finalStatus === "PUBLISHED_UNVERIFIED"
              ? "SUCCESS"
              : finalStatus === "PARTIALLY_PUBLISHED"
                ? "FAILED"
                : "FAILED",
          reason: lastErrorMessage,
          metadata: {
            status: finalStatus,
            publishedPostCount: publishedPosts.length,
          },
        });
      }

      if (finalStatus === "PUBLISHED" || finalStatus === "PUBLISHED_UNVERIFIED") {
        await this.contents.updateGeneratedContentStatus(refreshed.generatedContentId, "PUBLISHED", {
          publishedAt: this.now(),
        });
        if (finalStatus === "PUBLISHED_UNVERIFIED") {
          await this.notifications?.emitXEvent?.("X_POST_PUBLISHED_UNVERIFIED", {
            publicationId: completed.id,
          });
        } else {
          await this.notifications?.emitXEvent?.("X_PUBLICATION_PUBLISHED", {
            publicationId: completed.id,
          });
        }
        if (this.provider.providerName === "x-api" && finalStatus === "PUBLISHED") {
          await this.notifications?.emitXEvent?.("X_LIVE_POST_PUBLISHED", {
            publicationId: completed.id,
          });
        }
      } else if (finalStatus === "PARTIALLY_PUBLISHED") {
        await this.notifications?.emitXEvent?.("X_PUBLICATION_PARTIALLY_PUBLISHED", {
          publicationId: completed.id,
        });
      } else if (finalStatus === "FAILED") {
        await this.notifications?.emitXEvent?.("X_PUBLICATION_FAILED", {
          publicationId: completed.id,
          error: lastErrorMessage,
        });
      }

      void replyFailed;
      return completed;
    } finally {
      await this.publications.releaseLock(publicationId, ownerId);
    }
  }

  async runDue(limit = 20): Promise<PublicationWithPosts[]> {
    if (this.ops) {
      await this.ops.expireDueReservations(this.now());
    }
    const due = await this.publications.listDueForPublish(this.now(), limit);
    const results: PublicationWithPosts[] = [];
    for (const pub of due) {
      if (pub.status === "DRAFT" || pub.status === "BLOCKED") continue;
      if (
        pub.status === "SCHEDULED" &&
        pub.scheduledAt &&
        pub.scheduledAt.getTime() > this.now().getTime()
      ) {
        continue;
      }
      try {
        results.push(
          await this.publishOne(pub.id, {
            actorType: "SCHEDULER",
            actorId: "scheduler",
          }),
        );
      } catch (error) {
        this.logger.warn(`publish failed id=${pub.id}: ${safeErrorMessage(error)}`);
      }
    }
    return results;
  }

  async retry(publicationId: string): Promise<PublicationWithPosts> {
    const pub = await this.publications.findById(publicationId);
    if (!pub) throw new Error(`publication not found: ${publicationId}`);
    if (pub.status === "BLOCKED") {
      throw new Error("cannot retry BLOCKED publication — fix cause and reschedule");
    }
    if (pub.status !== "PARTIALLY_PUBLISHED" && pub.status !== "FAILED") {
      throw new Error(`cannot retry publication in status ${pub.status}`);
    }
    return this.publishOne(publicationId, { phase: "retry", actorType: "CLI" });
  }

  async cancel(publicationId: string): Promise<PublicationWithPosts> {
    const cancelled = await this.publications.cancel(publicationId);
    if (this.ops) {
      await this.ops.releaseReservation(publicationId, "CANCELLED");
      await this.ops.writeAudit({
        action: "PUBLICATION_CANCEL",
        actorType: "CLI",
        publicationId,
        releaseMode: this.config.xReleaseMode,
        result: "SUCCESS",
      });
    }
    return cancelled;
  }

  async schedule(
    publicationId: string,
    scheduledAt: Date,
    options?: { actorId?: string; cooldownOverrideReason?: string },
  ): Promise<PublicationWithPosts> {
    if (this.guard && this.ops) {
      const publication = await this.publications.findById(publicationId);
      if (!publication) throw new Error(`publication not found: ${publicationId}`);
      const content = await this.contents.findGeneratedContentById(
        publication.generatedContentId,
      );
      const externalId = await this.loadResearchExternalId?.(publication.researchItemId);
      const productKey = buildProductKey({
        provider: "fanza",
        providerProductId: extractProviderProductId({
          externalId,
          affiliateUrl: content?.affiliateUrl,
        }),
        contentId: publication.generatedContentId,
        affiliateUrl: content?.affiliateUrl,
        researchItemId: publication.researchItemId,
        externalId,
      });
      const result = await this.guard.evaluate({
        publication,
        productKey,
        phase: "schedule",
        cooldownOverrideReason: options?.cooldownOverrideReason,
      });
      if (!result.ok) {
        throw new Error(
          `schedule blocked: ${result.issues.map((i) => i.code).join(",")}`,
        );
      }
    }
    const scheduled = await this.publications.schedule(publicationId, scheduledAt);
    if (this.ops) {
      await this.ops.writeAudit({
        action: "PUBLICATION_SCHEDULE",
        actorType: "CLI",
        actorId: options?.actorId ?? null,
        publicationId,
        releaseMode: this.config.xReleaseMode,
        result: "SUCCESS",
        metadata: { scheduledAt: scheduledAt.toISOString() },
      });
    }
    return scheduled;
  }
}
