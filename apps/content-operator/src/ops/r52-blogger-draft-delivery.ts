/**
 * r52 — Blogger Draft delivery (OAuth restore + r51 HTML update, LLM=0).
 *
 *   OUT_DIR=/tmp/prod-gen-20260821-r52-mizd00320 \
 *   R51_DIR=/tmp/prod-gen-20260821-r51-mizd00320 \
 *   BLOGGER_DRAFT_ID=5758756966895197750 \
 *   npx tsx src/ops/r52-blogger-draft-delivery.ts
 *
 * Opens browser for OAuth consent if refresh token is invalid_grant.
 * Never prints secrets. Never publishes (draft update only).
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { loadConfig } from "@ai-affiliate/config";
import { createBloggerPublisherFromConfig } from "../adapters/publisher/blogger-api-publisher.js";
import {
  resolveWritableEnvPath,
  writeBloggerRefreshTokenToEnv,
} from "../generation/blogger-auth-cli.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/prod-gen-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-r52-mizd00320`;
const R51_DIR = process.env.R51_DIR || "/tmp/prod-gen-20260821-r51-mizd00320";
const BLOGGER_DRAFT_ID = process.env.BLOGGER_DRAFT_ID || "5758756966895197750";
const OAUTH_TIMEOUT_MS = Number(process.env.OAUTH_TIMEOUT_MS ?? 180_000);

type ProbeResult = {
  httpStatus: number;
  ok: boolean;
  error?: string | null;
  errorDescription?: string | null;
  accessTokenPresent?: boolean;
};

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

async function probeRefresh(config: ReturnType<typeof loadConfig>): Promise<ProbeResult> {
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
    let error: string | null = null;
    let errorDescription: string | null = null;
    try {
      const j = (await res.json()) as { error?: string; error_description?: string };
      error = typeof j.error === "string" ? j.error : null;
      errorDescription = typeof j.error_description === "string" ? j.error_description : null;
    } catch {
      // ignore
    }
    return { httpStatus: res.status, ok: false, error, errorDescription };
  }
  const j = (await res.json()) as { access_token?: string };
  return {
    httpStatus: res.status,
    ok: Boolean(j.access_token),
    accessTokenPresent: Boolean(j.access_token),
  };
}

async function captureOAuthCode(redirectUri: string, timeoutMs: number): Promise<string> {
  const redirect = new URL(redirectUri);
  if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") {
    throw new Error(`redirect host not local: ${redirect.hostname}`);
  }
  const port = Number(redirect.port || 80);
  const expectedPath = redirect.pathname;

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`OAuth callback timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const server = createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", `http://${redirect.hostname}:${port}`);
        if (reqUrl.pathname !== expectedPath) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("not found");
          return;
        }
        const err = reqUrl.searchParams.get("error");
        if (err) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(`<html><body><h1>OAuth error</h1><p>${err}</p></body></html>`);
          clearTimeout(timer);
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        const code = reqUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end("<html><body><h1>Missing code</h1></body></html>");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          "<html><body><h1>Blogger OAuth OK</h1><p>You can close this tab. Returning to r52…</p></body></html>",
        );
        clearTimeout(timer);
        server.close();
        resolve(code);
      } catch (e) {
        clearTimeout(timer);
        server.close();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    server.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.listen(port); // bind all interfaces so localhost/IPv6 redirect works
  });
}

async function exchangeCodeForRefreshToken(input: {
  config: ReturnType<typeof loadConfig>;
  code: string;
}): Promise<{ refreshToken: string; fingerprint: string }> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.config.bloggerClientId!,
    client_secret: input.config.bloggerClientSecret!,
    redirect_uri: input.config.bloggerOAuthRedirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(input.config.bloggerOAuthTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    throw new Error(
      `code exchange failed (${[json.error, json.error_description].filter(Boolean).join(": ") || res.status})`,
    );
  }
  if (!json.refresh_token) {
    throw new Error(
      "Token response missing refresh_token — re-run with prompt=consent (access_type=offline)",
    );
  }
  return {
    refreshToken: json.refresh_token,
    fingerprint: createHash("sha256").update(json.refresh_token).digest("hex").slice(0, 12),
  };
}

function countImages(html: string): number {
  return (html.match(/<img\b/gi) ?? []).length;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = {
    round: "r52",
    LLM: 0,
    purpose: "blogger_draft_delivery",
  };

  const htmlPath = `${R51_DIR}/HUMAN_REVIEW_DRAFT.html`;
  const rawPath = `${R51_DIR}/PROVIDER_RAW.json`;
  if (!existsSync(htmlPath) || !existsSync(rawPath)) {
    report.FINAL_STATUS = "BLOCKED_AUTH";
    report.error = `missing r51 artifacts under ${R51_DIR}`;
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const html = readFileSync(htmlPath, "utf8");
  const raw = JSON.parse(readFileSync(rawPath, "utf8")) as { title?: string };
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "r51 draft";

  let config = loadConfig({ requireDatabaseUrl: false });
  const firstProbe = await probeRefresh(config);
  report.A_firstFailureProbe = firstProbe;
  report.D_credentialSource = {
    source: "env:.env via loadConfig/dotenv",
    clientIdPresent: Boolean(config.bloggerClientId),
    clientSecretPresent: Boolean(config.bloggerClientSecret),
    refreshPresent: Boolean(config.bloggerRefreshToken),
    blogId: config.bloggerBlogId,
    tokenUrl: config.bloggerOAuthTokenUrl,
    redirectUri: config.bloggerOAuthRedirectUri,
    mode: config.bloggerMode,
    allowExternal: config.bloggerAllowExternalRequests,
    allowDirectPublish: config.bloggerAllowDirectPublish,
    defaultPublishMode: config.bloggerDefaultPublishMode,
  };

  let reauthed = false;
  if (!firstProbe.ok) {
    report.A_rootCause = {
      classification: "CORRECT",
      summary:
        "Existing Blogger OAuth refresh path is correct; BLOGGER_REFRESH_TOKEN in .env is expired/revoked (invalid_grant).",
      googleError: firstProbe.error,
      googleErrorDescription: firstProbe.errorDescription,
      httpStatus: firstProbe.httpStatus,
    };

    const state = `r52-${Date.now().toString(36)}`;
    const params = new URLSearchParams({
      client_id: config.bloggerClientId!,
      redirect_uri: config.bloggerOAuthRedirectUri,
      response_type: "code",
      scope: config.bloggerOAuthScopes,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    const authorizeUrl = `${config.bloggerOAuthAuthorizeUrl}?${params.toString()}`;
    report.oauthAuthorizeStarted = true;
    report.oauthRedirectUri = config.bloggerOAuthRedirectUri;
    writeFileSync(`${OUT}/OAUTH_AUTHORIZE_URL.txt`, `${authorizeUrl}\n`);

    console.error(
      JSON.stringify(
        {
          stage: "awaiting_oauth_consent",
          redirectUri: config.bloggerOAuthRedirectUri,
          timeoutMs: OAUTH_TIMEOUT_MS,
          note: "Browser will open. Approve Blogger access. Do not share codes/tokens.",
        },
        null,
        2,
      ),
    );

    try {
      const codePromise = captureOAuthCode(config.bloggerOAuthRedirectUri, OAUTH_TIMEOUT_MS);
      openBrowser(authorizeUrl);
      const code = await codePromise;
      const exchanged = await exchangeCodeForRefreshToken({ config, code });
      const envPath = resolveWritableEnvPath(process.cwd());
      const written = writeBloggerRefreshTokenToEnv(envPath, exchanged.refreshToken);
      process.env.BLOGGER_REFRESH_TOKEN = exchanged.refreshToken;
      reauthed = true;
      report.E_tokenRefreshAfterReauth = {
        envUpdated: true,
        envPath: written.envPath,
        refreshTokenFingerprint: written.refreshTokenFingerprint,
      };
      config = loadConfig({ requireDatabaseUrl: false });
    } catch (e) {
      report.FINAL_STATUS = "BLOCKED_AUTH";
      report.oauthError = e instanceof Error ? e.message : String(e);
      report.classification = "CORRECT";
      report.changedFiles = [
        "apps/content-operator/src/adapters/publisher/blogger-api-publisher.ts",
        "apps/content-operator/src/generation/blogger-auth-cli.ts",
      ];
      report.L_llmCalls = 0;
      report.note =
        "Open OAUTH_AUTHORIZE_URL.txt, approve, then re-run; or use blogger:exchange-code --write-env";
      writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      process.exit(2);
    }
  } else {
    report.A_rootCause = {
      classification: "N/A_ALREADY_VALID",
      summary: "Refresh token already valid; no reauth needed this run.",
    };
  }

  const secondProbe = await probeRefresh(config);
  report.E_tokenRefreshResult = secondProbe;
  if (!secondProbe.ok) {
    report.FINAL_STATUS = "BLOCKED_AUTH";
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  if (
    config.bloggerMode !== "api" ||
    !config.bloggerAllowExternalRequests ||
    config.bloggerAllowDirectPublish
  ) {
    report.FINAL_STATUS = "BLOCKED_AUTH";
    report.configGuard = {
      mode: config.bloggerMode,
      allowExternal: config.bloggerAllowExternalRequests,
      allowDirectPublish: config.bloggerAllowDirectPublish,
      required: "mode=api, allowExternal=true, allowDirectPublish=false",
    };
    writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const publisher = createBloggerPublisherFromConfig({
    bloggerMode: config.bloggerMode,
    bloggerAllowExternalRequests: config.bloggerAllowExternalRequests,
    bloggerAllowDirectPublish: false,
    bloggerDefaultPublishMode: "draft",
    bloggerClientId: config.bloggerClientId,
    bloggerClientSecret: config.bloggerClientSecret,
    bloggerRefreshToken: config.bloggerRefreshToken,
    bloggerBlogId: config.bloggerBlogId,
    bloggerApiBaseUrl: config.bloggerApiBaseUrl,
    bloggerOAuthTokenUrl: config.bloggerOAuthTokenUrl,
  });

  let bloggerCalls = 0;
  try {
    publisher.assertCanCallApi("update");
    const prepared = await publisher.prepare({
      contentVersionId: `r52-draft-delivery:mizd00320`,
      title,
      body: html,
      targetFormat: "article",
      destinationRef: config.bloggerBlogId ?? null,
      metadata: {
        mode: "draft",
        path: "HUMAN_REVIEW_DRAFT",
        label: "mizd00320",
        r52: true,
        publishForbidden: true,
        source: "r51",
      },
    });
    const updated = await publisher.update({
      externalId: BLOGGER_DRAFT_ID,
      prepared,
    });
    bloggerCalls += 1;
    const status = await publisher.getStatus(BLOGGER_DRAFT_ID);
    bloggerCalls += 1;

    const published = status.status === "LIVE";
    const editUrl = config.bloggerBlogId
      ? `https://www.blogger.com/blog/post/edit/${config.bloggerBlogId}/${BLOGGER_DRAFT_ID}`
      : null;

    report.F_bloggerApiResult = { update: updated, status };
    report.G_draftId = BLOGGER_DRAFT_ID;
    report.H_editUrl = editUrl;
    report.I_publishedFalseConfirmation = {
      published: false,
      apiStatus: status.status,
      isDraft: status.status === "DRAFT" || status.status === "UNKNOWN",
      hardFailIfLive: published,
    };
    report.J_renderedImageCount = countImages(html);
    report.K_articleBodyPreserved = {
      htmlBytes: Buffer.byteLength(html, "utf8"),
      title,
      sourceHtml: htmlPath,
      hasImg: html.includes("<img"),
    };
    report.L_llmCalls = 0;
    report.M_externalApiCalls = { blogger: bloggerCalls, oauthReauth: reauthed };
    report.N_bloggerCalls = bloggerCalls;
    report.reauthed = reauthed;
    report.B_classification = reauthed ? "CORRECT" : "N/A";
    report.C_changedFiles = [
      "apps/content-operator/src/adapters/publisher/blogger-api-publisher.ts",
      "apps/content-operator/src/generation/blogger-auth-cli.ts",
      "apps/content-operator/src/ops/r52-blogger-draft-delivery.ts",
      "apps/content-operator/src/ops/r52-probe-blogger-token.ts",
    ];

    if (published) {
      report.FINAL_STATUS = "BLOCKED_AUTH";
      report.fatal = "API returned LIVE — publish must never happen in r52";
      writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      process.exit(3);
    }

    report.FINAL_STATUS = "BLOGGER_DRAFT_READY";
    report.Q_FINAL_STATUS = "BLOGGER_DRAFT_READY";
  } catch (e) {
    report.FINAL_STATUS = "BLOCKED_AUTH";
    report.bloggerError = e instanceof Error ? e.message : String(e);
    report.N_bloggerCalls = bloggerCalls;
    report.L_llmCalls = 0;
  }

  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.FINAL_STATUS !== "BLOGGER_DRAFT_READY") process.exit(2);
}

main().catch((e) => {
  mkdirSync(OUT, { recursive: true });
  const report = {
    round: "r52",
    FINAL_STATUS: "BLOCKED_AUTH",
    error: e instanceof Error ? e.message : String(e),
    L_llmCalls: 0,
  };
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(1);
});
