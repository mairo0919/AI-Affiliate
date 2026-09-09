/**
 * R157 — rich Writer expansion: descriptive facts are SEMANTIC_PRESERVE (not blanket EXACT).
 */
import { describe, expect, it } from "vitest";
import { deriveExecutionMode } from "../plan-execution-contract.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";

describe("R157 Writer expansion execution modes", () => {
  it("keeps identity-critical EXACT (title / quantity / performer)", () => {
    expect(deriveExecutionMode("令和イチのメスガキ 松本いちか", "title")).toBe("EXACT_SURFACE");
    expect(deriveExecutionMode("480分", "body")).toBe("EXACT_SURFACE");
    expect(deriveExecutionMode("22本番", "body")).toBe("EXACT_SURFACE");
    expect(deriveExecutionMode("松本いちか", "lead")).toBe("EXACT_SURFACE");
    expect(deriveExecutionMode("優梨まいな", "lead")).toBe("EXACT_SURFACE");
  });

  it("does not freeze scene/trait/series/play nouns as EXACT on body/lead", () => {
    expect(deriveExecutionMode("絶対空域", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("ギャル妹", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("生意気", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("わからせ", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("デカ尻", "lead")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("小悪魔", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("大人をバカにした表情", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("MOODYZベスト第2弾", "lead")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("激ピス", "body")).toBe("SEMANTIC_PRESERVE");
    expect(deriveExecutionMode("追撃ピストン", "body")).toBe("SEMANTIC_PRESERVE");
  });

  it("Writer system asks for rich multi-unit development without empty promo padding", () => {
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/materialDepth[= ]?=?rich|materialDepth is rich|rich:/i);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/EXTERNAL FACTUAL CLAIMS|EDITORIAL INTERPRETATION/);
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/fact formatter|Coverage:|realize the meaning/i);
    expect(OPTION_B_WRITER_SYSTEM).not.toMatch(/最低250|必ず3段落/);
  });

  it("soft inflection paraphrase still realizes SEMANTIC body facts", async () => {
    const { resolveFactRealization, isFactRealized } = await import(
      "../../editorial-brain/generation/plan-fact-matching.js"
    );
    const r = resolveFactRealization(
      "大人をバカにしたような表情で挑発する",
      "大人をバカにした表情",
      { padBearing: false },
    );
    expect(isFactRealized(r.status)).toBe(true);
    const r2 = resolveFactRealization(
      "足裏でじょばじょばと射精するシーン",
      "足裏じょばじょば射精",
      { padBearing: false },
    );
    expect(isFactRealized(r2.status)).toBe(true);
  });
});
