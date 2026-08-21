import { describe, it } from "vitest";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { extractTextFacets } from "../shadow/assertion-extract.js";
import { classifyAssertionSupport } from "../shadow/claim-entailment.js";

describe("debug entailment", () => {
  it("dump", () => {
    const claims = [
      { id: "t1", statement: "強い反応が連続する展開が公開されている。", kind: "trait_or_scene" },
      { id: "p1", statement: "出演者Alphaがクレジットされている。", kind: "performer" },
    ];
    console.log("facets claim1", extractTextFacets(claims[0]!.statement));
    console.log("facets claim2", extractTextFacets(claims[1]!.statement));
    const sent = "強い反応が連続する展開が公開されている点を先に置く。";
    console.log("facets ass", extractTextFacets(sent));
    const prev = new Set<string>();
    const a = classifyAssertionSupport({
      sentence: sent,
      sourceSegment: "lead",
      claims,
      previouslyUsedFacets: prev,
    });
    console.log("classified", a);
    const core = buildCoreEditorialPlan({
      channel: "BLOG",
      formatKey: "NEW_RELEASE_SINGLE",
      contentType: "blogger-article",
      availableClaims: claims,
      selectedClaims: claims,
      openingClaimIds: ["t1"],
      hookClaimIds: ["t1"],
      developmentClaimIds: ["p1"],
      structurePatternId: null,
      editorialPatternId: null,
    });
    const review = reviewArtifactShadow({
      corePlan: core,
      claimStatements: claims,
      artifact: {
        channel: "BLOG",
        title: "公開事実の整理",
        summary: "公開されている事実を短くまとめた。",
        lead: sent,
        sections: [{ paragraphs: ["出演者Alphaがクレジットされている事実を続ける。"], lists: [] }],
        bodyText: "",
      },
    });
    console.log("decision", review.decision);
    console.log(
      "failures",
      review.failures.map((f) => f.code),
    );
    console.log("stats", review.metrics.assertionSupportStats);
    console.log(
      "assertions",
      review.semanticAssertions?.map((x) => ({
        t: x.supportType,
        f: x.failureCodes,
        a: x.assertion,
        hits: x.supportingClaimIds,
      })),
    );
  });
});
