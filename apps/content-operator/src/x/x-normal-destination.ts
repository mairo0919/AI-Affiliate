/**
 * X destinations are official FANZA/DMM product pages.
 * Affiliate URLs are never rewritten into a "normal" URL by stripping parameters.
 */

import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";

export const NORMAL_LINK_MIGRATION_MARKER = "normal-link-migration";
export const NORMAL_X_CTA_LABEL = "作品ページはこちら";

const CID_RE = /^[a-z0-9_-]{4,64}$/;

const WP_HOSTS = ["otonaselect.net", "otonaselect.mixh.jp"];
const REDIRECT_HOSTS = new Set([
  "t.co",
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "x.co",
]);

export type XDestinationClass =
  | "WORDPRESS"
  | "FANZA_NORMAL"
  | "FANZA_AFFILIATE"
  | "DMM_NORMAL"
  | "DMM_AFFILIATE"
  | "OTHER"
  | "UNKNOWN";

export type NormalXProductUrl =
  | { ok: true; url: string; source: "OFFICIAL_METADATA_URL" | "OFFICIAL_CONTENT_ID" }
  | { ok: false; reason: "NORMAL_URL_NOT_VERIFIED" };

export function publishingPauseActive(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "paused";
}

export function appendNormalLinkMarker(strategyVersion: string | null | undefined): string {
  const current = strategyVersion?.trim() || "x-strategy-v1";
  if (current.includes(NORMAL_LINK_MIGRATION_MARKER)) return current;
  return `${current}|${NORMAL_LINK_MIGRATION_MARKER}`;
}

export function officialIdentityFromRaw(raw: unknown): {
  contentId: string | null;
  productUrl: string | null;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { contentId: null, productUrl: null };
  }
  const record = raw as Record<string, unknown>;
  const contentId = record.contentId ?? record.content_id;
  const productUrl = record.URL ?? record.url;
  const urlText = typeof productUrl === "string" ? productUrl.trim() : "";
  return {
    contentId: typeof contentId === "string" ? contentId.trim().toLowerCase() : null,
    productUrl: urlText && !affiliateSignal(urlText) ? urlText : null,
  };
}

export function classifyXDestination(rawUrl: string | null | undefined): XDestinationClass {
  const raw = rawUrl?.trim() ?? "";
  if (!raw) return "UNKNOWN";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "UNKNOWN";
  }
  const host = url.hostname.toLowerCase();
  if (WP_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) return "WORDPRESS";
  if (host.includes("wordpress")) return "WORDPRESS";
  const affiliate = affiliateSignal(raw) || affiliateHost(host);
  if (host === "al.fanza.co.jp" || host.endsWith(".fanza.co.jp") || host === "fanza.co.jp") {
    return affiliate ? "FANZA_AFFILIATE" : "FANZA_NORMAL";
  }
  if (host === "dmm.co.jp" || host.endsWith(".dmm.co.jp")) {
    return affiliate ? "DMM_AFFILIATE" : "DMM_NORMAL";
  }
  if (affiliate) return "UNKNOWN";
  return "OTHER";
}

export function assertNormalXDestination(
  rawUrl: string | null | undefined,
  expectedCid: string | null | undefined,
): { ok: true; url: string } | { ok: false; code: "BLOCKED_INVALID_X_DESTINATION"; detail: string } {
  const expected = expectedCid?.trim().toLowerCase() ?? "";
  if (!CID_RE.test(expected)) {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "canonical_cid" };
  }
  const raw = rawUrl?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "unparseable" };
  }
  const host = url.hostname.toLowerCase();
  const kind = classifyXDestination(raw);
  if (kind === "WORDPRESS") {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "wordpress" };
  }
  if (kind === "FANZA_AFFILIATE" || kind === "DMM_AFFILIATE") {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "affiliate" };
  }
  if (REDIRECT_HOSTS.has(host)) {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "redirect" };
  }
  if (kind !== "FANZA_NORMAL" && kind !== "DMM_NORMAL") {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "host" };
  }
  if (affiliateSignal(raw) || url.searchParams.has("lurl")) {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "affiliate_parameter" };
  }
  const found = contentIdFromOfficialUrl(url, raw);
  if (!found || found !== expected) {
    return { ok: false, code: "BLOCKED_INVALID_X_DESTINATION", detail: "canonical_cid_mismatch" };
  }
  return { ok: true, url: raw };
}

