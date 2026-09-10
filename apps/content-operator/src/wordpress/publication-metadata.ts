/**
 * WordPress publication metadata layer (title / SEO / taxonomy hints).
 * Does NOT rewrite Writer article body, CTA, images, or Brain quality rules.
 * Factual taxonomy (performer/series/maker/genre) must come from Evidence SSOT.
 */

import type { LLMProvider } from "../adapters/types.js";
import {
  deriveWordPressTaxonomyFromEvidence,
  uniqPreserve,
  type EvidenceTaxonomyLabel,
  type DerivedWordPressTaxonomy,
} from "./evidence-taxonomy.js";
import { truncateMetaDescription } from "./wordpress-seo-attach.js";

export type TitleAxis =
  | "feature"
  | "performer"
  | "work_type"
  | "audience"
  | "highlight"
  | "series_maker";

export type PublicationMetadata = {
  title: string;
  seoTitle: string;
  metaDescription: string;
  categories: string[];
  tags: string[];
  performers: string[];
  seriesNames: string[];
  titleAxis: TitleAxis;
  productCanonicalId: string | null;
  quality: PublicationMetadataQuality;
  source: "llm" | "deterministic";
  generatedAt: string;
};

export type PublicationMetadataQuality = {
  pass: boolean;
  failures: string[];
  warnings: string[];
};

export type PublicationMetadataEvidence = {
  productCanonicalId?: string | null;
  officialTitle?: string | null;
  /** Official product description from Evidence / pageEvidence. */
  officialDescription?: string | null;
  performers?: string[];
  seriesNames?: string[];
  makers?: string[];
  labels?: string[];
  genres?: string[];
  labelsRaw?: EvidenceTaxonomyLabel[];
  /** Existing article title (Writer) — used as signal, may be replaced for WP. */
  writerTitle?: string | null;
  /** Short factual summary / lead already in article (no invention). */
  articleSummary?: string | null;
  /** Section headings already written (facts the article covers). */
  sectionHeadings?: string[];
  /** First body paragraphs (for description grounding). */
  bodySnippets?: string[];
};

const BANNED_TAGS = new Set([
  "動画",
  "作品",
  "紹介",
  "記事",
  "おすすめ",
  "人気",
  "アダルト",
  "エロ",
  "av",
  "av女優",
  "商品",
  "ページ",
  "詳細",
  "公式",
  "作品紹介",
  "プレイ",
  "時間",
  "配信",
  "コキ",
  "てこき",
  "中だし",
]);

const GENERIC_TITLE_SUFFIXES = ["を紹介", "を解説", "まとめ", "レビュー"];

export function isBannedTag(name: string): boolean {
  const t = name.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (t.length <= 1) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^https?:/i.test(t) || /www\./i.test(t)) return true;
  if (/<[^>]+>/.test(t) || /&[a-z]+;/i.test(t)) return true;
  if (BANNED_TAGS.has(t.toLowerCase()) || BANNED_TAGS.has(t)) return true;
  return false;
}

