import type { ResearchSourceAdapter, SourceDocumentPayload } from "../types.js";

/** Safe abstract catalog/document source for tests (no real network). */
export class MockResearchSourceAdapter implements ResearchSourceAdapter {
  readonly sourceKey = "mock-catalog-doc";

  async fetchDocument(ref: string): Promise<SourceDocumentPayload> {
    return {
      externalId: ref,
      url: `https://example.test/docs/${encodeURIComponent(ref)}`,
      title: `Catalog note ${ref}`,
      documentType: "catalog_note",
      contentHash: `hash-${ref}`,
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      freshnessScore: 0.9,
      robotsAllowed: true,
      termsNotes: "Mock source — terms allow local testing only",
      rateLimitNotes: "none (mock)",
      normalizedText:
        "Official catalog attributes for sample item. No user reviews. Abstract product facts only.",
      metadata: { mock: true },
    };
  }
}
