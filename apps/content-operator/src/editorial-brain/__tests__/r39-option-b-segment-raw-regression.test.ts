/**
 * r39 — OPTION B SEGMENT RAW regression (LLM=0).
 * Replays r38 Provider RAW through production observe-only gate.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { validateRawEditorialPlanCompliance } from "../generation/raw-plan-compliance.js";
import type { BrainGenerationInputContract } from "../generation/generation-input-contract.js";
import { detectGenericProseViolations } from "../generation/generic-prose-compliance.js";
import { validatePostTransformIntegrity } from "../generation/post-transform-integrity.js";
import {
  buildOptionBObservedRawPlanComplianceMeta,
  buildOptionBSegmentRawRouting,
  optionBSegmentRawAllowsPersist,
  OPTION_B_SEGMENT_RAW_OBSERVE_REASON,
} from "../generation/option-b-segment-raw-gate.js";
import { routeRawPlanFailure } from "../generation/raw-failure-routing.js";
import {
  fillOptionBArticleDefaults,
  parseBloggerArticle,
} from "../../generation/structured-article.js";
import { readFileSync as readSrc } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const R38_RAW = "/tmp/prod-gen-20260820-r38-mizd00320/PROVIDER_RAW.json";
const MIZD_TITLE =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

function loadR38Raw() {
  if (!existsSync(R38_RAW)) {
    throw new Error(`Missing r38 fixture: ${R38_RAW}`);
  }
  return JSON.parse(readFileSync(R38_RAW, "utf8")) as Record<string, unknown>;
}

/** Minimal contract — same stub pattern as contribution-family-routing.test.ts */
function mizdR38StubContract(): BrainGenerationInputContract {
  const leadFacets = ["松本いちか", "令和イチのメスガキ", "10作品", "8時間", "メスガキ"];
  const bodyFacets = ["22本番", "45射精", "480分", "デカ尻", "絶対空域"];
  const leadReq = leadFacets.map((facet) => ({
    id: `cmsy5nf95000cs79kum2etw5w::${facet}`,
    claimId: "cmsy5nf95000cs79kum2etw5w",
    facet,
  }));
  const bodyReq = bodyFacets.map((facet) => ({
    id: `cmsy5nf99000es79k4purbek2::${facet}`,
    claimId: "cmsy5nf99000es79k4purbek2",
    facet,
  }));
  return {
    corePlan: {} as never,
    channelPlan: {} as never,
    roleAllowlist: {
      titleAllowedClaimIds: ["cmsy5nf95000cs79kum2etw5w"],
      leadAllowedClaimIds: ["cmsy5nf95000cs79kum2etw5w"],
      developmentAllowedClaimIds: ["cmsy5nf99000es79k4purbek2"],
      summaryAllowedClaimIds: ["cmsy5nf95000cs79kum2etw5w", "cmsy5nf99000es79k4purbek2"],
      ctaAllowedClaimIds: [],
      omittedClaimIds: [],
    },
    roleClaims: { title: [], lead: [], development: [], summary: [] },
    roleFactualBoundaries: {
      title: { allowedClaims: [], forbiddenInventions: [] },
      lead: { allowedClaims: [], forbiddenInventions: [] },
      development: { allowedClaims: [], forbiddenInventions: [] },
      summary: { allowedClaims: [], forbiddenInventions: [] },
    },
    contributionPlan: {} as never,
    segmentAllocation: {} as never,
    segmentContracts: {
      title: {
        role: "title",
        allowedContributions: leadReq,
        requiredContributions: [],
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: [],
        allowedRelationFamilies: ["FACTUAL"],
      },
      lead: {
        role: "lead",
        allowedContributions: leadReq,
        requiredContributions: leadReq.slice(0, 2),
        reservedForLaterContributions: bodyReq,
        forbiddenConsumedContributions: bodyReq,
        allowedRelationFamilies: ["FACTUAL"],
      },
      development: {
        role: "development",
        allowedContributions: bodyReq,
        requiredContributions: bodyReq.slice(0, 2),
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: leadReq,
        allowedRelationFamilies: ["FACTUAL"],
      },
      summary: {
        role: "summary",
        allowedContributions: [],
        requiredContributions: [],
        reservedForLaterContributions: [],
        forbiddenConsumedContributions: [],
        allowedRelationFamilies: ["FACTUAL"],
      },
    },
    editorialExecution: null,
    insufficientDevelopmentMaterial: false,
    scarcityMode: false,
  } as BrainGenerationInputContract;
}

