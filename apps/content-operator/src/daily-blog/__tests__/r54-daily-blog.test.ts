/**
 * r54 — daily auto-publish skeleton (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { validateFanzaAffiliateUrl } from "../affiliate-url.js";
import {
  buildKnownPublication,
  checkDuplicatePublication,
  filterUnpublishedCandidates,
} from "../duplicate-gate.js";
import { dailyRunIdempotencyKey, tokyoDateString } from "../idempotency.js";
import { evaluatePublishGate } from "../publish-gate.js";
import { selectDailyProductCandidate } from "../selection.js";

describe("r54 daily-blog (LLM=0)", () => {
  it("validates CTA URL without synthesizing (product URL allowed until af_id)", () => {
    expect(validateFanzaAffiliateUrl(null).failureCode).toBe("AFFILIATE_URL_MISSING");
    expect(
      validateFanzaAffiliateUrl("https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=mizd00320/")
        .ok,
    ).toBe(true);
    expect(
      validateFanzaAffiliateUrl("https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=mizd00320/")
        .hasAffiliateIdHint,
    ).toBe(false);
    expect(
      validateFanzaAffiliateUrl(
        "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fwww.dmm.co.jp%2F&af_id=demo-001",
      ).ok,
    ).toBe(true);
  });

  it("prevents duplicate by cid across research re-fetch", () => {
    const known = [
      buildKnownPublication({
        externalProductId: "mizd00320",
        url: "https://video.dmm.co.jp/av/content/?id=mizd00320",
        status: "PUBLISHED",
        bloggerPostId: "123",
      }),
    ];
    const gate = checkDuplicatePublication(
      { cid: "MIZD00320", affiliateUrl: "https://al.fanza.co.jp/?af_id=x&lurl=y" },
      known,
    );
    expect(gate.duplicate).toBe(true);
    expect(gate.reason).toBe("same_canonical_cid");
  });

  it("selects unpublished high-evidence candidate with diversity soft-skip", () => {
    const pool = [
      {
        researchItemId: "r1",
        canonicalId: "aaa001",
        totalScore: 80,
        popularityScore: 80,
        trendScore: 50,
        freshnessScore: 40,
        dataQualityScore: 70,
        reviewScore: 60,
        pageEvidenceRichness: 0.9,
        sampleImageCount: 11,
        actressKey: "A",
        makerKey: "M1",
        seriesKey: "S1",
        affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
        title: "Title A",
      },
      {
        researchItemId: "r2",
        canonicalId: "bbb002",
        totalScore: 70,
        popularityScore: 70,
        trendScore: 50,
        freshnessScore: 40,
        dataQualityScore: 70,
        reviewScore: 60,
        pageEvidenceRichness: 0.8,
        sampleImageCount: 8,
        actressKey: "B",
        makerKey: "M2",
        seriesKey: "S2",
        affiliateUrl: "https://al.fanza.co.jp/?af_id=2",
        title: "Title B",
      },
    ];
    const sel = selectDailyProductCandidate(pool, {
      articlesPerRun: 1,
      minTotalScore: 35,
      minSampleImages: 3,
      minEvidenceRichness: 0.3,
      recentActressKeys: ["A"],
      recentMakerKeys: [],
      recentSeriesKeys: [],
    });
    expect(sel.selected?.canonicalId).toBe("bbb002");
  });

  it("publish gate holds on safety fail; dry-run without direct publish stays DRY_RUN_OK", () => {
    const held = evaluatePublishGate({
      schemaPass: true,
      defer: false,
      claimValidationPass: true,
      integrityPass: true,
      formatterPass: false,
      affiliateUrlValid: true,
      imagePipelinePass: true,
      bloggerAuthPass: true,
      duplicate: false,
      dryRun: false,
      autoPublishEnabled: true,
      allowDirectPublish: true,
    });
    expect(held.decision).toBe("HOLD");
    expect(held.failureCodes).toContain("FORMATTER_FAIL");
    const dry = evaluatePublishGate({
      schemaPass: true,
      defer: false,
      claimValidationPass: true,
      integrityPass: true,
      formatterPass: true,
      affiliateUrlValid: true,
      imagePipelinePass: true,
      bloggerAuthPass: true,
      duplicate: false,
      dryRun: true,
      autoPublishEnabled: false,
      allowDirectPublish: false,
    });
    expect(dry.decision).toBe("DRY_RUN_OK");
    expect(dry.allowPublish).toBe(false);
  });

  it("publish gate does not require Brain decision (R117)", () => {
    const gate = evaluatePublishGate({
      schemaPass: true,
      defer: false,
      claimValidationPass: true,
      integrityPass: true,
      formatterPass: true,
      affiliateUrlValid: true,
      imagePipelinePass: true,
      bloggerAuthPass: true,
      duplicate: false,
      dryRun: false,
      autoPublishEnabled: true,
      allowDirectPublish: true,
    });
    expect(gate.decision).toBe("PUBLISH");
    expect(gate.failureCodes).not.toContain("BRAIN_NOT_PASS");
  });

  it("idempotency keys enforce one product generation", () => {
    expect(tokyoDateString(new Date("2026-08-21T03:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      dailyRunIdempotencyKey({ timezoneDate: "2026-08-21", articleKind: "PRODUCT", canonicalId: "mizd00320" }),
    ).toContain("mizd00320");
  });


  it("filterUnpublishedCandidates drops duplicates", () => {
    const { eligible } = filterUnpublishedCandidates(
      [
        { cid: "a1", affiliateUrl: "https://al.fanza.co.jp/?af_id=1" },
        { cid: "b1", affiliateUrl: "https://al.fanza.co.jp/?af_id=2" },
      ],
      [buildKnownPublication({ cid: "a1", status: "DRAFT", bloggerPostId: "1" })],
    );
    expect(eligible.map((c) => c.cid)).toEqual(["b1"]);
  });
});