export function filterMeaningfulTags(tags: string[], opts?: { max?: number }): string[] {
  const max = opts?.max ?? 40;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (isBannedTag(t)) continue;
    if (t.length > 32) continue;
    const key = t.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Pick the evidence axis with the most usable signal (not random). */
export function selectTitleAxis(evidence: PublicationMetadataEvidence): TitleAxis {
  const performers = evidence.performers ?? [];
  const genres = evidence.genres ?? [];
  const series = evidence.seriesNames ?? [];
  const makers = evidence.makers ?? [];
  const headings = evidence.sectionHeadings ?? [];
  const official = evidence.officialTitle?.trim() ?? "";
  const writer = evidence.writerTitle?.trim() ?? "";
  const blob = `${official}\n${writer}\n${headings.join("\n")}\n${genres.join("\n")}`;

  const isVr = /(?:^|[\s\u3000/／])VR(?:$|[\s\u3000/／])|ＶＲ|\bVR\b/.test(blob);
  const isBest = /ベスト|総集編|\bBEST\b/i.test(blob);
  const isDebut = /デビュー/i.test(blob);
  const featureHint = headings.find((h) => h.length >= 4 && h.length <= 28) ?? null;

  if (isVr) return "work_type";
  if (isBest || isDebut) return series.length || makers.length ? "series_maker" : "work_type";
  if (performers.length === 1 && featureHint) return "feature";
  if (performers.length === 1 && genres.length > 0) return "highlight";
  if (performers.length >= 1 && /向け|初心者|ファン|好き/i.test(blob)) return "audience";
  if (performers.length >= 1) return "performer";
  if (series.length || makers.length) return "series_maker";
  if (featureHint) return "feature";
  return "highlight";
}

function primaryPerformer(evidence: PublicationMetadataEvidence): string | null {
  return evidence.performers?.[0]?.trim() || null;
}

function featurePhrase(evidence: PublicationMetadataEvidence): string | null {
  const headings = evidence.sectionHeadings ?? [];
  for (const h of headings) {
    const t = h.replace(/\s+/g, " ").trim();
    if (t.length >= 4 && t.length <= 24 && !/まとめ|CTA|リンク|商品/i.test(t)) return t;
  }
  const genres = evidence.genres ?? [];
  if (genres[0] && genres[0].length <= 20) return genres[0];
  return null;
}

function workTypePhrase(evidence: PublicationMetadataEvidence): string | null {
  const blob = [
    evidence.officialTitle,
    evidence.writerTitle,
    ...(evidence.genres ?? []),
    ...(evidence.seriesNames ?? []),
  ]
    .filter(Boolean)
    .join("\n");
  if (/(?:^|[\s\u3000/／])VR(?:$|[\s\u3000/／])|ＶＲ|\bVR\b/.test(blob)) return "VR作品";
  if (/ベスト|総集編|\bBEST\b/i.test(blob)) return "ベスト・総集編";
  if (/デビュー/i.test(blob)) return "デビュー作";
  if (/単体作品/.test(blob)) return "単体作品";
  if (/企画/.test(blob)) return "企画作品";
  return null;
}

function clipTitle(title: string, max = 48): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/**
 * Deterministic editorial title — diverse patterns by axis.
 * Never invents performers/series; uses only evidence fields.
 */
export function buildDeterministicTitle(
  evidence: PublicationMetadataEvidence,
  axis: TitleAxis,
): string {
  const performer = primaryPerformer(evidence);
  const feature = featurePhrase(evidence);
  const workType = workTypePhrase(evidence);
  const series = evidence.seriesNames?.[0] ?? evidence.makers?.[0] ?? null;
  const cid = evidence.productCanonicalId?.trim() || null;
  const official = evidence.officialTitle?.trim() || null;

  let title = "";
  switch (axis) {
    case "feature":
      if (performer && feature) {
        title = `${feature}が伝わる${performer}の一本`;
      } else if (feature) {
        title = `${feature}に注目したい一作`;
      } else if (performer) {
        title = `${performer}の魅力が分かる一本`;
      }
      break;
    case "performer":
      if (performer && workType) {
        title = `${performer}で見る${workType}`;
      } else if (performer && feature) {
        title = `${performer}｜${feature}の見どころ`;
      } else if (performer) {
        title = `${performer}の作品ガイド`;
      }
      break;
    case "work_type":
      if (workType && performer) {
        title = `${workType}で楽しむ${performer}`;
      } else if (workType) {
        title = `${workType}の見どころ整理`;
      }
      break;
    case "audience":
      if (performer && workType) {
        title = `${workType}が気になる人へ｜${performer}`;
      } else if (performer) {
        title = `${performer}を知りたい人向けガイド`;
      }
      break;
    case "highlight":
      if (feature && performer) {
        title = `注目は${feature}｜${performer}`;
      } else if (feature) {
        title = `注目ポイントは${feature}`;
      } else if (performer) {
        title = `${performer}の見どころを整理`;
      }
      break;
    case "series_maker":
      if (series && performer) {
        title = `${series}から｜${performer}の一作`;
      } else if (series && workType) {
        title = `${series}の${workType}`;
      } else if (series) {
        title = `${series}の作品ガイド`;
      }
      break;
  }

  if (!title) {
    if (performer && cid) title = `${performer}の作品メモ｜${cid.toUpperCase()}`;
    else if (performer) title = `${performer}の作品メモ`;
    else if (official && !looksLikeCatalogDump(official)) title = clipTitle(official, 40);
    else if (cid) title = `作品ガイド｜${cid.toUpperCase()}`;
    else title = "作品ガイド";
  }

  // Avoid appending generic 「を紹介」 spam.
  for (const suf of GENERIC_TITLE_SUFFIXES) {
    if (title.endsWith(suf)) title = title.slice(0, -suf.length);
  }
  return clipTitle(title, 48);
}

export function looksLikeCatalogDump(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  // Long catalog-like product titles
  if (t.length >= 36) return true;
  // cid + long japanese product name patterns
  if (/^[a-z0-9_-]{5,}\s+/i.test(t) && t.length > 24) return true;
  if (/^【.+】/.test(t) && t.length > 28) return true;
  // Typical FANZA catalog: long phrase + trailing performer name
  if (
    t.length >= 28 &&
    /\s[\u3040-\u30ff\u4e00-\u9fff々〆ゝゞA-Za-z]{2,16}$/u.test(t) &&
    !/｜/.test(t)
  ) {
    return true;
  }
  return false;
}

export function looksLikeWeakEditorialTitle(title: string, evidence: PublicationMetadataEvidence): boolean {
  const t = title.trim();
  if (!t) return true;
  if (looksLikeCatalogDump(t)) return true;
  const official = evidence.officialTitle?.trim();
  if (official && normalizeCompact(t) === normalizeCompact(official)) return true;
  // "XとY" / "XのY" only with very short Y often weak
  if (/^.+[との].+$/.test(t) && t.length <= 14 && !/｜/.test(t)) return true;
  // Title identical to a single genre token
  if ((evidence.genres ?? []).some((g) => normalizeCompact(g) === normalizeCompact(t))) return true;
  return false;
}

function normalizeCompact(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function buildDeterministicSeoTitle(
  editorialTitle: string,
  evidence: PublicationMetadataEvidence,
): string {
  const parts: string[] = [];
  const performer = primaryPerformer(evidence);
  const cid = evidence.productCanonicalId?.trim();
  const workType = workTypePhrase(evidence);

  // Prefer editorial title as base; enrich lightly for SERP without stuffing.
  parts.push(clipTitle(editorialTitle, 36));
  if (cid && !editorialTitle.toLowerCase().includes(cid.toLowerCase())) {
    parts.push(cid.toUpperCase());
  } else if (performer && !editorialTitle.includes(performer) && workType) {
    parts.push(workType);
  }
  parts.push("オトナセレクト");
  return clipTitle(uniqPreserve(parts).join("｜"), 70);
}

export function buildDeterministicMetaDescription(
  editorialTitle: string,
  evidence: PublicationMetadataEvidence,
): string {
  const performer = primaryPerformer(evidence);
  const feature = featurePhrase(evidence);
  const workType = workTypePhrase(evidence);
  const cid = evidence.productCanonicalId?.trim();
  const summary = evidence.articleSummary?.trim();
  const heading = evidence.sectionHeadings?.[0]?.trim();

  const bits: string[] = [];
  if (performer) bits.push(`${performer}の作品`);
  if (workType) bits.push(workType);
  if (feature) bits.push(`${feature}のポイント`);
  else if (heading && heading.length <= 24) bits.push(heading);

  let desc = "";
  if (bits.length >= 2) {
    desc = `${bits[0]}について、${bits.slice(1).join("・")}を中心に整理。`;
  } else if (summary && summary.length >= 20 && normalizeCompact(summary) !== normalizeCompact(editorialTitle)) {
    desc = truncateMetaDescription(summary, 110);
  } else if (performer && cid) {
    desc = `${performer}の${cid.toUpperCase()}について、公開情報をもとに見どころを整理した記事です。`;
  } else {
    desc = `${editorialTitle}。公開カタログの情報をもとに、作品の特徴を短く整理します。`;
  }
  if (cid && !desc.toLowerCase().includes(cid.toLowerCase()) && desc.length < 90) {
    desc = `${desc}（${cid.toUpperCase()}）`;
  }
  return truncateMetaDescription(desc, 120);
}

export function buildTaxonomyFromEvidencePack(
  evidence: PublicationMetadataEvidence,
): DerivedWordPressTaxonomy {
  const labels: EvidenceTaxonomyLabel[] = [
    ...(evidence.labelsRaw ?? []),
    ...(evidence.performers ?? []).map((name) => ({ type: "actress", name })),
    ...(evidence.seriesNames ?? []).map((name) => ({ type: "series", name })),
    ...(evidence.makers ?? []).map((name) => ({ type: "maker", name })),
    ...(evidence.labels ?? []).map((name) => ({ type: "label", name })),
    ...(evidence.genres ?? []).map((name) => ({ type: "genre", name })),
  ];
  return deriveWordPressTaxonomyFromEvidence({
    labels,
    title: evidence.officialTitle || evidence.writerTitle || "",
    officialDescription: evidence.officialDescription ?? null,
    extraPerformers: evidence.performers,
    extraSeriesNames: evidence.seriesNames,
    allowCategoryFallback: true,
    excludePerformersFromTags: true,
  });
}

export function evaluatePublicationMetadataQuality(
  meta: Omit<PublicationMetadata, "quality" | "source" | "generatedAt">,
  evidence: PublicationMetadataEvidence,
): PublicationMetadataQuality {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!meta.title?.trim()) failures.push("TITLE_MISSING");
  if (looksLikeCatalogDump(meta.title)) failures.push("TITLE_CATALOG_DUMP");
  if (looksLikeWeakEditorialTitle(meta.title, evidence) && meta.title === evidence.writerTitle) {
    failures.push("TITLE_PRODUCT_COPY");
  }
  if (meta.title.length > 60) warnings.push("TITLE_LONG");

  if (!meta.seoTitle?.trim()) failures.push("SEO_TITLE_MISSING");
  if (normalizeCompact(meta.seoTitle) === normalizeCompact(meta.title)) {
    failures.push("SEO_TITLE_SAME_AS_TITLE");
  }
  if (!meta.metaDescription?.trim()) failures.push("META_DESC_MISSING");
  if (normalizeCompact(meta.metaDescription) === normalizeCompact(meta.title)) {
    failures.push("META_DESC_SAME_AS_TITLE");
  }
  if (meta.metaDescription.trim().length < 28) failures.push("META_DESC_TOO_SHORT");

  if (!meta.categories?.length) failures.push("CATEGORY_MISSING");
  const meaningfulTags = filterMeaningfulTags(meta.tags ?? []);
  const evidenceTaggable =
    (evidence.performers?.length ?? 0) +
    (evidence.genres?.length ?? 0) +
    (evidence.makers?.length ?? 0) +
    (evidence.labels?.length ?? 0) +
    (evidence.seriesNames?.length ?? 0);
  if (meaningfulTags.length < 1) {
    if (evidenceTaggable > 0) failures.push("TAGS_MISSING");
    else warnings.push("TAGS_MISSING_NO_EVIDENCE");
  } else if (meaningfulTags.length < 2) {
    warnings.push("TAGS_SPARSE");
  }

  const evidencePerformers = evidence.performers ?? [];
  if (evidencePerformers.length > 0 && meta.performers.length === 0) {
    failures.push("PERFORMER_TAX_MISSING");
  }
  const evidenceSeries = evidence.seriesNames ?? [];
  if (evidenceSeries.length > 0 && meta.seriesNames.length === 0) {
    warnings.push("SERIES_TAX_MISSING");
  }

  return { pass: failures.length === 0, failures, warnings };
}

export function buildDeterministicPublicationMetadata(
  evidence: PublicationMetadataEvidence,
): PublicationMetadata {
  const axis = selectTitleAxis(evidence);
  const tax = buildTaxonomyFromEvidencePack(evidence);
  const title = buildDeterministicTitle(evidence, axis);
  const seoTitle = buildDeterministicSeoTitle(title, evidence);
  const metaDescription = buildDeterministicMetaDescription(title, evidence);
  const tags = filterMeaningfulTags([
    ...tax.tags.filter((t) => !(evidence.performers ?? []).includes(t) || tax.performers.length <= 3),
    ...tax.categories.filter((c) => c !== "作品紹介"),
    ...(evidence.makers ?? []),
    ...(evidence.labels ?? []),
    ...(evidence.genres ?? []),
  ]);

  // Prefer primary performers only for tax when compilation dump
  const performers =
    tax.performers.length > 5 ? tax.performers.slice(0, 3) : tax.performers;

  const base = {
    title,
    seoTitle,
    metaDescription,
    categories: tax.categories,
    tags,
    performers,
    seriesNames: tax.seriesNames,
    titleAxis: axis,
    productCanonicalId: evidence.productCanonicalId?.trim() || null,
  };
  const quality = evaluatePublicationMetadataQuality(base, evidence);
  return {
    ...base,
    quality,
    source: "deterministic",
    generatedAt: new Date().toISOString(),
  };
}

type LlmMetaJson = {
  title?: string;
  seoTitle?: string;
  metaDescription?: string;
  titleAxis?: TitleAxis;
};

export async function generatePublicationMetadata(input: {
  evidence: PublicationMetadataEvidence;
  llm?: LLMProvider | null;
  model?: string;
}): Promise<PublicationMetadata> {
  const fallback = buildDeterministicPublicationMetadata(input.evidence);
  if (!input.llm) return fallback;

  try {
    const result = await input.llm.executeTask({
      taskType: "publication_metadata",
      promptIdentifier: "wp-publication-metadata-v1",
      promptVersion: "1",
      model: input.model,
      systemInstruction:
        "あなたは日本語アダルトアフィリエイト媒体の編集者です。JSONのみ返してください。事実の捏造禁止。Evidenceにない出演者・シリーズ・評価・人気を作らない。titleは商品名の丸コピー禁止。seoTitleはtitleと差別化しkeyword stuffing禁止。metaDescriptionは本文切り抜きではなく検索結果向けの自然文。",
      userPrompt: JSON.stringify(
        {
          instruction:
            "Return JSON {title, seoTitle, metaDescription, titleAxis}. titleAxis one of feature|performer|work_type|audience|highlight|series_maker.",
          evidence: {
            productCanonicalId: input.evidence.productCanonicalId,
            officialTitle: input.evidence.officialTitle,
            performers: input.evidence.performers,
            seriesNames: input.evidence.seriesNames,
            makers: input.evidence.makers,
            genres: input.evidence.genres,
            writerTitle: input.evidence.writerTitle,
            articleSummary: input.evidence.articleSummary,
            sectionHeadings: input.evidence.sectionHeadings?.slice(0, 8),
            bodySnippets: input.evidence.bodySnippets?.slice(0, 2),
            suggestedAxis: selectTitleAxis(input.evidence),
            deterministicTitleHint: fallback.title,
          },
        },
        null,
        2,
      ),
      outputSchema: {
        type: "object",
        required: ["title", "seoTitle", "metaDescription"],
      },
      input: {},
    });

    const rawOutput = result.output;
    const json = (
      rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)
        ? rawOutput
        : extractJsonObject(
            typeof result.metadata?.rawText === "string" ? result.metadata.rawText : "",
          )
    ) as LlmMetaJson | null;
    if (!json?.title || !json.seoTitle || !json.metaDescription) return fallback;

    const tax = buildTaxonomyFromEvidencePack(input.evidence);
    const performers =
      tax.performers.length > 5 ? tax.performers.slice(0, 3) : tax.performers;
    const tags = filterMeaningfulTags([
      ...tax.tags.filter((t) => !performers.includes(t) || performers.length <= 3),
      ...tax.categories.filter((c) => c !== "作品紹介"),
      ...(input.evidence.makers ?? []),
      ...(input.evidence.genres ?? []),
    ]);

    const base = {
      title: clipTitle(String(json.title), 48),
      seoTitle: clipTitle(String(json.seoTitle), 70),
      metaDescription: truncateMetaDescription(String(json.metaDescription), 120),
      categories: tax.categories,
      tags,
      performers,
      seriesNames: tax.seriesNames,
      titleAxis: (json.titleAxis as TitleAxis) || fallback.titleAxis,
      productCanonicalId: input.evidence.productCanonicalId?.trim() || null,
    };
    let quality = evaluatePublicationMetadataQuality(base, input.evidence);
    if (!quality.pass) {
      // Merge: keep LLM title if valid enough, else deterministic; always keep evidence tax.
      const merged = {
        ...fallback,
        title: quality.failures.includes("TITLE_CATALOG_DUMP") ? fallback.title : base.title,
        seoTitle:
          quality.failures.includes("SEO_TITLE_SAME_AS_TITLE") ||
          quality.failures.includes("SEO_TITLE_MISSING")
            ? fallback.seoTitle
            : base.seoTitle,
        metaDescription:
          quality.failures.includes("META_DESC_SAME_AS_TITLE") ||
          quality.failures.includes("META_DESC_TOO_SHORT") ||
          quality.failures.includes("META_DESC_MISSING")
            ? fallback.metaDescription
            : base.metaDescription,
        source: "llm" as const,
      };
      quality = evaluatePublicationMetadataQuality(merged, input.evidence);
      return { ...merged, quality, generatedAt: new Date().toISOString() };
    }
    return {
      ...base,
      quality,
      source: "llm",
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]!) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** Build evidence pack from structuredContent + research labels. */
export function evidenceFromStructuredContent(input: {
  structured: Record<string, unknown>;
  versionTitle?: string | null;
  evidenceLabels?: EvidenceTaxonomyLabel[];
  productCanonicalId?: string | null;
  officialTitle?: string | null;
  officialDescription?: string | null;
  pageGenres?: string[] | null;
}): PublicationMetadataEvidence {
  const structured = input.structured;
  const article =
    structured.article && typeof structured.article === "object"
      ? (structured.article as Record<string, unknown>)
      : {};
  const seo =
    structured.seo && typeof structured.seo === "object"
      ? (structured.seo as Record<string, unknown>)
      : {};

  const performers = uniqPreserve([
    ...stringList(structured.performers),
    ...stringList(seo.performers),
    ...stringList(article.performers),
    ...(input.evidenceLabels ?? [])
      .filter((l) => /^(actress|performer)$/i.test(l.type))
      .map((l) => l.name),
  ]);
  const seriesNames = uniqPreserve([
    ...stringList(structured.seriesNames),
    ...(typeof structured.seriesName === "string" ? [structured.seriesName] : []),
    ...(typeof seo.seriesName === "string" ? [seo.seriesName] : []),
    ...(input.evidenceLabels ?? [])
      .filter((l) => /^series$/i.test(l.type))
      .map((l) => l.name),
  ]);
  const makers = uniqPreserve([
    ...(input.evidenceLabels ?? [])
      .filter((l) => /^(maker|label)$/i.test(l.type))
      .map((l) => l.name),
  ]);
  const genres = uniqPreserve([
    ...(input.pageGenres ?? []),
    ...stringList(article.labels),
    ...stringList(seo.labels),
    ...(input.evidenceLabels ?? [])
      .filter((l) => /^(genre|category|hashtag)$/i.test(l.type))
      .map((l) => l.name),
  ]);

  const sections = Array.isArray(article.sections) ? article.sections : [];
  const sectionHeadings: string[] = [];
  const bodySnippets: string[] = [];
  for (const s of sections) {
    if (!s || typeof s !== "object") continue;
    const row = s as { heading?: unknown; paragraphs?: unknown };
    if (typeof row.heading === "string" && row.heading.trim()) {
      sectionHeadings.push(row.heading.trim());
    }
    if (Array.isArray(row.paragraphs)) {
      for (const p of row.paragraphs) {
        if (typeof p === "string" && p.trim()) bodySnippets.push(p.trim());
      }
    }
  }

  const productCanonicalId =
    input.productCanonicalId ||
    (typeof structured.productCanonicalId === "string" && structured.productCanonicalId) ||
    (typeof structured.productKey === "string" && structured.productKey) ||
    null;

  return {
    productCanonicalId,
    officialTitle:
      input.officialTitle ||
      (typeof structured.officialTitle === "string" && structured.officialTitle) ||
      (typeof structured.productTitle === "string" && structured.productTitle) ||
      null,
    officialDescription:
      input.officialDescription ||
      (typeof structured.officialDescription === "string" && structured.officialDescription) ||
      null,
    performers,
    seriesNames,
    makers,
    genres,
    labelsRaw: input.evidenceLabels,
    writerTitle:
      (typeof article.title === "string" && article.title) || input.versionTitle || null,
    articleSummary:
      (typeof article.summary === "string" && article.summary) ||
      (typeof article.metaDescription === "string" && article.metaDescription) ||
      null,
    sectionHeadings,
    bodySnippets: bodySnippets.slice(0, 3),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const row of value) {
    if (typeof row === "string" && row.trim()) out.push(row.trim());
    else if (row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string") {
      const n = String((row as { name: string }).name).trim();
      if (n) out.push(n);
    }
  }
  return out;
}