export function resolveNormalXProductUrl(input: {
  canonicalCid: string | null | undefined;
  officialContentId: string | null | undefined;
  officialProductUrl: string | null | undefined;
}): NormalXProductUrl {
  const canonical = input.canonicalCid?.trim().toLowerCase() ?? "";
  const officialId = input.officialContentId?.trim().toLowerCase() ?? "";
  if (!CID_RE.test(canonical) || !CID_RE.test(officialId) || officialId !== canonical) {
    return { ok: false, reason: "NORMAL_URL_NOT_VERIFIED" };
  }
  const metadataUrl = input.officialProductUrl?.trim() ?? "";
  if (metadataUrl && !affiliateSignal(metadataUrl)) {
    const checked = assertNormalXDestination(metadataUrl, canonical);
    if (checked.ok) return { ok: true, url: checked.url, source: "OFFICIAL_METADATA_URL" };
  }
  const built = buildFanzaCanonicalProductUrl(officialId);
  const checked = assertNormalXDestination(built, canonical);
  if (!checked.ok) return { ok: false, reason: "NORMAL_URL_NOT_VERIFIED" };
  return { ok: true, url: checked.url, source: "OFFICIAL_CONTENT_ID" };
}

export function urlsInText(text: string): string[] {
  return text.match(/https?:\/\/[^\s)]+/giu) ?? [];
}

export function blockedDestinationDetail(text: string): string | null {
  for (const raw of urlsInText(text)) {
    const url = raw.replace(/[.,]+$/u, "");
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return "unparseable";
    }
    if (REDIRECT_HOSTS.has(host)) return "redirect";
    const kind = classifyXDestination(url);
    if (kind === "WORDPRESS") return "wordpress";
    if (kind === "FANZA_AFFILIATE" || kind === "DMM_AFFILIATE" || affiliateSignal(url)) {
      return "affiliate";
    }
    if (new URL(url).searchParams.has("lurl")) return "redirect";
  }
  return null;
}

export function isNormalOfficialCtaBody(body: string): boolean {
  const lines = body
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== NORMAL_X_CTA_LABEL) return false;
  const kind = classifyXDestination(lines[1] ?? "");
  return kind === "FANZA_NORMAL" || kind === "DMM_NORMAL";
}

export function reviewPassRootBody(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function composeNormalLinkPosts(input: {
  rootBody: string;
  url: string;
  canonicalCid: string;
}):
  | { ok: true; rootBody: string; ctaBody: string }
  | { ok: false; reason: "NORMAL_URL_NOT_VERIFIED" | "NO_REVIEW_PASS_TEXT" } {
  const rootBody = reviewPassRootBody(input.rootBody);
  if (!rootBody) return { ok: false, reason: "NO_REVIEW_PASS_TEXT" };
  const checked = assertNormalXDestination(input.url, input.canonicalCid);
  if (!checked.ok) return { ok: false, reason: "NORMAL_URL_NOT_VERIFIED" };
  return {
    ok: true,
    rootBody,
    ctaBody: `${NORMAL_X_CTA_LABEL}\n${checked.url}`,
  };
}

export type CanaryPostCheck = {
  pass: boolean;
  rootText: boolean;
  normalUrl: boolean;
  officialMedia: boolean;
  canonicalIdentity: boolean;
  wpAbsent: boolean;
  affiliateAbsent: boolean;
  wrongProduct: boolean;
};

function compactCopy(text: string): string {
  return reviewPassRootBody(text).replace(/\s+/gu, "");
}

function isXPlatformUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
    return host === "x.com" || host === "twitter.com" || host === "pic.x.com" || host === "pbs.twimg.com";
  } catch {
    return false;
  }
}

