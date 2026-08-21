/**
 * r52 — diagnose Blogger token refresh (no secrets printed).
 */
import { loadConfig } from "@ai-affiliate/config";

async function main() {
  const config = loadConfig({ requireDatabaseUrl: false });
  console.log(
    JSON.stringify(
      {
        mode: config.bloggerMode,
        allowExternal: config.bloggerAllowExternalRequests,
        allowDirectPublish: config.bloggerAllowDirectPublish,
        defaultPublishMode: config.bloggerDefaultPublishMode,
        tokenUrl: config.bloggerOAuthTokenUrl,
        apiBase: config.bloggerApiBaseUrl,
        blogId: config.bloggerBlogId,
        clientIdPresent: Boolean(config.bloggerClientId),
        clientIdLen: config.bloggerClientId?.length ?? 0,
        clientSecretPresent: Boolean(config.bloggerClientSecret),
        clientSecretLen: config.bloggerClientSecret?.length ?? 0,
        refreshPresent: Boolean(config.bloggerRefreshToken),
        refreshLen: config.bloggerRefreshToken?.length ?? 0,
        redirect: config.bloggerOAuthRedirectUri,
      },
      null,
      2,
    ),
  );

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
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { parseError: true, rawPrefix: text.slice(0, 300) };
  }
  const safe = { ...json };
  delete safe.access_token;
  delete safe.refresh_token;
  delete safe.id_token;
  console.log(JSON.stringify({ httpStatus: res.status, ok: res.ok, body: safe }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
