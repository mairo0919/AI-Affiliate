/**
 * Safe page diagnostics for Research — never returns HTML, cookie values, or secrets.
 */

export interface PageDiagnoseReport {
  status: number | null;
  finalUrl: string;
  redirectCount: number;
  contentType: string | null;
  byteLength: number;
  titlePresent: boolean;
  ogTitlePresent: boolean;
  jsonLdPresent: boolean;
  hydrationDataPresent: boolean;
  nextFlightPresent: boolean;
  productIdPresent: boolean;
  detectedGate: string | null;
  cookieNames: string[];
  selectedNormalizer: string;
  extractionFailures: string[];
  jsAppShell: boolean;
  visibleTextLength: number;
}

export function diagnoseHtmlBody(input: {
  html: string;
  finalUrl: string;
  status?: number | null;
  contentType?: string | null;
  redirectCount?: number;
  cookieNames?: string[];
  productIdFromUrl?: string | null;
}): PageDiagnoseReport {
  const html = input.html;
  const titlePresent = /<title[^>]*>\s*[^<\s][^<]*<\/title>/i.test(html);
  const ogTitlePresent = /property=["']og:title["']/i.test(html);
  const jsonLdPresent = /application\/ld\+json/i.test(html);
  const nextFlightPresent = /self\.__next_f\.push/i.test(html);
  const hydrationDataPresent =
    nextFlightPresent ||
    /id=["']__NEXT_DATA__["']/i.test(html) ||
    /__NUXT__|id=["']__NUXT_DATA__["']/i.test(html) ||
    /__INITIAL_STATE__/i.test(html);
  const productId = input.productIdFromUrl ?? extractProductIdFromUrl(input.finalUrl);
  const productIdPresent = productId ? html.includes(productId) : false;
  const visibleTextLength = stripHtml(html).length;
  const jsAppShell = detectJsAppShell(html, {
    titlePresent,
    productIdPresent,
    visibleTextLength,
  });

  const extractionFailures: string[] = [];
  if (!titlePresent) extractionFailures.push("html_title_missing");
  if (!ogTitlePresent) extractionFailures.push("og_title_missing");
  if (!jsonLdPresent) extractionFailures.push("json_ld_missing");
  if (jsAppShell) extractionFailures.push("js_app_shell_no_static_product_fields");
  if (productId && !productIdPresent) extractionFailures.push("product_id_not_in_body");

  return {
    status: input.status ?? null,
    finalUrl: input.finalUrl,
    redirectCount: input.redirectCount ?? 0,
    contentType: input.contentType ?? null,
    byteLength: Buffer.byteLength(html, "utf8"),
    titlePresent,
    ogTitlePresent,
    jsonLdPresent,
    hydrationDataPresent,
    nextFlightPresent,
    productIdPresent,
    detectedGate: detectGateLabel(html, input.finalUrl),
    cookieNames: [...new Set(input.cookieNames ?? [])],
    selectedNormalizer: jsAppShell ? "blocked:js_app_shell" : "html-normalize",
    extractionFailures,
    jsAppShell,
    visibleTextLength,
  };
}

export function detectJsAppShell(
  html: string,
  signals: { titlePresent: boolean; productIdPresent: boolean; visibleTextLength: number },
): boolean {
  const nextApp =
    /\/_next\/static\/chunks\/(main-app|app\/)/i.test(html) ||
    /self\.__next_f\.push/i.test(html);
  if (!nextApp) return false;
  // Shell: Next app markers present but no static product title/body/id payload.
  return (
    !signals.titlePresent &&
    signals.visibleTextLength < 40 &&
    !signals.productIdPresent &&
    !/application\/ld\+json/i.test(html) &&
    !/property=["']og:title["']/i.test(html)
  );
}

export function extractProductIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("id") ?? (/cid=([^%/]+)/i.exec(u.pathname)?.[1] ?? null);
  } catch {
    return null;
  }
}

function detectGateLabel(html: string, url: string): string | null {
  if (/\/age_check/i.test(url) || /年齢認証/i.test(html.slice(0, 2_000))) return "age_gate";
  if (/ログイン|sign\s*in/i.test(html.slice(0, 2_000))) return "login_page";
  if (/captcha|cf-browser-verification|challenge-platform/i.test(html)) return "bot_challenge";
  if (/access denied|403 forbidden|アクセス拒否/i.test(html.slice(0, 2_000))) return "access_denied";
  if (detectJsAppShell(html, {
    titlePresent: /<title[^>]*>\s*[^<\s][^<]*<\/title>/i.test(html),
    productIdPresent: false,
    visibleTextLength: stripHtml(html).length,
  })) {
    return "js_app_shell";
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
