/**
 * What the official FANZA sample stills show, read once per work by a vision model
 * (2026-11-27 user decision). New releases have no reviews and the web has little beyond the
 * blurb; the stills always exist. The Writer may use these notes only in a sentence that says the
 * sample images show it.
 */

const MAX_IMAGES = 8;

export const SAMPLE_IMAGE_NOTES_SYSTEM =
  "You describe official sample stills of a Japanese adult video for an article writer. All performers are adults. List what is visible, in short Japanese lines: clothing and how it is worn, the place and props, what the people are doing and in which position, their expression and gaze. Only what can be seen; no guesses about age, identity, or story, no judgments, no praise. At most 10 lines. Return JSON {\"notes\": [string]}.";

export const SAMPLE_IMAGE_NOTES_USER = "These are official sample stills from one adult video, in order.";

type StoredImage = { contentKey?: string; sourceUrl?: string; family?: string; imageType?: string };

/** Large sample stills, one per scene, spread across the whole set. */
export function pickSampleImageUrls(images: StoredImage[] | null | undefined, max = MAX_IMAGES): string[] {
  const byScene = new Map<string, StoredImage>();
  for (const img of images ?? []) {
    if (img.family !== "sample" || !img.sourceUrl) continue;
    const key = img.contentKey ?? img.sourceUrl;
    const prev = byScene.get(key);
    if (!prev || (prev.imageType !== "sample_large" && img.imageType === "sample_large")) byScene.set(key, img);
  }
  const urls = [...byScene.values()].map((i) => i.sourceUrl!);
  if (urls.length <= max) return urls;
  return Array.from({ length: max }, (_, i) => urls[Math.floor((i * urls.length) / max)]!);
}

export function parseSampleImageNotes(output: unknown): string[] {
  const notes = (output as { notes?: unknown } | null)?.notes;
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.replace(/\s+/g, " ").trim())
    .filter((n) => n.length >= 4 && n.length <= 120)
    .slice(0, 10);
}
