/**
 * Blogger article images — URL reference only (no download / redistribute).
 *
 * SSOT sources (reuse, do not invent a parallel store):
 * - ResearchImage.sourceUrl (FANZA/DMM API ItemList)
 * - SourceDocument.metadata.imageReferences (public URL research)
 *
 * Display in Blogger HTML as <img src="…"> hotlinks to provider CDN URLs.
 * Never feed image bytes into LLM / AI image generation from this path.
 *
 * Selection policy (product-intro):
 * - Cap is the count of unique, safe, publishable product images — NOT article length.
 * - One hero (best package/main), then all distinct sample/auxiliary images.
 * - Substantial duplicates and lower-quality size variants are excluded.
 */

export type ArticleImageRole = "hero" | "auxiliary";

export type ArticleImageUsageStatus =
  | "ALLOWED"
  | "REQUIRES_CONFIRMATION"
  | "UNKNOWN"
  | "NOT_ALLOWED";

export type ArticleImageProvenance =
  | "research_image"
  | "source_document_image_reference";

export type ArticleImage = {
  role: ArticleImageRole;
  sourceUrl: string;
  imageType: string;
  alt: string;
  researchImageId: string | null;
  usageStatus: ArticleImageUsageStatus;
  provenance: ArticleImageProvenance;
  displayMode: "url_reference";
};

export type RawResearchImageRow = {
  id: string;
  imageType: string;
  sourceUrl: string;
  usageStatus: string;
};

export type ArticleImageExclusionReason =
  | "untrusted_host"
  | "invalid_url"
  | "usage_not_allowed"
  | "usage_unknown"
  | "exact_url_duplicate"
  | "substantial_duplicate"
  | "lower_quality_variant"
  | "package_variant_not_hero"
  | "low_aux_rank_when_samples_exist"
  | "max_count_cap"
  | "unrelated_or_unclassified";

export type ArticleImageExclusion = {
  sourceUrl: string;
  imageType: string;
  usageStatus: string;
  provenance: ArticleImageProvenance | "unknown";
  reason: ArticleImageExclusionReason;
  detail?: string;
};

export type ArticleImageSelectionOptions = {
  /**
   * Optional hard cap (hero + auxiliary). Prefer omitting so all unique safe images are used.
   * Not tied to article length.
   */
  maxCount?: number;
  /**
   * @deprecated Ignored. Image count is not limited by article length.
   */
  bodyParagraphCount?: number;
  /**
   * Optional absolute ceiling when explicitly set by caller.
   * Default: no ceiling (all unique safe images).
   */
  absoluteMaxCount?: number;
  /** Alt text base (product short name). */
  altBase?: string;
  /**
   * When true (default), REQUIRES_CONFIRMATION may be used for
   * Blogger URL-reference display on trusted DMM hosts.
   * UNKNOWN and NOT_ALLOWED are always excluded.
   */
  allowRequiresConfirmationForDisplay?: boolean;
};

export type ArticleImageCandidate = {
  sourceUrl: string;
  imageType: string;
  usageStatus: ArticleImageUsageStatus;
  researchImageId: string | null;
  provenance: ArticleImageProvenance;
  contentKey: string;
  qualityRank: number;
  heroRank: number;
  auxRank: number;
  family: "package" | "sample" | "other";
};

const HERO_TYPE_RANK: Record<string, number> = {
  main_large: 100,
  main_list: 80,
  main_small: 60,
  page_og: 50,
  page_reference: 40,
};

const AUX_TYPE_RANK: Record<string, number> = {
  sample_large: 100,
  sample_small: 70,
  page_reference: 40,
};

/** @deprecated No longer used as a default ceiling; kept for callers that still import it. */
export const ARTICLE_IMAGE_ABSOLUTE_MAX = Number.MAX_SAFE_INTEGER;

/**
 * @deprecated Length-based caps removed. Returns eligibleCount (optionally clamped by absoluteMaxCount).
 */
export function adaptiveArticleImageMaxCount(input: {
  eligibleCount: number;
  bodyParagraphCount?: number;
  absoluteMaxCount?: number;
}): number {
  const eligible = Math.max(0, input.eligibleCount);
  if (eligible === 0) return 0;
  if (typeof input.absoluteMaxCount === "number" && Number.isFinite(input.absoluteMaxCount)) {
    return Math.min(eligible, Math.max(0, input.absoluteMaxCount));
  }
  return eligible;
}

/** Hosts known to serve DMM/FANZA product package/sample images. */
export function isTrustedDmmImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "pics.dmm.co.jp" ||
    h === "awsimgsrc.dmm.co.jp" ||
    h === "p.dmm.co.jp" ||
    h.endsWith(".pics.dmm.co.jp")
  );
}

