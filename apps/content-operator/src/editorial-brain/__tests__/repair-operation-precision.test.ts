/**
 * Repair operation precision tests (decision table SSOT).
 */

import { describe, expect, it } from "vitest";
import {
  selectRepairOperation,
  buildDeterministicReplaceText,
  buildDeterministicCompressText,
  filterStrongUnused,
  validateRepairedSegment,
  applyRepairs,
  MAX_TARGETED_REPAIR_ATTEMPTS,
  detectBadInputClaims,
  experienceMustNotMutateLearningRules,
  contributionsFromClaim,
  facetKey,
} from "../index.js";

const targetBase = {
  kind: "PARAGRAPH" as const,
  segmentId: "section:0:p0",
  originalText: "松本いちかが出演。魅力を堪能できるおすすめ作品。",
  allowedClaimIds: ["c1", "c2"],
  hints: [],
};

describe("operation decision table", () => {
  it("1. repetition + unused → REPLACE", () => {
    const unused = contributionsFromClaim({
      id: "c3",
      statement: "シリーズ情報として「バコバコバスツアー」が公開されている。",
    });
    const op = selectRepairOperation({
      target: { ...targetBase, failureCodes: ["REPETITION"], originalText: "松本いちかの再掲。" },
      unusedContributions: unused,
      consumedFacetKeys: new Set(["松本いちか"].map(facetKey)),
      allowedFacets: ["松本いちか"],
    });
    expect(op.operation).toBe("REPLACE_WITH_UNUSED_SUPPORTED_DETAIL");
    expect(op.requiresLlm).toBe(false);
    expect(op.ruleId).toBe("REP_REPLACE");
  });

  it("2. repetition + no unused → DELETE when other body remains", () => {
    const op = selectRepairOperation({
      target: { ...targetBase, failureCodes: ["REPETITION"] },
      unusedContributions: [],
      consumedFacetKeys: new Set(["松本いちか", "出演"].map(facetKey)),
      allowedFacets: ["松本いちか"],
      bodyGuard: {
        isBodySegment: true,
        isSoleBodySegment: false,
        requiredBodyFacets: [],
        bodyAssignedFacets: [],
        remainingBodyTextIfDeleted: "別段落に具体情報がある。",
      },
    });
    expect(op.operation).toBe("DELETE");
    expect(op.requiresLlm).toBe(false);
  });

  it("2c. repetition on sole body with unique facets → COMPRESS not empty DELETE", () => {
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        failureCodes: ["REPETITION"],
        originalText: "ベロキスのあと、独占配信で二人きりの関係が描かれる。",
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(["ベロキス"].map(facetKey)),
      allowedFacets: ["ベロキス", "独占", "二人"],
      bodyGuard: {
        isBodySegment: true,
        isSoleBodySegment: true,
        requiredBodyFacets: ["独占"],
        bodyAssignedFacets: ["独占", "二人"],
        remainingBodyTextIfDeleted: "",
      },
    });
    expect(op.operation).not.toBe("DELETE");
    expect(["COMPRESS", "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL", "REWRITE"]).toContain(op.operation);
  });

  it("2b. repetition on lead + no unused → COMPRESS (never DELETE opening)", () => {
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        kind: "LEAD",
        segmentId: "lead",
        failureCodes: ["REPETITION"],
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(["松本いちか"].map(facetKey)),
      allowedFacets: ["松本いちか"],
    });
    expect(op.operation).toBe("COMPRESS");
    expect(op.requiresLlm).toBe(true);
    expect(op.ruleId).toBe("REP_DELETE_OPENING");
  });

  it("3. NAME_DERIVED + no explicit setting → DELETE", () => {
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        failureCodes: ["NAME_DERIVED_INFERENCE"],
        originalText: "プールナンパの水着テーマが展開される。",
      },
      unusedContributions: contributionsFromClaim({
        id: "c2",
        statement: "メーカー／レーベルとして「DOC」が公開されている。",
      }),
      consumedFacetKeys: new Set(),
      allowedFacets: ["DOC"],
    });
    expect(op.operation).toBe("DELETE");
    expect(op.ruleId).toBe("NAME_DELETE");
  });

  it("4. NAME_DERIVED + supported setting → REPLACE", () => {
    const unused = contributionsFromClaim({
      id: "c4",
      statement: "シリーズ情報として「プールナンパ」が公開されている。",
    });
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        failureCodes: ["NAME_DERIVED_INFERENCE"],
        originalText: "水着ナンパテーマの舞台設定。",
      },
      unusedContributions: unused,
      consumedFacetKeys: new Set(),
      allowedFacets: [],
    });
    expect(op.operation).toBe("REPLACE_WITH_UNUSED_SUPPORTED_DETAIL");
    expect(op.ruleId).toBe("NAME_REPLACE_SETTING");
  });

  it("5. evaluative only → DELETE", () => {
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        failureCodes: ["EVALUATIVE_INFERENCE"],
        originalText: "魅力を堪能できるおすすめの一作です。",
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(),
      allowedFacets: [],
    });
    expect(op.operation).toBe("DELETE");
    expect(op.ruleId).toBe("EVAL_DELETE");
  });

  it("6. evaluative + factual core → COMPRESS", () => {
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        failureCodes: ["EVALUATIVE_INFERENCE"],
        originalText: "松本いちかが出演。魅力を堪能できる。",
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(),
      allowedFacets: ["松本いちか"],
    });
    expect(op.operation).toBe("COMPRESS");
    expect(op.ruleId).toBe("EVAL_COMPRESS");
  });

  it("7. filler → DELETE", () => {
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        kind: "CTA",
        segmentId: "cta",
        failureCodes: ["FILLER"],
        originalText: "ぜひチェックを。",
      },
      unusedContributions: [],
      consumedFacetKeys: new Set(),
    });
    expect(op.operation).toBe("DELETE");
  });

  it("EVAL is not misrouted to REPLACE by overlap heuristic", () => {
    const unused = contributionsFromClaim({
      id: "c3",
      statement: "シリーズ情報として「バコバコバスツアー」が公開されている。",
    });
    const op = selectRepairOperation({
      target: {
        ...targetBase,
        failureCodes: ["EVALUATIVE_INFERENCE"],
        originalText: "松本いちか出演で魅力を堪能できる。",
      },
      unusedContributions: unused,
      consumedFacetKeys: new Set(["松本いちか", "出演"].map(facetKey)),
      allowedFacets: ["松本いちか"],
    });
    expect(op.operation).not.toBe("REPLACE_WITH_UNUSED_SUPPORTED_DETAIL");
    expect(["COMPRESS", "DELETE"]).toContain(op.operation);
  });
});