export function verifyCanaryPosts(input: {
  canonicalCid: string;
  expectedRoot: string;
  expectedUrl: string;
  rootText: string;
  ctaText: string;
  rootExpandedUrls: string[];
  ctaExpandedUrls: string[];
  rootMediaCount: number;
  ctaMediaCount: number;
  sentMediaMatchesCid: boolean;
}): CanaryPostCheck {
  const rootText = compactCopy(input.rootText) === compactCopy(input.expectedRoot) && compactCopy(input.expectedRoot).length > 0;
  const rootDestinations = input.rootExpandedUrls.filter((url) => !isXPlatformUrl(url));
  const ctaDestinations = input.ctaExpandedUrls.filter((url) => !isXPlatformUrl(url));
  const expanded = [...rootDestinations, ...ctaDestinations];
  const display = `${input.rootText}\n${input.ctaText}`;
  const wpAbsent =
    !/otonaselect\.net|wordpress/iu.test(display) &&
    expanded.every((url) => classifyXDestination(url) !== "WORDPRESS");
  const affiliateAbsent =
    !/(?:^|[?&])(?:af_id|affiliate_id)=|al\.fanza\.co\.jp|al\.dmm\.co\.jp|affiliate\./iu.test(display) &&
    expanded.every((url) => {
      const kind = classifyXDestination(url);
      return kind !== "FANZA_AFFILIATE" && kind !== "DMM_AFFILIATE";
    });
  const expected = assertNormalXDestination(input.expectedUrl, input.canonicalCid);
  const ctaOk = ctaDestinations.some(
    (url) => assertNormalXDestination(url, input.canonicalCid).ok && url === input.expectedUrl,
  );
  const expandedOk = expanded.every((url) => assertNormalXDestination(url, input.canonicalCid).ok);
  const normalUrl = expected.ok && ctaOk && expandedOk && affiliateAbsent && wpAbsent;
  const wrongProduct = expanded.some((url) => {
    const checked = assertNormalXDestination(url, input.canonicalCid);
    return !checked.ok && checked.detail === "canonical_cid_mismatch";
  });
  const officialMedia =
    input.sentMediaMatchesCid && input.rootMediaCount > 0 && input.ctaMediaCount === 0;
  const canonicalIdentity = normalUrl && !wrongProduct;
  const pass = rootText && normalUrl && officialMedia && canonicalIdentity && wpAbsent && affiliateAbsent && !wrongProduct;
  return {
    pass,
    rootText,
    normalUrl,
    officialMedia,
    canonicalIdentity,
    wpAbsent,
    affiliateAbsent,
    wrongProduct,
  };
}

export function nextFutureJstSlots(count: number, now: Date, hours: readonly number[] = [12, 18, 23]): Date[] {
  const slots: Date[] = [];
  if (count <= 0) return slots;
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  for (let day = 0; day < 40 && slots.length < count; day += 1) {
    for (const hour of hours) {
      const slot = new Date(
        Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + day, hour - 9, 0, 0),
      );
      if (slot.getTime() <= now.getTime()) continue;
      slots.push(slot);
      if (slots.length >= count) break;
    }
  }
  return slots;
}

function affiliateHost(host: string): boolean {
  return host.startsWith("al.") || host.includes("affiliate");
}

function affiliateSignal(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return /(?:^|[?&])(?:af_id|affiliate_id)=|affiliate/iu.test(raw);
  }
  if (affiliateHost(url.hostname.toLowerCase())) return true;
  for (const [key] of url.searchParams) {
    const name = key.toLowerCase();
    if (name === "af_id" || name === "affiliate_id" || name.includes("affiliate")) return true;
  }
  return false;
}

function contentIdFromOfficialUrl(url: URL, raw: string): string | null {
  if (url.searchParams.has("lurl")) return null;
  for (const key of ["id", "cid", "content_id"]) {
    const value = url.searchParams.get(key)?.trim().toLowerCase() ?? "";
    if (CID_RE.test(value)) return value;
  }
  const fromPath = raw.match(/(?:^|[/=])cid=([a-z0-9_-]+)/iu)?.[1]?.toLowerCase() ?? "";
  return CID_RE.test(fromPath) ? fromPath : null;
}
