/**
 * Railway production readiness — presence/validation only.
 * Never prints secret values. Never publishes Blog/X.
 *
 *   npx tsx src/ops/r-railway-production-readiness.ts
 *   railway run -s scheduler -- npx tsx src/ops/r-railway-production-readiness.ts
 */
import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient } from "@ai-affiliate/database";
import { loadDailyMultiChannelConfig } from "../daily-ops/config.js";

function present(v: string | undefined | null): boolean {
  return Boolean(v && String(v).trim());
}

async function main() {
  const config = loadConfig({ requireDatabaseUrl: false });
  const daily = loadDailyMultiChannelConfig();

  const presence = {
    DATABASE_URL: present(process.env.DATABASE_URL),
    DMM_API_ID: present(process.env.DMM_API_ID),
    DMM_AFFILIATE_ID: present(process.env.DMM_AFFILIATE_ID),
    LLM_API_KEY: present(process.env.LLM_API_KEY) || present(process.env.OPENAI_API_KEY),
    BLOGGER_CLIENT_ID: present(config.bloggerClientId),
    BLOGGER_CLIENT_SECRET: present(config.bloggerClientSecret),
    BLOGGER_REFRESH_TOKEN: present(config.bloggerRefreshToken),
    BLOGGER_BLOG_ID: present(config.bloggerBlogId),
    X_API_CLIENT_ID: present(process.env.X_API_CLIENT_ID),
    X_API_CLIENT_SECRET: present(process.env.X_API_CLIENT_SECRET),
    X_API_ACCESS_TOKEN: present(process.env.X_API_ACCESS_TOKEN),
    X_API_REFRESH_TOKEN: present(process.env.X_API_REFRESH_TOKEN),
    X_API_ACCOUNT_ID: present(process.env.X_API_ACCOUNT_ID),
  };

  const flags = {
    APP_ROLE: process.env.APP_ROLE ?? null,
    NODE_ENV: config.nodeEnv,
    timezone: config.publicationTimezone,
    dailyBlogArticles: daily.blogArticlesPerDay,
    dailyXPosts: daily.xPostsPerDay,
    dailyOpsEnabled: daily.enabled,
    dailyOpsDryRun: daily.dryRun,
    bloggerMode: config.bloggerMode,
    bloggerAllowDirectPublish: config.bloggerAllowDirectPublish,
    bloggerAllowExternal: config.bloggerAllowExternalRequests,
    xApiEnabled: config.xApiEnabled,
    xAutoPublicationEnabled: config.xAutoPublicationEnabled,
    analysisAutoRun: config.analysisAutoRunEnabled,
    contentAutoGeneration: config.contentAutoGenerationEnabled,
  };

  let db: { ok: boolean; error?: string } = { ok: false };
  if (presence.DATABASE_URL) {
    try {
      const database = createDatabaseClient();
      await database.connect();
      await database.prisma.$queryRaw`SELECT 1`;
      await database.disconnect();
      db = { ok: true };
    } catch (e) {
      db = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    db = { ok: false, error: "DATABASE_URL missing" };
  }

  let bloggerToken: { ok: boolean; httpStatus?: number; error?: string | null } = {
    ok: false,
    error: "skipped",
  };
  if (
    presence.BLOGGER_CLIENT_ID &&
    presence.BLOGGER_CLIENT_SECRET &&
    presence.BLOGGER_REFRESH_TOKEN &&
    config.bloggerAllowExternalRequests
  ) {
    try {
      const body = new URLSearchParams({
        client_id: config.bloggerClientId!,
        client_secret: config.bloggerClientSecret!,
        refresh_token: config.bloggerRefreshToken!,
        grant_type: "refresh_token",
      });
      const res = await fetch(config.bloggerOAuthTokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          error_description?: string;
        };
        bloggerToken = {
          ok: false,
          httpStatus: res.status,
          error: [j.error, j.error_description].filter(Boolean).join(": ") || `http_${res.status}`,
        };
      } else {
        const j = (await res.json()) as { access_token?: string };
        bloggerToken = { ok: Boolean(j.access_token), httpStatus: res.status, error: null };
      }
    } catch (e) {
      bloggerToken = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const blockers: string[] = [];
  if (!presence.DATABASE_URL) blockers.push("DATABASE_URL");
  if (!db.ok) blockers.push("DB_CONNECT");
  if (!presence.DMM_API_ID || !presence.DMM_AFFILIATE_ID) blockers.push("FANZA_DMM_CREDENTIALS");
  if (!presence.LLM_API_KEY) blockers.push("OPENAI_LLM_CREDENTIAL");
  if (!bloggerToken.ok) blockers.push("BLOGGER_TOKEN_REFRESH");
  if (!presence.X_API_CLIENT_ID || !presence.X_API_ACCESS_TOKEN) blockers.push("X_API_CREDENTIALS");
  if (!flags.dailyOpsEnabled) blockers.push("DAILY_OPS_ENABLED_FALSE");
  if (flags.dailyOpsDryRun) blockers.push("DAILY_OPS_DRY_RUN_TRUE");
  if (!flags.bloggerAllowDirectPublish) blockers.push("BLOGGER_DIRECT_PUBLISH_DISABLED");
  if (!flags.xAutoPublicationEnabled) blockers.push("X_AUTO_PUBLICATION_DISABLED");
  blockers.push("DAILY_BLOG_PHASE_NOT_WIRED_TO_SCHEDULER_PIPELINE");
  blockers.push("RAILWAY_FIRST_BLOG_X_PRODUCTION_RUN_PENDING");

  const report = {
    round: "railway-production",
    presence,
    flags,
    db,
    bloggerToken: {
      ok: bloggerToken.ok,
      httpStatus: bloggerToken.httpStatus ?? null,
      error: bloggerToken.error ?? null,
    },
    blockers,
    DAILY_AUTOMATION_READY: false,
    note: "Secrets never printed. Ready only after Railway deploy + Blog=1 + X=1 production success.",
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.DAILY_AUTOMATION_READY ? 0 : 2;
}

main().catch((e) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        DAILY_AUTOMATION_READY: false,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
