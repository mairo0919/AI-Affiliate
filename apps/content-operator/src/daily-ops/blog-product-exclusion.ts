/**
 * Daily PRODUCT article exclusion — already articled products leave the normal pool.
 * Provider-agnostic: matches on normalized product keys (with or without provider: prefix).
 * Does not permanently ban future article kinds (re-review / roundup).
 */

import type { ChannelPublicationRecord } from "./channel-duplicate.js";

/**
 * Normalize product identity across AffiliateProviders.
 * Examples: `fanza:ofje00230`, `ofje00230-run1`, `amazon:B0XXXX` → stable compare keys.
 */
export function normalizeProductKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.trim().toLowerCase();
  if (!t) return null;
  t = t.replace(/^[a-z][a-z0-9_-]{0,32}:/, "");
  t = t.replace(/^cid=/i, "");
  if (t.includes("/")) {
    t = t.split("/").filter(Boolean).pop() ?? t;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return t;
  }
  const head = t.split("-")[0] ?? t;
  if (/^[a-z0-9]{3,64}$/i.test(head) && /\d/.test(head)) {
    return head;
  }
  if (/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(t)) return t;
  return t || null;
}

/** @deprecated Use normalizeProductKey — kept for call-site compatibility. */
export function baseProductCid(raw: string | null | undefined): string | null {
  return normalizeProductKey(raw);
}

export function isProductAlreadyArticledForDailyBlog(input: {
  canonicalId: string;
  history: ChannelPublicationRecord[];
}): { excluded: boolean; reason: string | null; matchedCanonicalId: string | null } {
  const target = normalizeProductKey(input.canonicalId);
  if (!target) {
    return { excluded: false, reason: null, matchedCanonicalId: null };
  }
  for (const h of input.history) {
    if (h.channel !== "BLOG") continue;
    const prior = normalizeProductKey(h.canonicalId);
    if (prior && prior === target) {
      return {
        excluded: true,
        reason: "daily_blog_product_already_articled",
        matchedCanonicalId: prior,
      };
    }
  }
  return { excluded: false, reason: null, matchedCanonicalId: null };
}

export function filterPoolExcludingArticledBlogProducts<T extends { canonicalId: string }>(
  pool: T[],
  history: ChannelPublicationRecord[],
): { eligible: T[]; excluded: Array<{ canonicalId: string; reason: string }> } {
  const eligible: T[] = [];
  const excluded: Array<{ canonicalId: string; reason: string }> = [];
  for (const c of pool) {
    const gate = isProductAlreadyArticledForDailyBlog({
      canonicalId: c.canonicalId,
      history,
    });
    if (gate.excluded) {
      excluded.push({
        canonicalId: c.canonicalId,
        reason: gate.reason ?? "daily_blog_product_already_articled",
      });
    } else {
      eligible.push(c);
    }
  }
  return { eligible, excluded };
}
