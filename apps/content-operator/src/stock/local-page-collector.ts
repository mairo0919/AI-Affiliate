/**
 * Local-Mac FANZA official page → production Research ingest.
 * Provider-agnostic downstream: ResearchItem upsert only.
 * No Railway egress bypass / proxy / captcha / cookie fabrication.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { LifecycleRepository, ResearchRepository } from "@ai-affiliate/database";
import { safeFetchText } from "@ai-affiliate/shared";
import { chromium } from "playwright";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import { ingestFanzaPageEvidence } from "../ops/ingest-fanza-page-evidence.js";
import { resolveDmmAgeGate, type AgeGateSessionCookie } from "../ops/dmm-age-gate.js";
import { isAgeCheckUrl } from "../ops/page-classification.js";
import { loadStockRuntimeConfig } from "./stock-config.js";

const LIST_SEEDS = [
  "https://video.dmm.co.jp/av/list/?sort=date",
  "https://video.dmm.co.jp/av/list/?sort=ranking",
  "https://video.dmm.co.jp/av/list/?sort=review_rank",
] as const;

export type LocalPageCollectResult = {
  discovered: string[];
  attempted: number;
  createdOrUpdated: number;
  duplicatesSkipped: number;
  failed: Array<{ contentId: string; reason: string }>;
  intervalMs: number;
  listDiscoveryMode: "browser" | "html" | "seeds-only" | "none";
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

/** Drop GTM / analytics / non-product tokens from SPA HTML. */
export function isLikelyFanzaContentId(id: string): boolean {
  const t = id.trim().toLowerCase();
  if (!t || t.length < 5 || t.length > 40) return false;
  if (!/\d/.test(t)) return false;
  if (/^(gtm-|g-|ua-|aw-|gtag)/.test(t)) return false;
  if (/^(www|http|https|null|undefined)$/.test(t)) return false;
  // Typical FANZA cid shapes: ssis00123, h_1472instv00732, 125umd01017
  return /^[a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*$/i.test(t);
}

export function extractContentIdsFromHtml(html: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /[?&]id=([a-z0-9][a-z0-9_-]{2,40})/gi,
    /\/cid=([a-z0-9][a-z0-9_-]{2,40})/gi,
    /content\/\?id=([a-z0-9][a-z0-9_-]{2,40})/gi,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const id = (m[1] ?? "").toLowerCase();
      if (isLikelyFanzaContentId(id)) found.add(id);
    }
  }
  return [...found];
}

async function discoverContentIdsFromListPages(input: {
  config: AppConfig;
  intervalMs: number;
  sleepImpl: (ms: number) => Promise<void>;
}): Promise<{ ids: string[]; mode: "browser" | "html" | "none" }> {
  const all = new Set<string>();
  let mode: "browser" | "html" | "none" = "none";

  for (const listUrl of LIST_SEEDS) {
    await input.sleepImpl(input.intervalMs);
    try {
      const first = await safeFetchText(listUrl, {
        timeoutMs: input.config.researchFetchTimeoutMs,
        maxBytes: Math.max(input.config.researchFetchMaxBytes, 1_500_000),
        userAgent:
          "AI-Affiliate-Factory/1.0 (+local-page-research; contact=ops-local; respectful-fetcher)",
      });

      let sessionCookies: AgeGateSessionCookie[] = [];
      let html = first.text;
      let finalUrl = first.finalUrl;

      if (isAgeCheckUrl(finalUrl) || /年齢認証|age_check/i.test(html.slice(0, 2000))) {
        const gate = await resolveDmmAgeGate({
          ageCheckUrl: finalUrl,
          html,
          timeoutMs: input.config.researchFetchTimeoutMs,
          maxBytes: input.config.researchFetchMaxBytes,
        });
        if (gate.ok) {
          html = gate.fetched.text;
          finalUrl = gate.fetched.finalUrl;
          sessionCookies = gate.sessionCookies;
        }
      }

      const fromHtml = extractContentIdsFromHtml(html);
      for (const id of fromHtml) all.add(id);
      if (fromHtml.length > 0) mode = "html";

      // List pages are SPA — use official age-gate cookies + browser render (no bypass).
      let browser = null as Awaited<ReturnType<typeof chromium.launch>> | null;
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
          userAgent:
            "AI-Affiliate-Factory/1.0 (+local-page-research; contact=ops-local; respectful-fetcher)",
        });
        if (sessionCookies.length > 0) {
          await context.addCookies(sessionCookies.map(toPlaywrightCookie));
        }
        const page = await context.newPage();
        await page.route("**/*", (route) => {
          const t = route.request().resourceType();
          if (["image", "media", "font", "stylesheet"].includes(t)) return route.abort();
          return route.continue();
        });
        await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(3_500);
        const rendered = await page.content();
        const fromBrowser = extractContentIdsFromHtml(rendered);
        for (const id of fromBrowser) all.add(id);
        if (fromBrowser.length > 0) mode = "browser";
        await context.close();
      } finally {
        await browser?.close().catch(() => undefined);
      }
      void finalUrl;
    } catch {
      /* try next list seed */
    }
  }

  return { ids: [...all], mode };
}

