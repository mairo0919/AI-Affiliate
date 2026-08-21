/**
 * Deterministic sentence/assertion extraction — channel-agnostic.
 */

/** Low-information facets that must not drive entailment / repetition alone. */
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
    // Prefer structured quantity compounds before greedy digit+kanji runs
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

/** Quoted / catalog-style name tokens appearing in a claim statement. */
export function extractNameTokens(statement: string): string[] {
  const quoted = [...statement.matchAll(/「([^」]{2,40})」/g)].map((m) => m[1]!);
  const tokens = new Set<string>(quoted);
  // Compact Latin/digit product-ish tokens (generic, not product-specific)
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

export type ExtractedSegment = { role: string; text: string };

export function segmentsFromBlog(input: {
  title: string;
  summary: string;
  lead: string;
  sections: Array<{ paragraphs: string[] }>;
}): ExtractedSegment[] {
  // Title is framing; review lead/body/summary for entailment first.
  // Keep title last so it cannot seed facet usage before body claims.
  const out: ExtractedSegment[] = [
    { role: "lead", text: input.lead },
  ];
  input.sections.forEach((sec, i) => {
    sec.paragraphs.forEach((p, pi) => {
      out.push({ role: `section:${i}:p${pi}`, text: p });
    });
  });
  out.push({ role: "summary", text: input.summary });
  out.push({ role: "title", text: input.title });
  return out.filter((s) => s.text.trim().length > 0);
}

export function segmentsFromX(input: {
  body: string;
  reply?: string | null;
  posts?: Array<{ order: number; text: string }>;
}): ExtractedSegment[] {
  if (input.posts?.length) {
    return input.posts.map((p) => ({ role: `post:${p.order}`, text: p.text }));
  }
  const out: ExtractedSegment[] = [{ role: "body", text: input.body }];
  if (input.reply?.trim()) out.push({ role: "reply", text: input.reply });
  return out;
}
