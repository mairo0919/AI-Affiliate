/**
 * Refresh WordPress publication metadata without rewriting body or schedule dates.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { requireApiLLMProvider } from "../adapters/llm/create-llm-provider.js";
import {
  createWordPressPublisherFromConfig,
  type WordPressApiPublisher,
} from "../adapters/publisher/wordpress-api-publisher.js";
import {
  evidenceFromStructuredContent,
  generatePublicationMetadata,
  type PublicationMetadata,
} from "./publication-metadata.js";
import {
  buildWordPressSeoAttach,
  OTONASELECT_PRODUCTION_ORIGIN,
} from "./wordpress-seo-attach.js";
import type { EvidenceTaxonomyLabel } from "./evidence-taxonomy.js";

export const DEFAULT_FUTURE_METADATA_REFRESH_IDS = [
  43, 47, 48, 49, 50, 51, 52, 59, 60, 62, 63, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
] as const;

export type MetadataRefreshRow = {
  externalId: string;
  contentVersionId: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  before?: {
    title: string;
    seoTitle: string;
    seoDesc: string;
    categories: string[];
    tags: string[];
    date: string | null;
  };
  after?: {
    title: string;
    seoTitle: string;
    seoDesc: string;
    categories: string[];
    tags: string[];
    date: string | null;
  };
  dateUnchanged?: boolean;
  bodyUnchanged?: boolean;
  metadata?: PublicationMetadata;
};

async function loadEvidenceLabels(
  prisma: DatabaseClient["prisma"],
  productCanonicalId: string | null,
): Promise<EvidenceTaxonomyLabel[]> {
  if (!productCanonicalId?.trim()) return [];
  const cid = productCanonicalId.trim().toLowerCase();
  try {
    const item = await prisma.researchItem.findFirst({
      where: {
        OR: [
          { externalId: { equals: cid, mode: "insensitive" } },
          { externalId: { startsWith: cid, mode: "insensitive" } },
        ],
      },
      orderBy: { collectedAt: "desc" },
      include: { tags: { include: { researchTag: true } } },
    });
    if (!item?.tags?.length) return [];
    return item.tags.map((t) => ({
      type: t.researchTag.type,
      name: t.researchTag.name,
    }));
  } catch {
    return [];
  }
}

async function fetchWpSnapshot(
  config: AppConfig,
  externalId: string,
): Promise<{
  title: string;
  seoTitle: string;
  seoDesc: string;
  categories: string[];
  tags: string[];
  date: string | null;
  content: string;
} | null> {
  const base = String(config.wordpressBaseUrl ?? "").replace(/\/$/, "");
  const user = config.wordpressUsername;
  const pass = String(config.wordpressApplicationPassword ?? "").replace(/\s+/g, "");
  if (!base || !user || !pass) return null;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const ns = config.wordpressApiNamespace || "wp/v2";
  const res = await fetch(`${base}/wp-json/${ns}/posts/${externalId}?context=edit`, {
    headers: { Authorization: `Basic ${auth}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json()) as {
    title?: { raw?: string; rendered?: string };
    date?: string;
    content?: { raw?: string; rendered?: string };
    categories?: number[];
    tags?: number[];
    meta?: Record<string, string>;
  };
  const meta = j.meta ?? {};
  const termNames = async (ids: number[] | undefined, tax: string) => {
    if (!ids?.length) return [] as string[];
    const r = await fetch(
      `${base}/wp-json/${ns}/${tax}?include=${ids.join(",")}&per_page=100&_fields=id,name`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!r.ok) return [];
    const rows = (await r.json()) as Array<{ name?: string }>;
    return rows.map((x) => x.name ?? "").filter(Boolean);
  };
  const [categories, tags] = await Promise.all([
    termNames(j.categories, "categories"),
    termNames(j.tags, "tags"),
  ]);
  return {
    title: j.title?.raw || j.title?.rendered || "",
    seoTitle: meta.otonaselect_seo_title || "",
    seoDesc: meta.otonaselect_seo_description || "",
    categories,
    tags,
    date: j.date ?? null,
    content: j.content?.raw || j.content?.rendered || "",
  };
}

export async function refreshWordPressPublicationMetadata(deps: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  externalIds: Array<string | number>;
  useLlm?: boolean;
  /** When true, only update posts whose metadata quality fails / is weak. */
  onlyIfWeak?: boolean;
}): Promise<{ rows: MetadataRefreshRow[] }> {
  const publisher = createWordPressPublisherFromConfig(deps.config) as WordPressApiPublisher;
  const llm = deps.useLlm === false ? null : requireApiLLMProvider(deps.config);
  const rows: MetadataRefreshRow[] = [];

  for (const rawId of deps.externalIds) {
    const externalId = String(rawId);
    const target = await deps.database.prisma.publicationTarget.findFirst({
      where: { platform: "WORDPRESS", publishedExternalId: externalId },
      select: { contentVersionId: true, status: true },
    });
    if (!target) {
      rows.push({
        externalId,
        contentVersionId: "",
        ok: false,
        reason: "PUBLICATION_TARGET_NOT_FOUND",
      });
      continue;
    }

    const version = await deps.database.prisma.contentVersion.findUnique({
      where: { id: target.contentVersionId },
      select: {
        id: true,
        title: true,
        summary: true,
        structuredContent: true,
      },
    });
    if (!version) {
      rows.push({
        externalId,
        contentVersionId: target.contentVersionId,
        ok: false,
        reason: "CONTENT_VERSION_NOT_FOUND",
      });
      continue;
    }

    const before = await fetchWpSnapshot(deps.config, externalId);
    const structured =
      version.structuredContent && typeof version.structuredContent === "object"
        ? ({ ...(version.structuredContent as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const productCanonicalId =
      (typeof structured.productCanonicalId === "string" && structured.productCanonicalId) ||
      (typeof structured.productKey === "string" && structured.productKey) ||
      null;
    const evidenceLabels = await loadEvidenceLabels(deps.database.prisma, productCanonicalId);
    const evidence = evidenceFromStructuredContent({
      structured,
      versionTitle: version.title,
      evidenceLabels,
      productCanonicalId,
    });
    const metadata = await generatePublicationMetadata({ evidence, llm });
    if (deps.onlyIfWeak && metadata.quality.pass && before) {
      const weak =
        before.title === before.seoTitle ||
        before.title === before.seoDesc ||
        before.tags.length < 2 ||
        !before.seoDesc;
      if (!weak) {
        rows.push({
          externalId,
          contentVersionId: version.id,
          ok: true,
          skipped: true,
          reason: "ALREADY_STRONG",
          before: before
            ? {
                title: before.title,
                seoTitle: before.seoTitle,
                seoDesc: before.seoDesc,
                categories: before.categories,
                tags: before.tags,
                date: before.date,
              }
            : undefined,
        });
        continue;
      }
    }

    const attach = buildWordPressSeoAttach({
      title: metadata.title,
      seoTitle: metadata.seoTitle,
      metaDescription: metadata.metaDescription,
      performers: metadata.performers,
      seriesNames: metadata.seriesNames,
      categories: metadata.categories,
      tags: metadata.tags,
      productCanonicalId: metadata.productCanonicalId,
      siteOrigin: deps.config.wordpressBaseUrl ?? OTONASELECT_PRODUCTION_ORIGIN,
    });

    try {
      const ensure = publisher.ensureTerm.bind(publisher);
      const tagIds: number[] = [];
      for (const name of attach.tags) {
        const id = await ensure({ taxonomyRestBase: "tags", name });
        if (id) tagIds.push(id);
      }
      const categoryIds: number[] = [];
      for (const name of attach.categories) {
        const id = await ensure({ taxonomyRestBase: "categories", name });
        if (id) categoryIds.push(id);
      }
      const performerIds: number[] = [];
      for (const p of attach.performers) {
        const id = await ensure({
          taxonomyRestBase: "performer",
          name: p.name,
          slug: p.stableSlug,
        });
        if (id) performerIds.push(id);
      }
      const seriesIds: number[] = [];
      for (const s of attach.seriesList) {
        const id = await ensure({
          taxonomyRestBase: "series",
          name: s.name,
          slug: s.stableSlug,
        });
        if (id) seriesIds.push(id);
      }

      await publisher.updateMetadataOnly({
        externalId,
        title: metadata.title,
        excerpt: attach.excerpt,
        wpSeoMeta: attach.meta,
        tagIds,
        categoryIds,
        performerIds,
        seriesIds,
      });
    } catch (error) {
      rows.push({
        externalId,
        contentVersionId: version.id,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        metadata,
        before: before
          ? {
              title: before.title,
              seoTitle: before.seoTitle,
              seoDesc: before.seoDesc,
              categories: before.categories,
              tags: before.tags,
              date: before.date,
            }
          : undefined,
      });
      continue;
    }

    // Persist publicationMetadata only — do not mutate article.sections / body.
    const nextStructured = {
      ...structured,
      publicationMetadata: metadata,
      seo: {
        ...((structured.seo && typeof structured.seo === "object"
          ? structured.seo
          : {}) as Record<string, unknown>),
        title: metadata.seoTitle,
        metaDescription: metadata.metaDescription,
        categories: metadata.categories,
        tags: metadata.tags,
        performers: metadata.performers,
        seriesName: metadata.seriesNames[0] ?? null,
        seriesNames: metadata.seriesNames,
      },
    };
    if (typeof deps.lifecycle.updateContentVersionStructuredContent === "function") {
      await deps.lifecycle.updateContentVersionStructuredContent(version.id, nextStructured);
    } else {
      await deps.database.prisma.contentVersion.update({
        where: { id: version.id },
        data: { structuredContent: nextStructured },
      });
    }

    const after = await fetchWpSnapshot(deps.config, externalId);
    rows.push({
      externalId,
      contentVersionId: version.id,
      ok: true,
      before: before
        ? {
            title: before.title,
            seoTitle: before.seoTitle,
            seoDesc: before.seoDesc,
            categories: before.categories,
            tags: before.tags,
            date: before.date,
          }
        : undefined,
      after: after
        ? {
            title: after.title,
            seoTitle: after.seoTitle,
            seoDesc: after.seoDesc,
            categories: after.categories,
            tags: after.tags,
            date: after.date,
          }
        : undefined,
      dateUnchanged: Boolean(before && after && before.date === after.date),
      bodyUnchanged: Boolean(before && after && before.content === after.content),
      metadata,
    });
  }

  return { rows };
}
