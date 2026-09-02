/**
 * WordPress live / batch publish CLI.
 *
 * Mode resolution (never uses LIVE_CONFIRM alone to choose publish):
 *   1. WORDPRESS_PUBLISH_MODE if set to publish|draft
 *   2. else WORDPRESS_DEFAULT_PUBLISH_MODE
 *   3. else draft
 *
 * Live publish (status=publish) requires ALL of:
 *   WORDPRESS_PUBLISH_MODE=publish
 *   WORDPRESS_ALLOW_DIRECT_PUBLISH=true
 *   WORDPRESS_LIVE_CONFIRM=1
 *
 * Safe draft example:
 *   CONTENT_VERSION_ID=... WORDPRESS_LIVE_CONFIRM=1 WORDPRESS_LIVE_LIMIT=1 \
 *     WORDPRESS_PUBLISH_MODE=draft pnpm wordpress:live:publish
 *
 * Mock / dry-run (no confirm needed when mode=mock or DRY_RUN=1):
 *   WORDPRESS_MODE=mock CONTENT_VERSION_ID=... node dist/ops/wordpress-live-publish.js
 */
import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import {
  assertWordPressLivePublishAllowed,
  createDefaultWordPressPublisher,
  resolveWordPressPublishMode,
  runWordPressPublicationBatch,
} from "../wordpress/wordpress-publish-path.js";

function parseIds(): string[] {
  const multi = process.env.CONTENT_VERSION_IDS?.trim();
  if (multi) {
    return multi
      .split(/[, \s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const one = process.env.CONTENT_VERSION_ID?.trim();
  return one ? [one] : [];
}

function parseExplicitPublishMode(): "publish" | "draft" | undefined {
  const modeEnv = process.env.WORDPRESS_PUBLISH_MODE?.trim().toLowerCase();
  if (modeEnv === "publish" || modeEnv === "draft") return modeEnv;
  return undefined;
}

async function main() {
  const config = loadConfig();
  const ids = parseIds();
  if (ids.length === 0) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "CONTENT_VERSION_ID or CONTENT_VERSION_IDS required",
      }),
    );
    process.exit(2);
  }

  const dryRun = process.env.WORDPRESS_DRY_RUN === "1" || process.env.DRY_RUN === "1";
  const confirm = process.env.WORDPRESS_LIVE_CONFIRM === "1";
  const limit = Math.max(
    1,
    Number.parseInt(process.env.WORDPRESS_LIVE_LIMIT ?? "1", 10) || 1,
  );
  const explicitMode = parseExplicitPublishMode();
  const mode = resolveWordPressPublishMode({
    explicitMode: explicitMode ?? null,
    defaultPublishMode: config.wordpressDefaultPublishMode,
  });

  if (config.wordpressMode === "api" && !dryRun && !confirm) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "WORDPRESS_LIVE_CONFIRM=1 required for api mode (safety)",
        wordpressMode: config.wordpressMode,
        hint: "Set WORDPRESS_LIVE_CONFIRM=1 after Application Password is ready",
      }),
    );
    process.exit(2);
  }

  const publishGate = assertWordPressLivePublishAllowed({
    mode,
    explicitPublishMode: explicitMode === "publish",
    allowDirectPublish: config.wordpressAllowDirectPublish,
    liveConfirm: confirm,
  });
  if (!publishGate.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: publishGate.reason,
        mode,
        hint:
          "Live publish requires WORDPRESS_PUBLISH_MODE=publish AND WORDPRESS_ALLOW_DIRECT_PUBLISH=true AND WORDPRESS_LIVE_CONFIRM=1",
      }),
    );
    process.exit(2);
  }

  const database = createDatabaseClient();
  await database.connect();
  const lifecycle = new LifecycleRepository(database.prisma);
  // Confirm may enable outbound API for this CLI session; never flip allowDirectPublish
  // solely because LIVE_CONFIRM=1.
  const publisher = createDefaultWordPressPublisher({
    ...config,
    wordpressAllowExternalRequests:
      config.wordpressMode === "mock"
        ? config.wordpressAllowExternalRequests
        : confirm
          ? true
          : config.wordpressAllowExternalRequests,
  });

  const canonicalById = new Map<string, string>();
  if (process.env.CANONICAL_ID?.trim() && ids.length === 1) {
    canonicalById.set(ids[0]!, process.env.CANONICAL_ID.trim());
  }

  const batch = await runWordPressPublicationBatch(
    {
      config: {
        ...config,
        wordpressAllowExternalRequests:
          config.wordpressMode === "mock" || confirm
            ? true
            : config.wordpressAllowExternalRequests,
      },
      lifecycle,
      publisher,
      prisma: database.prisma,
    },
    {
      contentVersionIds: ids,
      limit,
      mode,
      dryRun,
      route: "WORDPRESS_LIVE_CLI",
      resolveCanonicalId: (id) => canonicalById.get(id) ?? null,
    },
  );

  console.log(
    JSON.stringify(
      {
        ok: batch.failed === 0,
        platform: "WORDPRESS",
        wordpressMode: config.wordpressMode,
        publishMode: mode,
        dryRun,
        limit,
        ...batch,
      },
      null,
      2,
    ),
  );

  await database.disconnect();
  process.exitCode = batch.failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      ok: false,
      reason: "CLI_ERROR",
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
});
