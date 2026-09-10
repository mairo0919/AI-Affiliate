/**
 * Official FANZA/DMM image size-variant helpers.
 * Prefer the largest known official URL for the same content key.
 * Never invents unrelated images; only rewrites known size suffixes.
 */

import { imageContentKey, isTrustedDmmImageUrl } from "./article-images.js";

export type OfficialImageVariantUpgrade = {
  fromUrl: string;
  toUrl: string;
  contentKey: string;
  fromQuality: number;
  toQuality: number;
  reason: "package_ps_pt_to_pl" | "sample_js_to_jp" | "sample_strip_to_jp";
};

/** Propose the max official URL for a known size variant (may or may not exist on CDN). */
export function proposeMaxOfficialImageUrl(sourceUrl: string): OfficialImageVariantUpgrade | null {
  if (!isTrustedDmmImageUrl(sourceUrl)) return null;
  let u: URL;
  try {
    u = new URL(sourceUrl);
  } catch {
    return null;
  }
  const file = u.pathname.split("/").pop() ?? "";
  const identity = imageContentKey(sourceUrl);
  if (!identity) return null;

  const pkg = file.match(/^([a-z0-9_]+)(ps|pt)\.(jpe?g|webp|png)$/i);
  if (pkg) {
    const next = file.replace(/(ps|pt)\./i, "pl.");
    const toUrl = `${u.origin}${u.pathname.replace(file, next)}${u.search}`;
    return {
      fromUrl: sourceUrl,
      toUrl,
      contentKey: identity.contentKey,
      fromQuality: identity.qualityHint,
      toQuality: 100,
      reason: "package_ps_pt_to_pl",
    };
  }

  const js = file.match(/^([a-z0-9_]+)js-(\d+)\.(jpe?g|webp|png)$/i);
  if (js) {
    const next = file.replace(/js-/i, "jp-");
    const toUrl = `${u.origin}${u.pathname.replace(file, next)}${u.search}`;
    return {
      fromUrl: sourceUrl,
      toUrl,
      contentKey: identity.contentKey,
      fromQuality: identity.qualityHint,
      toQuality: 100,
      reason: "sample_js_to_jp",
    };
  }

  const strip = file.match(/^([a-z0-9_]+)-(\d+)\.(jpe?g|webp|png)$/i);
  if (strip && !/j[ps]-\d+\./i.test(file)) {
    const cid = strip[1]!;
    const n = strip[2]!;
    const ext = strip[0]!.split(".").pop()!;
    const next = `${cid}jp-${n}.${ext}`;
    const toUrl = `${u.origin}${u.pathname.replace(file, next)}${u.search}`;
    return {
      fromUrl: sourceUrl,
      toUrl,
      contentKey: identity.contentKey,
      fromQuality: identity.qualityHint,
      toQuality: 100,
      reason: "sample_strip_to_jp",
    };
  }

  return null;
}

/** HEAD/GET existence check for a candidate upgrade URL. */
export async function officialImageUrlExists(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const head = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
    if (head.ok) return true;
    if (head.status === 403 || head.status === 405) {
      const get = await fetchImpl(url, {
        method: "GET",
        headers: { Range: "bytes=0-1023" },
        redirect: "follow",
      });
      return get.ok || get.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

export type ImagePixelSize = { width: number; height: number };

/** Probe JPEG/PNG dimensions from a small byte range (no full download). */
export async function probeImagePixelSize(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImagePixelSize | null> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Range: "bytes=0-131071" },
      redirect: "follow",
    });
    if (!res.ok && res.status !== 206) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return parseImageDimensions(buf);
  } catch {
    return null;
  }
}

export function parseImageDimensions(buf: Buffer): ImagePixelSize | null {
  if (buf.length < 24) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
    return null;
  }
  // JPEG
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const size = buf.readUInt16BE(i + 2);
    // SOF0 / SOF2
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    i += 2 + size;
  }
  return null;
}

/**
 * Upgrade a candidate URL to max official variant when the target exists.
 * Returns original URL when no upgrade or target missing.
 */
export async function resolveMaxOfficialImageUrl(
  sourceUrl: string,
  opts?: {
    fetchImpl?: typeof fetch;
    /** Known alternate URLs already in Evidence (preferred without HEAD). */
    evidenceUrls?: string[] | null;
  },
): Promise<{ url: string; upgraded: boolean; upgrade: OfficialImageVariantUpgrade | null }> {
  const upgrade = proposeMaxOfficialImageUrl(sourceUrl);
  if (!upgrade) return { url: sourceUrl, upgraded: false, upgrade: null };

  const evidence = opts?.evidenceUrls ?? [];
  const evidenceHit = evidence.find((u) => u === upgrade.toUrl);
  if (evidenceHit) {
    return { url: evidenceHit, upgraded: true, upgrade };
  }

  // Prefer same contentKey higher-quality URL already present in Evidence.
  const fromKey = imageContentKey(sourceUrl);
  if (fromKey) {
    let best: { url: string; q: number } | null = null;
    for (const u of evidence) {
      const id = imageContentKey(u);
      if (!id || id.contentKey !== fromKey.contentKey) continue;
      if (!best || id.qualityHint > best.q) best = { url: u, q: id.qualityHint };
    }
    if (best && best.q > fromKey.qualityHint) {
      return {
        url: best.url,
        upgraded: true,
        upgrade: { ...upgrade, toUrl: best.url, toQuality: best.q },
      };
    }
  }

  const exists = await officialImageUrlExists(upgrade.toUrl, opts?.fetchImpl);
  if (!exists) return { url: sourceUrl, upgraded: false, upgrade };
  return { url: upgrade.toUrl, upgraded: true, upgrade };
}
