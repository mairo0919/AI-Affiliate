/**
 * Persist FANZA demand observations. Rows are appended; history is not overwritten.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import {
  parseDemandIngest,
  selectLatestDemandSnapshot,
  type DemandObservationDraft,
  type DemandSemanticType,
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

export async function loadLatestDemandSnapshot(prisma: Prisma): Promise<DemandObservationDraft[]> {
  const rows = await prisma.demandObservation.findMany({
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    take: 800,
  });
  return selectLatestDemandSnapshot(
    rows.map((row) => ({
      source:
        row.source === "FANZA_RECOMMENDED_PRODUCT" || row.source === "FANZA_INTERNAL_SEARCH"
          ? row.source
          : "FANZA_INTERNAL_SEARCH",
      scope: "video",
      contentId: row.contentId,
      keyword: row.keyword,
      rank: row.rank,
      semanticType: semanticTypeOf(row.semanticType),
      provenance: row.provenance,
      observedAt: row.observedAt,
    })),
  );
}
