import { describe, expect, it } from "vitest";
import { demandSupplementContentIds } from "../candidate-pool.js";
import { FANZA_API_POPULAR, FANZA_RECOMMENDED_PRODUCT, type DemandObservationDraft } from "../demand-signal.js";
import { xAdmissionBlock } from "../x-slot-live.js";

function row(partial: Pick<DemandObservationDraft, "source" | "contentId" | "rank">): DemandObservationDraft {
  return {
    source: partial.source,
    scope: "video",
    contentId: partial.contentId,
    keyword: null,
    rank: partial.rank,
    semanticType: null,
    provenance: "test",
    observedAt: new Date("2026-10-01T14:07:53.000Z"),
  };
}

describe("WordPress and X recommended priority stay independent", () => {
  it("adds a recommended work with no article to the shared candidate pool", () => {
    const ids = demandSupplementContentIds(
      [
        row({ source: FANZA_RECOMMENDED_PRODUCT, contentId: "jur00841", rank: 4 }),
        row({ source: FANZA_API_POPULAR, contentId: "popular-1", rank: 1 }),
        row({ source: FANZA_RECOMMENDED_PRODUCT, contentId: "spone00001", rank: 1 }),
      ],
      new Set(["spone00001"]),
    );
    expect(ids).toEqual(["jur00841", "popular-1"]);
  });

  it("does not require a ContentVersion when the official product source and URL exist", () => {
    expect(
      xAdmissionBlock({
        hasVerifiedProductSource: true,
        contentVersionId: null,
        usedContentVersionIds: new Set(),
        officialUrl: { ok: true },
      }),
    ).toBeNull();
  });

  it("still blocks a missing product source and a repeated ContentVersion", () => {
    expect(
      xAdmissionBlock({
        hasVerifiedProductSource: false,
        contentVersionId: null,
        usedContentVersionIds: new Set(),
        officialUrl: { ok: true },
      }),
    ).toBe("NO_VERIFIED_X_SOURCE");
    expect(
      xAdmissionBlock({
        hasVerifiedProductSource: true,
        contentVersionId: "cv-1",
        usedContentVersionIds: new Set(["cv-1"]),
        officialUrl: { ok: true },
      }),
    ).toBe("DUPLICATE_CONTENT_VERSION");
    expect(
      xAdmissionBlock({
        hasVerifiedProductSource: true,
        contentVersionId: null,
        usedContentVersionIds: new Set(),
        officialUrl: { ok: false, reason: "NORMAL_URL_NOT_VERIFIED" },
      }),
    ).toBe("NORMAL_URL_NOT_VERIFIED");
  });
});
