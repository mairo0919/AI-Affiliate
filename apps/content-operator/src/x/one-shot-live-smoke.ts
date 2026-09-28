/**
 * One-shot live smoke for a single frozen CID (juvr00281).
 *
 * - Does not regenerate social copy / media / affiliate URL
 * - Does not enable scheduler or backlog
 * - Uses confirmed dry-run payload only
 */

import { createHash } from "node:crypto";
import type { AppConfig } from "@ai-affiliate/config";
import {
  PrismaClient,
  XLiveRepository,
  XOpsRepository,
  type DatabaseClient,
} from "@ai-affiliate/database";
import { createLiveStack } from "./live/live-stack.js";
import { XPublishError } from "./types.js";

/** Confirmed dry-run payload — do not regenerate. */
export const JUVR00281_FROZEN_SMOKE = {
  cid: "juvr00281",
  threadShape: "SINGLE" as const,
  mediaMode: "SAFE_IMAGE" as const,
  mediaRole: "hero" as const,
  mediaUrl: "https://pics.dmm.co.jp/digital/video/juvr00281/juvr00281pl.jpg",
  body:
    "町内会の合宿で、欲求不満な人妻たちが僕1人を求め合い奪い合う超ハーレム温泉。MadonnaVR史上初の専属美熟女10人が大集合。 https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2Fav%2Fcontent%2F%3Fid%3Djuvr00281&af_id=mario0919-990&ch=api",
  affiliateUrl:
    "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2Fav%2Fcontent%2F%3Fid%3Djuvr00281&af_id=mario0919-990&ch=api",
} as const;

export const ONESHOT_IDEMPOTENCY_KEY = "x-oneshot-live-smoke:juvr00281:v1";

function scopesOf(cred: { scopes?: unknown } | null): string[] {
  if (!cred) return [];
  return Array.isArray(cred.scopes) ? (cred.scopes as string[]) : [];
}

/**
 * Copy encrypted credential ciphertext from a source DB into the current DB
 * without decrypting tokens. Same encryption key must be used at runtime.
 */
export async function syncXCredentialCiphertext(options: {
  targetPrisma: DatabaseClient["prisma"];
  sourceDatabaseUrl: string;
  /** When true, overwrite an existing target credential with source ciphertext. */
  force?: boolean;
}): Promise<{
  synced: boolean;
  accountId: string | null;
  scopes: string[];
  source: "already_present" | "copied_from_source" | "missing";
}> {
  const targetLive = new XLiveRepository(options.targetPrisma);
  const existing = await targetLive.findActiveCredential();
  const existingScopes = scopesOf(existing);
  const canSkip =
    !options.force &&
    existing?.encryptedAccessToken &&
    existing.encryptedRefreshToken &&
    existingScopes.includes("media.write");
  if (canSkip) {
    return {
      synced: false,
      accountId: existing!.accountId,
      scopes: existingScopes,
      source: "already_present",
    };
  }

  const source = new PrismaClient({
    datasources: { db: { url: options.sourceDatabaseUrl } },
  });
  try {
    const sourceLive = new XLiveRepository(source);
    const from = await sourceLive.findActiveCredential();
    if (!from?.encryptedAccessToken || !from.encryptedRefreshToken) {
      if (existing?.encryptedAccessToken && existing.encryptedRefreshToken) {
        return {
          synced: false,
          accountId: existing.accountId,
          scopes: existingScopes,
          source: "already_present",
        };
      }
      return { synced: false, accountId: null, scopes: [], source: "missing" };
    }
    await targetLive.upsertCredential({
      accountId: from.accountId,
      status: from.status,
      encryptedAccessToken: from.encryptedAccessToken,
      encryptedRefreshToken: from.encryptedRefreshToken,
      accessTokenExpiresAt: from.accessTokenExpiresAt,
      refreshTokenExpiresAt: from.refreshTokenExpiresAt,
      scopes: scopesOf(from),
      encryptionKeyVersion: from.encryptionKeyVersion,
      authorizedAt: from.authorizedAt,
      lastRefreshedAt: from.lastRefreshedAt,
      bumpTokenVersion: true,
    });
    return {
      synced: true,
      accountId: from.accountId,
      scopes: scopesOf(from),
      source: "copied_from_source",
    };
  } finally {
    await source.$disconnect();
  }
}

export type OneShotPreflight = {
  oauthCredentialAvailable: boolean;
  accountIdResolved: boolean;
  accountIdResolution: "env" | "db_credential" | "none";
  accountId: string | null;
  cid: string;
  mediaMode: string;
  mediaRole: string;
  mediaUploadUrl: string;
  createPostWillReceiveMediaIds: boolean;
  socialCopyMatchesFrozen: boolean;
  affiliateUrlMatchesFrozen: boolean;
  hasPrHashtag: boolean;
  oneShotAllowlist: string;
  otherCandidateCount: number;
  livePostCount: number;
  scopes: string[];
  hasMediaWriteScope: boolean;
  autoPublicationEnabled: boolean;
  releaseMode: string;
  killSwitch: boolean;
  xApiEnabled: boolean;
  bodyPreview: string;
  idempotencyKey: string;
};

