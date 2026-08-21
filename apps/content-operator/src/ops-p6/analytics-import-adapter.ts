import { createHash } from "node:crypto";
import { normalizeSnapshotMetrics } from "../learning/analytics-aggregator.js";

export interface NormalizedImportRow {
  rowIndex: number;
  externalPublicationId: string | null;
  measuredAt: Date | null;
  rawMetrics: Record<string, unknown>;
  normalizedMetrics: Record<string, number>;
  unit: string | null;
  attributionWindowHours: number | null;
  platform: string | null;
  validationIssues: string[];
  rowHash: string;
}

export interface AnalyticsImportAdapter {
  readonly sourceKey: string;
  parse(input: string | Record<string, unknown>[] | Record<string, unknown>): NormalizedImportRow[];
}

function hashRow(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceMetrics(row: Record<string, unknown>): {
  raw: Record<string, unknown>;
  issues: string[];
} {
  const raw: Record<string, unknown> = {};
  const issues: string[] = [];
  const known = [
    "impressions",
    "views",
    "pageViews",
    "page_views",
    "clicks",
    "ctr",
    "engagement",
    "likes",
    "repost",
    "reposts",
    "comments",
    "bookmark",
    "bookmarks",
    "article_open",
    "articleOpens",
    "read_time",
    "readTime",
    "external_click",
    "externalClicks",
    "publication_age",
  ];
  for (const [k, v] of Object.entries(row)) {
    if (["externalId", "external_publication_id", "publicationId", "platform", "measuredAt", "measured_at", "unit", "attributionWindowHours"].includes(k)) {
      continue;
    }
    const n = parseNumber(v);
    if (n === null) {
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        issues.push(`invalid_metric:${k}`);
      }
      continue;
    }
    raw[k] = n;
    if (!known.includes(k) && !known.includes(k.toLowerCase())) {
      // unknown columns kept in raw / platformSpecific after normalize
    }
  }
  return { raw, issues };
}

function rowFromObject(row: Record<string, unknown>, rowIndex: number, defaultPlatform?: string): NormalizedImportRow {
  const issues: string[] = [];
  const external =
    (typeof row.externalId === "string" && row.externalId) ||
    (typeof row.external_publication_id === "string" && row.external_publication_id) ||
    (typeof row.publicationId === "string" && row.publicationId) ||
    null;
  const measuredRaw = row.measuredAt ?? row.measured_at;
  let measuredAt: Date | null = null;
  if (measuredRaw) {
    const d = new Date(String(measuredRaw));
    if (Number.isNaN(d.getTime())) issues.push("invalid_measuredAt");
    else measuredAt = d;
  }
  const { raw, issues: metricIssues } = coerceMetrics(row);
  issues.push(...metricIssues);
  if (Object.keys(raw).length === 0) issues.push("missing_metrics");

  const normalized = normalizeSnapshotMetrics(raw);
  const flat: Record<string, number> = {
    ...Object.fromEntries(
      Object.entries(normalized.canonical).filter(([, v]) => v !== undefined) as [string, number][],
    ),
    ...normalized.platformSpecific,
  };

  const platform =
    (typeof row.platform === "string" && row.platform) || defaultPlatform || null;
  const unit = typeof row.unit === "string" ? row.unit : null;
  const attributionWindowHours = parseNumber(row.attributionWindowHours);

  return {
    rowIndex,
    externalPublicationId: external,
    measuredAt,
    rawMetrics: raw,
    normalizedMetrics: flat,
    unit,
    attributionWindowHours,
    platform,
    validationIssues: issues,
    rowHash: hashRow([external, measuredAt?.toISOString() ?? null, flat, platform]),
  };
}

/** Simple CSV: header row + comma-separated values. Does not stream huge files. */
export class CsvAnalyticsImportAdapter implements AnalyticsImportAdapter {
  readonly sourceKey = "csv";
  constructor(private readonly defaultPlatform?: string) {}

  parse(input: string | Record<string, unknown>[] | Record<string, unknown>): NormalizedImportRow[] {
    if (typeof input !== "string") {
      throw new Error("CsvAnalyticsImportAdapter expects string CSV content");
    }
    const lines = input
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]!);
    const rows: NormalizedImportRow[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cols = splitCsvLine(lines[i]!);
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx] ?? "";
      });
      rows.push(rowFromObject(obj, i - 1, this.defaultPlatform));
    }
    return rows;
  }
}

export class JsonAnalyticsImportAdapter implements AnalyticsImportAdapter {
  readonly sourceKey = "json";
  constructor(private readonly defaultPlatform?: string) {}

  parse(input: string | Record<string, unknown>[] | Record<string, unknown>): NormalizedImportRow[] {
    let data: unknown = input;
    if (typeof input === "string") data = JSON.parse(input);
    const list = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)
        ? (data as { rows: unknown[] }).rows
        : [data];
    return list.map((item, idx) =>
      rowFromObject((item ?? {}) as Record<string, unknown>, idx, this.defaultPlatform),
    );
  }
}

/** Future API adapter boundary — does not call network. */
export class FutureApiAnalyticsImportAdapter implements AnalyticsImportAdapter {
  readonly sourceKey = "api-future";
  parse(input: string | Record<string, unknown>[] | Record<string, unknown>): NormalizedImportRow[] {
    const adapter = new JsonAnalyticsImportAdapter();
    return adapter.parse(input);
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
