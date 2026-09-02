/**
 * R152 — POST_TRANSFORM_INTEGRITY short-title false positive (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { validatePostTransformIntegrity } from "../generation/post-transform-integrity.js";

describe("R152 post-transform integrity short title", () => {
  it("nnpj-like title「2時間」is not FRAGMENT", () => {
    const r = validatePostTransformIntegrity({
      title: "2時間",
      lead: "2時間にわたるノンストップの濃密な時間です。",
      summary: "2時間",
      sections: [
        {
          paragraphs: [
            "連発射精で快感が続く。アナル舐めからイクイクイグぅぅうう。",
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("punctuation-only title still fails", () => {
    const r = validatePostTransformIntegrity({
      title: "。。。",
      lead: "十分な長さのあるリード文です。",
      sections: [{ paragraphs: ["十分な長さのある本文です。"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => /FRAGMENT/.test(f.message))).toBe(true);
  });

  it("real dangling particle still fails", () => {
    const r = validatePostTransformIntegrity({
      title: "十分なタイトル",
      lead: "は、を目指す。",
      sections: [{ paragraphs: ["本文は十分な長さがあります。"] }],
    });
    expect(r.ok).toBe(false);
  });
});
