import {
  assertSafeOutboundUrl,
  SafeFetchError,
  type SafeFetchTextResult,
  SsrfBlockedError,
} from "@ai-affiliate/shared";
import {
  buildDeclaredYesUrl,
  extractAndValidateAgeCheckRurl,
  extractDeclaredYesUrl,
  isAgeCheckUrl,
  isDmmFanzaHost,
} from "./page-classification.js";

const MAX_REDIRECTS = 5;
const DEFAULT_UA =
  "AI-Affiliate-Factory/1.0 (+research; contact=ops-local; respectful-fetcher)";

/** Age-gate session cookies for same-process Playwright injection. Never log values. */
export type AgeGateSessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
};

export type AgeGateResolveResult =
  | {
      ok: true;
      fetched: SafeFetchTextResult;
      rurl: string;
      usedDeclaredYes: true;
      cookieNames: string[];
      /** Same-process browser injection only — do not serialize to logs/artifacts. */
      sessionCookies: AgeGateSessionCookie[];
      redirectCount: number;
    }
  | { ok: false; reason: string };

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

/**
 * Resolve a DMM/FANZA age_check interstitial using the site's own declared=yes link.
 * Cookie values are taken only from Set-Cookie on that response (never invented).
 */
export async function resolveDmmAgeGate(input: {
  ageCheckUrl: string;
  html: string;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
}): Promise<AgeGateResolveResult> {
  const rurlResult = extractAndValidateAgeCheckRurl(input.ageCheckUrl);
  if (!rurlResult.ok) {
    return { ok: false, reason: rurlResult.reason };
  }

  const declaredFromHtml = extractDeclaredYesUrl(input.html, input.ageCheckUrl);
  const declared =
    declaredFromHtml ?? buildDeclaredYesUrl(input.ageCheckUrl, rurlResult.rurl);
  if (!declared) {
    return { ok: false, reason: "declared_yes_link_unavailable" };
  }

  try {
    const fetched = await fetchWithRedirectCookies(declared, {
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
      fetchImpl: input.fetchImpl,
    });
    if (isAgeCheckUrl(fetched.result.finalUrl)) {
      return { ok: false, reason: "still_age_check_after_declared_yes" };
    }
    if (!isDmmFanzaHost(new URL(fetched.result.finalUrl).hostname)) {
      return { ok: false, reason: "post_affirm_host_not_allowed" };
    }
    return {
      ok: true,
      fetched: fetched.result,
      rurl: rurlResult.rurl,
      usedDeclaredYes: true,
      cookieNames: fetched.cookieNames,
      sessionCookies: fetched.sessionCookies,
      redirectCount: fetched.redirectCount,
    };
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return { ok: false, reason: "ssrf_blocked" };
    }
    if (error instanceof SafeFetchError) {
      return { ok: false, reason: error.code.toLowerCase() };
    }
    return { ok: false, reason: "declared_yes_fetch_failed" };
  }
}

/**
 * Manual redirect fetch that forwards cookies received via Set-Cookie
 * using Domain / Path / Secure matching (RFC6265-ish). Does not inject fixed values.
 */
