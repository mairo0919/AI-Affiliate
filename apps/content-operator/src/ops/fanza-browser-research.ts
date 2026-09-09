/// <reference lib="dom" />
/**
 * Browser-rendered FANZA product page research (Playwright).
 * Restored for page-evidence browser fallback; evaluate callbacks use DOM APIs.
 */
import { chromium, type Browser, type Page } from "playwright";
import { assertSafeOutboundUrl } from "@ai-affiliate/shared";
import { isDmmFanzaHost } from "./page-classification.js";
import { canonicalizeResearchUrl } from "./research-url-canonical.js";
import { normalizePublicHtml, type NormalizedPublicPage } from "./page-normalize.js";

const DEFAULT_UA =
  "AI-Affiliate-Factory/1.0 (+research; contact=ops-local; respectful-fetcher)";

export interface BrowserNetworkSummary {
  host: string;
  path: string;
  method: string;
  status: number;
  contentType: string;
}

export interface BrowserFieldExtraction {
  field: string;
  ok: boolean;
  confidence: "high" | "medium" | "low";
  source: string;
}

export interface FanzaBrowserDiagnose {
  finalUrl: string;
  documentTitle: string | null;
  visibleHeadings: string[];
  semanticLabels: string[];
  detectedProductId: string | null;
  detectedFieldNames: string[];
  fieldExtraction: BrowserFieldExtraction[];
  networkSummary: BrowserNetworkSummary[];
  ageGateHandled: boolean;
  renderDurationMs: number;
  /** Short sanitized failure code for tests/diagnose — never secrets/HTML. */
  errorCode?: string;
}

export interface FanzaBrowserResearchOptions {
  url: string;
  navigationTimeoutMs?: number;
  renderTimeoutMs?: number;
  /** Injected session for tests (no real browser). */
  sessionFactory?: BrowserSessionFactory;
  /** Test-only: load this HTML instead of network navigation. */
  fixtureHtml?: string;
  /** Test-only: force render wait failure. */
  forceTimeout?: boolean;
  diagnose?: boolean;
}

export interface FanzaBrowserResearchResult {
  ok: boolean;
  reason?: string;
  page: NormalizedPublicPage | null;
  ageGateHandled: boolean;
  renderDurationMs: number;
  networkSummary: BrowserNetworkSummary[];
  diagnose?: FanzaBrowserDiagnose;
}

export interface BrowserSession {
  page: Page;
  networkSummary: () => BrowserNetworkSummary[];
  close: () => Promise<void>;
}

export type BrowserSessionFactory = () => Promise<BrowserSession>;

/**
 * Only FANZA/DMM js_app_shell pages may use browser fallback.
 */
export function shouldUseFanzaBrowserFallback(input: {
  seed: NormalizedPublicPage;
  allowBrowserRender: boolean;
  confirmExternal: boolean;
  researchAllowExternalRequests: boolean;
  mockHtml?: string;
}): boolean {
  if (!input.allowBrowserRender) return false;
  if (!input.confirmExternal) return false;
  if (!input.researchAllowExternalRequests && !input.mockHtml) return false;
  if (input.seed.classificationReason !== "js_app_shell_no_product_data") return false;
  if (input.seed.canUseAsProductSource) return false;
  if (input.seed.title && input.seed.title.trim().length >= 2) return false;
  try {
    const host = new URL(input.seed.sourceUrl).hostname;
    return isDmmFanzaHost(host);
  } catch {
    return false;
  }
}