/**
 * Discover contentIds from official list pages (rate-limited), then ingest each product page.
 */
export async function runLocalFanzaPageResearchCollect(input: {
  lifecycle: LifecycleRepository;
  research: ResearchRepository;
  config: AppConfig;
  /** Extra seed contentIds (optional). */
  seedContentIds?: string[];
  maxItems?: number;
  intervalMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  /** When true, skip list discovery and only ingest seeds. */
  seedsOnly?: boolean;
}): Promise<LocalPageCollectResult> {
  const runtime = loadStockRuntimeConfig();
  const intervalMs = input.intervalMs ?? runtime.localPageResearchIntervalMs;
  const maxItems = input.maxItems ?? runtime.localPageResearchMaxPerRun;
  const sleepImpl = input.sleepImpl ?? sleep;

  if (!input.config.researchAllowExternalRequests) {
    return {
      discovered: [],
      attempted: 0,
      createdOrUpdated: 0,
      duplicatesSkipped: 0,
      failed: [{ contentId: "-", reason: "RESEARCH_ALLOW_EXTERNAL_REQUESTS_FALSE" }],
      intervalMs,
      listDiscoveryMode: "none",
    };
  }

  const discovered = new Set<string>(
    (input.seedContentIds ?? [])
      .map((s) => s.trim().toLowerCase())
      .filter((s) => isLikelyFanzaContentId(s)),
  );

  let listDiscoveryMode: LocalPageCollectResult["listDiscoveryMode"] = "seeds-only";
  if (!input.seedsOnly) {
    const listed = await discoverContentIdsFromListPages({
      config: input.config,
      intervalMs,
      sleepImpl,
    });
    for (const id of listed.ids) discovered.add(id);
    listDiscoveryMode = listed.mode === "none" && discovered.size > 0 ? "seeds-only" : listed.mode;
  }

  // Prefer not-yet-known items first for continuous collection.
  const ordered: string[] = [];
  for (const id of discovered) {
    const existing = await input.research.findItemByExternalId(id);
    if (!existing) ordered.push(id);
  }
  for (const id of discovered) {
    if (!ordered.includes(id)) ordered.push(id);
  }

  const queue = ordered.slice(0, maxItems);
  let createdOrUpdated = 0;
  let duplicatesSkipped = 0;
  const failed: Array<{ contentId: string; reason: string }> = [];
  let attempted = 0;

  for (const contentId of queue) {
    attempted += 1;
    const existing = await input.research.findItemByExternalId(contentId);
    await sleepImpl(intervalMs);
    try {
      const result = await ingestFanzaPageEvidence({
        lifecycle: input.lifecycle,
        research: input.research,
        productUrl: buildFanzaCanonicalProductUrl(contentId),
        contentId,
        fetchOptions: {
          confirmExternal: true,
          config: input.config,
          allowBrowserFallback: true,
        },
      });
      if (!result.evidence || result.evidence.extractMode === "empty") {
        failed.push({
          contentId,
          reason: result.fetch.reason ?? "empty_evidence",
        });
        continue;
      }
      if (existing) duplicatesSkipped += 1;
      createdOrUpdated += 1;
    } catch (e) {
      failed.push({
        contentId,
        reason: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  return {
    discovered: [...discovered],
    attempted,
    createdOrUpdated,
    duplicatesSkipped,
    failed,
    intervalMs,
    listDiscoveryMode,
  };
}
