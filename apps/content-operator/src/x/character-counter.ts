/**
 * X (Twitter) weighted character counter.
 * Approximate official rules:
 * - CJK / full-width / most emoji graphemes: weight 2
 * - Latin / digits / half-width / spaces / newlines: weight 1
 * - URLs (http/https): fixed weight (default 23), regardless of raw length
 * - Combining marks: weight 0 (attached to base)
 * Does not enable Premium long-form (>280).
 */

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function isCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function isHeavyChar(code: number): boolean {
  // CJK Unified Ideographs and common full-width / kana / hangul / emoji blocks
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fa1f) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x2600 && code <= 0x27bf)
  );
}

export interface WeightedCountResult {
  weightedLength: number;
  urlCount: number;
  hashtagCount: number;
}

export class XCharacterCounter {
  constructor(private readonly urlWeightedLength = 23) {}

  count(text: string): WeightedCountResult {
    const urls = text.match(URL_RE) ?? [];
    let withoutUrls = text;
    for (const url of urls) {
      withoutUrls = withoutUrls.replace(url, "");
    }

    let weighted = urls.length * this.urlWeightedLength;
    const segmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter("ja", { granularity: "grapheme" })
        : null;

    if (segmenter) {
      for (const { segment } of segmenter.segment(withoutUrls)) {
        const code = segment.codePointAt(0) ?? 0;
        if (isCombiningMark(code)) {
          continue;
        }
        weighted += isHeavyChar(code) || segment.length > 1 ? 2 : 1;
      }
    } else {
      for (const ch of withoutUrls) {
        const code = ch.codePointAt(0) ?? 0;
        if (isCombiningMark(code)) continue;
        weighted += isHeavyChar(code) ? 2 : 1;
      }
    }

    const hashtagCount = (text.match(/(^|[\s\u3000])#[\w\u3040-\u30ff\u3400-\u9fff]+/g) ?? [])
      .length;

    return {
      weightedLength: weighted,
      urlCount: urls.length,
      hashtagCount,
    };
  }

  assertWithinLimit(text: string, maxWeightedLength: number): WeightedCountResult {
    const result = this.count(text);
    if (result.weightedLength > maxWeightedLength) {
      throw new Error(
        `X weighted length ${result.weightedLength} exceeds max ${maxWeightedLength}`,
      );
    }
    return result;
  }
}
