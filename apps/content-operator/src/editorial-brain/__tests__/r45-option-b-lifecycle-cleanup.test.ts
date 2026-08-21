/**
 * r45 — OPTION B FINAL LIFECYCLE CLEANUP (LLM=0).
 * heading:null must not BLOCK without Structure Pattern; Structure Pattern heading=true preserved.
 * No prompt / evidence / Brain / Writer source-material changes.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validatePostTransformIntegrity } from "../generation/post-transform-integrity.js";
import { formatBloggerHtml } from "../../generation/blogger-formatter.js";
import {
  assertSectionHeadingsAgainstStructurePattern,
  fillOptionBArticleDefaults,
  parseBloggerArticle,
  validateSectionHeadingsAgainstStructurePattern,
} from "../../generation/structured-article.js";

const R44_RAW = "/tmp/prod-gen-20260820-r44-mizd00320/PROVIDER_RAW.json";
const structuredPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../generation/structured-article.ts",
);

function loadR44Raw(): Record<string, unknown> {
  if (!existsSync(R44_RAW)) {
    throw new Error(`Missing r44 fixture: ${R44_RAW}`);
  }
  return JSON.parse(readFileSync(R44_RAW, "utf8")) as Record<string, unknown>;
}

describe("r45 OPTION B lifecycle cleanup (LLM=0)", () => {
  it("A/D. r44 RAW heading:null — schema + no-pattern assert PASS (persist gate open)", () => {
    const raw = loadR44Raw();
    expect(raw.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ heading: null })]),
    );
    const parsed = parseBloggerArticle(fillOptionBArticleDefaults(raw));
    expect(parsed.sections[0]?.heading).toBeNull();

    const noPattern = validateSectionHeadingsAgainstStructurePattern(parsed, null);
    expect(noPattern.ok).toBe(true);
    expect(noPattern.findings).toEqual([]);
    expect(() => assertSectionHeadingsAgainstStructurePattern(parsed, null)).not.toThrow();
    expect(() =>
      assertSectionHeadingsAgainstStructurePattern(parsed, { blocks: [] }),
    ).not.toThrow();
  });

  it("B. Structure Pattern heading=true still enforces (non-OPTION-B preserved)", () => {
    const article = parseBloggerArticle(
      fillOptionBArticleDefaults({
        title: "t",
        lead: "lead text here for length",
        sections: [{ heading: null, paragraphs: ["body paragraph"], lists: [] }],
        cta: { label: "cta", url: null },
      }),
    );
    const withPattern = validateSectionHeadingsAgainstStructurePattern(article, {
      blocks: [
        { role: "hook", heading: false },
        { role: "interest_development", heading: true },
      ],
    });
    expect(withPattern.ok).toBe(false);
    expect(withPattern.findings.some((f) => f.code === "HEADING_REQUIRED")).toBe(true);
    expect(
      withPattern.findings.some((f) =>
        f.message.includes("required when no Structure Pattern is applied"),
      ),
    ).toBe(false);
  });

  it("C. legacy no-pattern heading-required string deleted from validator", () => {
    const src = readFileSync(structuredPath, "utf8");
    expect(src).not.toContain(
      "heading is required when no Structure Pattern is applied",
    );
    expect(src).toMatch(/Schema already allows heading:null/);
  });

  it("E. formatter + integrity tolerate heading:null (Brain-input shape)", () => {
    const parsed = parseBloggerArticle(fillOptionBArticleDefaults(loadR44Raw()));
    const html = formatBloggerHtml({
      title: parsed.title,
      lead: parsed.lead,
      sections: parsed.sections,
      cta: parsed.cta.url
        ? parsed.cta
        : { label: parsed.cta.label, url: "https://example.invalid/p" },
      images: [],
    });
    expect(html).toContain("<p>");
    expect(html).not.toMatch(/<h2>\s*null\s*<\/h2>/i);

    const integrity = validatePostTransformIntegrity({
      title: parsed.title,
      lead: parsed.lead,
      summary: parsed.summary,
      sections: parsed.sections.map((s) => ({ paragraphs: s.paragraphs })),
    });
    expect(integrity.ok).toBe(true);
  });
});
