/**
 * Deterministic text surface utilities for generation / R102 — not reviewer entailment.
 */

const STOP_FACETS = new Set([
  "公開",
  "事実",
  "作品",
  "情報",
  "内容",
  "整理",
  "確認",
  "記載",
  "状態",
  "示さ",
  "述べ",
  "続ける",
  "残す",
  "短く",
  "まとめ",
  "記事",
  "本編",
  "紹介",
  "対象",
  "関連",
  "以上",
  "以下",
  "場合",
  "可能",
  "利用",
  "販売",
  "配信",
]);

export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[。．！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

export function extractTextFacets(text: string): string[] {
  const facets = [
    ...(text.match(/\d+泊\d+日/g) ?? []),
    ...(text.match(/\d+(?:名|時間|作品|分|人)/g) ?? []),
    ...(text.match(/\d+[\u4e00-\u9fff]{1,6}(?:\d+[\u4e00-\u9fff]{1,6})*/g) ?? []),
    ...(text.match(/[\u30a0-\u30ff]{3,}/g) ?? []),
    ...(text.match(/[\u4e00-\u9fff]{2,}/g) ?? []),
    ...(text.match(/[A-Za-z0-9]+[\u30a0-\u30ff\u4e00-\u9fff]{2,}/g) ?? []),
    ...(text.match(/[A-Za-z][A-Za-z0-9_-]{1,24}/g) ?? []),
    ...(text.match(/「([^」]{2,40})」/g) ?? []).map((m) => m.slice(1, -1)),
  ];
  return [...new Set(facets.filter((f) => f.length >= 2 && !STOP_FACETS.has(f)))];
}

export function extractNameTokens(statement: string): string[] {
  const quoted = [...statement.matchAll(/「([^」]{2,40})」/g)].map((m) => m[1]!);
  const tokens = new Set<string>(quoted);
  for (const m of statement.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{1,24})\b/g)) {
    if (m[1] && m[1].length >= 2) tokens.add(m[1]);
  }
  return [...tokens];
}

export function isNamingClaimStatement(statement: string): boolean {
  return /シリーズ|メーカー|レーベル|出演|クリエイター|タイトル|販売／配信|として「/.test(
    statement,
  );
}