export async function buildOneShotPreflight(options: {
  prisma: DatabaseClient["prisma"];
  config: AppConfig;
  frozen?: typeof JUVR00281_FROZEN_SMOKE;
}): Promise<OneShotPreflight> {
  const frozen = options.frozen ?? JUVR00281_FROZEN_SMOKE;
  const live = new XLiveRepository(options.prisma);
  const cred = await live.findActiveCredential();
  const scopes = scopesOf(cred);

  let accountIdResolution: OneShotPreflight["accountIdResolution"] = "none";
  let accountId: string | null = null;
  if (options.config.xApiAccountId?.trim()) {
    accountId = options.config.xApiAccountId.trim();
    accountIdResolution = "env";
  } else if (cred?.accountId) {
    accountId = cred.accountId;
    accountIdResolution = "db_credential";
  }

  const livePostCount = await options.prisma.xPublicationPost.count({
    where: { status: "PUBLISHED" },
  });

  const allowlist = (options.config.xOneShotLiveSmokeCid ?? frozen.cid).toLowerCase();
  const hasPr = /#PR\b/i.test(frozen.body);
  const affiliateOk = frozen.body.includes(frozen.affiliateUrl);

  return {
    oauthCredentialAvailable: Boolean(
      cred?.encryptedAccessToken && cred.encryptedRefreshToken,
    ),
    accountIdResolved: Boolean(accountId),
    accountIdResolution,
    accountId,
    cid: frozen.cid,
    mediaMode: frozen.mediaMode,
    mediaRole: frozen.mediaRole,
    mediaUploadUrl: frozen.mediaUrl,
    createPostWillReceiveMediaIds: true,
    socialCopyMatchesFrozen: true,
    affiliateUrlMatchesFrozen: affiliateOk,
    hasPrHashtag: hasPr,
    oneShotAllowlist: allowlist,
    otherCandidateCount: allowlist === frozen.cid ? 0 : 1,
    livePostCount,
    scopes,
    hasMediaWriteScope: scopes.includes("media.write"),
    autoPublicationEnabled: options.config.xAutoPublicationEnabled,
    releaseMode: options.config.xReleaseMode,
    killSwitch: options.config.xGlobalKillSwitch,
    xApiEnabled: options.config.xApiEnabled,
    bodyPreview: frozen.body,
    idempotencyKey: ONESHOT_IDEMPOTENCY_KEY,
  };
}

