/**
 * Official FANZA product-page catalog metadata (LLM=0).
 *
 * Priority per field: page_json_ld > page_dom > breadcrumb > itemlist.
 * No inference of scene/content from genres. No price/rating/campaign.
 */

export type CatalogFieldProvenance =
  | "page_json_ld"
  | "page_dom"
  | "breadcrumb"
  | "itemlist";

export type CatalogStringValue = {
  value: string;
  provenance: CatalogFieldProvenance;
  originField: string;
};

export type CatalogNumberValue = {
  value: number;
  provenance: CatalogFieldProvenance;
  originField: string;
};

export type PageCatalogEvidence = {
  maker: CatalogStringValue | null;
  label: CatalogStringValue | null;
  series: CatalogStringValue | null;
  genres: CatalogStringValue[];
  durationMinutes: CatalogNumberValue | null;
  releaseDate: CatalogStringValue | null;
  manufacturerSku: CatalogStringValue | null;
};

const PROVENANCE_RANK: Record<CatalogFieldProvenance, number> = {
  page_json_ld: 1,
  page_dom: 2,
  breadcrumb: 3,
  itemlist: 4,
};

const EMPTY_CATALOG: PageCatalogEvidence = {
  maker: null,
  label: null,
  series: null,
  genres: [],
  durationMinutes: null,
  releaseDate: null,
  manufacturerSku: null,
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function typeOf(obj: Record<string, unknown>): string[] {
  const t = obj["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function cleanLabelValue(raw: string): string | null {
  let v = raw.replace(/\s+/g, " ").trim();
  if (!v) return null;
  // Drop placeholder / nav leakage
  if (/^(-{2,}|—+|−+|なし|未定)$/u.test(v)) return null;
  if (/から探す|ブランドストア|新着順|すべてのセール/u.test(v)) return null;
  // Truncate at next known label when DOM glue happens
  v = v.split(
    /(?=(?:メーカー|レーベル|シリーズ|ジャンル|収録時間|商品発売日|配信開始日|出演者|監督|品番|メーカー品番|平均評価)[:：])/u,
  )[0]!.trim();
  if (!v || /^(-{2,}|—+)$/u.test(v)) return null;
  return v.slice(0, 200);
}

function parseDurationMinutes(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/(\d+)\s*分/);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null;
  }
  const bare = raw.trim();
  if (/^\d+$/.test(bare)) {
    const n = Number(bare);
    return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null;
  }
  return null;
}

