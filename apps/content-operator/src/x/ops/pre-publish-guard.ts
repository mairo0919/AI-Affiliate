import type { AppConfig } from "@ai-affiliate/config";
import type {
  ContentRepository,
  PublicationWithPosts,
  XOpsRepository,
  XOptimizationRepository,
  XPublicationRepository,
} from "@ai-affiliate/database";
import { hashNormalizedBody, hashProductKey } from "@ai-affiliate/database";
import { XCharacterCounter } from "../character-counter.js";
import { tokyoParts } from "../optimization/feature-extractor.js";

export interface PrePublishIssue {
  code: string;
  message: string;
  blocking: boolean;
}

export interface PrePublishContext {
  publication: PublicationWithPosts;
  productKey: string;
  candidateType?: string | null;
  recommendationId?: string | null;
  applicationId?: string | null;
  accountId?: string | null;
  phase: "create" | "schedule" | "publish" | "retry";
  actorType?: "SYSTEM" | "ADMIN" | "SCHEDULER" | "CLI";
  cooldownOverrideReason?: string | null;
}

export interface PrePublishResult {
  ok: boolean;
  issues: PrePublishIssue[];
  dryRun: boolean;
  skipProvider: boolean;
  releaseMode: AppConfig["xReleaseMode"];
  killSwitch: boolean;
}

export interface XPrePublishGuardDeps {
  config: AppConfig;
  contents: ContentRepository;
  publications: XPublicationRepository;
  ops: XOpsRepository;
  optimization?: XOptimizationRepository;
  now?: () => Date;
}

export class XPrePublishGuard {
  private readonly now: () => Date;
  private readonly counter: XCharacterCounter;

  constructor(private readonly deps: XPrePublishGuardDeps) {
    this.now = deps.now ?? (() => new Date());
    this.counter = new XCharacterCounter(deps.config.xUrlWeightedLength);
  }

