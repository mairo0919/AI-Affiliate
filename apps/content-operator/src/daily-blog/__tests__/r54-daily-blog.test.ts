/**
 * r54 — daily auto-publish skeleton (LLM=0).
 */
import { describe, expect, it } from "vitest";
import { validateFanzaAffiliateUrl } from "../affiliate-url.js";
import { loadDailyBlogEnvConfig } from "../config.js";
import {
  buildKnownPublication,
  checkDuplicatePublication,
  filterUnpublishedCandidates,
} from "../duplicate-gate.js";
import { dailyRunIdempotencyKey, tokyoDateString } from "../idempotency.js";
import { runDailyBlogOrchestratorDry } from "../orchestrator.js";
import { evaluatePublishGate } from "../publish-gate.js";
import {
  decideRankingSlot,
  isNearDuplicateRanking,
  freezeRankingItems,
} from "../ranking-plan.js";
import { selectDailyProductCandidate } from "../selection.js";
import {
  buildBlogPostingJsonLd,
  metaDescriptionFromLead,
  appendJsonLdIfEnabled,
} from "../seo-metadata.js";
import { rankingToProductLinks } from "../internal-linking.js";
import { buildXHandoffPayload } from "../x-handoff.js";
import { canStartLlmGeneration, createBudgetState } from "../budget.js";

