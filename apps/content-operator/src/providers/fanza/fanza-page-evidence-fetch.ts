/**
 * Low-cost FANZA product page fetch for evidence extraction.
 *
 * Production path:
 * 1) direct HTML text fetch (+ age-gate hop if needed)
 * 2) JSON-LD / light DOM parse
 * 3) browser fallback ONLY when JSON-LD Product missing and host is DMM/FANZA
 *
 * Browser fallback aborts media/fonts/images/analytics where possible.
 * Never downloads video binaries.
 */

import type { AppConfig } from "@ai-affiliate/config";
import {
  assertSafeOutboundUrl,
  safeFetchText,
  SafeFetchError,
} from "@ai-affiliate/shared";
import { resolveDmmAgeGate, type AgeGateSessionCookie } from "../../ops/dmm-age-gate.js";
import { isAgeCheckUrl, isDmmFanzaHost } from "../../ops/page-classification.js";
import { canonicalizeResearchUrl } from "../../ops/research-url-canonical.js";
import {
  extractFanzaPageEvidenceFromHtml,
  type FanzaPageEvidence,
} from "./fanza-page-evidence.js";

export type PageEvidenceFetchMode = "html" | "browser_fallback" | "fixture";

export type PageEvidenceFetchResult = {
  ok: boolean;
  reason?: string;
  evidence: FanzaPageEvidence | null;
  html: string | null;
  finalUrl: string;
  fetchMode: PageEvidenceFetchMode;
  browserFallbackUsed: boolean;
  /** Approximate HTTP round-trips we initiated (not asset fan-out when aborted). */
  externalRequestCount: number;
  /** Confirmed zero video binary downloads from this path. */
  movieBinaryRequests: 0;
};

export type FetchFanzaPageEvidenceOptions = {
  url: string;
  contentIdHint?: string | null;
  confirmExternal: boolean;
  config: AppConfig;
  /** Injected HTML for tests / artifact reuse — skips network. */
  fixtureHtml?: string;
  fetchImpl?: typeof fetch;
  allowBrowserFallback?: boolean;
  browserNavigationTimeoutMs?: number;
  browserRenderTimeoutMs?: number;
};

const UA =
  "AI-Affiliate-Factory/1.0 (+page-evidence; contact=ops-local; respectful-fetcher)";

function toPlaywrightCookie(c: AgeGateSessionCookie): {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
} {
  let domain = c.domain;
  if (!domain.startsWith(".")) {
    if (/(^|\.)dmm\.co\.jp$/i.test(domain)) domain = ".dmm.co.jp";
    else if (/(^|\.)dmm\.com$/i.test(domain)) domain = ".dmm.com";
    else if (/(^|\.)fanza\.co\.jp$/i.test(domain)) domain = ".fanza.co.jp";
    else domain = `.${domain}`;
  }
  return {
    name: c.name,
    value: c.value,
    domain,
    path: c.path || "/",
    secure: c.secure,
  };
}

export async function fetchFanzaPageEvidence(
  options: FetchFanzaPageEvidenceOptions,
): Promise<PageEvidenceFetchResult> {
  const url = canonicalizeResearchUrl(options.url);
  assertSafeOutboundUrl(url);

  if (options.fixtureHtml) {
    const evidence = extractFanzaPageEvidenceFromHtml({
      html: options.fixtureHtml,
      contentIdHint: options.contentIdHint,
    });
    return {
      ok: evidence.extractMode !== "empty",
      reason: evidence.extractMode === "empty" ? "no_page_evidence_in_fixture" : undefined,
      evidence,
      html: options.fixtureHtml,
      finalUrl: url,
      fetchMode: "fixture",
      browserFallbackUsed: false,
      externalRequestCount: 0,
      movieBinaryRequests: 0,
    };
  }

  const allow =
    options.confirmExternal && options.config.researchAllowExternalRequests;
  if (!allow) {
    return {
      ok: false,
      reason: "external_fetch_denied",
      evidence: null,
      html: null,
      finalUrl: url,
      fetchMode: "html",
      browserFallbackUsed: false,
      externalRequestCount: 0,
      movieBinaryRequests: 0,
    };
  }

  let externalRequestCount = 0;
  let html = "";
  let finalUrl = url;

  try {
    const fetched = await safeFetchText(url, {
      userAgent: UA,
      redirect: "follow",
      timeoutMs: options.config.researchFetchTimeoutMs ?? 15_000,
      maxBytes: options.config.researchFetchMaxBytes ?? 512_000,
    });
    externalRequestCount += 1;
    html = fetched.text;
    finalUrl = fetched.finalUrl || url;
  } catch (e) {
    const msg = e instanceof SafeFetchError ? e.code : "fetch_failed";
    return {
      ok: false,
      reason: msg,
      evidence: null,
      html: null,
      finalUrl: url,
      fetchMode: "html",
      browserFallbackUsed: false,
      externalRequestCount,
      movieBinaryRequests: 0,
    };
  }

  let sessionCookies: AgeGateSessionCookie[] = [];

  if (isAgeCheckUrl(finalUrl) || /年齢認証|age_check/i.test(html.slice(0, 2000))) {
    try {
      const resolved = await resolveDmmAgeGate({
        ageCheckUrl: finalUrl,
        html,
        timeoutMs: options.config.researchFetchTimeoutMs ?? 15_000,
        maxBytes: options.config.researchFetchMaxBytes ?? 512_000,
        fetchImpl: options.fetchImpl,
      });
      if (resolved.ok) {
        externalRequestCount += resolved.redirectCount || 1;
        html = resolved.fetched.text;
        finalUrl = resolved.fetched.finalUrl || finalUrl;
        sessionCookies = resolved.sessionCookies;
      }
    } catch {
      /* keep current html */
    }
  }

  let evidence = extractFanzaPageEvidenceFromHtml({
    html,
    contentIdHint: options.contentIdHint,
  });

  const needsBrowser =
    options.allowBrowserFallback === true &&
    evidence.extractMode === "empty" &&
    isDmmFanzaHost(new URL(finalUrl).hostname);

  if (needsBrowser) {
    const browserHtml = await fetchRenderedHtmlLowCost({
      url: finalUrl,
      navigationTimeoutMs: options.browserNavigationTimeoutMs ?? 30_000,
      renderTimeoutMs: options.browserRenderTimeoutMs ?? 25_000,
      sessionCookies,
    });
    externalRequestCount += browserHtml.requestEstimate;
    if (browserHtml.html) {
      html = browserHtml.html;
      if (browserHtml.finalUrl) finalUrl = browserHtml.finalUrl;
      evidence = extractFanzaPageEvidenceFromHtml({
        html,
        contentIdHint: options.contentIdHint,
      });
      return {
        ok: evidence.extractMode !== "empty",
        reason: evidence.extractMode === "empty" ? "browser_no_evidence" : undefined,
        evidence,
        html,
        finalUrl,
        fetchMode: "browser_fallback",
        browserFallbackUsed: true,
        externalRequestCount,
        movieBinaryRequests: 0,
      };
    }
  }

  return {
    ok: evidence.extractMode !== "empty",
    reason: evidence.extractMode === "empty" ? "no_page_evidence" : undefined,
    evidence,
    html,
    finalUrl,
    fetchMode: "html",
    browserFallbackUsed: false,
    externalRequestCount,
    movieBinaryRequests: 0,
  };
}