export function isTrustedDmmImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return isTrustedDmmImageHost(u.hostname);
  } catch {
    return false;
  }
}

function normalizeUsage(status: string): ArticleImageUsageStatus {
  if (status === "ALLOWED") return "ALLOWED";
  if (status === "REQUIRES_CONFIRMATION") return "REQUIRES_CONFIRMATION";
  if (status === "NOT_ALLOWED") return "NOT_ALLOWED";
  return "UNKNOWN";
}

function displayAllowed(
  status: ArticleImageUsageStatus,
  allowRequiresConfirmation: boolean,
): boolean {
  if (status === "NOT_ALLOWED") return false;
  if (status === "UNKNOWN") return false;
  if (status === "ALLOWED") return true;
  return allowRequiresConfirmation;
}

/**
 * Normalize DMM product image identity for substantial-duplicate detection.
 * Package size variants (pl/ps/pt) and CDN mirrors collapse to one package key.
 */
export function imageContentKey(sourceUrl: string): {
  contentKey: string;
  family: "package" | "sample" | "other";
  qualityHint: number;
} | null {
  let pathname: string;
  try {
    pathname = new URL(sourceUrl).pathname;
  } catch {
    return null;
  }
  const file = pathname.split("/").pop()?.toLowerCase() ?? "";
  if (!file) return null;

  // package: {cid}pl|ps|pt.(jpg|webp)
  const pkg = file.match(/^([a-z0-9]+)(pl|ps|pt)\.(jpe?g|webp|png)$/i);
  if (pkg) {
    const cid = pkg[1]!;
    const size = pkg[2]!.toLowerCase();
    const qualityHint = size === "pl" ? 100 : size === "pt" ? 80 : 60;
    return { contentKey: `${cid}:package`, family: "package", qualityHint };
  }

  // sample large/small: {cid}jp-{n} / {cid}js-{n}
  const jp = file.match(/^([a-z0-9]+)(jp|js)-(\d+)\.(jpe?g|webp|png)$/i);
  if (jp) {
    const cid = jp[1]!;
    const kind = jp[2]!.toLowerCase();
    const n = jp[3]!;
    const qualityHint = kind === "jp" ? 100 : 70;
    return { contentKey: `${cid}:sample:${n}`, family: "sample", qualityHint };
  }

  // sample strip / small: {cid}-{n}.jpg — SAME scene key as jp-{n} (size variant)
  const strip = file.match(/^([a-z0-9]+)-(\d+)\.(jpe?g|webp|png)$/i);
  if (strip) {
    const cid = strip[1]!;
    const n = strip[2]!;
    return { contentKey: `${cid}:sample:${n}`, family: "sample", qualityHint: 65 };
  }

  // fallback: basename without host
  return { contentKey: `file:${file}`, family: "other", qualityHint: 40 };
}

function qualityForType(imageType: string, hint: number): number {
  const typeBoost =
    imageType === "main_large" || imageType === "sample_large"
      ? 20
      : imageType === "main_list"
        ? 10
        : imageType === "sample_small" || imageType === "main_small"
          ? -10
          : 0;
  return hint + typeBoost;
}

/**
 * Prefer package/main for hero; sample images for auxiliary.
 * Dedupes exact URL + substantial package/sample variants. Does not invent URLs.
 * Count = unique safe images (optional maxCount / absoluteMaxCount only when set).
 */
export function selectArticleImages(input: {
  researchImages?: RawResearchImageRow[];
  pageImageUrls?: string[];
  options?: ArticleImageSelectionOptions;
}): ArticleImage[] {
  return selectArticleImagesWithReport(input).selected;
}

