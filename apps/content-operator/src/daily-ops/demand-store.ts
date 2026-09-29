/**
 * Persist FANZA demand observations. Rows are appended; history is not overwritten.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import {
  DEMAND_PRODUCT_LIST_SOURCES,
  DEMAND_SEGMENT_SOURCES,
  FANZA_INTERNAL_SEARCH,
  isDemandSource,
  parseDemandIngest,
  selectLatestDemandSnapshot,
  type DemandObservationDraft,
  type DemandSemanticType,
  type DemandSource,
} from "./demand-signal.js";

type Prisma = DatabaseClient["prisma"];

const SEMANTIC_TYPES = new Set<DemandSemanticType>(["PERFORMER", "GENRE", "THEME", "OTHER"]);

function semanticTypeOf(value: string | null): DemandSemanticType | null {
  if (value && SEMANTIC_TYPES.has(value as DemandSemanticType)) return value as DemandSemanticType;
  return value ? "OTHER" : null;
}

export async function appendDemandObservations(
  prisma: Prisma,
  input: unknown,
): Promise<{ inserted: number } | { errors: string[] }> {
  const parsed = parseDemandIngest(input);
  if (!parsed.ok) return { errors: parsed.errors };
  if (parsed.rows.length === 0) return { inserted: 0 };
  const result = await prisma.demandObservation.createMany({
    data: parsed.rows.map((row) => ({
      source: row.source,
      scope: row.scope,
      contentId: row.contentId,
      keyword: row.keyword,
      rank: row.rank,
      semanticType: row.semanticType,
      provenance: row.provenance,
      observedAt: row.observedAt,
    })),
  });
  return { inserted: result.count };
}

function toDraft(row: {
  source: string;
  contentId: string | null;
  keyword: string | null;
  rank: number;
  semanticType: string | null;
  provenance: string;
  observedAt: Date;
}): DemandObservationDraft | null {
  if (!isDemandSource(row.source)) return null;
  return {
    source: row.source,
    scope: "video",
    contentId: row.contentId,
    keyword: row.keyword,
    rank: row.rank,
    semanticType: semanticTypeOf(row.semanticType),
    provenance: row.provenance,
    observedAt: row.observedAt,
  };
}

export async function loadLatestDemandSnapshot(prisma: Prisma): Promise<DemandObservationDraft[]> {
  const collected: DemandObservationDraft[] = [];
  const listSources: DemandSource[] = [FANZA_INTERNAL_SEARCH, ...DEMAND_PRODUCT_LIST_SOURCES];
  for (const source of listSources) {
    const latest = await prisma.demandObservation.findFirst({
      where: { source },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
      select: { observedAt: true },
    });
    if (!latest) continue;
    const rows = await prisma.demandObservation.findMany({
      where: { source, observedAt: latest.observedAt },
    });
    for (const row of rows) {
      const draft = toDraft(row);
      if (draft) collected.push(draft);
    }
  }
  for (const source of DEMAND_SEGMENT_SOURCES) {
    const rows = await prisma.demandObservation.findMany({
      where: { source },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    for (const row of rows) {
      const draft = toDraft(row);
      if (draft) collected.push(draft);
    }
  }
  return selectLatestDemandSnapshot(collected);
}
