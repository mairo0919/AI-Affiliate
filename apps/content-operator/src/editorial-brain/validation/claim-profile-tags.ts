/**
 * Claim kind inference for validation / planner input when Claim.metadata.kind is absent.
 * Statement-pattern based — not product-specific.
 */

export function inferClaimKindFromStatement(statement: string): string {
  const s = statement.trim();
  if (/出演者|クリエイター/.test(s)) return "performer";
  if (/メーカー|レーベル/.test(s)) return "maker";
  if (/シリーズ/.test(s)) return "series";
  if (/販売|配信|AVAILABLE|availability/i.test(s)) return "availability";
  if (/タイトル|作品名/.test(s) && /として「/.test(s)) return "title";
  return "trait_or_scene";
}

export type ValidationClaimProfileTag =
  | "trait-rich"
  | "identity-heavy"
  | "scarce"
  | "rich"
  | "naming-risk"
  | "evaluation-risk"
  | "mixed";

export function classifyClaimProfiles(
  claims: Array<{ kind: string; statement: string }>,
): ValidationClaimProfileTag[] {
  const tags = new Set<ValidationClaimProfileTag>();
  const kinds = claims.map((c) => c.kind.toLowerCase());
  const trait = kinds.filter((k) => k === "trait_or_scene" || k === "trait" || k === "scene").length;
  const identity = kinds.filter((k) =>
    ["performer", "maker", "series", "title"].includes(k),
  ).length;
  const total = claims.length;

  if (total <= 2) tags.add("scarce");
  if (total >= 5) tags.add("rich");
  if (trait >= 3) tags.add("trait-rich");
  if (identity >= 3 && trait <= 1) tags.add("identity-heavy");
  if (kinds.includes("series") || kinds.includes("title") || kinds.includes("maker")) {
    tags.add("naming-risk");
  }
  if (trait >= 2) tags.add("evaluation-risk");
  if (tags.size === 0) tags.add("mixed");
  return [...tags];
}
