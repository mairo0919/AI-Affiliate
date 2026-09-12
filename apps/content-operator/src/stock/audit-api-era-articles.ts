/**
 * Re-audit API-era articles against current canonical quality criteria.
 * Classifies each as NORMAL | REPAIR_REQUIRED | NEEDS_ENRICHMENT.
 * Does not mutate production state.
 */

import type { AppConfig } from "@ai-affiliate/config";
import type { DatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";
import { createLogger } from "@ai-affiliate/shared";
import { validateFanzaAffiliateUrl } from "../daily-blog/affiliate-url.js";
import { buildFanzaCanonicalProductUrl } from "../adapters/affiliate/fanza-affiliate-provider.js";
import {
  extractItemListCatalogFacts,
  readPageEvidenceFromDocMetadata,
  shouldAvoidSingularPerformerFraming,
} from "./ensure-official-enrichment.js";
import {
  detectRepairScope,
  isMechanicalTemplateTitle,
  isPerformerGenreListTitle,
  scoreArticleAxes,
  type RepairScope,
} from "./repair-quality-guard.js";
import { evaluateStockArticleQualityGate } from "./stock-quality-gate.js";
import { listApiEraWordPressProductCids } from "./repair-api-article-quality.js";

export type AuditClass = "NORMAL" | "REPAIR_REQUIRED" | "NEEDS_ENRICHMENT";

export type ApiEraAuditRow = {
  cid: string;
  wpId: string | null;
  wpStatus: "PUBLISHED" | "SCHEDULED" | "APPROVED_UNSCHEDULED" | "MISSING";
  contentVersionId: string | null;
  contentStatus: string | null;
  title: string;
  bodyLen: number;
  scope: RepairScope;
  classification: AuditClass;
  reasons: string[];
  evidence: {
    hasOfficialDescription: boolean;
    synthesized: boolean;
    actorCount: number;
  };
  affiliateOk: boolean;
  reviewCount: number;
  reviewFailed: number;
  reviewPassed: number;
  axes: ReturnType<typeof scoreArticleAxes>;
  scheduledAt: string | null;
};

function plainBody(body: unknown): string {
  return String(body ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cidFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  for (const k of ["productCanonicalId", "productKey", "canonicalId", "externalId", "cid"]) {
    if (typeof m[k] === "string" && m[k].trim()) return m[k].trim();
  }
  return null;
}

async function resolveCtaUrl(input: {
  item: { url: string | null; rawData: unknown };
  meta: Record<string, unknown>;
  cid: string;
}): Promise<string> {
  const raw = (input.item.rawData ?? {}) as Record<string, unknown>;
  const affiliateFromResearch =
    (typeof raw.affiliateURL === "string" && raw.affiliateURL) ||
    (typeof raw.affiliateUrl === "string" && raw.affiliateUrl) ||
    (typeof input.item.url === "string" && input.item.url.includes("al.fanza")
      ? input.item.url
      : null) ||
    null;
  const metaCta = typeof input.meta.ctaUrl === "string" ? input.meta.ctaUrl : null;
  const candidate =
    affiliateFromResearch ||
    (metaCta && /al\.fanza|af_id=|affiliate/i.test(metaCta) ? metaCta : null) ||
    metaCta ||
    buildFanzaCanonicalProductUrl(input.cid);
  return validateFanzaAffiliateUrl(candidate).url || buildFanzaCanonicalProductUrl(input.cid);
}

/**
 * List API-era CIDs: WP scheduled/published api-like + APPROVED stock without WP reservation
 * that looks API-era (FANZA ItemList / null description / stockRoute markers).
 */
export async function listApiEraUniverseCids(input: {
  database: DatabaseClient;
}): Promise<string[]> {
  const fromWp = await listApiEraWordPressProductCids(input);
  const cids = new Set(fromWp);

  // APPROVED ContentVersions without WordPress target (未予約)
  const approved = await input.database.prisma.contentVersion.findMany({
    where: { status: "APPROVED" },
    orderBy: { updatedAt: "desc" },
    take: 300,
    select: { id: true, structuredContent: true, title: true },
  });
  for (const cv of approved) {
    const sc = (cv.structuredContent ?? {}) as Record<string, unknown>;
    const cid =
      (typeof sc.productCanonicalId === "string" && sc.productCanonicalId) ||
      (typeof sc.canonicalId === "string" && sc.canonicalId) ||
      null;
    if (!cid) continue;
    const hasWp = await input.database.prisma.publicationTarget.findFirst({
      where: {
        contentVersionId: cv.id,
        platform: "WORDPRESS",
        status: { in: ["SCHEDULED", "PUBLISHED", "DRAFT", "AWAITING_APPROVAL"] },
      },
      select: { id: true },
    });
    if (hasWp) continue;
    const item = await input.database.prisma.researchItem.findFirst({
      where: { externalId: cid },
      include: { source: true },
    });
    const looksApi =
      item?.description == null ||
      /fanza/i.test(String(item?.source?.name ?? "")) ||
      sc.stockRoute === "STOCK_GENERATION" ||
      sc.stockRoute === "API_QUALITY_REPAIR" ||
      String(sc.generationRoute ?? "").includes("STOCK");
    if (looksApi) cids.add(cid);
  }

  return [...cids];
}

export async function auditApiEraArticle(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  logger?: Logger;
  cid: string;
}): Promise<ApiEraAuditRow> {
  const logger = input.logger ?? createLogger("info");
  void logger;
  void input.config;  const item = await input.database.prisma.researchItem.findFirst({
    where: { externalId: input.cid },
  });
  if (!item) {
    return {
      cid: input.cid,
      wpId: null,
      wpStatus: "MISSING",
      contentVersionId: null,
      contentStatus: null,
      title: "",
      bodyLen: 0,
      scope: "FULL",
      classification: "NEEDS_ENRICHMENT",
      reasons: ["RESEARCH_ITEM_MISSING"],
      evidence: {
        hasOfficialDescription: false,
        synthesized: false,
        actorCount: 0,
      },
      affiliateOk: false,
      reviewCount: 0,
      reviewFailed: 0,
      reviewPassed: 0,
      axes: scoreArticleAxes({
        title: "",
        bodyText: "",
        productTitle: "",
        rawData: {},
      }),
      scheduledAt: null,
    };
  }

  const target = await input.database.prisma.publicationTarget.findFirst({
    where: {
      platform: "WORDPRESS",
      status: { in: ["SCHEDULED", "PUBLISHED"] },
      OR: [
        { platformMetadata: { path: ["productCanonicalId"], equals: input.cid } },
        { platformMetadata: { path: ["productKey"], equals: input.cid } },
        { platformMetadata: { path: ["canonicalId"], equals: input.cid } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  let contentVersionId = target?.contentVersionId ?? null;
  let wpStatus: ApiEraAuditRow["wpStatus"] = target
    ? ((target.status as "PUBLISHED" | "SCHEDULED") ?? "MISSING")
    : "MISSING";

  if (!contentVersionId) {
    const approvedCv = await input.database.prisma.contentVersion.findFirst({
      where: {
        status: "APPROVED",
        OR: [
          { structuredContent: { path: ["productCanonicalId"], equals: input.cid } },
          { structuredContent: { path: ["canonicalId"], equals: input.cid } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (approvedCv) {
      contentVersionId = approvedCv.id;
      wpStatus = "APPROVED_UNSCHEDULED";
    }
  }

  const cv = contentVersionId
    ? await input.database.prisma.contentVersion.findUnique({
        where: { id: contentVersionId },
        select: {
          id: true,
          title: true,
          body: true,
          status: true,
          structuredContent: true,
        },
      })
    : null;

  const meta = (target?.platformMetadata ?? {}) as Record<string, unknown>;
  const title = cv?.title ?? String(meta.title ?? item.title);
  const bodyText = plainBody(cv?.body);
  const catalog = extractItemListCatalogFacts(item.rawData);
  const snap = {
    title,
    bodyText,
    productTitle: item.title,
    rawData: item.rawData,
  };
  const axes = scoreArticleAxes(snap);
  const scope = detectRepairScope(snap);

  const doc = await input.lifecycle.findLatestSourceDocumentByUrlContains(input.cid);
  const pe = doc ? readPageEvidenceFromDocMetadata(doc.metadata) : null;
  const synthesized = (pe as { synthesizedFrom?: string; fetchMode?: string } | null)?.synthesizedFrom === "itemlist"
    && !(pe as { fetchMode?: string } | null)?.fetchMode;
  const hasOfficialDescription = Boolean(pe?.description?.text?.trim()) && !synthesized;

  const reasons: string[] = [];
  if (!hasOfficialDescription) {
    reasons.push(synthesized ? "SYNTHESIZED_EVIDENCE" : "MISSING_OFFICIAL_DESCRIPTION");
  }
  if (scope !== "NONE") reasons.push(`SCOPE_${scope}`);

  const gate = evaluateStockArticleQualityGate({
    productTitle: item.title,
    rawData: item.rawData,
    structuredContent: {
      title,
      bodyHtml: cv?.body ?? bodyText,
    },
    writerTitle: title,
  });
  if (!gate.ok) reasons.push(gate.reason);

  if (shouldAvoidSingularPerformerFraming({ actors: catalog.actors, productTitle: item.title })) {
    const named = catalog.actors.filter((a) => a.length >= 2 && title.includes(a));
    if (named.length === 1 && /出演|が魅せる|が贈る|^注目は/.test(title)) {
      reasons.push("MULTI_PERFORMER_SINGULAR_TITLE");
    }
  }
  if (isPerformerGenreListTitle(title, catalog.actors)) {
    reasons.push("PERFORMER_GENRE_LIST_TITLE");
  }
  if (isMechanicalTemplateTitle(title)) {
    reasons.push("MECHANICAL_TEMPLATE_TITLE");
  }
  if (axes.factual < 55) reasons.push("LOW_FACTUAL");
  if (axes.productUnderstanding < 40) reasons.push("LOW_PRODUCT_UNDERSTANDING");
  if (bodyText.length > 0 && bodyText.length < 280) reasons.push("THIN_BODY");

  const ctaUrl = await resolveCtaUrl({ item, meta, cid: input.cid });
  const affiliateOk = validateFanzaAffiliateUrl(ctaUrl).ok;
  if (!affiliateOk) reasons.push("AFFILIATE_CTA_WEAK");

  const reviews = contentVersionId
    ? await input.database.prisma.qualityReviewRecord.findMany({
        where: { contentVersionId },
        select: { result: true },
      })
    : [];
  const reviewCount = reviews.length;
  const reviewFailed = reviews.filter((r) => r.result === "FAILED").length;
  const reviewPassed = reviews.filter(
    (r) => r.result === "PASSED" || r.result === "WARNING",
  ).length;
  if (reviewCount === 0) reasons.push("REVIEW_NOT_EXECUTED");
  if (reviewFailed > 0) reasons.push("REVIEW_FAILED");

  // Classification: Evidence first; quality issues → repair; else keep.
  // Missing historical reviews alone does NOT force repair (informational).
  let classification: AuditClass = "NORMAL";
  if (!hasOfficialDescription) {
    classification = "NEEDS_ENRICHMENT";
  } else if (
    scope !== "NONE" ||
    !gate.ok ||
    axes.factual < 55 ||
    reviewFailed > 0
  ) {
    classification = "REPAIR_REQUIRED";
  } else {
    classification = "NORMAL";
  }

  // Deduplicate reasons
  const uniqueReasons = [...new Set(reasons)];

  const scheduledAt =
    target?.scheduledAt?.toISOString() ??
    (typeof meta.scheduledAt === "string" ? meta.scheduledAt : null);

  return {
    cid: input.cid,
    wpId: target?.publishedExternalId ?? null,
    wpStatus,
    contentVersionId: cv?.id ?? null,
    contentStatus: cv?.status ?? null,
    title,
    bodyLen: bodyText.length,
    scope,
    classification,
    reasons: uniqueReasons,
    evidence: {
      hasOfficialDescription,
      synthesized,
      actorCount: catalog.actors.length || (pe?.actors?.length ?? 0),
    },
    affiliateOk,
    reviewCount,
    reviewFailed,
    reviewPassed,
    axes,
    scheduledAt,
  };
}

export async function auditApiEraArticlesBatch(input: {
  database: DatabaseClient;
  lifecycle: LifecycleRepository;
  config: AppConfig;
  logger?: Logger;
  cids?: string[];
}): Promise<{
  auditedAt: string;
  total: number;
  counts: Record<AuditClass, number>;
  rows: ApiEraAuditRow[];
}> {
  const logger = input.logger ?? createLogger("info");
  const cids = input.cids?.length
    ? input.cids
    : await listApiEraUniverseCids({ database: input.database });

  const rows: ApiEraAuditRow[] = [];
  for (const cid of cids) {
    const row = await auditApiEraArticle({
      database: input.database,
      lifecycle: input.lifecycle,
      config: input.config,
      logger,
      cid,
    });
    rows.push(row);
  }

  const counts: Record<AuditClass, number> = {
    NORMAL: 0,
    REPAIR_REQUIRED: 0,
    NEEDS_ENRICHMENT: 0,
  };
  for (const r of rows) counts[r.classification] += 1;

  return {
    auditedAt: new Date().toISOString(),
    total: rows.length,
    counts,
    rows,
  };
}

export { cidFromMeta };
