/**
 * Helpers: extract official actress ruby from ResearchItem.rawData (FANZA iteminfo).
 * Never invents readings — only returns values present in Evidence/API payload.
 */

export type PerformerReading = { name: string; reading: string };

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeNameKey(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/**
 * Walk FANZA-like rawData for actress entities with ruby.
 */
export function extractPerformerReadingsFromRawData(raw: unknown): PerformerReading[] {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const iteminfo =
    root.iteminfo && typeof root.iteminfo === "object" && !Array.isArray(root.iteminfo)
      ? (root.iteminfo as Record<string, unknown>)
      : root.itemInfo && typeof root.itemInfo === "object" && !Array.isArray(root.itemInfo)
        ? (root.itemInfo as Record<string, unknown>)
        : null;
  if (!iteminfo) return [];

  const actress = iteminfo.actress;
  const out: PerformerReading[] = [];
  const seen = new Set<string>();
  for (const ent of asArray(actress)) {
    if (!ent || typeof ent !== "object") continue;
    const row = ent as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const ruby = typeof row.ruby === "string" ? row.ruby.trim() : "";
    if (!name || !ruby) continue;
    const key = normalizeNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, reading: ruby });
  }
  return out;
}

/** Policy category display name → reading (not AI). */
export const CATEGORY_READING_MAP: Record<string, string> = {
  企画: "きかく",
  単体作品: "たんたいさくひん",
  "ベスト・総集編": "べすとそうしゅうへん",
  VR: "vr",
};
