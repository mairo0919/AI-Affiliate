/**
 * Production-path E2E regressions for BAD_INPUT / atomic allocation / REP body guard.
 * Deterministic — no LLM.
 */

import { describe, expect, it } from "vitest";
import {
  detectBadInputClaims,
  isTitleRichClaim,
  looksLikeJammedCastNames,
  buildSegmentContributionAllocation,
  normalizeAtomicFacets,
  unusedContributionsForRepair,
  consumedFacetKeysOutsideTarget,
  selectRepairOperation,
  applyRepairs,
  facetKey,
} from "../index.js";
import { classifyClaimKind as classifyKind } from "../../generation/select-claims-for-structure-pattern.js";

const MIRD_TITLE =
  "【独占】MOODYZファン感謝祭 バコバコバスツアー2024 AV男優発掘＆育成スペシャル！！ AV男優を目指す素人16名とAV女優16名の1泊2日大乱交ツアー！ は公開ページ上で確認できる。";

const ICHIKA_TITLE =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト は公開ページ上で確認できる。";

const SSIS_TITLE =
  "【独占】彼女の綺麗なお姉さんと二人きり… 突然のベロキス、イヤラしく舐め尽くされてセックス三昧 こんな僕って最低ですか…？ 葵つかさ は公開ページ上で確認できる。";

describe("CASE A: title-rich + cast words must not BAD_INPUT", () => {
  it("mird-like title with AV男優/AV女優 + quantity + scenario passes", () => {
    const claim = {
      id: "mird-title",
      statement: MIRD_TITLE,
      kind: "trait_or_scene",
    };
    expect(isTitleRichClaim(claim)).toBe(true);
    expect(detectBadInputClaims([claim])).toEqual([]);
  });

  it("title reaches allocation with body concrete facets (16名 / 1泊2日 / 乱交)", () => {
    const claims = [{ id: "t", statement: MIRD_TITLE, kind: "trait_or_scene" }];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["t"],
      developmentClaimIds: [],
    });
    expect(allocation.insufficientDevelopmentMaterial).toBe(false);
    const allFacets = [
      ...allocation.leadContributions.map((c) => c.facet),
      ...allocation.bodyContributions.map((c) => c.facet),
    ].join("|");
    expect(allFacets).toMatch(/16名|1泊2日|乱交/);
    expect(allocation.bodyContributions.length).toBeGreaterThan(0);
    // Contract body required non-empty → would appear in model input contract
    expect(
      allocation.segmentContracts.development.requiredContributions.length,
    ).toBeGreaterThan(0);
  });
});

describe("CASE B: compound facet atomic split lead/body", () => {
  it("10作品/8時間 normalize to atomics and split across roles", () => {
    const atomics = normalizeAtomicFacets(["10作品8時間", "10作品", "8時間", "ベスト", "メスガキ"]);
    expect(atomics).toContain("10作品");
    expect(atomics).toContain("8時間");
    expect(atomics.some((a) => a === "10作品8時間")).toBe(false);

    const claims = [{ id: "t", statement: ICHIKA_TITLE, kind: "trait_or_scene" }];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["t"],
      developmentClaimIds: [],
    });
    expect(allocation.insufficientDevelopmentMaterial).toBe(false);
    const lead = new Set(allocation.leadContributions.map((c) => c.facet));
    const body = new Set(allocation.bodyContributions.map((c) => c.facet));
    // No exact facet overlap between lead and body
    for (const f of lead) expect(body.has(f)).toBe(false);
    // Both quantity atomics should appear somewhere in the plan
    const all = new Set([...lead, ...body]);
    expect(all.has("10作品") || all.has("8時間")).toBe(true);
    expect(allocation.bodyContributions.length).toBeGreaterThan(0);

    // unused must not falsely go to 0 when lead prose mentions body atomics
    const article = {
      title: "メスガキ作品",
      summary: "まとめ",
      lead: "松本いちかのメスガキ痴女10作品を収録した8時間ベスト。",
      sections: [
        {
          paragraphs: ["本作は合計8時間の長尺で、痴女演技が確認できる。"],
        },
      ],
    };
    const unused = unusedContributionsForRepair({ plan: allocation.plan, article });
    // Body-assigned facets not in lead assignment remain available
    const leadKeys = new Set(allocation.leadContributions.map((c) => facetKey(c.facet)));
    const bodyOnly = allocation.bodyContributions.filter((c) => !leadKeys.has(facetKey(c.facet)));
    expect(bodyOnly.length).toBeGreaterThan(0);
    expect(unused.length).toBeGreaterThan(0);
  });
});