describe("r39 OPTION B SEGMENT RAW regression (LLM=0)", () => {
  it("r38 RAW: legacy gate BLOCKING → OPTION B observe-only PASS", () => {
    const raw = loadR38Raw();
    const parsed = parseBloggerArticle(fillOptionBArticleDefaults(raw));
    const contract = mizdR38StubContract();
    const articleForRaw = {
      title: parsed.title,
      summary: parsed.summary,
      lead: parsed.lead,
      sections: parsed.sections.map((s) => ({
        paragraphs: s.paragraphs,
        heading: s.heading,
      })),
    };

    const postIntegrity = validatePostTransformIntegrity({
      title: articleForRaw.title,
      lead: articleForRaw.lead,
      summary: articleForRaw.summary,
      sections: articleForRaw.sections,
    });
    expect(postIntegrity.ok).toBe(true);

    const genericProse = detectGenericProseViolations({
      lead: articleForRaw.lead,
      sections: articleForRaw.sections,
      leadAssignedFacts: ["松本いちか", "10作品", "8時間"],
      bodyAssignedFacts: ["22本番", "45射精", "480分"],
      transformationAvailable: true,
    });

    const rawPlan = validateRawEditorialPlanCompliance({
      article: articleForRaw,
      contract,
      productTitle: MIZD_TITLE,
      segmentContributionProvenance: null,
    });

    // r38 regression: raw SEGMENT findings were BLOCKING before fix
    expect(rawPlan.planExecutionFailed).toBe(true);
    expect(rawPlan.findings.some((f) => f.severity === "BLOCKING")).toBe(true);

    const routing = buildOptionBSegmentRawRouting();
    expect(routing.reason).toBe(OPTION_B_SEGMENT_RAW_OBSERVE_REASON);
    expect(routing.route).toBe("PASS");

    const meta = buildOptionBObservedRawPlanComplianceMeta({
      attempt: 1,
      rawPlan,
      genericProse,
      postIntegrity,
      routing,
      leadRedacted: false,
      bodyRedacted: false,
    });

    expect(meta.planExecutionFailed).toBe(false);
    expect(meta.ok).toBe(true);
    expect(meta.failureSignature).toBe("OPTION_B_PASS");
    expect(meta.optionBSkipSegmentMutation).toBe(true);
    expect(optionBSegmentRawAllowsPersist(true, rawPlan)).toBe(true);

    const findings = meta.findings as Array<{ severity: string; observeOnly?: boolean }>;
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.severity === "INFO" && f.observeOnly === true)).toBe(true);
    expect(findings.some((f) => "code" in f && f.code === "LEAD_BODY_OVERLAP")).toBe(true);

    // Prose unchanged (no mutation)
    expect(parsed.lead).toBe(raw.lead);
  });

  it("non-OPTION-B still routes failures via routeRawPlanFailure", () => {
    const raw = loadR38Raw();
    const parsed = parseBloggerArticle(fillOptionBArticleDefaults(raw));
    const contract = mizdR38StubContract();
    const rawPlan = validateRawEditorialPlanCompliance({
      article: {
        title: parsed.title,
        summary: parsed.summary,
        lead: parsed.lead,
        sections: parsed.sections.map((s) => ({
          paragraphs: s.paragraphs,
          heading: s.heading,
        })),
      },
      contract,
      productTitle: MIZD_TITLE,
      segmentContributionProvenance: null,
    });
    const legacyRouting = routeRawPlanFailure({
      result: rawPlan,
      insufficientDevelopmentMaterial: false,
      scarcityMode: false,
      bodyOnlyRestatesLead: rawPlan.bodyOnlyRestatesLead,
    });
    expect(legacyRouting.route).not.toBe("PASS");
    expect(optionBSegmentRawAllowsPersist(false, rawPlan)).toBe(false);
  });

  it("production gate module exposes option_b_segment_raw_observe_only", () => {
    const gatePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../generation/option-b-segment-raw-gate.ts",
    );
    const cgsPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../generation/content-generation-service.ts",
    );
    expect(readSrc(gatePath, "utf8")).toContain(OPTION_B_SEGMENT_RAW_OBSERVE_REASON);
    expect(readSrc(cgsPath, "utf8")).toContain("buildOptionBSegmentRawRouting");
    expect(readSrc(cgsPath, "utf8")).toContain("optionBSegmentRawAllowsPersist");
  });
});
