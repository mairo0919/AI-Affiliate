import { createHash } from "node:crypto";

const DESCRIPTION_KEYS = new Set([
  "comment",
  "description",
  "iteminfo_comment",
  "content",
  "synopsis",
  "story",
]);

const REVIEW_KEYS = new Set([
  "review",
  "review_text",
  "reviewtext",
  "user_review",
  "userreview",
  "review_comment",
]);

/**
 * Extract short forbidden snippets from rawData for validation only.
 * Never returns full rawData; snippets are capped.
 */
export function extractForbiddenSnippetsFromRawData(
  rawData: unknown,
  maxSnippets = 20,
  maxLen = 200,
): { descriptions: string[]; reviews: string[] } {
  const descriptions: string[] = [];
  const reviews: string[] = [];

  const visit = (value: unknown, keyHint: string | null): void => {
    if (descriptions.length + reviews.length >= maxSnippets) {
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length < 20) {
        return;
      }
      const lowerKey = (keyHint ?? "").toLowerCase();
      if (DESCRIPTION_KEYS.has(lowerKey) || lowerKey.includes("comment")) {
        descriptions.push(trimmed.slice(0, maxLen));
      } else if (REVIEW_KEYS.has(lowerKey) || lowerKey.includes("review")) {
        reviews.push(trimmed.slice(0, maxLen));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, keyHint);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, key);
      }
    }
  };

  visit(rawData, null);
  return { descriptions, reviews };
}

export function fingerprintForbiddenCorpus(snippets: string[]): string {
  return createHash("sha256").update(snippets.join("|"), "utf8").digest("hex").slice(0, 16);
}