/** Normalize to YYYY-MM-DD when possible; otherwise keep cleaned date-like string. */
export function normalizeReleaseDate(raw: string): string | null {
  const t = raw.trim();
  const iso = t.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) {
    const y = iso[1]!;
    const mo = iso[2]!.padStart(2, "0");
    const d = iso[3]!.padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function pickString(
  current: CatalogStringValue | null,
  next: CatalogStringValue | null,
): CatalogStringValue | null {
  if (!next?.value) return current;
  if (!current?.value) return next;
  return PROVENANCE_RANK[next.provenance] < PROVENANCE_RANK[current.provenance]
    ? next
    : current;
}

function pickNumber(
  current: CatalogNumberValue | null,
  next: CatalogNumberValue | null,
): CatalogNumberValue | null {
  if (next == null || !Number.isFinite(next.value)) return current;
  if (current == null) return next;
  return PROVENANCE_RANK[next.provenance] < PROVENANCE_RANK[current.provenance]
    ? next
    : current;
}

function mergeGenreLists(
  existing: CatalogStringValue[],
  incoming: CatalogStringValue[],
): CatalogStringValue[] {
  const byNorm = new Map<string, CatalogStringValue>();
  for (const g of [...existing, ...incoming]) {
    const key = g.value.replace(/\s+/g, "").toLowerCase();
    if (!key) continue;
    const prev = byNorm.get(key);
    if (!prev || PROVENANCE_RANK[g.provenance] < PROVENANCE_RANK[prev.provenance]) {
      byNorm.set(key, g);
    }
  }
  return [...byNorm.values()];
}

function setIfEmpty(
  cat: PageCatalogEvidence,
  field: "maker" | "label" | "series" | "releaseDate" | "manufacturerSku",
  next: CatalogStringValue | null,
): void {
  cat[field] = pickString(cat[field], next);
}

/** Extract catalog from already-flattened JSON-LD nodes + raw HTML. */
export function extractPageCatalogEvidence(input: {
  html: string;
  jsonLdNodes: Record<string, unknown>[];
}): PageCatalogEvidence {
  const cat: PageCatalogEvidence = {
    maker: null,
    label: null,
    series: null,
    genres: [],
    durationMinutes: null,
    releaseDate: null,
    manufacturerSku: null,
  };

  for (const node of input.jsonLdNodes) {
    const types = typeOf(node);
    if (types.includes("Product")) {
      const brand = node.brand;
      if (brand && typeof brand === "object" && !Array.isArray(brand)) {
        const name = (brand as { name?: unknown }).name;
        if (typeof name === "string" && name.trim()) {
          setIfEmpty(cat, "maker", {
            value: name.trim(),
            provenance: "page_json_ld",
            originField: "jsonld.Product.brand.name",
          });
        }
      }
    }
    if (types.includes("VideoObject")) {
      if (typeof node.uploadDate === "string" && node.uploadDate.trim()) {
        const normalized = normalizeReleaseDate(node.uploadDate);
        if (normalized) {
          setIfEmpty(cat, "releaseDate", {
            value: normalized,
            provenance: "page_json_ld",
            originField: "jsonld.VideoObject.uploadDate",
          });
        }
      }
      // genre on VideoObject when present (official structured tag only)
      for (const g of asArray(node.genre as unknown)) {
        if (typeof g === "string" && g.trim()) {
          cat.genres = mergeGenreLists(cat.genres, [
            {
              value: g.trim(),
              provenance: "page_json_ld",
              originField: "jsonld.VideoObject.genre",
            },
          ]);
        } else if (g && typeof g === "object" && typeof (g as { name?: unknown }).name === "string") {
          const name = String((g as { name: string }).name).trim();
          if (name) {
            cat.genres = mergeGenreLists(cat.genres, [
              {
                value: name,
                provenance: "page_json_ld",
                originField: "jsonld.VideoObject.genre",
              },
            ]);
          }
        }
      }
    }
    if (types.includes("BreadcrumbList")) {
      const elements = asArray(node.itemListElement as unknown)
        .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
      // Typical: 1 動画 / 2 ビデオ / 3 maker / 4 label / 5 product
      const makerCrumb = elements.find((e) => Number(e.position) === 3);
      const labelCrumb = elements.find((e) => Number(e.position) === 4);
      if (typeof makerCrumb?.name === "string" && makerCrumb.name.trim()) {
        setIfEmpty(cat, "maker", {
          value: makerCrumb.name.trim(),
          provenance: "breadcrumb",
          originField: "jsonld.BreadcrumbList.position3",
        });
      }
      if (typeof labelCrumb?.name === "string" && labelCrumb.name.trim()) {
        setIfEmpty(cat, "label", {
          value: labelCrumb.name.trim(),
          provenance: "breadcrumb",
          originField: "jsonld.BreadcrumbList.position4",
        });
      }
    }
  }

  applyDomCatalog(input.html, cat);
  return cat;
}

function extractDetailRegion(html: string): string {
  // Prefer the product detail block when present; otherwise keep a wide slice.
  const markers = ["メーカー品番", "商品発売日", "収録時間", "品番"];
  let bestIdx = -1;
  for (const m of markers) {
    const idx = html.indexOf(m);
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx >= 0) {
    return html.slice(Math.max(0, bestIdx - 400), bestIdx + 8000);
  }
  return html.slice(0, 120_000);
}

function visibleDetailText(html: string): string {
  return extractDetailRegion(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:tr|td|th|li|dt|dd|p|div|span)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n");
}

/** Full-page visible text for fields that may sit outside the 品番-anchored region. */
function visiblePageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:tr|td|th|li|dt|dd|p|div|span)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n");
}

