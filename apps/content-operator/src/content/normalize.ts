import { createHash } from "node:crypto";

/** Normalize body text for hashing / approximate duplicate detection. */
export function normalizeContentText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim()
    .toLowerCase();
}

export function hashNormalizedContent(text: string): string {
  const normalized = normalizeContentText(text);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function truncateDetectedValue(value: string, max = 50): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max)}…`;
}

export function hashSnippet(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}
