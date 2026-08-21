/**
 * Article-level editorial sufficiency (BLOG).
 * Not length-based: uses SUPPORTED informational contribution + development progress.
 *
 * Segment repair success ≠ article success.
 */

import type { CoreEditorialPlan } from "../core/types.js";
import type { EditorialFailureCode } from "../core/failure-taxonomy.js";
import type { ReviewableBlogArtifact } from "../shadow/reviewer.js";
import type { SemanticAssertion } from "../shadow/semantic-types.js";
import { hasEvaluativeRelation } from "../shadow/predicate-families.js";

const META_ONLY_KINDS = new Set(["maker", "availability", "label", "temporal_sale"]);

const EDITORIAL_FAMILIES = new Set([
  "EVENT_OR_SCENE",
  "SETTING",
  "FACTUAL_ATTRIBUTE",
]);

export type ArticleSufficiencyResult = {
  ok: boolean;
  code: EditorialFailureCode | null;
  message: string;
  evidence: Record<string, unknown>;
};

function isCatalogOnlyText(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (t.length === 0) return true;
  const hasCatalog = /メーカー|レーベル|配信|制作|担当|公開ページ|配給|手がけ/.test(t);
  const hasConcreteEditorial =
    /キス|舐め|シーン|シチュ|ナンパ|潮|ピストン|収録|時間|ベスト|バスツアー|洗脳|姉妹|痴女|わからせ|生ハメ|顔面|プール|水着|巨乳|感度|企画|乱交|男優|女優/.test(
      t,
    );
  // Maker/availability prose without concrete editorial contribution
  if (hasCatalog && !hasConcreteEditorial) return true;
  // Evaluative fluff attached to maker/label only
  if (hasCatalog && hasEvaluativeRelation(text) && !hasConcreteEditorial) return true;
  return false;
}

function isEditorialDevelopmentAssertion(
  a: SemanticAssertion,
  claimById: Map<string, { id: string; statement: string; kind?: string }>,
): boolean {
  if (a.failureCodes.length > 0) return false;
  if (!(a.supportType === "DIRECT" || a.supportType === "SAFE_COMPOSITION")) return false;
  if ((a.novelFacets?.length ?? 0) === 0) return false;
  if (isCatalogOnlyText(a.assertion)) return false;

  const kinds = a.supportingClaimIds
    .map((id) => (claimById.get(id)?.kind ?? "").toLowerCase())
    .filter(Boolean);
  if (kinds.length > 0 && kinds.every((k) => META_ONLY_KINDS.has(k))) return false;

  // Pure evaluation/recommendation without editorial families is not development value
  const families = a.predicateFamilies ?? [];
  if (
    families.some((f) => f === "EVALUATION" || f === "RECOMMENDATION" || f === "SUITABILITY") &&
    !families.some((f) => EDITORIAL_FAMILIES.has(f))
  ) {
    return false;
  }

  return true;
}

/**
 * Does development (body sections) advance understanding beyond opening (lead/title/summary)?
 */