function applyDomCatalog(html: string, cat: PageCatalogEvidence): void {
  const detailText = visibleDetailText(html);
  const pageText = visiblePageText(html);

  const takeFrom = (text: string, label: string): string | null => {
    // Inline: 収録時間： 477分
    const inline = text.match(
      new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "u"),
    );
    if (inline?.[1]) {
      const cleaned = cleanLabelValue(inline[1]);
      if (cleaned) return cleaned;
    }
    // Stacked rows: 収録時間\n477分
    const stacked = text.match(
      new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`, "u"),
    );
    if (stacked?.[1]) {
      const cleaned = cleanLabelValue(stacked[1]);
      if (cleaned) return cleaned;
    }
    return null;
  };

  const take = (label: string): string | null =>
    takeFrom(detailText, label) ?? takeFrom(pageText, label);

  const maker = take("メーカー");
  if (maker) {
    setIfEmpty(cat, "maker", {
      value: maker,
      provenance: "page_dom",
      originField: "dom.detail.メーカー",
    });
  }
  const label = take("レーベル");
  if (label) {
    setIfEmpty(cat, "label", {
      value: label,
      provenance: "page_dom",
      originField: "dom.detail.レーベル",
    });
  }
  const series = take("シリーズ");
  if (series) {
    setIfEmpty(cat, "series", {
      value: series,
      provenance: "page_dom",
      originField: "dom.detail.シリーズ",
    });
  }
  const sku = take("メーカー品番");
  if (sku) {
    setIfEmpty(cat, "manufacturerSku", {
      value: sku,
      provenance: "page_dom",
      originField: "dom.detail.メーカー品番",
    });
  }
  const release = take("商品発売日") ?? take("配信開始日");
  if (release) {
    const normalized = normalizeReleaseDate(release);
    if (normalized) {
      setIfEmpty(cat, "releaseDate", {
        value: normalized,
        provenance: "page_dom",
        originField: "dom.detail.release",
      });
    }
  }
  const durationRaw = take("収録時間");
  if (durationRaw) {
    const mins = parseDurationMinutes(durationRaw);
    if (mins != null) {
      cat.durationMinutes = pickNumber(cat.durationMinutes, {
        value: mins,
        provenance: "page_dom",
        originField: "dom.detail.収録時間",
      });
    }
  }

  const genreLine = take("ジャンル");
  if (genreLine) {
    // Official genre tokens are whitespace-separated on the product detail row.
    const tokens = genreLine
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !/関連タグ|平均評価/u.test(t));
    cat.genres = mergeGenreLists(
      cat.genres,
      tokens.map((value) => ({
        value,
        provenance: "page_dom" as const,
        originField: "dom.detail.ジャンル",
      })),
    );
  }

  // Fallback: duration may appear as "収録時間 477分" without a full-width colon capture.
  if (!cat.durationMinutes) {
    const loose = pageText.match(/収録時間\s*[:：]?\s*(\d+)\s*分/u);
    if (loose?.[1]) {
      const mins = Number(loose[1]);
      if (Number.isFinite(mins) && mins > 0) {
        cat.durationMinutes = {
          value: mins,
          provenance: "page_dom",
          originField: "dom.detail.収録時間",
        };
      }
    }
  }
}

function itemInfoNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw) {
    if (row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string") {
      const n = String((row as { name: string }).name).trim();
      if (n) out.push(n);
    }
  }
  return out;
}

/**
 * Merge page catalog with ItemList rawData into one canonical catalog.
 * Missing page fields filled from iteminfo / volume / date only.
 */
export function mergeCanonicalCatalog(input: {
  pageCatalog: PageCatalogEvidence | null | undefined;
  itemListRawData?: unknown;
}): PageCatalogEvidence {
  const cat: PageCatalogEvidence = {
    maker: input.pageCatalog?.maker ?? null,
    label: input.pageCatalog?.label ?? null,
    series: input.pageCatalog?.series ?? null,
    genres: [...(input.pageCatalog?.genres ?? [])],
    durationMinutes: input.pageCatalog?.durationMinutes ?? null,
    releaseDate: input.pageCatalog?.releaseDate ?? null,
    manufacturerSku: input.pageCatalog?.manufacturerSku ?? null,
  };

  const raw =
    input.itemListRawData &&
    typeof input.itemListRawData === "object" &&
    !Array.isArray(input.itemListRawData)
      ? (input.itemListRawData as Record<string, unknown>)
      : null;
  if (!raw) return cat;

  const iteminfo =
    raw.iteminfo && typeof raw.iteminfo === "object" && !Array.isArray(raw.iteminfo)
      ? (raw.iteminfo as Record<string, unknown>)
      : null;

  if (iteminfo) {
    for (const name of itemInfoNames(iteminfo.maker)) {
      setIfEmpty(cat, "maker", {
        value: name,
        provenance: "itemlist",
        originField: "itemlist.iteminfo.maker",
      });
    }
    for (const name of itemInfoNames(iteminfo.label)) {
      setIfEmpty(cat, "label", {
        value: name,
        provenance: "itemlist",
        originField: "itemlist.iteminfo.label",
      });
    }
    for (const name of itemInfoNames(iteminfo.series)) {
      setIfEmpty(cat, "series", {
        value: name,
        provenance: "itemlist",
        originField: "itemlist.iteminfo.series",
      });
    }
    cat.genres = mergeGenreLists(
      cat.genres,
      itemInfoNames(iteminfo.genre).map((value) => ({
        value,
        provenance: "itemlist" as const,
        originField: "itemlist.iteminfo.genre",
      })),
    );
  }

  if (typeof raw.volume === "string" || typeof raw.volume === "number") {
    const mins = parseDurationMinutes(String(raw.volume));
    if (mins != null) {
      cat.durationMinutes = pickNumber(cat.durationMinutes, {
        value: mins,
        provenance: "itemlist",
        originField: "itemlist.volume",
      });
    }
  }
  if (typeof raw.date === "string" && raw.date.trim()) {
    const normalized = normalizeReleaseDate(raw.date);
    if (normalized) {
      setIfEmpty(cat, "releaseDate", {
        value: normalized,
        provenance: "itemlist",
        originField: "itemlist.date",
      });
    }
  }

  return cat;
}

export function emptyPageCatalog(): PageCatalogEvidence {
  return { ...EMPTY_CATALOG, genres: [] };
}
