/**
 * Audit WordPress product posts for small/low-quality FANZA image variants
 * and rewrite img src to the max official size when available.
 * Does not change body text, titles, taxonomy, dates, or rights status.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { imageContentKey, isTrustedDmmImageUrl } from "../generation/article-images.js";
import {
  officialImageUrlExists,
  probeImagePixelSize,
  proposeMaxOfficialImageUrl,
  resolveMaxOfficialImageUrl,
} from "../generation/fanza-image-variants.js";

export type SmallImageCause = "A_evidence_has_larger" | "B_fanza_has_larger" | "C_only_small" | "D_unknown";

export type ImageAuditRow = {
  postId: string;
  productId: string | null;
  researchItemId: string | null;
  imageUrl: string;
  contentKey: string | null;
  family: string | null;
  qualityHint: number | null;
  width: number | null;
  height: number | null;
  under500: boolean;
  cause: SmallImageCause | null;
  upgradeUrl: string | null;
  researchImageId: string | null;
};

export type PostImageFixResult = {
  postId: string;
  status: string;
  productId: string | null;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  imageCount: number;
  under500Count: number;
  replacedCount: number;
  removedDuplicateCount: number;
  bodyTextUnchanged: boolean;
  dateUnchanged: boolean;
  beforeMaxUnder500: number | null;
  afterMaxUnder500: number | null;
  sampleReplacements: Array<{ from: string; to: string; beforePx: number | null; afterPx: number | null }>;
};

function wpAuth(config: AppConfig): { base: string; auth: string; ns: string } | null {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) return null;
  return {
    base,
    auth: Buffer.from(`${user}:${pass}`).toString("base64"),
    ns: config.wordpressApiNamespace || "wp/v2",
  };
}

async function listProductPostIds(config: AppConfig): Promise<
  Array<{ id: string; status: string; date: string | null }>
> {
  const wp = wpAuth(config);
  if (!wp) return [];
  const out: Array<{ id: string; status: string; date: string | null }> = [];
  let page = 1;
  for (;;) {
    const url = `${wp.base}/wp-json/${wp.ns}/posts?status=publish,future,draft&per_page=100&page=${page}&_fields=id,status,date,type`;
    const res = await fetch(url, { headers: { Authorization: `Basic ${wp.auth}` } });
    if (!res.ok) break;
    const rows = (await res.json()) as Array<{ id?: number; status?: string; date?: string; type?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      if (!row.id) continue;
      if (row.type && row.type !== "post") continue;
      out.push({
        id: String(row.id),
        status: String(row.status ?? ""),
        date: row.date ?? null,
      });
    }
    if (rows.length < 100) break;
    page += 1;
  }
  return out;
}

function extractImgUrls(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]!).filter(Boolean);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<\/?figure[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rewrite img src and drop lower-quality duplicates of the same content key. */
export function rewriteHtmlImageUrls(
  html: string,
  replacements: Map<string, string>,
): { html: string; replacedCount: number; removedDuplicateCount: number } {
  let replacedCount = 0;
  let next = html.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (full, src: string) => {
    const to = replacements.get(src);
    if (!to || to === src) return full;
    replacedCount += 1;
    return full.replace(src, to);
  });

  const seenKeys = new Set<string>();
  let removedDuplicateCount = 0;
  next = next.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (figure) => {
    const m = figure.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (!m?.[1]) return figure;
    const id = imageContentKey(m[1]);
    const key = id?.contentKey ?? m[1];
    if (seenKeys.has(key)) {
      removedDuplicateCount += 1;
      return "";
    }
    seenKeys.add(key);
    return figure;
  });

  return { html: next.replace(/\n{3,}/g, "\n\n"), replacedCount, removedDuplicateCount };
}

