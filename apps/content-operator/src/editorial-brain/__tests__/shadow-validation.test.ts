import { describe, expect, it } from "vitest";
import { classifyClaimProfiles, inferClaimKindFromStatement } from "../validation/claim-profile-tags.js";
import { VALIDATION_FIXTURES } from "../validation/fixtures.js";
import { reviewArtifactShadow } from "../shadow/reviewer.js";
import { buildCoreEditorialPlan } from "../core/planner.js";

describe("shadow validation fixtures (no DB)", () => {
  it("infers claim kinds from statements without product hardcode", () => {
    expect(inferClaimKindFromStatement("出演者／クリエイターとして「X」が記載されている。")).toBe(
      "performer",
    );
    expect(inferClaimKindFromStatement("シリーズとして「Y」に属する。")).toBe("series");
    expect(inferClaimKindFromStatement("高感度の反応が公開されている。")).toBe("trait_or_scene");
  });

  it("classifies profile tags", () => {
    const tags = classifyClaimProfiles([
      { kind: "performer", statement: "a" },
      { kind: "maker", statement: "b" },
      { kind: "series", statement: "c" },
    ]);
    expect(tags).toEqual(expect.arrayContaining(["identity-heavy", "naming-risk"]));
  });

  it("scarce-pass and rich-pass fixtures agree with human PASS under Brain", () => {
    for (const id of ["fixture-scarce-pass", "fixture-rich-pass"]) {
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
      expect(fx.humanJudgment.overall).toBe("PASS");
      expect(review.decision).toBe("PASS");
    }
  });

  it("X boundary fixture does not invent NAME_DERIVED", () => {
    const fx = VALIDATION_FIXTURES.find((f) => f.sampleId === "fixture-x-boundary-ok")!;
    const core = buildCoreEditorialPlan({
      channel: "X",
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
    expect(review.failures.map((f) => f.code)).not.toContain("NAME_DERIVED_INFERENCE");
  });
});
