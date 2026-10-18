import { describe, expect, it } from "vitest";
import { reviewEvidenceFromStructuredContent } from "./content-generation-service.js";

describe("fact reviewers see the writer's official material", () => {
  it("builds the evidence block from the stored writer contract", () => {
    const text = reviewEvidenceFromStructuredContent({
      brainGenerationContract: {
        layers: {
          EVIDENCE_PACK: {
            productTitle: "令和イチのメスガキ 松本いちか ベスト",
            supportedClaims: [{ id: "c1", statement: "10作品8時間のベスト" }],
            officialDescription: "松本いちかのMOODYZベスト第2弾！",
          },
        },
      },
    });
    expect(text).toContain("OFFICIAL_EVIDENCE");
    expect(text).toContain("10作品8時間のベスト");
    expect(text).toContain("MOODYZベスト第2弾");
    expect(text).toContain("opinions, not product facts");
  });

  it("returns null when nothing was stored", () => {
    expect(reviewEvidenceFromStructuredContent(null)).toBeNull();
    expect(reviewEvidenceFromStructuredContent({ brainGenerationContract: { layers: {} } })).toBeNull();
  });
});