async function loadProductContext(
  prisma: DatabaseClient["prisma"],
  postId: string,
): Promise<{
  productId: string | null;
  researchItemId: string | null;
  evidenceUrls: string[];
  researchByUrl: Map<string, string>;
}> {
  const target = await prisma.publicationTarget.findFirst({
    where: { platform: "WORDPRESS", publishedExternalId: postId },
    select: { contentVersionId: true },
  });
  if (!target) {
    return { productId: null, researchItemId: null, evidenceUrls: [], researchByUrl: new Map() };
  }
  const version = await prisma.contentVersion.findUnique({
    where: { id: target.contentVersionId },
    select: { structuredContent: true },
  });
  const sc =
    version?.structuredContent && typeof version.structuredContent === "object"
      ? (version.structuredContent as Record<string, unknown>)
      : {};
  const productId =
    (typeof sc.productCanonicalId === "string" && sc.productCanonicalId) ||
    (typeof sc.productKey === "string" && sc.productKey) ||
    null;
  if (!productId) {
    return { productId: null, researchItemId: null, evidenceUrls: [], researchByUrl: new Map() };
  }
  const item = await prisma.researchItem.findFirst({
    where: {
      OR: [
        { externalId: { equals: productId, mode: "insensitive" } },
        { externalId: { startsWith: productId.toLowerCase(), mode: "insensitive" } },
      ],
    },
    orderBy: { collectedAt: "desc" },
    include: { images: true },
  });
  const evidenceUrls = (item?.images ?? []).map((i) => i.sourceUrl).filter(Boolean);
  const researchByUrl = new Map<string, string>();
  for (const img of item?.images ?? []) {
    researchByUrl.set(img.sourceUrl, img.id);
  }
  return {
    productId,
    researchItemId: item?.id ?? null,
    evidenceUrls,
    researchByUrl,
  };
}