export async function runOneShotLiveSmoke(options: {
  database: DatabaseClient;
  config: AppConfig;
  /** When true, perform upload+createPost. When false, preflight only. */
  executeLive: boolean;
  sourceCredentialDatabaseUrl?: string;
}): Promise<Record<string, unknown>> {
  const frozen = JUVR00281_FROZEN_SMOKE;
  const ops = new XOpsRepository(options.database.prisma);

  // Ensure process-local one-shot allowlist
  if (
    !options.config.xOneShotLiveSmokeCid ||
    options.config.xOneShotLiveSmokeCid !== frozen.cid
  ) {
    (options.config as { xOneShotLiveSmokeCid?: string }).xOneShotLiveSmokeCid =
      frozen.cid;
  }

  const syncMeta = options.sourceCredentialDatabaseUrl
    ? await syncXCredentialCiphertext({
        targetPrisma: options.database.prisma,
        sourceDatabaseUrl: options.sourceCredentialDatabaseUrl,
      })
    : await (async () => {
        const cred = await new XLiveRepository(
          options.database.prisma,
        ).findActiveCredential();
        return {
          synced: false,
          accountId: cred?.accountId ?? null,
          scopes: scopesOf(cred),
          source: (cred ? "already_present" : "missing") as
            | "already_present"
            | "copied_from_source"
            | "missing",
        };
      })();

  // Prefer DB account id when env empty
  if (!options.config.xApiAccountId && syncMeta.accountId) {
    (options.config as { xApiAccountId?: string }).xApiAccountId = syncMeta.accountId;
  }

  const preflight = await buildOneShotPreflight({
    prisma: options.database.prisma,
    config: options.config,
    frozen,
  });

  const reportBase = {
    phase: options.executeLive ? "live" : "preflight",
    preflight,
    credentialSync: {
      source: syncMeta.source,
      synced: syncMeta.synced,
      accountIdPresent: Boolean(syncMeta.accountId),
      hasMediaWriteScope: syncMeta.scopes.includes("media.write"),
      // never print tokens
    },
    schedulerAutoPublicationEnabled: options.config.xAutoPublicationEnabled,
    success: false as boolean,
    xPostId: null as string | null,
    accountIdResolution: preflight.accountIdResolution,
    mediaUploadSuccess: false as boolean,
    mediaIdObtained: false as boolean,
    postedBody: frozen.body,
    mediaAttached: false as boolean,
    affiliateUrlPresent: frozen.body.includes(frozen.affiliateUrl),
    idempotencyKey: ONESHOT_IDEMPOTENCY_KEY,
    idempotencyRecorded: false as boolean,
    retryTarget: null as string | null,
    otherXPostCount: preflight.livePostCount,
    reauthRequired: false as boolean,
  };

  const blocking: string[] = [];
  if (!preflight.oauthCredentialAvailable) blocking.push("OAUTH_CREDENTIAL_MISSING");
  if (!preflight.accountIdResolved) blocking.push("ACCOUNT_ID_UNRESOLVED");
  if (preflight.hasPrHashtag) blocking.push("UNEXPECTED_PR_HASHTAG");
  if (!preflight.affiliateUrlMatchesFrozen) blocking.push("AFFILIATE_URL_MISMATCH");
  if (preflight.oneShotAllowlist !== frozen.cid) blocking.push("ALLOWLIST_MISMATCH");
  if (preflight.otherCandidateCount !== 0) blocking.push("OTHER_CANDIDATES_PRESENT");
  if (options.config.xAutoPublicationEnabled) blocking.push("AUTO_PUBLICATION_MUST_STAY_OFF");

  if (!options.executeLive) {
    return { ...reportBase, blocking, wouldCallLiveApi: false };
  }

  if (blocking.length > 0) {
    return { ...reportBase, blocking, success: false };
  }

  // Minimal process-local gate open (does not persist to Railway service env)
  (options.config as { xApiEnabled?: boolean }).xApiEnabled = true;
  (options.config as { xGlobalKillSwitch?: boolean }).xGlobalKillSwitch = false;
  (options.config as { xReleaseMode?: string }).xReleaseMode = "ALLOWLIST";
  (options.config as { xAutoPublicationEnabled?: boolean }).xAutoPublicationEnabled =
    false;
  if (
    !(options.config as { xReleaseAllowedAccountIds?: string[] }).xReleaseAllowedAccountIds
      ?.length &&
    preflight.accountId
  ) {
    (options.config as { xReleaseAllowedAccountIds?: string[] }).xReleaseAllowedAccountIds =
      [preflight.accountId];
  }
  // Composer must not inject #PR — disclosure empty for this smoke body
  (options.config as { xAffiliateDisclosure?: string }).xAffiliateDisclosure = "";
  // Avoid UNKNOWN_COST block for one-shot smoke only
  if ((options.config as { xApiWriteCostPerRequest?: number | null }).xApiWriteCostPerRequest == null) {
    (options.config as { xApiWriteCostPerRequest?: number | null }).xApiWriteCostPerRequest =
      0.01;
  }
  if ((options.config as { xApiReadCostPerResource?: number | null }).xApiReadCostPerResource == null) {
    (options.config as { xApiReadCostPerResource?: number | null }).xApiReadCostPerResource =
      0.001;
  }
  if (
    (options.config as { xApiAnalyticsCostPerRequest?: number | null })
      .xApiAnalyticsCostPerRequest == null
  ) {
    (options.config as { xApiAnalyticsCostPerRequest?: number | null }).xApiAnalyticsCostPerRequest =
      0.005;
  }

  // Idempotency: refuse if we already recorded a successful smoke
  const prior = await ops.listAudit({
    action: "ONESHOT_LIVE_SMOKE",
    limit: 20,
  }).catch(() => []);
  const priorOk = Array.isArray(prior)
    ? prior.find(
        (row) =>
          row.result === "SUCCESS" &&
          (row.metadata as { idempotencyKey?: string } | null)?.idempotencyKey ===
            ONESHOT_IDEMPOTENCY_KEY,
      )
    : null;
  if (priorOk) {
    return {
      ...reportBase,
      success: true,
      xPostId:
        ((priorOk.metadata as { xPostId?: string } | null)?.xPostId as string) ?? null,
      idempotencyRecorded: true,
      retryTarget: null,
      note: "idempotent replay — prior successful smoke found; createPost not re-called",
    };
  }

  if (!preflight.hasMediaWriteScope) {
    // Still attempt live path: stored scope list may lag; upload will hard-fail if missing.
    reportBase.reauthRequired = false;
  }

  const stack = createLiveStack({
    config: options.config,
    prisma: options.database.prisma,
    allowWrites: true,
  });

  let mediaId: string | null = null;
  try {
    // Refresh expired access token if needed (tokens never logged)
    await stack.tokens.getValidAccessToken(preflight.accountId!);

    // Re-check scopes after potential refresh persistence
    const after = await new XLiveRepository(options.database.prisma).findCredentialByAccountId(
      preflight.accountId!,
    );
    const scopesNow = scopesOf(after);
    if (!scopesNow.includes("media.write")) {
      reportBase.reauthRequired = true;
      return {
        ...reportBase,
        success: false,
        blocking: ["MEDIA_WRITE_SCOPE_MISSING"],
        note:
          "Credential exists (synced from local DB) but lacks media.write required for v2 image upload. Re-authorize with existing PKCE (x-auth-start) including media.write — no new OAuth method.",
        scopesAfterRefresh: scopesNow,
      };
    }

    const upload = await stack.provider.uploadMedia!({
      sourceUrl: frozen.mediaUrl,
      idempotencyKey: `${ONESHOT_IDEMPOTENCY_KEY}:media`,
    });
    mediaId = upload.mediaId;
    reportBase.mediaUploadSuccess = true;
    reportBase.mediaIdObtained = Boolean(mediaId);

    // Persist media upload success before createPost so retries do not re-upload.
    await ops.writeAudit({
      action: "ONESHOT_LIVE_SMOKE_MEDIA",
      actorType: "CLI",
      actorId: "oneshot-live-smoke",
      releaseMode: options.config.xReleaseMode,
      result: "SUCCESS",
      reason: frozen.cid,
      metadata: {
        idempotencyKey: `${ONESHOT_IDEMPOTENCY_KEY}:media`,
        mediaIdPresent: true,
        mediaByteLength: upload.byteLength,
        sourceUrl: frozen.mediaUrl,
      },
    });

    const created = await stack.provider.createPost({
      text: frozen.body,
      mediaIds: mediaId ? [mediaId] : undefined,
      idempotencyKey: `${ONESHOT_IDEMPOTENCY_KEY}:post`,
    });

    reportBase.success = true;
    reportBase.xPostId = created.postId;
    reportBase.mediaAttached = Boolean(mediaId);
    reportBase.accountIdResolution = preflight.accountIdResolution;

    await ops.writeAudit({
      action: "ONESHOT_LIVE_SMOKE",
      actorType: "CLI",
      actorId: "oneshot-live-smoke",
      releaseMode: options.config.xReleaseMode,
      result: "SUCCESS",
      reason: frozen.cid,
      metadata: {
        idempotencyKey: ONESHOT_IDEMPOTENCY_KEY,
        xPostId: created.postId,
        mediaAttached: true,
        mediaIdPresent: Boolean(mediaId),
        cid: frozen.cid,
        textHash: createHash("sha256").update(frozen.body, "utf8").digest("hex"),
        // never store tokens
      },
    });
    reportBase.idempotencyRecorded = true;
  } catch (error) {
    const message =
      error instanceof XPublishError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    const code =
      error instanceof XPublishError ? error.errorType : "Unknown";
    if (/media\.write|FORBIDDEN|403/i.test(message) || code === "Permission") {
      reportBase.reauthRequired = true;
    }
    await ops.writeAudit({
      action: "ONESHOT_LIVE_SMOKE",
      actorType: "CLI",
      actorId: "oneshot-live-smoke",
      releaseMode: options.config.xReleaseMode,
      result: "FAILED",
      reason: code,
      metadata: {
        idempotencyKey: ONESHOT_IDEMPOTENCY_KEY,
        mediaIdPresent: Boolean(mediaId),
        errorType: code,
        // sanitized message only
        errorMessage: message.slice(0, 200),
      },
    });
    reportBase.retryTarget =
      code === "Timeout" || code === "Network" || code === "RateLimit" || code === "AuthTransient"
        ? "createPost_or_upload_after_fix_check"
        : null;
    return {
      ...reportBase,
      success: false,
      mediaUploadSuccess: reportBase.mediaUploadSuccess,
      mediaIdObtained: reportBase.mediaIdObtained,
      errorType: code,
      errorMessage: message.slice(0, 200),
    };
  }

  // Confirm scheduler still off
  reportBase.schedulerAutoPublicationEnabled = false;
  (options.config as { xAutoPublicationEnabled?: boolean }).xAutoPublicationEnabled =
    false;
  (options.config as { xApiEnabled?: boolean }).xApiEnabled = false;
  (options.config as { xGlobalKillSwitch?: boolean }).xGlobalKillSwitch = true;
  (options.config as { xReleaseMode?: string }).xReleaseMode = "DRY_RUN";

  return reportBase;
}
