import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractArticleStructureFeatures } from "./structure-extraction.js";
import {
  extractWritingFeaturesDeterministic,
  extractWritingFeaturesWithDiagnostics,
  mergeWritingFeatures,
} from "./writing-extraction.js";
import { evaluateSingleArticleLearningSuitability } from "./learning-suitability.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

function stripLen(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

describe("informationDensityBucket v2 (deterministic SSOT)", () => {
  it("Case1: very short generic recommendation is not high", () => {
    const html = loadFixture("dens-short-generic.html");
    expect(stripLen(html)).toBeGreaterThanOrEqual(120);
    expect(stripLen(html)).toBeLessThan(280);
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({ html });
    expect(features.informationDensityBucket).not.toBe("high");
    expect(features.informationDensityBucket).toBe("low");
    expect(densityDiagnostics.genericSignalCount).toBeGreaterThan(0);
    expect(densityDiagnostics.lengthBucket).toBe("very_short");
  });

  it("Case2: 1200–1600 descriptive single review (≥ medium, heading≈1)", () => {
    const html = loadFixture("dens-descriptive-single.html");
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({ html });
    expect(densityDiagnostics.textLength).toBeGreaterThanOrEqual(1100);
    expect(["medium", "high"]).toContain(features.informationDensityBucket);
    expect(densityDiagnostics.editorialEvidenceCount + densityDiagnostics.descriptiveEvidenceCount).toBeGreaterThan(
      0,
    );
    expect(densityDiagnostics.repetitionPenalty).toBeLessThan(0.35);
  });

  it("Case3: long generic prose only → low", () => {
    const html = loadFixture("dens-generic-long.html");
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({ html });
    expect(densityDiagnostics.textLength).toBeGreaterThanOrEqual(800);
    expect(features.informationDensityBucket).toBe("low");
    expect(densityDiagnostics.genericOnlyPenalty + densityDiagnostics.repetitionPenalty).toBeGreaterThan(0);
  });

  it("Case4: long catalog dump is not medium/high", () => {
    const html = loadFixture("dens-catalog-long.html");
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({ html });
    expect(densityDiagnostics.concreteEvidenceCount).toBeGreaterThanOrEqual(5);
    expect(densityDiagnostics.catalogHeavyCap).toBe(true);
    expect(features.informationDensityBucket).toBe("low");
  });

  it("Case5: BEST5 may have elevated density (suitability still gates A)", () => {
    const extracted = extractArticleStructureFeatures({
      html: loadFixture("dens-best5.html"),
      sourceUrl: "https://example.invalid/best5",
    });
    expect(["medium", "high"]).toContain(
      extracted.features.writingFeatures.informationDensityBucket,
    );
    const suit = evaluateSingleArticleLearningSuitability({
      articleTypeHint: extracted.articleTypeHint,
      features: extracted.features,
      sourceUrl: "https://example.invalid/best5",
      sourceDomain: "example.invalid",
    });
    expect(suit.classification).not.toBe("A");
  });

  it("Case6: sidebar h5×10 does not inflate density (article scope)", () => {
    const extracted = extractArticleStructureFeatures({
      html: loadFixture("scope-single-with-sidebar.html"),
      sourceUrl: "https://sadist-avreview.example/scoped",
    });
    expect(extracted.articleScope.selectorKind).toBe("article");
    expect(extracted.features.headingCount).toBeLessThan(5);
    // Density comes from article body only — not sidebar h5 count.
    expect(extracted.densityDiagnostics.bucket).toBe(
      extracted.features.writingFeatures.informationDensityBucket,
    );
    const fullPageWriting = extractWritingFeaturesDeterministic({
      html: loadFixture("scope-single-with-sidebar.html"),
    });
    // Unscoped full page would see many h5; scoped extraction must not match that inflation path.
    expect(extracted.features.headingPatterns.filter((h) => h === "h5").length).toBe(0);
    expect(fullPageWriting.informationDensityBucket).toBeTruthy();
  });

  it("Case7: repetitive long article does not become high", () => {
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({
      html: loadFixture("dens-repetitive.html"),
    });
    expect(densityDiagnostics.repetitionPenalty).toBeGreaterThan(0);
    expect(features.informationDensityBucket).not.toBe("high");
  });

  it("Case8: sadist-like descriptive single → medium+", () => {
    const html = loadFixture("dens-descriptive-single.html");
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({ html });
    expect(["medium", "high"]).toContain(features.informationDensityBucket);
    expect(densityDiagnostics.descriptiveEvidenceCount + densityDiagnostics.editorialEvidenceCount).toBeGreaterThan(
      2,
    );
  });

  it("Case9: rich editorial (adultgod7-like) → medium/high", () => {
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({
      html: loadFixture("dens-rich-editorial.html"),
    });
    expect(["medium", "high"]).toContain(features.informationDensityBucket);
    expect(densityDiagnostics.concreteEvidenceCount).toBeGreaterThan(0);
    expect(densityDiagnostics.editorialEvidenceCount).toBeGreaterThan(0);
  });

  it("Case10: 161-ish note short is not forced high", () => {
    const html = loadFixture("dens-note-short.html");
    const { features, densityDiagnostics } = extractWritingFeaturesWithDiagnostics({ html });
    expect(densityDiagnostics.textLength).toBeLessThan(280);
    expect(features.informationDensityBucket).not.toBe("high");
  });

  it("LLM overlay cannot override informationDensityBucket", () => {
    const base = extractWritingFeaturesDeterministic({
      html: loadFixture("dens-generic-long.html"),
    });
    expect(base.informationDensityBucket).toBe("low");
    const merged = mergeWritingFeatures(base, {
      informationDensityBucket: "high",
      tone: "editorial",
    });
    expect(merged.informationDensityBucket).toBe("low");
    expect(merged.tone).toBe("editorial");
  });

  it("diagnostics are numeric/enum only (no prose body)", () => {
    const { densityDiagnostics } = extractWritingFeaturesWithDiagnostics({
      html: loadFixture("dens-descriptive-single.html"),
    });
    const serialized = JSON.stringify(densityDiagnostics);
    expect(serialized).not.toMatch(/向いている人向けに/);
    expect(densityDiagnostics.bucket).toMatch(/^(low|medium|high)$/);
    expect(typeof densityDiagnostics.densityScore).toBe("number");
  });

  it("same input → same density (deterministic)", () => {
    const html = loadFixture("dens-rich-editorial.html");
    const a = extractWritingFeaturesWithDiagnostics({ html });
    const b = extractWritingFeaturesWithDiagnostics({ html });
    expect(a.features.informationDensityBucket).toBe(b.features.informationDensityBucket);
    expect(a.densityDiagnostics).toEqual(b.densityDiagnostics);
  });

  it("does not change A hard gate semantics (densityOk still medium|high)", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "learning-suitability.ts"),
      "utf8",
    );
    expect(src).toMatch(/densityOk = density === "medium" \|\| density === "high"/);
  });
});
