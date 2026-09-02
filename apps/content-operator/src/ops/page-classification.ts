import { assertSafeOutboundUrl, SsrfBlockedError } from "@ai-affiliate/shared";
import { detectJsAppShell } from "./page-diagnose.js";

/**
 * Minimal page access classification for Research.
 * Blocks login / age / consent / error / challenge pages from being treated as products.
 */

export type PageAccessClass =
  | "content_page"
  | "age_gate"
  | "login_page"
  | "consent_page"
  | "access_denied"
  | "bot_challenge"
  | "error_page"
  | "unknown";

export type ResearchAccessOutcome =
  | "ok"
  | "manual_review_required"
  | "source_access_blocked";

export interface PageClassification {
  classification: PageAccessClass;
  reason: string;
  /** True only when page may feed Product / Topic / SUPPORTED claims */
  canUseAsProductSource: boolean;
  outcome: ResearchAccessOutcome;
}

const AGE_TITLE =
  /^(年齢認証(\s*[-–|]\s*FANZA)?|age\s*verification|age\s*check|are you (over|18)|adult verification)(\b|$)/i;
const LOGIN_TITLE = /(^|[^a-z0-9_])(login|sign\s*in|ログ[イィ]ン|会員認証|認証が必要)([^a-z0-9_]|$)/i;
const CONSENT_TITLE = /(cookie\s*consent|consent|同意|プライバシー同意|gdpr)/i;
const DENIED_TITLE = /(access\s*denied|forbidden|\b403\b|アクセス拒否|閲覧できません)/i;
const BOT_TITLE = /(captcha|cloudflare|attention required|just a moment|bot\s*check|ロボット|確認して)/i;
const ERROR_TITLE = /(^|\b)(error|not\s*found|404|500|ページが見つかり|エラー)/i;

const AGE_BODY =
  /年齢認証|adult content|18歳未満|under\s*18|年齢確認|age\s*verification/i;
const LOGIN_BODY = /\b(password|パスワード|sign\s*in|ログインしてください)\b/i;
const BOT_BODY = /\bcaptcha|cf-browser-verification|challenge-platform|ロボットでない/i;
const DENIED_BODY = /\b403 forbidden|access denied|アクセスが拒否/i;
const ERROR_BODY = /\b404 not found|internal server error|ページが見つかりません/i;

const BLOCKED_PRODUCT_NAMES =
  /^(年齢認証|age\s*verification|login|サインイン|アクセス拒否|error|not\s*found|just a moment)$/i;

export function isDmmFanzaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "dmm.co.jp" ||
    h.endsWith(".dmm.co.jp") ||
    h === "fanza.co.jp" ||
    h.endsWith(".fanza.co.jp") ||
    h === "dmm.com" ||
    h.endsWith(".dmm.com")
  );
}

export function isAgeCheckUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\/age_check(?:\/|$)/i.test(u.pathname);
  } catch {
    return /dmm\.co\.jp\/age_check/i.test(url);
  }
}

/**
 * Decode and validate age_check `rurl` (URL-encoded product URL).
 * Rejects malformed, non-http(s), SSRF-unsafe, and non-DMM/FANZA hosts.
 */
export function extractAndValidateAgeCheckRurl(ageCheckUrl: string): {
  ok: true;
  rurl: string;
} | {
  ok: false;
  reason: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(ageCheckUrl);
  } catch {
    return { ok: false, reason: "invalid_age_check_url" };
  }
  if (!isDmmFanzaHost(parsed.hostname)) {
    return { ok: false, reason: "age_check_host_not_allowed" };
  }
  if (!isAgeCheckUrl(ageCheckUrl)) {
    return { ok: false, reason: "not_age_check_url" };
  }

  const raw =
    parsed.searchParams.get("rurl") ??
    extractRurlFromPath(parsed.pathname + parsed.search);
  if (!raw) {
    return { ok: false, reason: "missing_rurl" };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.trim());
  } catch {
    return { ok: false, reason: "malformed_rurl_encoding" };
  }

  // Some gates nest encoding; decode once more if still encoded.
  if (/^https?%3A/i.test(decoded)) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return { ok: false, reason: "malformed_rurl_encoding" };
    }
  }

  if (!/^https?:\/\//i.test(decoded)) {
    return { ok: false, reason: "malformed_rurl_not_url" };
  }

  try {
    const safe = assertSafeOutboundUrl(decoded);
    if (!isDmmFanzaHost(safe.hostname)) {
      return { ok: false, reason: "rurl_host_not_allowed" };
    }
    if (isAgeCheckUrl(safe.toString())) {
      return { ok: false, reason: "rurl_is_age_check" };
    }
    return { ok: true, rurl: safe.toString() };
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return { ok: false, reason: "rurl_ssrf_blocked" };
    }
    return { ok: false, reason: "rurl_invalid" };
  }
}

function extractRurlFromPath(pathAndQuery: string): string | null {
  const m = /[?&/]rurl=([^&/]+)/i.exec(pathAndQuery);
  return m?.[1] ?? null;
}