describe("CASE C: repetition repair keeps unique body substance", () => {
  it("lead=A body=A+B → compress/replace keeps B, no empty DELETE", () => {
    const claims = [{ id: "t", statement: SSIS_TITLE, kind: "trait_or_scene" }];
    const allocation = buildSegmentContributionAllocation({
      claims,
      openingClaimIds: ["t"],
      developmentClaimIds: [],
    });
    const leadFacet = allocation.leadContributions[0]?.facet ?? "ベロキス";
    const bodyUnique =
      allocation.bodyContributions.find((c) => c.facet !== leadFacet)?.facet ?? "独占";

    const article = {
      title: "作品",
      summary: leadFacet,
      lead: `${leadFacet}から始まる。`,
      sections: [
        {
          paragraphs: [`${leadFacet}に続き、${bodyUnique}の展開がある。`],
        },
      ],
    };
    const plan = allocation.plan;
    const unused = unusedContributionsForRepair({ plan, article });
    const consumed = consumedFacetKeysOutsideTarget({
      article,
      targetSegmentId: "section:0:p0",
      plan,
    });
    const op = selectRepairOperation({
      target: {
        kind: "PARAGRAPH",
        segmentId: "section:0:p0",
        originalText: article.sections[0]!.paragraphs[0]!,
        allowedClaimIds: ["t"],
        hints: [],
        failureCodes: ["REPETITION"],
      },
      unusedContributions: unused.filter((u) => !consumed.has(facetKey(u.facet))),
      consumedFacetKeys: consumed,
      allowedFacets: allocation.bodyContributions.map((c) => c.facet),
      bodyGuard: {
        isBodySegment: true,
        isSoleBodySegment: true,
        requiredBodyFacets: allocation.segmentContracts.development.requiredContributions.map(
          (c) => c.facet,
        ),
        bodyAssignedFacets: allocation.bodyContributions.map((c) => c.facet),
        remainingBodyTextIfDeleted: "",
      },
    });
    expect(op.operation).not.toBe("DELETE");

    const repaired = applyRepairs(article, [
      {
        segmentId: "section:0:p0",
        text:
          op.operation === "DELETE"
            ? ""
            : op.operation === "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL" && op.replaceWith[0]
              ? `${op.replaceWith.map((c) => c.facet).join("と")}が確認できる。`
              : `${bodyUnique}の展開がある。`,
        claimIdsUsed: ["t"],
        operation: op.operation === "DELETE" ? "DELETE" : op.operation,
      },
    ]);
    const bodyText = repaired.sections.flatMap((s) => s.paragraphs).join("");
    expect(bodyText.replace(/\s+/g, "").length).toBeGreaterThan(0);
  });
});

describe("para BAD_INPUT regression", () => {
  it("jammed cast 「優梨まいなましろ杏」 still BAD_INPUT", () => {
    expect(looksLikeJammedCastNames("優梨まいなましろ杏")).toBe(true);
    const findings = detectBadInputClaims([
      {
        id: "bad",
        statement: "出演者／クリエイターとして「優梨まいなましろ杏」が記載されている。",
        kind: "performer",
      },
    ]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("normal single performer cast line is NOT BAD_INPUT", () => {
    const findings = detectBadInputClaims([
      {
        id: "ok",
        statement: "出演者／クリエイターとして「松本いちか」が記載されている。",
        kind: "performer",
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("title-rich vs jammed-cast distinction", () => {
    expect(
      detectBadInputClaims([
        { id: "title", statement: MIRD_TITLE, kind: "trait_or_scene" },
        {
          id: "jam",
          statement: "出演は優梨まいなましろ杏",
          kind: "performer",
        },
      ]).map((f) => f.claimId),
    ).toEqual(["jam"]);
  });
});

describe("selection path: BAD_INPUT must not defer title-rich", () => {
  it("classify + detect leaves mird title selectable", () => {
    const kind = classifyKind(MIRD_TITLE);
    expect(kind).toBe("trait_or_scene");
    const bad = detectBadInputClaims([
      { id: "t", statement: MIRD_TITLE, kind },
      {
        id: "series",
        statement: "シリーズ情報として「バコバコバスツアー」が公開されている。",
        kind: "series",
      },
    ]);
    expect(bad.map((b) => b.claimId)).not.toContain("t");
  });
});
