/**
 * Stable affiliate product external IDs for public-URL registration.
 * Never use fixed-length prefixes of base64(url) — they collide across FANZA ids.
 */

import { createHash } from "node:crypto";

/**
 * Prefer platform content id from URL; else full-hash of canonical URL.
 * Deterministic, stable, collision-resistant for distinct URLs.
 */
export function stablePublicUrlProductExternalId(url: string): string {
  const raw = url.trim();
  const fromQuery = /[?&]id=([^&/#]+)/i.exec(raw)?.[1];
  const fromCidPath = /[?&/]cid=([^&/#]+)/i.exec(raw)?.[1];
  const fromDetail = /\/detail\/=\/cid=([^/]+)\//i.exec(raw)?.[1];
  const contentId = decodeURIComponent(fromQuery ?? fromCidPath ?? fromDetail ?? "").trim();
  if (contentId && /^[A-Za-z0-9_-]{3,80}$/.test(contentId)) {
    return `cid-${contentId}`;
  }
  const canonical = canonicalizeProductUrl(raw);
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `urlh-${hash}`;
}

export function canonicalizeProductUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // drop volatile affiliate params
    for (const key of [...u.searchParams.keys()]) {
      if (/^(af_id|ch|utm_|gclid|fbclid)/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.toLowerCase();
    let path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
