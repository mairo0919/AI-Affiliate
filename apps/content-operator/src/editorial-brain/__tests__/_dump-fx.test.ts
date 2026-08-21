import { describe, it } from "vitest";
import { VALIDATION_FIXTURES } from "../validation/fixtures.js";
import { buildCoreEditorialPlan } from "../core/planner.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";

describe("dump fixtures", () => {
  it("codes", () => {
    for (const id of [
      "fixture-scarce-pass",
      "fixture-rich-pass",
      "fixture-identity-heavy-clean",
      "fixture-eval-supported-pass",
    ]) {
      const fx = VALIDATION_FIXTURES.find((f) => f.sampleId === id)!;
      const core = buildCoreEditorialPlan({
        channel: fx.channel,
        formatKey: fx.formatKey,
        contentType: fx.contentType,
        availableClaims: fx.claims,
        selectedClaims: fx.claims,
        openingClaimIds: fx.openingClaimIds,
        hookClaimIds: fx.openingClaimIds,
        developmentClaimIds: fx.developmentClaimIds,
        structurePatternId: null,
        editorialPatternId: null,
      });
      const review = reviewArtifactShadow({
        artifact: fx.artifact,
        corePlan: core,
        claimStatements: fx.claims,
      });
      console.log(
        id,
        review.decision,
        review.failures.map((f) => f.code),
        "novel",
        review.metrics.supportedNovelAssertionCount,
        "target",
        core.informationGainTarget,
      );
    }
  });
});