export function evaluateBlogArticleEditorialSufficiency(input: {
  artifact: ReviewableBlogArtifact;
  assertions: SemanticAssertion[];
  corePlan: CoreEditorialPlan;
  claimStatements: Array<{ id: string; statement: string; kind?: string }>;
  /** OPTION B: short natural intro — do not require high informationGainTarget coverage */
  naturalProductIntro?: boolean;
}): ArticleSufficiencyResult {
  const { artifact, assertions, corePlan, claimStatements } = input;
  const naturalIntro = input.naturalProductIntro === true;
  const claimById = new Map(claimStatements.map((c) => [c.id, c]));

  const sectionParas = artifact.sections.flatMap((s, si) =>
    s.paragraphs.map((p, pi) => ({ role: `section:${si}:p${pi}`, text: (p ?? "").trim() })),
  );
  const nonEmptySections = sectionParas.filter((p) => p.text.length > 0);

  const openingRoles = new Set(["lead", "title", "summary"]);
  const developmentAssertions = assertions.filter(
    (a) => a.sourceSegment.startsWith("section:") && !a.failureCodes.includes("REPETITION"),
  );
  const openingAssertions = assertions.filter((a) =>
    openingRoles.has(a.sourceSegment.split(":")[0] ?? ""),
  );

  const editorialDev = developmentAssertions.filter((a) =>
    isEditorialDevelopmentAssertion(a, claimById),
  );
  const novelSupportedOpening = openingAssertions.filter(
    (a) =>
      (a.supportType === "DIRECT" || a.supportType === "SAFE_COMPOSITION") &&
      (a.novelFacets?.length ?? 0) > 0 &&
      a.failureCodes.length === 0,
  );

  const totalNovelSupported = assertions.filter(
    (a) =>
      (a.supportType === "DIRECT" || a.supportType === "SAFE_COMPOSITION") &&
      (a.novelFacets?.length ?? 0) > 0 &&
      !a.failureCodes.includes("REPETITION"),
  ).length;

  // 1) Empty body after repair / generation — no development surface
  if (nonEmptySections.length === 0) {
    return {
      ok: false,
      code: "INSUFFICIENT_SUPPORTED_MATERIAL",
      message:
        "Article has no development paragraphs after review/repair; insufficient editorial material for publishable BLOG",
      evidence: {
        nonEmptySections: 0,
        novelSupportedOpening: novelSupportedOpening.length,
        informationGainTarget: corePlan.informationGainTarget,
        scarcityMode: corePlan.scarcityMode,
      },
    };
  }

  // 2) Development is only maker/availability / catalog readout — always insufficient
  //    (novel facets on maker claims do NOT rescue a catalog-only body)
  const allDevCatalog =
    nonEmptySections.length > 0 && nonEmptySections.every((p) => isCatalogOnlyText(p.text));
  if (allDevCatalog) {
    return {
      ok: false,
      code: "CATALOG_NARRATION",
      message:
        "Body only restates maker/availability catalog facts; lead→body does not advance reader interest",
      evidence: {
        sectionTexts: nonEmptySections.map((p) => p.text.slice(0, 80)),
        editorialDev: editorialDev.length,
      },
    };
  }

  // 3) No editorial SUPPORTED contribution in development (restatement / evaluative fluff)
  if (editorialDev.length === 0) {
    // True material scarcity → defer upstream. Otherwise treat as repairable gain failure
    // (generator failed to place existing SUPPORTED facets into body).
    const concretePool = claimStatements.filter((c) => {
      const k = (c.kind ?? "").toLowerCase();
      if (META_ONLY_KINDS.has(k)) return false;
      const s = c.statement.trim();
      if (s.length > 80) return true;
      return !/メーカー|レーベル|配信状態|AVAILABLE|販売／配信/.test(s);
    });
    const poolScarce = concretePool.length === 0 || corePlan.scarcityMode;
    return {
      ok: false,
      code: poolScarce ? "INSUFFICIENT_SUPPORTED_MATERIAL" : "INFORMATION_GAIN_LOW",
      message:
        "Development segments add no new SUPPORTED editorial contribution beyond opening",
      evidence: {
        editorialDev: 0,
        novelSupportedOpening: novelSupportedOpening.length,
        totalNovelSupported,
        informationGainTarget: corePlan.informationGainTarget,
        scarcityMode: corePlan.scarcityMode,
        concretePool: concretePool.length,
      },
    };
  }

  // 4) Article-level gain still below target (contribution count, not length)
  // Natural intro: floor = 1 novel supported fact — do not maximize coverage.
  const gainFloor = naturalIntro ? 1 : Math.max(1, corePlan.informationGainTarget);
  if (totalNovelSupported < gainFloor) {
    return {
      ok: false,
      code: "INFORMATION_GAIN_LOW",
      message: `Article supportedNovel=${totalNovelSupported} < informationGainFloor=${gainFloor}`,
      evidence: {
        totalNovelSupported,
        informationGainTarget: corePlan.informationGainTarget,
        informationGainFloor: gainFloor,
        naturalIntro,
      },
    };
  }

  // 5) Claim pool itself is insufficient for a postable BLOG (only meta kinds)
  const kinds = claimStatements.map((c) => (c.kind ?? "").toLowerCase()).filter(Boolean);
  const concreteKinds = kinds.filter((k) => !META_ONLY_KINDS.has(k));
  if (claimStatements.length > 0 && concreteKinds.length === 0 && editorialDev.length === 0) {
    return {
      ok: false,
      code: "INSUFFICIENT_SUPPORTED_MATERIAL",
      message: "Claim pool lacks concrete SUPPORTED material beyond maker/availability",
      evidence: { kinds },
    };
  }

  return {
    ok: true,
    code: null,
    message: "sufficient editorial development contribution",
    evidence: {
      editorialDev: editorialDev.length,
      totalNovelSupported,
      nonEmptySections: nonEmptySections.length,
    },
  };
}