export async function fetchWithRedirectCookies(
  rawUrl: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    fetchImpl?: typeof fetch;
  },
): Promise<{
  result: SafeFetchTextResult;
  cookieNames: string[];
  sessionCookies: AgeGateSessionCookie[];
  redirectCount: number;
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = assertSafeOutboundUrl(rawUrl).toString();
  const jar: StoredCookie[] = [];
  let redirectCount = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertSafeOutboundUrl(current);
    const host = new URL(current).hostname;
    if (!isDmmFanzaHost(host)) {
      throw new SafeFetchError("HOST_NOT_ALLOWED", "Redirect left DMM/FANZA hosts");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      const cookieHeader = cookieHeaderForUrl(jar, current);
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
          "user-agent": DEFAULT_UA,
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
      });
    } catch (error) {
      throw new SafeFetchError(
        "FETCH_FAILED",
        error instanceof Error ? error.message.slice(0, 200) : "fetch failed",
      );
    } finally {
      clearTimeout(timer);
    }

    mergeSetCookie(jar, response.headers, current);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SafeFetchError("REDIRECT_ERROR", "Redirect without Location");
      current = assertSafeOutboundUrl(new URL(location, current).toString()).toString();
      redirectCount += 1;
      continue;
    }

    if (!response.ok) {
      throw new SafeFetchError("HTTP_ERROR", `Upstream returned ${response.status}`);
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml") &&
      !contentType.includes("text/plain")
    ) {
      throw new SafeFetchError(
        "UNSUPPORTED_CONTENT_TYPE",
        `Unsupported content-type: ${contentType.split(";")[0] ?? "unknown"}`,
      );
    }

    const buf = await readLimitedBody(response, options.maxBytes);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return {
      result: {
        requestedUrl: rawUrl,
        finalUrl: current,
        contentType: contentType.split(";")[0] ?? "text/html",
        text,
        bytes: buf.byteLength,
      },
      cookieNames: [...new Set(jar.map((c) => c.name))],
      sessionCookies: jar.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
      })),
      redirectCount,
    };
  }

  throw new SafeFetchError("TOO_MANY_REDIRECTS", "Exceeded redirect limit");
}

/** Exported for unit tests — Domain/Path matching only, never logs values. */
export function cookieMatchesUrl(cookie: StoredCookie, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (cookie.secure && url.protocol !== "https:") return false;
  if (!domainMatches(cookie.domain, url.hostname)) return false;
  return pathMatches(cookie.path || "/", url.pathname || "/");
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === "/") return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (requestPath.length === cookiePath.length) return true;
  if (cookiePath.endsWith("/")) return true;
  return requestPath.charAt(cookiePath.length) === "/";
}

export function parseSetCookieLine(
  line: string,
  requestUrl: string,
): StoredCookie | null {
  const parts = line.split(";").map((p) => p.trim());
  const nv = parts[0];
  if (!nv) return null;
  const eq = nv.indexOf("=");
  if (eq <= 0) return null;
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  // Only persist age-gate consent cookie from DMM responses.
  if (name !== "age_check_done" || !value || value.length >= 64) return null;

  let domain = new URL(requestUrl).hostname;
  let path = "/";
  let secure = false;
  for (const attr of parts.slice(1)) {
    const [rawKey, ...rest] = attr.split("=");
    const key = (rawKey ?? "").trim().toLowerCase();
    const val = rest.join("=").trim();
    if (key === "domain" && val) {
      domain = val.startsWith(".") ? val : `.${val}`;
    } else if (key === "path" && val) {
      path = val;
    } else if (key === "secure") {
      secure = true;
    }
  }
  return { name, value, domain, path, secure };
}

function mergeSetCookie(jar: StoredCookie[], headers: Headers, requestUrl: string): void {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const lines = raw.length > 0 ? raw : headerLines(headers, "set-cookie");
  for (const line of lines) {
    const parsed = parseSetCookieLine(line, requestUrl);
    if (!parsed) continue;
    const idx = jar.findIndex(
      (c) => c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path,
    );
    if (idx >= 0) jar[idx] = parsed;
    else jar.push(parsed);
  }
}

function cookieHeaderForUrl(jar: StoredCookie[], rawUrl: string): string {
  return jar
    .filter((c) => cookieMatchesUrl(c, rawUrl))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function domainMatches(cookieDomain: string, hostname: string): boolean {
  const host = hostname.toLowerCase();
  const domain = cookieDomain.toLowerCase();
  if (domain.startsWith(".")) {
    const base = domain.slice(1);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === domain;
}

function headerLines(headers: Headers, name: string): string[] {
  const single = headers.get(name);
  return single ? [single] : [];
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const ab = await response.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new SafeFetchError("RESPONSE_TOO_LARGE", `Response exceeds ${maxBytes} bytes`);
  }
  return new Uint8Array(ab);
}