export function selectArticleImagesWithReport(input: {
  researchImages?: RawResearchImageRow[];
  pageImageUrls?: string[];
  options?: ArticleImageSelectionOptions;
}): {
  selected: ArticleImage[];
  excluded: ArticleImageExclusion[];
  dbCandidateCount: number;
  publishableCount: number;
  candidates: ArticleImageCandidate[];
} {
  const allowRc = input.options?.allowRequiresConfirmationForDisplay ?? true;
  const altBase = (input.options?.altBase ?? "商品画像").trim() || "商品画像";
  const absoluteMax =
    typeof input.options?.absoluteMaxCount === "number" &&
    Number.isFinite(input.options.absoluteMaxCount)
      ? Math.max(0, input.options.absoluteMaxCount)
      : null;
  const maxCountOpt =
    typeof input.options?.maxCount === "number" && Number.isFinite(input.options.maxCount)
      ? Math.max(0, input.options.maxCount)
      : null;

  const excluded: ArticleImageExclusion[] = [];
  const rawRows: Array<{
    sourceUrl: string;
    imageType: string;
    usageStatus: string;
    researchImageId: string | null;
    provenance: ArticleImageProvenance;
  }> = [];

  for (const row of input.researchImages ?? []) {
    rawRows.push({
      sourceUrl: row.sourceUrl?.trim() ?? "",
      imageType: row.imageType,
      usageStatus: row.usageStatus,
      researchImageId: row.id,
      provenance: "research_image",
    });
  }
  for (const raw of input.pageImageUrls ?? []) {
    const url = raw?.trim() ?? "";
    const imageType = /pl\.jpg|package|og/i.test(url) ? "page_og" : "page_reference";
    rawRows.push({
      sourceUrl: url,
      imageType,
      usageStatus: "REQUIRES_CONFIRMATION",
      researchImageId: null,
      provenance: "source_document_image_reference",
    });
  }

  const dbCandidateCount = rawRows.length;
  const seenExact = new Set<string>();
  const prelim: ArticleImageCandidate[] = [];

  for (const row of rawRows) {
    const url = row.sourceUrl;
    if (!url) {
      excluded.push({
        sourceUrl: "",
        imageType: row.imageType,
        usageStatus: row.usageStatus,
        provenance: row.provenance,
        reason: "invalid_url",
      });
      continue;
    }
    if (!isTrustedDmmImageUrl(url)) {
      excluded.push({
        sourceUrl: url,
        imageType: row.imageType,
        usageStatus: row.usageStatus,
        provenance: row.provenance,
        reason: "untrusted_host",
      });
      continue;
    }
    const usageStatus = normalizeUsage(row.usageStatus);
    if (usageStatus === "NOT_ALLOWED") {
      excluded.push({
        sourceUrl: url,
        imageType: row.imageType,
        usageStatus,
        provenance: row.provenance,
        reason: "usage_not_allowed",
      });
      continue;
    }
    if (usageStatus === "UNKNOWN" || !displayAllowed(usageStatus, allowRc)) {
      excluded.push({
        sourceUrl: url,
        imageType: row.imageType,
        usageStatus,
        provenance: row.provenance,
        reason: usageStatus === "UNKNOWN" ? "usage_unknown" : "usage_not_allowed",
      });
      continue;
    }
    if (seenExact.has(url)) {
      excluded.push({
        sourceUrl: url,
        imageType: row.imageType,
        usageStatus,
        provenance: row.provenance,
        reason: "exact_url_duplicate",
      });
      continue;
    }
    seenExact.add(url);

    const identity = imageContentKey(url);
    if (!identity) {
      excluded.push({
        sourceUrl: url,
        imageType: row.imageType,
        usageStatus,
        provenance: row.provenance,
        reason: "unrelated_or_unclassified",
      });
      continue;
    }

    prelim.push({
      sourceUrl: url,
      imageType: row.imageType,
      usageStatus,
      researchImageId: row.researchImageId,
      provenance: row.provenance,
      contentKey: identity.contentKey,
      qualityRank: qualityForType(row.imageType, identity.qualityHint),
      heroRank: HERO_TYPE_RANK[row.imageType] ?? identity.qualityHint,
      auxRank: AUX_TYPE_RANK[row.imageType] ?? (identity.family === "sample" ? 60 : 10),
      family: identity.family,
    });
  }

  // Collapse substantial duplicates / lower-quality variants by contentKey.
  const bestByKey = new Map<string, ArticleImageCandidate>();
  for (const c of prelim) {
    const prev = bestByKey.get(c.contentKey);
    if (!prev) {
      bestByKey.set(c.contentKey, c);
      continue;
    }
    if (c.qualityRank > prev.qualityRank) {
      excluded.push({
        sourceUrl: prev.sourceUrl,
        imageType: prev.imageType,
        usageStatus: prev.usageStatus,
        provenance: prev.provenance,
        reason: "lower_quality_variant",
        detail: `kept higher quality ${c.sourceUrl} (${c.contentKey})`,
      });
      bestByKey.set(c.contentKey, c);
    } else {
      excluded.push({
        sourceUrl: c.sourceUrl,
        imageType: c.imageType,
        usageStatus: c.usageStatus,
        provenance: c.provenance,
        reason:
          c.qualityRank === prev.qualityRank
            ? "substantial_duplicate"
            : "lower_quality_variant",
        detail: `kept ${prev.sourceUrl} (${c.contentKey})`,
      });
    }
  }

  const unique = [...bestByKey.values()];
  if (unique.length === 0) {
    return {
      selected: [],
      excluded,
      dbCandidateCount,
      publishableCount: 0,
      candidates: [],
    };
  }

  const byHero = [...unique].sort((a, b) => {
    // Prefer package family for hero over sample images.
    const famScore = (x: ArticleImageCandidate) =>
      x.family === "package" ? 2 : x.family === "other" ? 1 : 0;
    return famScore(b) - famScore(a) || b.heroRank - a.heroRank || b.qualityRank - a.qualityRank;
  });
  const hero = byHero[0]!;

  let ceiling = unique.length;
  if (absoluteMax !== null) ceiling = Math.min(ceiling, absoluteMax);
  if (maxCountOpt !== null) ceiling = Math.min(ceiling, maxCountOpt);
  if (ceiling === 0) {
    for (const c of unique) {
      excluded.push({
        sourceUrl: c.sourceUrl,
        imageType: c.imageType,
        usageStatus: c.usageStatus,
        provenance: c.provenance,
        reason: "max_count_cap",
      });
    }
    return {
      selected: [],
      excluded,
      dbCandidateCount,
      publishableCount: 0,
      candidates: unique,
    };
  }

  const selected: ArticleImage[] = [
    {
      role: "hero",
      sourceUrl: hero.sourceUrl,
      imageType: hero.imageType,
      alt: `${altBase}（パッケージ）`,
      researchImageId: hero.researchImageId,
      usageStatus: hero.usageStatus,
      provenance: hero.provenance,
      displayMode: "url_reference",
    },
  ];

  const hasStrongSamples = unique.some(
    (c) => c.sourceUrl !== hero.sourceUrl && c.family === "sample" && c.auxRank >= 70,
  );

  const byAux = unique
    .filter((c) => c.sourceUrl !== hero.sourceUrl)
    .sort((a, b) => b.auxRank - a.auxRank || b.qualityRank - a.qualityRank);

  for (const aux of byAux) {
    if (selected.length >= ceiling) {
      excluded.push({
        sourceUrl: aux.sourceUrl,
        imageType: aux.imageType,
        usageStatus: aux.usageStatus,
        provenance: aux.provenance,
        reason: "max_count_cap",
        detail: `ceiling=${ceiling}`,
      });
      continue;
    }
    // Other package size/CDN variants must not appear as body images.
    if (aux.family === "package") {
      excluded.push({
        sourceUrl: aux.sourceUrl,
        imageType: aux.imageType,
        usageStatus: aux.usageStatus,
        provenance: aux.provenance,
        reason: "package_variant_not_hero",
        detail: `hero already selected for package: ${hero.sourceUrl}`,
      });
      continue;
    }
    if (hasStrongSamples && aux.auxRank < 30) {
      excluded.push({
        sourceUrl: aux.sourceUrl,
        imageType: aux.imageType,
        usageStatus: aux.usageStatus,
        provenance: aux.provenance,
        reason: "low_aux_rank_when_samples_exist",
      });
      continue;
    }
    if (aux.family === "other" && hasStrongSamples) {
      excluded.push({
        sourceUrl: aux.sourceUrl,
        imageType: aux.imageType,
        usageStatus: aux.usageStatus,
        provenance: aux.provenance,
        reason: "unrelated_or_unclassified",
        detail: "prefer product sample images over unclassified refs",
      });
      continue;
    }

    selected.push({
      role: "auxiliary",
      sourceUrl: aux.sourceUrl,
      imageType: aux.imageType,
      alt: `${altBase}（サンプル）`,
      researchImageId: aux.researchImageId,
      usageStatus: aux.usageStatus,
      provenance: aux.provenance,
      displayMode: "url_reference",
    });
  }

  return {
    selected,
    excluded,
    dbCandidateCount,
    publishableCount: selected.length,
    candidates: unique,
  };
}