  async evaluate(ctx: PrePublishContext): Promise<PrePublishResult> {
    const issues: PrePublishIssue[] = [];
    const releaseMode = this.deps.config.xReleaseMode;
    const envKill = this.deps.config.xGlobalKillSwitch;
    const dbKill = await this.deps.ops.isControlActive("GLOBAL_KILL_SWITCH", this.now());
    const dbPaused = await this.deps.ops.isControlActive("PUBLISHING_PAUSED", this.now());
    const killSwitch = envKill || dbKill || dbPaused;

    const content = await this.deps.contents.findGeneratedContentById(
      ctx.publication.generatedContentId,
    );
    if (!content) {
      issues.push({ code: "CONTENT_MISSING", message: "generated content missing", blocking: true });
    } else {
      if (content.status !== "READY_TO_PUBLISH") {
        issues.push({
          code: "CONTENT_NOT_READY",
          message: `content status=${content.status}`,
          blocking: true,
        });
      }
      const blockingIssues = (content.validationIssues ?? []).filter(
        (i) => i.severity === "BLOCKING",
      );
      if (blockingIssues.length > 0) {
        issues.push({
          code: "VALIDATION_BLOCKING",
          message: `${blockingIssues.length} unresolved BLOCKING issues`,
          blocking: true,
        });
      }
      for (const post of ctx.publication.posts) {
        if (!post.body.includes(content.affiliateUrl)) {
          issues.push({
            code: "AFFILIATE_URL_MISMATCH",
            message: "affiliateUrl missing or changed in post body",
            blocking: true,
          });
          break;
        }
      }
    }

    const disclosure = this.deps.config.xAffiliateDisclosure;
    const root = ctx.publication.posts.find((p) => p.sequence === 1);
    if (root && disclosure && !root.body.includes(disclosure) && !/アフィリエイト|広告|#PR/i.test(root.body)) {
      issues.push({ code: "DISCLOSURE_MISSING", message: "disclosure missing", blocking: true });
    }

    for (const post of ctx.publication.posts) {
      const weighted = this.counter.count(post.body).weightedLength;
      if (weighted > this.deps.config.xMaxWeightedLength) {
        issues.push({
          code: "WEIGHTED_LENGTH",
          message: `seq=${post.sequence} weightedLength=${weighted}`,
          blocking: true,
        });
      }
    }

    // reply refs
    const sequences = new Set(ctx.publication.posts.map((p) => p.sequence));
    for (const post of ctx.publication.posts) {
      if (post.replyToSequence != null && !sequences.has(post.replyToSequence)) {
        issues.push({
          code: "INVALID_REPLY_REF",
          message: `invalid replyToSequence=${post.replyToSequence}`,
          blocking: true,
        });
      }
    }

    if (
      ctx.publication.status === "CANCELLED" ||
      ctx.publication.status === "DELETED"
    ) {
      issues.push({
        code: "PUBLICATION_CANCELLED",
        message: `status=${ctx.publication.status}`,
        blocking: true,
      });
    }

    // product cooldown
    const state = await this.deps.ops.findProductState(ctx.productKey);
    if (state?.nextEligibleAt && state.nextEligibleAt.getTime() > this.now().getTime()) {
      if (!ctx.cooldownOverrideReason) {
        issues.push({
          code: "PRODUCT_COOLDOWN",
          message: `nextEligibleAt=${state.nextEligibleAt.toISOString()}`,
          blocking: true,
        });
      }
    }

    if (ctx.phase === "publish" || ctx.phase === "retry" || ctx.phase === "schedule") {
      const reservation = await this.deps.ops.findReservationByPublication(
        ctx.publication.id,
      );
      if (!reservation || reservation.status !== "ACTIVE") {
        issues.push({
          code: "RESERVATION_INACTIVE",
          message: `reservation=${reservation?.status ?? "missing"}`,
          blocking: true,
        });
      } else if (reservation.expiresAt.getTime() < this.now().getTime()) {
        issues.push({
          code: "RESERVATION_EXPIRED",
          message: "reservation expired",
          blocking: true,
        });
      }
    }

    // duplicate body
    const since = new Date(
      this.now().getTime() -
        this.deps.config.xPostBodyDuplicateLookbackDays * 24 * 60 * 60 * 1000,
    );
    for (const post of ctx.publication.posts) {
      const hash = post.bodyHash ?? hashNormalizedBody(post.body);
      const dup = await this.deps.ops.findBodyHashDuplicate({
        bodyHash: hash,
        since,
        excludePublicationId: ctx.publication.id,
      });
      if (dup) {
        issues.push({
          code: "DUPLICATE_BODY",
          message: `duplicate bodyHash with publication=${dup.publicationId}`,
          blocking: true,
        });
      }
    }

    // recommendation
    if (ctx.recommendationId && this.deps.optimization) {
      const rec = await this.deps.optimization.findRecommendationById(ctx.recommendationId);
      if (!rec || rec.status !== "APPROVED" && rec.status !== "APPLIED") {
        issues.push({
          code: "RECOMMENDATION_NOT_APPROVED",
          message: `recommendation status=${rec?.status ?? "missing"}`,
          blocking: true,
        });
      }
    }

    // release mode
    if (releaseMode === "DISABLED" && (ctx.phase === "publish" || ctx.phase === "retry")) {
      issues.push({
        code: "RELEASE_DISABLED",
        message: "X_RELEASE_MODE=DISABLED",
        blocking: true,
      });
    }

    if (releaseMode === "ALLOWLIST" || releaseMode === "LIMITED" || releaseMode === "FULL") {
      const allowedStrategies = this.deps.config.xReleaseAllowedStrategies;
      if (
        allowedStrategies.length > 0 &&
        !allowedStrategies.includes(ctx.publication.strategyType)
      ) {
        issues.push({
          code: "STRATEGY_NOT_ALLOWED",
          message: `strategy ${ctx.publication.strategyType} not in allowlist`,
          blocking: true,
        });
      }
      const allowedCandidates = this.deps.config.xReleaseAllowedCandidateTypes;
      if (
        allowedCandidates.length > 0 &&
        ctx.candidateType &&
        !allowedCandidates.includes(ctx.candidateType.toUpperCase())
      ) {
        issues.push({
          code: "CANDIDATE_TYPE_NOT_ALLOWED",
          message: `candidateType ${ctx.candidateType} not allowed`,
          blocking: true,
        });
      }
      const allowedAccounts = this.deps.config.xReleaseAllowedAccountIds;
      if (
        releaseMode === "ALLOWLIST" &&
        allowedAccounts.length > 0 &&
        ctx.accountId &&
        !allowedAccounts.includes(ctx.accountId)
      ) {
        issues.push({
          code: "ACCOUNT_NOT_ALLOWED",
          message: "account not in allowlist",
          blocking: true,
        });
      }
    }

    if (
      (releaseMode === "LIMITED" || releaseMode === "FULL" || releaseMode === "ALLOWLIST") &&
      (ctx.phase === "publish" || ctx.phase === "retry")
    ) {
      const hour = tokyoParts(this.now()).hour;
      const start = this.deps.config.xReleaseAllowedStartHourJst;
      const end = this.deps.config.xReleaseAllowedEndHourJst;
      if (hour < start || hour > end) {
        issues.push({
          code: "OUTSIDE_ALLOWED_HOURS",
          message: `hourJst=${hour} allowed=${start}-${end}`,
          blocking: true,
        });
      }

      const dayStart = tokyoDayStart(this.now());
      const hourStart = new Date(this.now());
      hourStart.setMinutes(0, 0, 0);
      const daily = await this.deps.ops.countPublishedPostsInRange({
        since: dayStart,
        until: this.now(),
        accountId: ctx.accountId,
      });
      const hourly = await this.deps.ops.countPublishedPostsInRange({
        since: hourStart,
        until: this.now(),
        accountId: ctx.accountId,
      });
      if (daily >= this.deps.config.xReleaseDailyPostLimit) {
        issues.push({
          code: "DAILY_LIMIT",
          message: `daily=${daily} limit=${this.deps.config.xReleaseDailyPostLimit}`,
          blocking: true,
        });
      }
      if (hourly >= this.deps.config.xReleaseHourlyPostLimit) {
        issues.push({
          code: "HOURLY_LIMIT",
          message: `hourly=${hourly} limit=${this.deps.config.xReleaseHourlyPostLimit}`,
          blocking: true,
        });
      }
    }

    if (killSwitch && (ctx.phase === "publish" || ctx.phase === "retry")) {
      issues.push({
        code: "KILL_SWITCH",
        message: "publishing paused by kill switch / runtime control",
        blocking: true,
      });
    }

    const policySkipCodes = new Set(["KILL_SWITCH", "RELEASE_DISABLED"]);
    const hardBlocking = issues.filter((i) => i.blocking && !policySkipCodes.has(i.code));
    const dryRun = releaseMode === "DRY_RUN";
    const policySkip =
      releaseMode === "DISABLED" ||
      (killSwitch && (ctx.phase === "publish" || ctx.phase === "retry"));
    const skipProvider = dryRun || policySkip || hardBlocking.length > 0;

    void hashProductKey;
    return {
      ok: hardBlocking.length === 0,
      issues,
      dryRun,
      skipProvider,
      releaseMode,
      killSwitch,
    };
  }
}

function tokyoDayStart(now: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  // JST midnight as UTC
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`);
}