export async function fetchFanzaBrowserRenderedPage(
  options: FanzaBrowserResearchOptions,
): Promise<FanzaBrowserResearchResult> {
  const url = canonicalizeResearchUrl(options.url);
  assertSafeOutboundUrl(url);
  if (!isDmmFanzaHost(new URL(url).hostname)) {
    return {
      ok: false,
      reason: "host_not_dmm_fanza",
      page: null,
      ageGateHandled: false,
      renderDurationMs: 0,
      networkSummary: [],
    };
  }

  const navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
  const renderTimeoutMs = options.renderTimeoutMs ?? 25_000;
  const started = Date.now();

  // Test/fixture path: never launch Playwright when HTML is injected without a session.
  // Production live research always uses createDefaultBrowserSession (no fixtureHtml).
  if (options.fixtureHtml && !options.sessionFactory) {
    return fetchFromFixtureHtmlWithoutBrowser({
      url,
      fixtureHtml: options.fixtureHtml,
      forceTimeout: options.forceTimeout,
      diagnose: options.diagnose,
      started,
    });
  }

  let session: BrowserSession | null = null;

  try {
    session = options.sessionFactory
      ? await options.sessionFactory()
      : await createDefaultBrowserSession({ navigationTimeoutMs });

    const { page } = session;
    page.setDefaultTimeout(renderTimeoutMs);
    page.setDefaultNavigationTimeout(navigationTimeoutMs);

    if (options.forceTimeout) {
      throw new Error("browser render timeout exceeded");
    }

    let ageGateHandled = false;
    if (options.fixtureHtml) {
      await page.setContent(options.fixtureHtml, { waitUntil: "domcontentloaded" });
      ageGateHandled = await handleAgeGateIfPresent(page);
    } else {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
      ageGateHandled = await handleAgeGateIfPresent(page);
    }

    await page
      .waitForFunction(
        () => {
          const t = document.title || "";
          return Boolean(t && !/年齢認証|age\s*verification/i.test(t) && t.trim().length > 2);
        },
        { timeout: renderTimeoutMs },
      )
      .catch(() => undefined);

    await page
      .waitForSelector("h1", { timeout: Math.min(15_000, renderTimeoutMs) })
      .catch(() => undefined);

    const extracted = await extractFanzaProductDom(page);
    const renderDurationMs = Date.now() - started;
    const networkSummary = session.networkSummary();

    if (!extracted.productName) {
      return {
        ok: false,
        reason: "browser_missing_product_title",
        page: null,
        ageGateHandled,
        renderDurationMs,
        networkSummary,
        diagnose: options.diagnose
          ? toDiagnose(extracted, page.url(), ageGateHandled, renderDurationMs, networkSummary)
          : undefined,
      };
    }

    const syntheticHtml = buildSyntheticHtmlFromExtraction(extracted);
    const pageNorm = normalizePublicHtml({
      html: syntheticHtml,
      sourceUrl: url,
      finalUrl: extracted.canonicalUrl ?? page.url(),
    });

    return {
      ok: pageNorm.canUseAsProductSource,
      reason: pageNorm.canUseAsProductSource ? undefined : (pageNorm.classificationReason ?? undefined),
      page: pageNorm,
      ageGateHandled,
      renderDurationMs,
      networkSummary,
      diagnose: options.diagnose
        ? toDiagnose(extracted, page.url(), ageGateHandled, renderDurationMs, networkSummary)
        : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return {
      ok: false,
      reason: /timeout/i.test(message) ? "browser_render_timeout" : "browser_render_failed",
      page: null,
      ageGateHandled: false,
      renderDurationMs: Date.now() - started,
      networkSummary: session?.networkSummary() ?? [],
      diagnose: options.diagnose
        ? {
            finalUrl: options.url,
            documentTitle: null,
            visibleHeadings: [],
            semanticLabels: [],
            detectedProductId: null,
            detectedFieldNames: [],
            fieldExtraction: [],
            networkSummary: session?.networkSummary() ?? [],
            ageGateHandled: false,
            renderDurationMs: Date.now() - started,
            // Safe short error code only — never cookies/HTML.
            errorCode: message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 160),
          }
        : undefined,
    };
  } finally {
    if (session) {
      try {
        await session.close();
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/**
 * Deterministic fixture extraction without Playwright.
 * Used by unit tests; live CLI path never sets fixtureHtml.
 */
function fetchFromFixtureHtmlWithoutBrowser(input: {
  url: string;
  fixtureHtml: string;
  forceTimeout?: boolean;
  diagnose?: boolean;
  started: number;
}): FanzaBrowserResearchResult {
  if (input.forceTimeout) {
    return {
      ok: false,
      reason: "browser_render_timeout",
      page: null,
      ageGateHandled: false,
      renderDurationMs: Date.now() - input.started,
      networkSummary: [],
      diagnose: input.diagnose
        ? {
            finalUrl: input.url,
            documentTitle: null,
            visibleHeadings: [],
            semanticLabels: [],
            detectedProductId: null,
            detectedFieldNames: [],
            fieldExtraction: [],
            networkSummary: [],
            ageGateHandled: false,
            renderDurationMs: Date.now() - input.started,
            errorCode: "browser render timeout exceeded",
          }
        : undefined,
    };
  }

  const titleMatch = input.fixtureHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const documentTitle = (titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  const ageGateOnly =
    /年齢認証|age\s*verification|age_check/i.test(documentTitle) &&
    !/#fixture-product-root|data-tracking-page-type=["']detail["']/i.test(input.fixtureHtml);

  if (ageGateOnly) {
    // JS click path requires a real browser — covered by smoke tests.
    return {
      ok: false,
      reason: "browser_age_gate_requires_render",
      page: null,
      ageGateHandled: false,
      renderDurationMs: Date.now() - input.started,
      networkSummary: [],
      diagnose: input.diagnose
        ? {
            finalUrl: input.url,
            documentTitle: documentTitle || null,
            visibleHeadings: [],
            semanticLabels: [],
            detectedProductId: null,
            detectedFieldNames: [],
            fieldExtraction: [],
            networkSummary: [],
            ageGateHandled: false,
            renderDurationMs: Date.now() - input.started,
            errorCode: "age_gate_requires_browser",
          }
        : undefined,
    };
  }

  const extracted = extractFanzaProductFieldsFromHtml(input.fixtureHtml);
  const renderDurationMs = Date.now() - input.started;
  if (!extracted.productName) {
    return {
      ok: false,
      reason: "browser_missing_product_title",
      page: null,
      ageGateHandled: false,
      renderDurationMs,
      networkSummary: [],
      diagnose: input.diagnose
        ? toDiagnose(extracted, input.url, false, renderDurationMs, [])
        : undefined,
    };
  }

  const syntheticHtml = buildSyntheticHtmlFromExtraction(extracted);
  const pageNorm = normalizePublicHtml({
    html: syntheticHtml,
    sourceUrl: input.url,
    finalUrl: extracted.canonicalUrl ?? input.url,
  });

  return {
    ok: pageNorm.canUseAsProductSource,
    reason: pageNorm.canUseAsProductSource ? undefined : (pageNorm.classificationReason ?? undefined),
    page: pageNorm,
    ageGateHandled: false,
    renderDurationMs,
    networkSummary: [],
    diagnose: input.diagnose
      ? toDiagnose(extracted, extracted.canonicalUrl ?? input.url, false, renderDurationMs, [])
      : undefined,
  };
}

/**
 * Mirror of browser DOM extraction for fixture HTML (no Playwright / no Chrome).
 * Keep field sources aligned with extractFanzaProductDom evaluate() body.
 */
export function extractFanzaProductFieldsFromHtml(html: string): DomExtraction {
  const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
  const fieldExtraction: BrowserFieldExtraction[] = [];
  const rows: Record<string, string> = {};

  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const block = tr[1] ?? "";
    const th = clean(block.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1]?.replace(/<[^>]+>/g, ""));
    const td = clean(block.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1]?.replace(/<[^>]+>/g, ""));
    const key = th.replace(/[：:]\s*$/, "");
    if (!key || !td || td === "----" || td.length > 400) continue;
    rows[key] = td;
  }

  const h1 = clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ""));
  const ogTitle = clean(
    html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i)?.[1],
  );
  const documentTitle = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const productName = h1 || ogTitle || documentTitle.replace(/\s*[|｜].*$/, "").trim() || null;
  fieldExtraction.push({
    field: "productName",
    ok: Boolean(productName),
    confidence: h1 ? "high" : ogTitle ? "high" : productName ? "medium" : "low",
    source: h1 ? "h1" : ogTitle ? "og:title" : productName ? "document.title" : "none",
  });

  const canonicalUrl =
    html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
    html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1] ??
    null;
  fieldExtraction.push({
    field: "canonicalUrl",
    ok: Boolean(canonicalUrl),
    confidence: canonicalUrl ? "high" : "low",
    source: "link[rel=canonical]",
  });

  const pick = (labels: string[], field: string) => {
    for (const label of labels) {
      if (rows[label]) {
        fieldExtraction.push({
          field,
          ok: true,
          confidence: "high",
          source: `tr>th: ${label}`,
        });
        return rows[label]!;
      }
    }
    fieldExtraction.push({ field, ok: false, confidence: "low", source: "tr>th missing" });
    return null;
  };

  const performer = pick(["出演者"], "performer");
  const maker = pick(["メーカー"], "maker");
  const label = pick(["レーベル"], "label");
  const series = pick(["シリーズ"], "series");
  const genre = pick(["ジャンル"], "genre");
  const releaseDate = pick(["配信開始日", "商品発売日"], "releaseDate");
  const productId = pick(["配信品番"], "productId");

  let price: string | null = null;
  const purchaseIdx = html.search(/data-e2eid=["']purchase-button["']/i);
  if (purchaseIdx >= 0) {
    const vicinity = html.slice(Math.max(0, purchaseIdx - 200), purchaseIdx + 400);
    const m = clean(vicinity.replace(/<[^>]+>/g, " ")).match(/(?:¥|￥)?\s*([\d,]+)\s*円/);
    if (m) {
      price = `${m[1]}円`;
      fieldExtraction.push({
        field: "price",
        ok: true,
        confidence: "medium",
        source: "[data-e2eid=purchase-button] vicinity",
      });
    }
  }
  if (!price) {
    fieldExtraction.push({
      field: "price",
      ok: false,
      confidence: "low",
      source: "ambiguous_or_missing",
    });
  }

  const availability = /data-e2eid=["'](purchase-button|add-to-cart-button)["']/i.test(html)
    ? "AVAILABLE"
    : null;
  fieldExtraction.push({
    field: "availability",
    ok: Boolean(availability),
    confidence: availability ? "medium" : "low",
    source: "purchase affordance",
  });

  let imageUrl: string | null = null;
  const galleryUrls: string[] = [];
  const galleryBlock = html.match(
    /data-e2eid=["']sample-image-gallery["'][\s\S]{0,120000}?(?=data-e2eid=["'](?!sample-image-gallery)|<\/section>|$)/i,
  );
  const galleryScope = galleryBlock?.[0] ?? "";
  for (const m of galleryScope.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const u = (m[1] ?? "").split("?")[0];
    if (u) galleryUrls.push(u);
  }
  if (galleryUrls[0]) {
    imageUrl = galleryUrls[0];
  }
  fieldExtraction.push({
    field: "imageUrl",
    ok: Boolean(imageUrl),
    confidence: imageUrl ? "medium" : "low",
    source: "[data-e2eid=sample-image-gallery] img",
  });
  fieldExtraction.push({
    field: "sampleGalleryCount",
    ok: galleryUrls.length > 0,
    confidence: galleryUrls.length > 1 ? "high" : galleryUrls.length === 1 ? "medium" : "low",
    source: `[data-e2eid=sample-image-gallery] imgs (${galleryUrls.length})`,
  });

  const descriptionPresent = /<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']+["']/i.test(
    html,
  );
  const pageType =
    html.match(/data-tracking-page-type=["']([^"']+)["']/i)?.[1] ?? null;

  const headings = [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((m) => clean(m[1]?.replace(/<[^>]+>/g, "")))
    .filter(Boolean)
    .slice(0, 12);

  return {
    productName,
    documentTitle: documentTitle || null,
    ogTitle: ogTitle || null,
    canonicalUrl,
    productId,
    performer,
    maker,
    label,
    series,
    genre,
    releaseDate,
    price,
    availability,
    imageUrl,
    descriptionPresent,
    pageType,
    rowLabels: Object.keys(rows),
    headings,
    fieldExtraction,
  };
}

async function createDefaultBrowserSession(input: {
  navigationTimeoutMs: number;
}): Promise<BrowserSession> {
  let browser: Browser | null = null;
  const network: BrowserNetworkSummary[] = [];
  const seen = new Set<string>();

  try {
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
      headless: true,
    });
  } catch {
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext({
    userAgent: DEFAULT_UA,
    viewport: { width: 1280, height: 900 },
    javaScriptEnabled: true,
    acceptDownloads: false,
  });
  await context.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (type === "media" || type === "font") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  page.on("popup", async (popup) => {
    try {
      await popup.close();
    } catch {
      /* ignore */
    }
  });
  page.on("download", async (download) => {
    try {
      await download.cancel();
    } catch {
      /* ignore */
    }
  });
  page.on("response", (res) => {
    try {
      const u = new URL(res.url());
      if (!isDmmFanzaHost(u.hostname) && !/\.dmm\./i.test(u.hostname)) return;
      const ct = (res.headers()["content-type"] || "").split(";")[0] || "";
      if (!/json|graphql|javascript|html|text/i.test(ct) && !/api|graphql|bff/i.test(u.pathname)) {
        return;
      }
      const key = `${res.request().method()}|${u.hostname}|${u.pathname}|${res.status()}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (network.length < 40) {
        network.push({
          host: u.hostname,
          path: u.pathname.slice(0, 160),
          method: res.request().method(),
          status: res.status(),
          contentType: ct.slice(0, 80),
        });
      }
    } catch {
      /* ignore */
    }
  });
  page.setDefaultNavigationTimeout(input.navigationTimeoutMs);

  return {
    page,
    networkSummary: () => [...network],
    close: async () => {
      await context.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    },
  };
}

async function handleAgeGateIfPresent(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const current = page.url();
  if (!/age_check|年齢認証/i.test(`${title} ${current}`)) {
    return false;
  }
  const yes = page.locator('a:has-text("はい"), button:has-text("はい")').first();
  if ((await yes.count()) === 0) {
    throw new Error("age_gate_yes_control_missing");
  }
  await yes.click();
  // Fixture pages may rewrite DOM via click handler.
  try {
    await page.waitForSelector("#fixture-product-root h1", { timeout: 3_000 });
    return true;
  } catch {
    /* live navigation path */
  }
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () => !/age_check/i.test(location.href) && !/年齢認証/.test(document.title || ""),
    { timeout: 20_000 },
  );
  return true;
}

interface DomExtraction {
  productName: string | null;
  documentTitle: string | null;
  ogTitle: string | null;
  canonicalUrl: string | null;
  productId: string | null;
  performer: string | null;
  maker: string | null;
  label: string | null;
  series: string | null;
  genre: string | null;
  releaseDate: string | null;
  price: string | null;
  availability: string | null;
  imageUrl: string | null;
  descriptionPresent: boolean;
  pageType: string | null;
  rowLabels: string[];
  headings: string[];
  fieldExtraction: BrowserFieldExtraction[];
}

/**
 * Selectors confirmed on video.dmm.co.jp/av/content detail (2026-08):
 * - product name: h1 / meta[property=og:title]
 * - canonical: link[rel=canonical]
 * - facts: table tr > th + td (出演者/メーカー/レーベル/シリーズ/ジャンル/配信開始日/配信品番)
 * - page type: [data-tracking-page-type]
 * - purchase affordance: [data-e2eid=purchase-button]
 */
export async function extractFanzaProductDom(page: Page): Promise<DomExtraction> {
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const fieldExtraction: Array<{
      field: string;
      ok: boolean;
      confidence: "high" | "medium" | "low";
      source: string;
    }> = [];
    const rows: Record<string, string> = {};
    for (const tr of Array.from(document.querySelectorAll("tr"))) {
      const th = tr.querySelector("th");
      const td = tr.querySelector("td");
      if (!th || !td) continue;
      const key = clean(th.textContent).replace(/[：:]\s*$/, "");
      const val = clean(td.textContent);
      if (!key || !val || val === "----" || val.length > 400) continue;
      rows[key] = val;
    }
    const h1 = clean(document.querySelector("h1")?.textContent);
    const ogTitle = clean(
      document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    );
    const documentTitle = clean(document.title);
    const productName = h1 || ogTitle || documentTitle.replace(/\s*[|｜].*$/, "").trim() || null;
    fieldExtraction.push({
      field: "productName",
      ok: Boolean(productName),
      confidence: h1 ? "high" : ogTitle ? "high" : productName ? "medium" : "low",
      source: h1 ? "h1" : ogTitle ? "og:title" : productName ? "document.title" : "none",
    });
    const canonicalUrl =
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") || null;
    fieldExtraction.push({
      field: "canonicalUrl",
      ok: Boolean(canonicalUrl),
      confidence: canonicalUrl ? "high" : "low",
      source: "link[rel=canonical]",
    });
    const pick = (labels: string[], field: string) => {
      for (const label of labels) {
        if (rows[label]) {
          fieldExtraction.push({
            field,
            ok: true,
            confidence: "high",
            source: `tr>th: ${label}`,
          });
          return rows[label]!;
        }
      }
      fieldExtraction.push({ field, ok: false, confidence: "low", source: "tr>th missing" });
      return null;
    };
    const performer = pick(["出演者"], "performer");
    const maker = pick(["メーカー"], "maker");
    const label = pick(["レーベル"], "label");
    const series = pick(["シリーズ"], "series");
    const genre = pick(["ジャンル"], "genre");
    const releaseDate = pick(["配信開始日", "商品発売日"], "releaseDate");
    const productId = pick(["配信品番"], "productId");
    let price: string | null = null;
    const purchase = document.querySelector('[data-e2eid="purchase-button"]');
    const purchaseRoot =
      purchase?.closest("section, aside, div") ?? purchase?.parentElement ?? null;
    if (purchaseRoot) {
      const m = clean(purchaseRoot.textContent).match(/(?:¥|￥)?\s*([\d,]+)\s*円/);
      if (m) {
        price = `${m[1]}円`;
        fieldExtraction.push({
          field: "price",
          ok: true,
          confidence: "medium",
          source: "[data-e2eid=purchase-button] vicinity",
        });
      }
    }
    if (!price) {
      fieldExtraction.push({
        field: "price",
        ok: false,
        confidence: "low",
        source: "ambiguous_or_missing",
      });
    }
    const availability = document.querySelector(
      '[data-e2eid="purchase-button"], [data-e2eid="add-to-cart-button"]',
    )
      ? "AVAILABLE"
      : null;
    fieldExtraction.push({
      field: "availability",
      ok: Boolean(availability),
      confidence: availability ? "medium" : "low",
      source: "purchase affordance",
    });
    let imageUrl: string | null = null;
    const galleryRoot = document.querySelector('[data-e2eid="sample-image-gallery"]');
    const galleryImgs = galleryRoot
      ? Array.from(galleryRoot.querySelectorAll("img"))
      : [];
    if (galleryImgs[0] instanceof HTMLImageElement) {
      imageUrl =
        (galleryImgs[0].currentSrc || galleryImgs[0].src || "").split("?")[0] || null;
    }
    fieldExtraction.push({
      field: "imageUrl",
      ok: Boolean(imageUrl),
      confidence: imageUrl ? "medium" : "low",
      source: "[data-e2eid=sample-image-gallery] img",
    });
    fieldExtraction.push({
      field: "sampleGalleryCount",
      ok: galleryImgs.length > 0,
      confidence: galleryImgs.length > 1 ? "high" : galleryImgs.length === 1 ? "medium" : "low",
      source: `[data-e2eid=sample-image-gallery] imgs (${galleryImgs.length})`,
    });
    const descriptionPresent = Boolean(
      document.querySelector('meta[name="description"]')?.getAttribute("content"),
    );
    const pageType =
      document.querySelector("[data-tracking-page-type]")?.getAttribute("data-tracking-page-type") ||
      null;
    return {
      productName,
      documentTitle: documentTitle || null,
      ogTitle: ogTitle || null,
      canonicalUrl,
      productId,
      performer,
      maker,
      label,
      series,
      genre,
      releaseDate,
      price,
      availability,
      imageUrl,
      descriptionPresent,
      pageType,
      rowLabels: Object.keys(rows),
      headings: Array.from(document.querySelectorAll("h1,h2,[role='heading']"))
        .map((el) => clean(el.textContent))
        .filter(Boolean)
        .slice(0, 12),
      fieldExtraction,
    };
  });
}

/** Build minimal HTML so existing normalizePublicHtml / claims path can run. */
export function buildSyntheticHtmlFromExtraction(extracted: DomExtraction): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const name = extracted.productName ?? "";
  const lines = [
    extracted.maker ? `メーカー: ${esc(extracted.maker)}` : null,
    extracted.label ? `レーベル: ${esc(extracted.label)}` : null,
    extracted.series ? `シリーズ: ${esc(extracted.series)}` : null,
    extracted.performer ? `出演者: ${esc(extracted.performer)}` : null,
    extracted.releaseDate ? `配信開始日: ${esc(extracted.releaseDate)}` : null,
    extracted.price ? `価格: ${esc(extracted.price)}` : null,
    extracted.availability === "AVAILABLE" ? "販売中" : null,
    extracted.genre ? `ジャンル: ${esc(extracted.genre)}` : null,
    extracted.productId ? `品番: ${esc(extracted.productId)}` : null,
  ].filter(Boolean);

  return `<!doctype html><html><head>
<title>${esc(name)}</title>
${extracted.ogTitle ? `<meta property="og:title" content="${esc(extracted.ogTitle)}" />` : ""}
${extracted.canonicalUrl ? `<link rel="canonical" href="${esc(extracted.canonicalUrl)}" />` : ""}
${extracted.descriptionPresent ? `<meta name="description" content="public product description present" />` : ""}
</head><body>
<h1>${esc(name)}</h1>
${lines.map((l) => `<p>${l}</p>`).join("\n")}
${extracted.imageUrl ? `<img src="${esc(extracted.imageUrl)}" alt="" />` : ""}
</body></html>`;
}

function toDiagnose(
  extracted: DomExtraction,
  finalUrl: string,
  ageGateHandled: boolean,
  renderDurationMs: number,
  networkSummary: BrowserNetworkSummary[],
): FanzaBrowserDiagnose {
  return {
    finalUrl,
    documentTitle: extracted.documentTitle,
    visibleHeadings: extracted.headings,
    semanticLabels: extracted.rowLabels,
    detectedProductId: extracted.productId,
    detectedFieldNames: extracted.fieldExtraction.filter((f) => f.ok).map((f) => f.field),
    fieldExtraction: extracted.fieldExtraction,
    networkSummary,
    ageGateHandled,
    renderDurationMs,
  };
}