export function parseArticleImages(raw: unknown): ArticleImage[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleImage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const sourceUrl = typeof r.sourceUrl === "string" ? r.sourceUrl.trim() : "";
    if (!sourceUrl || !isTrustedDmmImageUrl(sourceUrl)) continue;
    const role: ArticleImageRole = r.role === "auxiliary" ? "auxiliary" : "hero";
    const usageStatus = normalizeUsage(
      typeof r.usageStatus === "string" ? r.usageStatus : "REQUIRES_CONFIRMATION",
    );
    if (usageStatus === "NOT_ALLOWED" || usageStatus === "UNKNOWN") continue;
    out.push({
      role,
      sourceUrl,
      imageType: typeof r.imageType === "string" ? r.imageType : "unknown",
      alt: typeof r.alt === "string" && r.alt.trim() ? r.alt.trim() : "商品画像",
      researchImageId: typeof r.researchImageId === "string" ? r.researchImageId : null,
      usageStatus,
      provenance:
        r.provenance === "research_image"
          ? "research_image"
          : "source_document_image_reference",
      displayMode: "url_reference",
    });
  }
  return out;
}

/** Count body paragraphs (lead excluded). Kept for layout helpers / callers. */
export function countBodyParagraphs(
  sections: Array<{ paragraphs?: string[] }>,
): number {
  return sections.reduce((n, s) => n + (s.paragraphs?.filter((p) => p.trim()).length ?? 0), 0);
}
