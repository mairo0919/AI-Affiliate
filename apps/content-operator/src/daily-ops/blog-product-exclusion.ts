/**
 * Daily PRODUCT article exclusion — already articled products leave the normal pool.
 * Does not permanently ban future article kinds (re-review / roundup); those paths
 * must opt in explicitly later. This module is for normal daily-ops PRODUCT selection.
 */

import { normalizeCid } from "../daily-blog/product-identity.js";
import type { ChannelPublicationRecord } from "./channel-duplicate.js";

/**
 * Extract base FANZA content id for matching (ofje00230 from ofje00230-…).
 */
export function baseProductCid(raw: string | null | undefined): string | null {
  const n = normalizeCid(raw);
  if (!n) return null;
  const head = n.split("-")[0] ?? n;
  if (/^[a-z][a-z0-9]{2,31}$/i.test(head) && /\d/.test(head)) {
    return head.toLowerCase();
  }
  return n;
}

export function isProductAlreadyArticledForDailyBlog(input: {
  canonicalId: string;
  history: ChannelPublicationRecord[];
}): { excluded: boolean; reason: string | null; matchedCanonicalId: string | null } {
  const target = baseProductCid(input.canonicalId);
  if (!target) {
    return { excluded: false, reason: null, matchedCanonicalId: null };
  }
  for (const h of input.history) {
    if (h.channel !== "BLOG") continue;
    const prior = baseProductCid(h.canonicalId);
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