export async function auditAndUpgradeWordPressImageResolutions(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  /** When true, write upgraded HTML back to WordPress. */
  apply: boolean;
  postIds?: string[];
}): Promise<{
  postsScanned: number;
  imageTotal: number;
  under500Count: number;
  postsWithUnder500: number;
  causeA: number;
  causeB: number;
  causeC: number;
  causeD: number;
  postsFixed: number;
  imagesReplaced: number;
  maxImprovement: { postId: string; before: number; after: number } | null;
  post74?: { before: number | null; after: number | null };
  rows: PostImageFixResult[];
  imageRows: ImageAuditRow[];
}> {
  const wp = wpAuth(input.config);
  if (!wp) {
    throw new Error("WordPress credentials missing");
  }

  const posts =
    input.postIds && input.postIds.length > 0
      ? input.postIds.map((id) => ({ id: String(id), status: "unknown", date: null }))
      : await listProductPostIds(input.config);

  const imageRows: ImageAuditRow[] = [];
  const rows: PostImageFixResult[] = [];
  let imageTotal = 0;
  let under500Count = 0;
  let postsWithUnder500 = 0;
  let causeA = 0;
  let causeB = 0;
  let causeC = 0;
  let causeD = 0;
  let postsFixed = 0;
  let imagesReplaced = 0;
  let maxImprovement: { postId: string; before: number; after: number } | null = null;
  let post74Before: number | null = null;
  let post74After: number | null = null;

  for (const post of posts) {
    const res = await fetch(`${wp.base}/wp-json/${wp.ns}/posts/${post.id}?context=edit`, {
      headers: { Authorization: `Basic ${wp.auth}` },
    });
    if (!res.ok) {
      rows.push({
        postId: post.id,
        status: post.status,
        productId: null,
        ok: false,
        reason: `WP_FETCH_${res.status}`,
        imageCount: 0,
        under500Count: 0,
        replacedCount: 0,
        removedDuplicateCount: 0,
        bodyTextUnchanged: true,
        dateUnchanged: true,
        beforeMaxUnder500: null,
        afterMaxUnder500: null,
        sampleReplacements: [],
      });
      continue;
    }
    const json = (await res.json()) as {
      status?: string;
      date?: string;
      content?: { raw?: string; rendered?: string };
    };
    const html = json.content?.raw || json.content?.rendered || "";
    const status = String(json.status ?? post.status);
    const dateBefore = json.date ?? post.date;
    const urls = extractImgUrls(html).filter((u) => isTrustedDmmImageUrl(u));
    imageTotal += urls.length;

    const ctx = await loadProductContext(input.database.prisma, post.id);
    const replacements = new Map<string, string>();
    const sampleReplacements: PostImageFixResult["sampleReplacements"] = [];
    let postUnder500 = 0;
    let beforeMaxUnder500: number | null = null;
    let afterMaxUnder500: number | null = null;

    // Prefer largest among URLs already in the post (same content key).
    const bestInPost = new Map<string, { url: string; q: number }>();
    for (const url of urls) {
      const id = imageContentKey(url);
      if (!id) continue;
      const prev = bestInPost.get(id.contentKey);
      if (!prev || id.qualityHint > prev.q) {
        bestInPost.set(id.contentKey, { url, q: id.qualityHint });
      }
    }

    for (const url of urls) {
      const id = imageContentKey(url);
      const size = await probeImagePixelSize(url);
      const under500 = Boolean(size && size.width < 500);
      if (under500) {
        under500Count += 1;
        postUnder500 += 1;
        if (beforeMaxUnder500 == null || size!.width > beforeMaxUnder500) {
          beforeMaxUnder500 = size!.width;
        }
      }

      let cause: SmallImageCause | null = under500 || (id != null && id.qualityHint < 100) ? "D_unknown" : null;
      let upgradeUrl: string | null = null;

      const inPostBest = id ? bestInPost.get(id.contentKey) : null;
      if (inPostBest && inPostBest.url !== url && inPostBest.q > (id?.qualityHint ?? 0)) {
        upgradeUrl = inPostBest.url;
        cause = "A_evidence_has_larger";
      } else {
        const resolved = await resolveMaxOfficialImageUrl(url, {
          evidenceUrls: [...ctx.evidenceUrls, ...urls],
        });
        if (resolved.upgraded) {
          upgradeUrl = resolved.url;
          const inEvidence = ctx.evidenceUrls.includes(resolved.url) || urls.includes(resolved.url);
          cause = inEvidence ? "A_evidence_has_larger" : "B_fanza_has_larger";
        } else if (under500 || (id != null && id.qualityHint < 90)) {
          const proposed = proposeMaxOfficialImageUrl(url);
          if (proposed) {
            const exists = await officialImageUrlExists(proposed.toUrl);
            cause = exists ? "B_fanza_has_larger" : "C_only_small";
            if (exists) upgradeUrl = proposed.toUrl;
          } else {
            cause = size ? "C_only_small" : "D_unknown";
          }
        } else {
          cause = null;
        }
      }

      if (cause === "A_evidence_has_larger") causeA += 1;
      if (cause === "B_fanza_has_larger") causeB += 1;
      if (cause === "C_only_small") causeC += 1;
      if (cause === "D_unknown") causeD += 1;

      if (upgradeUrl && upgradeUrl !== url) {
        replacements.set(url, upgradeUrl);
        let afterPx: number | null = null;
        if (under500 || id?.qualityHint !== 100) {
          const afterSize = await probeImagePixelSize(upgradeUrl);
          afterPx = afterSize?.width ?? null;
          if (afterPx != null) {
            if (afterMaxUnder500 == null || afterPx > afterMaxUnder500) afterMaxUnder500 = afterPx;
            if (size?.width != null && afterPx > size.width) {
              const delta = afterPx - size.width;
              if (!maxImprovement || delta > maxImprovement.after - maxImprovement.before) {
                maxImprovement = { postId: post.id, before: size.width, after: afterPx };
              }
            }
          }
          sampleReplacements.push({
            from: url,
            to: upgradeUrl,
            beforePx: size?.width ?? null,
            afterPx,
          });
        }
      }

      imageRows.push({
        postId: post.id,
        productId: ctx.productId,
        researchItemId: ctx.researchItemId,
        imageUrl: url,
        contentKey: id?.contentKey ?? null,
        family: id?.family ?? null,
        qualityHint: id?.qualityHint ?? null,
        width: size?.width ?? null,
        height: size?.height ?? null,
        under500,
        cause,
        upgradeUrl,
        researchImageId: ctx.researchByUrl.get(url) ?? null,
      });
    }

    if (postUnder500 > 0) postsWithUnder500 += 1;
    if (post.id === "74") {
      post74Before = beforeMaxUnder500;
    }

    const textBefore = stripTags(html);
    let replacedCount = 0;
    let removedDuplicateCount = 0;
    let htmlAfter = html;
    let applied = false;

    // Always collapse same-key duplicates to the best URL present/upgraded.
    for (const url of urls) {
      const id = imageContentKey(url);
      if (!id) continue;
      const best = bestInPost.get(id.contentKey);
      const mapped = replacements.get(url) ?? (best && best.q > id.qualityHint ? best.url : null);
      if (mapped && mapped !== url) replacements.set(url, mapped);
    }

    if (replacements.size > 0 || urls.length > new Set(urls.map((u) => imageContentKey(u)?.contentKey ?? u)).size) {
      const rewritten = rewriteHtmlImageUrls(html, replacements);
      htmlAfter = rewritten.html;
      replacedCount = rewritten.replacedCount;
      removedDuplicateCount = rewritten.removedDuplicateCount;
    }

    const textAfter = stripTags(htmlAfter);
    const bodyTextUnchanged = textBefore === textAfter;

    if (input.apply && (replacedCount > 0 || removedDuplicateCount > 0) && bodyTextUnchanged) {
      const update = await fetch(`${wp.base}/wp-json/${wp.ns}/posts/${post.id}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${wp.auth}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: htmlAfter }),
      });
      if (!update.ok) {
        rows.push({
          postId: post.id,
          status,
          productId: ctx.productId,
          ok: false,
          reason: `WP_UPDATE_${update.status}`,
          imageCount: urls.length,
          under500Count: postUnder500,
          replacedCount,
          removedDuplicateCount,
          bodyTextUnchanged,
          dateUnchanged: true,
          beforeMaxUnder500,
          afterMaxUnder500,
          sampleReplacements: sampleReplacements.slice(0, 5),
        });
        continue;
      }
      const updated = (await update.json()) as { date?: string; content?: { raw?: string } };
      const dateUnchanged = !dateBefore || !updated.date || dateBefore === updated.date;
      applied = true;
      postsFixed += 1;
      imagesReplaced += replacedCount;

      // Sync structuredContent.images URLs when linked.
      if (ctx.productId) {
        const target = await input.database.prisma.publicationTarget.findFirst({
          where: { platform: "WORDPRESS", publishedExternalId: post.id },
          select: { contentVersionId: true },
        });
        if (target) {
          const version = await input.database.prisma.contentVersion.findUnique({
            where: { id: target.contentVersionId },
            select: { structuredContent: true },
          });
          if (version?.structuredContent && typeof version.structuredContent === "object") {
            const sc = { ...(version.structuredContent as Record<string, unknown>) };
            if (Array.isArray(sc.images)) {
              sc.images = sc.images.map((img) => {
                if (!img || typeof img !== "object") return img;
                const row = { ...(img as Record<string, unknown>) };
                if (typeof row.sourceUrl === "string" && replacements.has(row.sourceUrl)) {
                  row.sourceUrl = replacements.get(row.sourceUrl);
                }
                return row;
              });
              await input.lifecycle.updateContentVersionStructuredContent(
                target.contentVersionId,
                sc,
              );
            }
          }
        }
      }

      if (post.id === "74") {
        const afterUrls = extractImgUrls(updated.content?.raw || htmlAfter);
        let maxW: number | null = null;
        for (const u of afterUrls.slice(0, 30)) {
          const s = await probeImagePixelSize(u);
          if (s && (maxW == null || s.width > maxW)) maxW = s.width;
        }
        post74After = maxW;
      }

      rows.push({
        postId: post.id,
        status,
        productId: ctx.productId,
        ok: true,
        imageCount: urls.length,
        under500Count: postUnder500,
        replacedCount,
        removedDuplicateCount,
        bodyTextUnchanged,
        dateUnchanged,
        beforeMaxUnder500,
        afterMaxUnder500,
        sampleReplacements: sampleReplacements.slice(0, 5),
      });
    } else {
      rows.push({
        postId: post.id,
        status,
        productId: ctx.productId,
        ok: true,
        skipped: !applied && replacedCount === 0 && removedDuplicateCount === 0,
        reason:
          replacedCount === 0 && removedDuplicateCount === 0
            ? "NO_UPGRADE"
            : !input.apply
              ? "DRY_RUN"
              : !bodyTextUnchanged
                ? "BODY_TEXT_CHANGED_ABORT"
                : undefined,
        imageCount: urls.length,
        under500Count: postUnder500,
        replacedCount,
        removedDuplicateCount,
        bodyTextUnchanged,
        dateUnchanged: true,
        beforeMaxUnder500,
        afterMaxUnder500,
        sampleReplacements: sampleReplacements.slice(0, 5),
      });
    }
  }

  return {
    postsScanned: posts.length,
    imageTotal,
    under500Count,
    postsWithUnder500,
    causeA,
    causeB,
    causeC,
    causeD,
    postsFixed,
    imagesReplaced,
    maxImprovement,
    post74: { before: post74Before, after: post74After },
    rows,
    imageRows,
  };
}