describe("REPLACE / DELETE success contracts", () => {
  it("8. REPLACE same contribution reuse → reject", () => {
    const replaceWith = contributionsFromClaim({
      id: "c3",
      statement: "シリーズは「バコバコバスツアー」",
    });
    const result = validateRepairedSegment({
      operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
      originalText: "松本いちかの再掲",
      repairedText: "松本いちかが出演する独占配信。",
      claimIdsUsed: ["c1"],
      allowedClaimIds: ["c1", "c3"],
      allowedFacets: ["バコバコバスツアー"],
      consumedFacetKeys: new Set(["松本いちか", "独占配信"].map(facetKey)),
      replaceWith,
    });
    expect(result.ok).toBe(false);
    expect(
      result.findings.some(
        (f) => f.code === "FORBIDDEN_CONTRIBUTION_REUSE" || f.code === "REPLACEMENT_NOT_USED",
      ),
    ).toBe(true);
  });

  it("9. REPLACE unused fact unused → reject", () => {
    const replaceWith = contributionsFromClaim({
      id: "c3",
      statement: "シリーズは「バコバコバスツアー」",
    });
    const result = validateRepairedSegment({
      operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
      originalText: "x",
      repairedText: "別の言い回しだけの本文。",
      claimIdsUsed: ["c3"],
      allowedClaimIds: ["c3"],
      allowedFacets: ["バコバコバスツアー"],
      consumedFacetKeys: new Set(),
      replaceWith,
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "REPLACEMENT_NOT_USED")).toBe(true);
  });

  it("10. DELETE empty → success", () => {
    const result = validateRepairedSegment({
      operation: "DELETE",
      originalText: "重複段落",
      repairedText: "",
      claimIdsUsed: [],
      allowedClaimIds: [],
      allowedFacets: [],
      consumedFacetKeys: new Set(),
    });
    expect(result.ok).toBe(true);
  });

  it("11. DELETE clears section; no meta filler placeholder", () => {
    const next = applyRepairs(
      {
        title: "t",
        summary: "s",
        lead: "lead fact",
        sections: [
          { heading: null, paragraphs: ["dup"] },
          { heading: null, paragraphs: ["keep"] },
        ],
      },
      [{ segmentId: "section:0:p0", text: "", claimIdsUsed: [], operation: "DELETE" }],
    );
    expect(next.sections.every((s) => !s.paragraphs.includes("（公開事実は冒頭に示した）"))).toBe(
      true,
    );
    expect(next.sections.some((s) => s.paragraphs.includes("keep"))).toBe(true);
  });

  it("12. clean segment unchanged", () => {
    const next = applyRepairs(
      {
        title: "clean-title",
        summary: "clean-summary",
        lead: "clean-lead",
        sections: [{ heading: null, paragraphs: ["bad", "clean"] }],
      },
      [{ segmentId: "section:0:p0", text: "", claimIdsUsed: [], operation: "DELETE" }],
    );
    expect(next.title).toBe("clean-title");
    expect(next.lead).toBe("clean-lead");
    expect(next.sections[0]!.paragraphs).toEqual(["clean"]);
  });

  it("13. max repair=1", () => {
    expect(MAX_TARGETED_REPAIR_ATTEMPTS).toBe(1);
  });

  it("14. deterministic REPLACE uses unused contribution", () => {
    const replaceWith = contributionsFromClaim({
      id: "c3",
      statement: "シリーズ情報として「バコバコバスツアー」が公開されている。",
    });
    const built = buildDeterministicReplaceText({
      replaceWith,
      claims: [{ id: "c3", statement: "シリーズ情報として「バコバコバスツアー」が公開されている。" }],
    });
    expect(built.text).toContain("バコバコバスツアー");
    expect(built.text).not.toContain("公開情報として");
    expect(built.claimIdsUsed).toEqual(["c3"]);
    const result = validateRepairedSegment({
      operation: "REPLACE_WITH_UNUSED_SUPPORTED_DETAIL",
      originalText: "dup",
      repairedText: built.text,
      claimIdsUsed: built.claimIdsUsed,
      allowedClaimIds: ["c3"],
      allowedFacets: ["バコバコバスツアー"],
      consumedFacetKeys: new Set(["松本いちか"].map(facetKey)),
      replaceWith,
    });
    expect(result.ok).toBe(true);
  });

  it("15. BAD_INPUT not repaired via detect", () => {
    expect(
      detectBadInputClaims([
        {
          id: "b",
          statement: "出演者／クリエイターとして「優梨まいなましろ杏」が記載されている。",
        },
      ]).length,
    ).toBeGreaterThan(0);
  });

  it("weak unused filtered", () => {
    const weak = filterStrongUnused([
      { id: "a::ページ", claimId: "a", facet: "ページ" },
      { id: "a::バコバコバスツアー", claimId: "a", facet: "バコバコバスツアー" },
    ]);
    expect(weak.map((c) => c.facet)).toEqual(["バコバコバスツアー"]);
  });

  it("deterministic compress drops evaluative sentence", () => {
    const r = buildDeterministicCompressText({
      originalText: "松本いちかが出演。魅力を堪能できる。",
      allowedFacets: ["松本いちか"],
    });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("松本いちか");
    expect(r.text).not.toContain("魅力を堪能");
  });

  it("18. LearningRule unchanged", () => {
    expect(experienceMustNotMutateLearningRules()).toEqual({
      autoPromote: false,
      writesLearningRule: false,
    });
  });
});