async function fetchRenderedHtmlLowCost(input: {
  url: string;
  navigationTimeoutMs: number;
  renderTimeoutMs: number;
  sessionCookies?: AgeGateSessionCookie[];
}): Promise<{ html: string | null; finalUrl?: string; requestEstimate: number }> {
  // Dynamic import keeps unit tests free of Playwright unless fallback runs.
  const { chromium } = await import("playwright");
  let browser = null as Awaited<ReturnType<typeof chromium.launch>> | null;
  let requestEstimate = 1;
  try {
    try {
      browser = await chromium.launch({
        channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
        headless: true,
      });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
    const context = await browser.newContext({
      userAgent: UA,
      javaScriptEnabled: true,
      acceptDownloads: false,
    });
    // Inject age_check_done from declared=yes HTML hop so SPA GraphQL can render.
    if (input.sessionCookies?.length) {
      await context.addCookies(input.sessionCookies.map(toPlaywrightCookie));
    }
    await context.route("**/*", async (route) => {
      const type = route.request().resourceType();
      const u = route.request().url();
      // Abort heavy / irrelevant assets — we only need HTML+JSON-LD after JS.
      if (
        type === "image" ||
        type === "media" ||
        type === "font" ||
        /\.(mp4|m3u8|ts|webm|woff2?)(\?|$)/i.test(u) ||
        /google-analytics|googletagmanager|doubleclick|facebook|hotjar|ads\./i.test(u)
      ) {
        await route.abort();
        return;
      }
      requestEstimate += 1;
      await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(input.navigationTimeoutMs);
    await page.goto(input.url, { waitUntil: "domcontentloaded" });

    // Age gate: official affirm only (when cookies were not yet injected / still gated)
    const title = await page.title().catch(() => "");
    if (/age_check|年齢認証/i.test(`${title} ${page.url()}`)) {
      const affirm = page.locator('a[href*="declared=yes"], a:has-text("はい")').first();
      if (await affirm.count()) {
        await affirm.click({ timeout: 8_000 });
        await page.waitForLoadState("domcontentloaded");
        await page
          .waitForFunction(
            // Expression (IIFE) — a bare `() => ...` string is truthy as a Function object.
            `(() => !/age_check/i.test(location.href) && !/年齢認証/.test(document.title || ""))()`,
            { timeout: Math.min(20_000, input.renderTimeoutMs) },
          )
          .catch(() => undefined);
        requestEstimate += 1;
      }
    }

    // Wait for product JSON-LD / gallery — h1 alone is too early on the SPA shell.
    // Must be an IIFE expression string: bare `() => ...` evaluates to a truthy Function.
    await page
      .waitForFunction(
        `(() => {
          const nodes = document.querySelectorAll('script[type="application/ld+json"]');
          for (const node of nodes) {
            const t = node.textContent || "";
            if (t.includes("@type") && t.includes("Product")) return true;
          }
          return Boolean(document.querySelector('[data-e2eid="sample-image-gallery"]'));
        })()`,
        { timeout: input.renderTimeoutMs },
      )
      .catch(() => undefined);

    const html = await page.content();
    const renderedUrl = page.url();
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    return { html, finalUrl: renderedUrl, requestEstimate };
  } catch {
    await browser?.close().catch(() => undefined);
    return { html: null, requestEstimate };
  }
}
