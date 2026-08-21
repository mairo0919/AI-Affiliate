/**
 * r12 reservation contract / lead budget / scarce DEFER tests.
 */
import { describe, expect, it } from "vitest";
import { buildSegmentContributionAllocation } from "../generation/contribution-compliance.js";
import { validateRawEditorialPlanCompliance } from "../generation/raw-plan-compliance.js";
import { routeRawPlanFailure } from "../generation/raw-failure-routing.js";
import { contributionFamilyKey, countIndependentFamilies } from "../generation/contribution-family.js";
import type { BrainGenerationInputContract } from "../generation/generation-input-contract.js";

function stubContract(opts: {
  leadFacets: string[];
  bodyFacets: string[];
}): BrainGenerationInputContract {
  const leadReq = opts.leadFacets.map((facet) => ({
    id: `c1::${facet}`,
    claimId: "c1",
    facet,
  }));
  const bodyReq = opts.bodyFacets.map((facet) => ({
    id: `c2::${facet}`,
    claimId: "c2",
    facet,
  }));
  return {
    corePlan: {} as never,
    channelPlan: {} as never,
    roleAllowlist: {
      titleAllowedClaimIds: ["c1"],
      leadAllowedClaimIds: ["c1"],
      developmentAllowedClaimIds: ["c2"],
      summaryAllowedClaimIds: ["c1", "c2"],
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
        requiredContributions: leadReq,
        reservedForLaterContributions: bodyReq,
        forbiddenConsumedContributions: bodyReq,
        allowedRelationFamilies: ["FACTUAL"],
      },
      development: {
        role: "development",
        allowedContributions: bodyReq,
        requiredContributions: bodyReq,
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
    inferencePolicy: { allowed: ["direct_paraphrase"], forbidden: [] },
    scarcityMode: false,
    developmentDepth: "standard",
    titleStrategy: "performer_plus_trait",
    summaryStrategy: "list_snippet",
    ctaStrategy: "widget_only_no_generic_bridge",
    informationGainTarget: "new_supported_detail",
    omitDevelopmentSubstance: false,
    insufficientDevelopmentMaterial: false,
    editorialExecution: null,
  } as BrainGenerationInputContract;
}

describe("r12 reservation / lead budget", () => {
  it("1. opening A / development B → lead asserts B → PREMATURE_CONTRIBUTION_CONSUMPTION", () => {
    const contract = stubContract({
      leadFacets: ["ベロキス"],
      bodyFacets: ["イヤラ"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "突然のベロキスからイヤラしく舐め尽くされる。",
        sections: [{ paragraphs: ["出演が確認できる。"] }],
      },
      contract,
    });
    expect(result.ok).toBe(false);
    expect(
      result.findings.some((f) => f.code === "PREMATURE_CONTRIBUTION_CONSUMPTION"),
    ).toBe(true);
    expect(result.prematurelyConsumedContributionIds.length).toBeGreaterThan(0);
    expect(routeRawPlanFailure({ result }).failureClass).toBe("STRUCTURAL_PLAN_FAILURE");
  });

  it("2. lead A / body B → PASS", () => {
    const contract = stubContract({
      leadFacets: ["ベロキス"],
      bodyFacets: ["イヤラ"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "突然のベロキスが交わされる場面が確認できる。",
        sections: [{ paragraphs: ["イヤラしく舐め尽くされる展開が続く。"] }],
      },
      contract,
    });
    expect(result.ok).toBe(true);
  });

  it("3. lead A+B shrinks when needed to reserve development family", () => {
    const alloc = buildSegmentContributionAllocation({
      claims: [
        {
          id: "c1",
          statement: "素人16名と女優16名が参加する1泊2日の大乱交ツアー。発掘と育成が目的。",
          kind: "other",
        },
      ],
      openingClaimIds: ["c1"],
      developmentClaimIds: [],
    });
    const leadFacets = alloc.leadContributions.map((c) => c.facet);
    const bodyFacets = alloc.bodyContributions.map((c) => c.facet);
    expect(bodyFacets.length).toBeGreaterThan(0);
    expect(countIndependentFamilies(bodyFacets)).toBeGreaterThanOrEqual(1);
    // Lead must not hold every strong family
    const all = [...leadFacets, ...bodyFacets];
    expect(countIndependentFamilies(all)).toBeGreaterThanOrEqual(2);
    expect(alloc.segmentContracts.lead.reservedForLaterContributions.length).toBeGreaterThan(0);
    expect(alloc.segmentContracts.lead.forbiddenConsumedContributions.length).toBeGreaterThan(0);
  });

  it("4. shrink still no development → DEFER insufficient", () => {
    const alloc = buildSegmentContributionAllocation({
      claims: [
        {
          id: "c1",
          statement: "メーカー／レーベル情報として掲載されている。",
          kind: "maker",
        },
        {
          id: "c2",
          statement: "販売／配信状態として公開中である。",
          kind: "availability",
        },
      ],
      openingClaimIds: ["c1"],
      developmentClaimIds: ["c2"],
    });
    expect(alloc.insufficientDevelopmentMaterial).toBe(true);
  });

  it("5. composite lead consuming development child → PREMATURE", () => {
    const contract = stubContract({
      leadFacets: ["1泊2日"],
      bodyFacets: ["大乱交"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "1泊2日の大乱交ツアーとして公開されている。",
        sections: [{ paragraphs: ["発掘と育成が目的の企画である。"] }],
      },
      contract,
    });
    expect(result.findings.some((f) => f.code === "PREMATURE_CONTRIBUTION_CONSUMPTION")).toBe(
      true,
    );
  });

  it("6. identity entity re-mention is not premature false positive", () => {
    const contract = stubContract({
      leadFacets: ["10作品", "8時間"],
      bodyFacets: ["メスガキ"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "松本いちかが出演する10作品・合計8時間が公開されている。",
        sections: [
          {
            paragraphs: [
              "松本いちかはメスガキキャラクターとして知られている。",
            ],
          },
        ],
      },
      contract,
    });
    expect(result.ok).toBe(true);
    expect(
      result.findings.some((f) => f.code === "PREMATURE_CONTRIBUTION_CONSUMPTION"),
    ).toBe(false);
  });

  it("7. standard-type ベロキス lead / 舐め尽くし body PASS", () => {
    const contract = stubContract({
      leadFacets: ["ベロキス"],
      bodyFacets: ["舐め"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "突然のベロキスが交わされる。",
        sections: [{ paragraphs: ["舐め尽くされる展開が続く。"] }],
      },
      contract,
    });
    expect(result.ok).toBe(true);
  });

  it("8. mird-type lead consumes all families → FAIL", () => {
    const contract = stubContract({
      leadFacets: ["16名", "1泊2日"],
      bodyFacets: ["大乱交", "発掘"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "素人16名と女優16名の1泊2日の大乱交ツアーで発掘と育成が行われる。",
        sections: [
          {
            paragraphs: ["参加者は素人16名で構成されている。"],
          },
        ],
      },
      contract,
    });
    expect(result.ok).toBe(false);
    expect(
      result.findings.some((f) =>
        ["PREMATURE_CONTRIBUTION_CONSUMPTION", "COMPOSITE_COMPONENT_RESTATEMENT", "SEMANTIC_CONTRIBUTION_REUSE"].includes(
          f.code,
        ),
      ),
    ).toBe(true);
  });

  it("6. identity entity re-mention is not premature false positive", () => {
    const contract = stubContract({
      leadFacets: ["姉妹洗脳"],
      bodyFacets: ["濃厚親父", "森日向子"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "本作は姉妹洗脳をテーマに、木下ひまりと森日向子が出演する独占作品である。",
        sections: [{ paragraphs: ["濃厚親父が物語に深みを与えている。"] }],
      },
      contract,
    });
    const premature = result.findings.filter((f) => f.code === "PREMATURE_CONTRIBUTION_CONSUMPTION");
    expect(premature.every((f) => !(f.facets ?? []).includes("森日向子"))).toBe(true);
  });

  it("strip keepFacets keeps fact carriers; does not rewrite to catalog 確認できる", async () => {
    const { stripUnsupportedEvaluativePadding } = await import(
      "../generation/strip-evaluative-padding.js"
    );
    const out = stripUnsupportedEvaluativePadding({
      article: {
        title: "t",
        summary: "s",
        lead: "福原みなが出演する本作は、Hカップの超敏感巨乳が際立つ内容となっている。",
        sections: [
          {
            paragraphs: [
              "本作は猛烈なピストンシーンが見どころの一つで、感度の良さが際立っている。",
            ],
          },
        ],
      },
      claimStatements: [{ statement: "超敏感巨乳" }, { statement: "ピストン" }],
      keepFacets: ["超敏感巨乳", "ピストン"],
    });
    expect(out.lead).toContain("超敏感巨乳");
    expect(out.sections[0]?.paragraphs.join("")).toContain("ピストン");
    // OPTION B: no deterministic rewrite into 「が確認できる」
    expect(out.lead).not.toContain("が確認できる");
    expect(out.sections[0]?.paragraphs.join("")).not.toContain("が確認できる");
  });

  it("lead reserved redaction: blind token delete forbidden; unsafe → fail", async () => {
    const { safeRedactReservedLead, safeRedactLeadConsumedFromBody } = await import(
      "../generation/lead-reservation-redact.js"
    );
    // Mid-clause reserved facet cannot be token-deleted
    const unsafe = safeRedactReservedLead({
      lead: "素人16名が参加する1泊2日の大乱交ツアーとして公開されている。",
      reservedFacets: ["2日大乱交ツアー"],
      requiredFacets: ["16名", "1泊2日"],
    });
    expect(unsafe.ok).toBe(false);
    expect(unsafe.failureCode).toMatch(/RAW_PLAN_EXECUTION_FAILED|POST_TRANSFORM/);

    // Separate clause can be removed safely
    const safe = safeRedactReservedLead({
      lead: "素人16名が参加する1泊2日のツアーだ。大乱交も含まれる。",
      reservedFacets: ["大乱交"],
      requiredFacets: ["16名", "1泊2日"],
    });
    expect(safe.ok).toBe(true);
    expect(safe.lead).toContain("16名");
    expect(safe.lead).not.toContain("大乱交");

    const sections = safeRedactLeadConsumedFromBody({
      sections: [
        {
          paragraphs: [
            "作品では、ベロキスに続き、濃密なセックスシーンが繰り広げられる。",
            "イヤラしい舐め尽くしの描写がある。",
          ],
        },
      ],
      leadConsumedFacets: ["ベロキス"],
      bodyRequiredFacets: ["セックス", "イヤラ"],
    });
    expect(sections.ok).toBe(true);
    const body = (sections.sections ?? []).flatMap((s) => s.paragraphs).join("");
    // First paragraph mixes consumed+required in one clause → keep (no blind delete)
    // Second paragraph has required only
    expect(body).toContain("セックス");
    expect(body).toContain("イヤラ");
  });

  it("9. mird-type participants/duration → event → purpose PASS", () => {
    const contract = stubContract({
      leadFacets: ["16名", "1泊2日"],
      bodyFacets: ["大乱交", "発掘"],
    });
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "素人16名と女優16名が参加する1泊2日のツアーとして公開されている。",
        sections: [
          { paragraphs: ["企画内容は大乱交として構成されている。"] },
          { paragraphs: ["発掘と育成が目的の特別企画である。"] },
        ],
      },
      contract,
    });
    expect(result.ok).toBe(true);
  });

  it("10. scarce development family 0 → DEFER without regen", () => {
    const contract = stubContract({ leadFacets: ["独占"], bodyFacets: [] });
    contract.scarcityMode = true;
    contract.insufficientDevelopmentMaterial = true;
    const result = validateRawEditorialPlanCompliance({
      article: {
        title: "t",
        summary: "s",
        lead: "独占作品として公開されている。",
        sections: [{ paragraphs: ["独占の設定を改めて説明する。"] }],
      },
      contract,
    });
    const routing = routeRawPlanFailure({
      result,
      insufficientDevelopmentMaterial: true,
      scarcityMode: true,
      bodyOnlyRestatesLead: true,
    });
    expect(routing.route).toBe("DEFER_INSUFFICIENT_MATERIAL");
    expect(routing.allowPlanAwareRegen).toBe(false);
  });

  it("family keys distinguish kiss vs lick", () => {
    expect(contributionFamilyKey("ベロキス")).not.toBe(contributionFamilyKey("イヤラ"));
    expect(contributionFamilyKey("16名")).toBe("family:participants");
    expect(contributionFamilyKey("大乱交")).toBe("family:orgy_event");
  });
});
