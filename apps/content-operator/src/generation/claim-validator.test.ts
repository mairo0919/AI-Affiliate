import { describe, expect, it } from "vitest";
import {
  attestedSurfacesFromArticlePlan,
  validateClaimsAgainstArticle,
} from "./claim-validator.js";
import { parseBloggerArticle } from "./structured-article.js";

function emptyClaims() {
  return [] as never[];
}

function articleWithBody(paragraph: string) {
  return parseBloggerArticle({
    title: "t",
    summary: "s",
    lead: "l",
    sections: [{ heading: "h", paragraphs: [paragraph] }],
    cta: { label: "x", url: null },
    sourceReferences: [],
    seoTitle: "t",
    metaDescription: "m",
    labels: [],
    warnings: [],
    usedClaimIds: [],
    usedProductLinkIds: [],
  });
}

describe("claim-validator source-attested superlative", () => {
  it("rejects 世界一 when Evidence/Plan attestation is missing (negative control)", () => {
    const article = articleWithBody("これは世界一のファン感謝祭です");
    const result = validateClaimsAgainstArticle({
      article,
      claims: emptyClaims(),
      bodyText: structuredBody(article),
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "UNSUPPORTED_SUPERLATIVE")).toBe(true);
  });

  it("rejects invented No.1-like absolute when unattested (絶対に)", () => {
    const article = articleWithBody("絶対に稼げる商品です");
    const result = validateClaimsAgainstArticle({
      article,
      claims: emptyClaims(),
      bodyText: structuredBody(article),
      attestedEvidenceSurfaces: ["豪華なファン感謝祭", "複数出演"],
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "UNSUPPORTED_SUPERLATIVE")).toBe(true);
  });

  it("allows 世界一 when ARTICLE_PLAN fact attests the same surface (mird00237 path)", () => {
    const planFact = "これが世界一豪華なファン感謝祭だ";
    const article = articleWithBody(
      "本作はこれが世界一豪華なファン感謝祭だと銘打つ特別企画だ。",
    );
    const attested = attestedSurfacesFromArticlePlan({
      title: { facts: ["MIRU"] },
      lead: { facts: [] },
      body: [{ facts: [planFact, "豪華共演"] }],
    });
    const result = validateClaimsAgainstArticle({
      article,
      claims: emptyClaims(),
      bodyText: structuredBody(article),
      attestedEvidenceSurfaces: attested,
    });
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.code === "UNSUPPORTED_SUPERLATIVE")).toBe(false);
  });

  it("still rejects 世界一 when plan facts lack that token", () => {
    const article = articleWithBody("世界一のクオリティを誇る作品");
    const result = validateClaimsAgainstArticle({
      article,
      claims: emptyClaims(),
      bodyText: structuredBody(article),
      attestedEvidenceSurfaces: attestedSurfacesFromArticlePlan({
        body: [{ facts: ["豪華共演", "ファン感謝祭"] }],
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "UNSUPPORTED_SUPERLATIVE")).toBe(true);
  });
});

function structuredBody(article: ReturnType<typeof parseBloggerArticle>): string {
  return [
    article.lead,
    ...article.sections.flatMap((s) => s.paragraphs),
  ].join("\n");
}