describe("r54 daily-blog (LLM=0)", () => {
  it("validates affiliate URL without synthesizing", () => {
    expect(validateFanzaAffiliateUrl(null).failureCode).toBe("AFFILIATE_URL_MISSING");
    expect(
      validateFanzaAffiliateUrl("https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=mizd00320/").ok,
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

  it("publish gate requires Brain PASS and blocks without direct publish flag", () => {
    const held = evaluatePublishGate({
      schemaPass: true,
      defer: false,
      claimValidationPass: true,
      integrityPass: true,
      brainDecision: "TARGETED_REPAIR",
      formatterPass: true,
      affiliateUrlValid: true,
      imagePipelinePass: true,
      bloggerAuthPass: true,
      duplicate: false,
      dryRun: false,
      autoPublishEnabled: true,
      allowDirectPublish: true,
    });
    expect(held.decision).toBe("HOLD");
    const dry = evaluatePublishGate({
      schemaPass: true,
      defer: false,
      claimValidationPass: true,
      integrityPass: true,
      brainDecision: "PASS",
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

  it("ranking slot is configurable and freezes ranks deterministically", () => {
    const slot = decideRankingSlot({
      config: {
        enabled: true,
        everyNProductPosts: 5,
        minDaysBetweenRanking: 7,
        allowedTypes: ["POPULAR"],
      },
      productPostsSinceLastRanking: 5,
      daysSinceLastRanking: 7,
    });
    expect(slot.useRanking).toBe(true);
    const frozen = freezeRankingItems([
      { rank: 3, canonicalId: "c", title: "c", affiliateUrl: "u", performerNames: [], officialFacts: [] },
      { rank: 1, canonicalId: "a", title: "a", affiliateUrl: "u", performerNames: [], officialFacts: [] },
    ]);
    expect(frozen.map((x) => x.canonicalId)).toEqual(["a", "c"]);
    expect(frozen.map((x) => x.rank)).toEqual([1, 2]);
    expect(
      isNearDuplicateRanking(
        { rankingType: "POPULAR", periodKey: "2026-08", productIdsSorted: ["a", "b", "c"] },
        { rankingType: "POPULAR", periodKey: "2026-08", productIdsSorted: ["a", "b", "c"] },
      ),
    ).toBe(true);
  });

  it("seo helpers avoid stuffing and skip duplicate json-ld", () => {
    const meta = metaDescriptionFromLead("あ".repeat(200), 50);
    expect(meta.endsWith("…")).toBe(true);
    const ld = buildBlogPostingJsonLd({
      title: "作品紹介",
      lead: "公式情報の要約です。",
      canonicalUrl: "https://example.com/p/1",
      imageUrls: ["https://example.com/i.jpg"],
      publishedAtIso: "2026-08-21T00:00:00+09:00",
    });
    expect(ld["@type"]).toBe("BlogPosting");
    expect((ld as { offers?: unknown }).offers).toBeUndefined();
    const html = appendJsonLdIfEnabled(
      '<script type="application/ld+json">{"@type":"BlogPosting"}</script>',
      ld,
      true,
    );
    expect(html.match(/application\/ld\+json/g)?.length).toBe(1);
  });

  it("idempotency keys and LLM budget enforce one product generation", () => {
    expect(tokyoDateString(new Date("2026-08-21T03:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      dailyRunIdempotencyKey({ timezoneDate: "2026-08-21", articleKind: "PRODUCT", canonicalId: "mizd00320" }),
    ).toContain("mizd00320");
    const state = createBudgetState();
    state.llmProductsUsed = 1;
    expect(
      canStartLlmGeneration(state, {
        maxLlmProductsPerRun: 1,
        maxLlmCallsPerRun: 1,
        maxCandidatesToScan: 30,
      }).ok,
    ).toBe(false);
  });

  it("internal links only when published URL exists", () => {
    const links = rankingToProductLinks(["a", "b"], [
      { canonicalId: "a", publishedUrl: "https://blog.example/a", articleKind: "PRODUCT" },
    ]);
    expect(links).toEqual([{ canonicalId: "a", url: "https://blog.example/a" }]);
  });

  it("x handoff stores published event without connecting X auto-post", () => {
    const h = buildXHandoffPayload({
      publishedBlogUrl: "https://blog.example/p",
      canonicalId: "mizd00320",
      affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
      imageUrls: ["https://img/1.jpg"],
      title: "t",
      bloggerPostId: "1",
      contentVersionId: "cv",
    });
    expect(h.xAutoPostConnected).toBe(false);
  });

  it("dry orchestrator runs end-to-end without LLM/publish", () => {
    const cfg = loadDailyBlogEnvConfig({
      BLOG_DAILY_AUTO_PUBLISH_ENABLED: "false",
      BLOG_DAILY_DRY_RUN: "true",
      BLOG_DAILY_TIMEZONE: "Asia/Tokyo",
      BLOG_DAILY_CRON: "0 10 * * *",
    });
    const known = [
      buildKnownPublication({
        externalProductId: "old001",
        status: "PUBLISHED",
        bloggerPostId: "9",
      }),
    ];
    const result = runDailyBlogOrchestratorDry({
      config: cfg,
      knownPublications: known,
      candidates: [
        {
          researchItemId: "r-old",
          canonicalId: "old001",
          totalScore: 99,
          popularityScore: 99,
          trendScore: 1,
          freshnessScore: 1,
          dataQualityScore: 1,
          reviewScore: 1,
          pageEvidenceRichness: 1,
          sampleImageCount: 11,
          actressKey: "X",
          makerKey: "M",
          seriesKey: "S",
          affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
          title: "Old",
        },
        {
          researchItemId: "r-new",
          canonicalId: "new002",
          totalScore: 60,
          popularityScore: 60,
          trendScore: 50,
          freshnessScore: 50,
          dataQualityScore: 50,
          reviewScore: 50,
          pageEvidenceRichness: 0.7,
          sampleImageCount: 6,
          actressKey: "Y",
          makerKey: "N",
          seriesKey: "T",
          affiliateUrl: "https://al.fanza.co.jp/?af_id=2",
          title: "New",
        },
      ],
    });
    expect(result.selected?.canonicalId).toBe("new002");
    expect(result.log.llmCalls).toBe(0);
    expect(result.publishGate.allowPublish).toBe(false);
    expect(result.publishGate.decision).toBe("DRY_RUN_OK");
    expect(result.autoPublishReadyChecklist.livePublishRequiresHumanNextRound).toBe(true);
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