/** Prefer the site's own 「はい」 / declared=yes link from age_check HTML. */
export function extractDeclaredYesUrl(html: string, ageCheckUrl: string): string | null {
  const patterns = [
    /href=["']([^"']*declared=yes[^"']*)["']/i,
    /href=["']([^"']*\/age_check\/[^"']*declared=yes[^"']*)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (!m?.[1]) continue;
    try {
      const abs = new URL(m[1], ageCheckUrl).toString();
      assertSafeOutboundUrl(abs);
      if (isDmmFanzaHost(new URL(abs).hostname) && /declared=yes/i.test(abs)) {
        return abs;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Build declared=yes URL only when host/path match the age_check page we already fetched.
 * Path shape matches links observed on DMM age_check HTML (not an invented cookie bypass).
 */
export function buildDeclaredYesUrl(ageCheckUrl: string, rurl: string): string | null {
  try {
    const base = new URL(ageCheckUrl);
    if (!isDmmFanzaHost(base.hostname) || !isAgeCheckUrl(ageCheckUrl)) return null;
    const validated = extractAndValidateAgeCheckRurl(
      `${base.origin}/age_check/=/?rurl=${encodeURIComponent(rurl)}`,
    );
    if (!validated.ok) return null;
    return `${base.origin}/age_check/=/declared=yes/?rurl=${encodeURIComponent(validated.rurl)}`;
  } catch {
    return null;
  }
}

export function classifyPublicPage(input: {
  url: string;
  finalUrl?: string;
  title: string | null;
  text: string;
  html?: string;
  /** Observed product-like facts (maker/series/price/release/cid) */
  hasProductSignals?: boolean;
}): PageClassification {
  const url = input.finalUrl ?? input.url;
  const title = (input.title ?? "").trim();
  const text = input.text.slice(0, 8_000);
  const html = input.html?.slice(0, 20_000) ?? "";

  if (isAgeCheckUrl(url) || isAgeCheckUrl(input.url) || AGE_TITLE.test(title)) {
    return blocked("age_gate", "age_check_or_age_title", "source_access_blocked");
  }
  if (AGE_BODY.test(title) && !input.hasProductSignals) {
    return blocked("age_gate", "age_gate_title_body", "source_access_blocked");
  }
  // Age gate body without product signals (short interstitial)
  if (
    AGE_BODY.test(text) &&
    !input.hasProductSignals &&
    (text.length < 1_200 || /18歳未満|under\s*18/i.test(text))
  ) {
    return blocked("age_gate", "age_gate_interstitial", "source_access_blocked");
  }

  if (LOGIN_TITLE.test(title) || (LOGIN_BODY.test(text) && /login|ログイン/i.test(url + title))) {
    return blocked("login_page", "login_page_detected", "source_access_blocked");
  }
  if (CONSENT_TITLE.test(title) && !input.hasProductSignals) {
    return blocked("consent_page", "consent_page_detected", "manual_review_required");
  }
  if (DENIED_TITLE.test(title) || DENIED_BODY.test(text)) {
    return blocked("access_denied", "access_denied_detected", "source_access_blocked");
  }
  if (BOT_TITLE.test(title) || BOT_BODY.test(html) || BOT_BODY.test(text)) {
    return blocked("bot_challenge", "bot_challenge_detected", "source_access_blocked");
  }
  if (ERROR_TITLE.test(title) || ERROR_BODY.test(text)) {
    return blocked("error_page", "error_page_detected", "manual_review_required");
  }

  if (BLOCKED_PRODUCT_NAMES.test(title) || BLOCKED_PRODUCT_NAMES.test(cleanName(title))) {
    return blocked("age_gate", "blocked_product_name", "source_access_blocked");
  }

  const visibleTextLength = text.replace(/\s+/g, " ").trim().length;
  const productIdInUrl = (() => {
    try {
      return new URL(url).searchParams.get("id");
    } catch {
      return null;
    }
  })();
  if (
    detectJsAppShell(html.length > 0 ? html : text, {
      titlePresent: Boolean(title && title.length >= 2),
      productIdPresent: productIdInUrl ? (html.includes(productIdInUrl) || text.includes(productIdInUrl)) : false,
      visibleTextLength,
    })
  ) {
    return {
      classification: "unknown",
      reason: "js_app_shell_no_product_data",
      canUseAsProductSource: false,
      outcome: "manual_review_required",
    };
  }

  if (!title || title.length < 2) {
    return {
      classification: "unknown",
      reason: "missing_meaningful_title",
      canUseAsProductSource: false,
      outcome: "manual_review_required",
    };
  }

  if (!input.hasProductSignals && !looksLikeProductUrl(url)) {
    return {
      classification: "unknown",
      reason: "insufficient_product_signals",
      canUseAsProductSource: false,
      outcome: "manual_review_required",
    };
  }

  return {
    classification: "content_page",
    reason: "valid_content_or_product_page",
    canUseAsProductSource: true,
    outcome: "ok",
  };
}

export function looksLikeProductUrl(url: string): boolean {
  return /cid=|\/detail\/|\/product\/|\/content\/\?id=/i.test(url);
}

export function isBlockedProductName(name: string | null | undefined): boolean {
  if (!name) return true;
  return BLOCKED_PRODUCT_NAMES.test(name.trim()) || BLOCKED_PRODUCT_NAMES.test(cleanName(name));
}

function cleanName(title: string): string {
  return title.replace(/\s*[|\-–].*$/, "").trim();
}

function blocked(
  classification: PageAccessClass,
  reason: string,
  outcome: ResearchAccessOutcome,
): PageClassification {
  return {
    classification,
    reason,
    canUseAsProductSource: false,
    outcome,
  };
}
