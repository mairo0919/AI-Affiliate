/**
 * Deterministic Brain Reviewer (shadow).
 * Hard guarantees (structure/meta) stay deterministic; meaning uses SemanticReviewerPort.
 * Length alone never decides PASS/FAIL.
 */

import { FAILURE_CODE_META, type EditorialFailureCode } from "../core/failure-taxonomy.js";
import type {
  BrainDecision,
  CoreEditorialPlan,
  EditorialFailure,
  EditorialReviewReport,
} from "../core/types.js";
import { evaluateBlogArticleEditorialSufficiency } from "../generation/article-sufficiency.js";
import { optionBNaturalIntroInformationGainFloor } from "../../article-pattern/natural-product-intro-policy.js";
import {
  buildSegmentContributionAllocation,
  detectSourceTitleRestatement,
  validateContributionCompliance,
} from "../generation/contribution-compliance.js";
import {
  validatePostTransformIntegrity,
  integrityFindingsAsBrainCodes,
} from "../generation/post-transform-integrity.js";
import { extractTextFacets, segmentsFromBlog, segmentsFromX } from "./assertion-extract.js";
import { defaultSemanticReviewer } from "./semantic-reviewer.js";
import type { SemanticReviewerPort, SemanticReviewStats } from "./semantic-types.js";
import { claimStatesEvaluativeRelation, hasEvaluativeRelation } from "./predicate-families.js";

export type ReviewableBlogArtifact = {
  channel: "BLOG";
  title: string;
  summary: string;
  lead: string;
  sections: Array<{ paragraphs: string[]; lists: string[] }>;
  bodyText: string;
};

export type ReviewableXArtifact = {
  channel: "X";
  body: string;
  reply?: string | null;
  posts?: Array<{ order: number; text: string; claimIdsUsed?: string[]; function?: string }>;
};

export type ReviewableArtifact = ReviewableBlogArtifact | ReviewableXArtifact;

const SUMMARY_META_RE = /について紹介します|本記事では|この記事では|をご紹介します/;
const OPENING_BOILER_RE = /今回は.{0,12}紹介します|結論から言うと/;
const FILLER_RE = /ぜひチェック|詳しく確認|より深く|興味を持った方は/;

function units(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function toFailure(
  code: EditorialFailureCode,
  message: string,
  evidence?: Record<string, unknown>,
): EditorialFailure {
  const meta = FAILURE_CODE_META[code];
  return {
    code,
    severity: meta.defaultSeverity,
    message,
    evidence,
  };
}

function artifactSegments(artifact: ReviewableArtifact): Array<{ role: string; text: string }> {
  if (artifact.channel === "BLOG") {
    return segmentsFromBlog(artifact);
  }
  return segmentsFromX(artifact);
}

/**
 * Cross-segment FULL_RESTATEMENT only:
 * body has lead facet overlap AND that body segment contributed zero novel facets.
 * Partial overlap with gain is not blocking repetition.
 */
function detectFullRestatementAcrossSegments(input: {
  artifact: ReviewableArtifact;
  assertions: NonNullable<EditorialReviewReport["semanticAssertions"]>;
  optionBNaturalIntro?: boolean;
}): number {
  if (input.artifact.channel === "BLOG") {
    const leadFacets = extractTextFacets(input.artifact.lead).filter((f) => f.length >= 3);
    if (leadFacets.length === 0) return 0;
    let fullRestatementHits = 0;
    input.artifact.sections.forEach((sec, si) => {
      sec.paragraphs.forEach((para, pi) => {
        const overlap = leadFacets.filter((f) => para.includes(f));
        if (overlap.length < 2) return;
        // OPTION B: lead/body shared scale facts alone are natural overview→detail, not cross-seg BLOCKING.
        if (
          input.optionBNaturalIntro &&
          overlap.every(
            (f) =>
              /^\d+(?:作品|名|人|時間|分)/.test(f) ||
              (/^(?:\d+)?(?:時間|分|作品)$/.test(f) && /\d/.test(f)),
          )
        ) {
          return;
        }
        const rolePrefix = `section:${si}:p${pi}`;
        const related = input.assertions.filter((a) => a.sourceSegment === rolePrefix);
        const novelInPara = related.reduce((n, a) => n + (a.novelFacets?.length ?? 0), 0);
        const hasInference = related.some((a) =>
          ["EVALUATIVE", "INTERPRETIVE", "NAME_DERIVED", "UNSUPPORTED"].includes(a.supportType),
        );
        if (novelInPara === 0 && !hasInference) fullRestatementHits += 1;
      });
    });
    return fullRestatementHits;
  }

  const posts = input.artifact.posts?.map((p) => p.text) ?? [input.artifact.body];
  if (posts.length < 2) return 0;
  const first = extractTextFacets(posts[0] ?? "").filter((f) => f.length >= 3);
  let hits = 0;
  for (let i = 1; i < posts.length; i++) {
    const text = posts[i] ?? "";
    const overlap = first.filter((f) => text.includes(f)).length;
    if (overlap < 2) continue;
    const related = input.assertions.filter(
      (a) => a.sourceSegment === `post:${i}` || a.sourceSegment === `post:${i + 1}`,
    );
    const novel = related.reduce((n, a) => n + (a.novelFacets?.length ?? 0), 0);
    if (novel === 0) hits += 1;
  }
  return hits;
}

/**
 * Shadow reviewer: semantic assertion entailment + channel structural checks.
 * Information gain uses supportedNovelAssertionCount — not claim-count appearance.
 */
export function reviewArtifactShadow(
  input: {
    artifact: ReviewableArtifact;
    corePlan: CoreEditorialPlan;
    claimStatements: Array<{ id: string; statement: string; kind?: string }>;
    /**
     * OPTION B natural product intro: prioritize factual / no-repetition / readable intro
     * over maximizing information-gain coverage.
     */
    optionBNaturalIntro?: boolean;
    /**
     * Writer-visible source texts (e.g. officialDescription). Used to distinguish
     * source-supported promotional paraphrase from unsupported evaluative inference.
     */
    sourceTexts?: string[];
  },
  semanticReviewer: SemanticReviewerPort = defaultSemanticReviewer,
): EditorialReviewReport {
  const { artifact, corePlan, claimStatements } = input;
  const naturalIntro = input.optionBNaturalIntro === true;
  const informationGainFloor = naturalIntro
    ? optionBNaturalIntroInformationGainFloor()
    : Math.max(1, corePlan.informationGainTarget);
  const failures: EditorialFailure[] = [];
  const body =
    artifact.channel === "BLOG"
      ? [artifact.lead, ...artifact.sections.flatMap((s) => s.paragraphs), artifact.summary].join(
          "\n",
        )
      : [artifact.body, artifact.reply ?? ""].join("\n");

  const bodyUnits = units(body);
  const segments = artifactSegments(artifact);

  const semantic = semanticReviewer.review({
    segments,
    claims: claimStatements,
    allocatedClaimIds: corePlan.selectedClaimIds,
    sourceTexts: input.sourceTexts,
    optionBNaturalIntro: naturalIntro,
  });
  if (semantic instanceof Promise) {
    throw new Error("Async SemanticReviewerPort is not wired in Shadow; use deterministic reviewer");
  }

  const stats: SemanticReviewStats = semantic.stats;
  for (const code of semantic.failureCodes) {
    const samples = semantic.assertions
      .filter((a) => a.failureCodes.includes(code))
      .slice(0, 3)
      .map((a) => ({
        assertion: a.assertion.slice(0, 120),
        supportType: a.supportType,
        sourceSegment: a.sourceSegment,
        predicateFamilies: a.predicateFamilies,
        repetitionKind: a.repetitionKind,
      }));
    failures.push(
      toFailure(code, `Semantic assertion review: ${code}`, {
        sampleAssertions: samples,
        stats: {
          supportedNovelAssertionCount: stats.supportedNovelAssertionCount,
          unsupportedAssertionCount: stats.unsupportedAssertionCount,
        },
      }),
    );
  }

  const fullRestatementHits = detectFullRestatementAcrossSegments({
    artifact,
    assertions: semantic.assertions,
    optionBNaturalIntro: naturalIntro,
  });
  if (fullRestatementHits >= 1 && !failures.some((f) => f.code === "REPETITION")) {
    failures.push(
      toFailure(
        "REPETITION",
        `Full restatement across segments without novel gain (hits=${fullRestatementHits})`,
        { fullRestatementHits, classification: "FULL_RESTATEMENT" },
      ),
    );
  }

  if (stats.supportedNovelAssertionCount < informationGainFloor) {
    if (!failures.some((f) => f.code === "INFORMATION_GAIN_LOW")) {
      failures.push(
        toFailure(
          "INFORMATION_GAIN_LOW",
          `supportedNovelAssertionCount=${stats.supportedNovelAssertionCount} < informationGainFloor=${informationGainFloor}${
            naturalIntro ? " (OPTION_B_NATURAL_INTRO)" : ""
          }`,
          {
            supportedNovelAssertionCount: stats.supportedNovelAssertionCount,
            novelFacetCoverage: stats.novelFacetCoverage,
            informationGainTarget: corePlan.informationGainTarget,
            informationGainFloor,
            naturalIntro,
          },
        ),
      );
    }
  }

  if (artifact.channel === "BLOG") {
    // HARD: broken Japanese after redaction must never PASS (deterministic; no LLM)
    const integrity = validatePostTransformIntegrity({
      title: artifact.title,
      lead: artifact.lead,
      summary: artifact.summary,
      sections: artifact.sections,
    });
    for (const f of integrityFindingsAsBrainCodes(integrity)) {
      failures.push(toFailure(f.code, f.message));
    }

    if (SUMMARY_META_RE.test(artifact.summary)) {
      failures.push(toFailure("SUMMARY", "Summary uses meta-intro phrasing"));
    }
    if (OPENING_BOILER_RE.test(artifact.lead)) {
      failures.push(toFailure("OPENING", "Opening uses boilerplate intro"));
    }
    const last = artifact.sections[artifact.sections.length - 1];
    if (last && FILLER_RE.test(last.paragraphs.join("")) && last.paragraphs.join("").length < 80) {
      failures.push(toFailure("CTA", "CTA bridge looks like generic encouragement only"));
    }

    // Article-level sufficiency: repair/delete success ≠ publishable article
    const sufficiency = evaluateBlogArticleEditorialSufficiency({
      artifact,
      assertions: semantic.assertions,
      corePlan,
      claimStatements,
      naturalProductIntro: naturalIntro,
    });
    if (!sufficiency.ok && sufficiency.code) {
      if (!failures.some((f) => f.code === sufficiency.code)) {
        failures.push(toFailure(sufficiency.code, sufficiency.message, sufficiency.evidence));
      }
    }

    // Segment contribution compliance (plan required/forbidden facets)
    // OPTION B natural intro: do not hard-fail for "unused contribution coverage"
    if (!naturalIntro) {
      const openingIds = corePlan.openingDriverClaimIds;
      const developmentIds = corePlan.claimAllocation
        .filter((a) => a.role === "development" || a.role === "support")
        .map((a) => a.claimId);
      const selectedIds = corePlan.selectedClaimIds;
      const allocation = buildSegmentContributionAllocation({
        claims: claimStatements.map((c) => ({
          id: c.id,
          statement: c.statement,
          kind: c.kind,
        })),
        // Long title claims must remain decomposable even when listed only as opening
        openingClaimIds: openingIds.length ? openingIds : selectedIds,
        developmentClaimIds: [
          ...new Set([...developmentIds, ...selectedIds.filter((id) => !openingIds.includes(id))]),
        ],
        claimsAllowEvaluation: claimStatements.some((c) =>
          claimStatesEvaluativeRelation(c.statement),
        ),
      });
      if (allocation.insufficientDevelopmentMaterial) {
        if (!failures.some((f) => f.code === "INSUFFICIENT_SUPPORTED_MATERIAL")) {
          failures.push(
            toFailure(
              "INSUFFICIENT_SUPPORTED_MATERIAL",
              "BLOG_INSUFFICIENT_DEVELOPMENT_MATERIAL: no concrete body contributions after lead allocation",
              { reason: allocation.insufficientReason },
            ),
          );
        }
      } else {
        const compliance = validateContributionCompliance({
          article: {
            title: artifact.title,
            summary: artifact.summary,
            lead: artifact.lead,
            sections: artifact.sections,
          },
          allocation,
          claimsAllowEvaluation: claimStatements.some((c) =>
            claimStatesEvaluativeRelation(c.statement),
          ),
        });
        for (const f of compliance.findings) {
          if (!failures.some((x) => x.code === f.code)) {
            failures.push(toFailure(f.code, f.message, f.evidence));
          }
        }
      }
    }
  }

  if (artifact.channel === "X") {
    const firstLine = (artifact.body.split(/\n/)[0] ?? "").trim();
    if (firstLine.length < 6) {
      failures.push(toFailure("OPENING", "Weak first-line value for X"));
    }

    const titleRestatement = detectSourceTitleRestatement({
      body: artifact.body,
      sourceStatements: claimStatements.map((c) => c.statement),
    });
    if (titleRestatement.hit) {
      failures.push(
        toFailure(
          "SOURCE_TITLE_RESTATEMENT",
          "X post restates source title contributions without editorial selection/compression",
          titleRestatement.evidence,
        ),
      );
    }

    if (
      hasEvaluativeRelation(artifact.body) &&
      stats.evaluativeCount + stats.unsupportedAssertionCount > 0
    ) {
      if (!failures.some((f) => f.code === "EVALUATIVE_INFERENCE")) {
        failures.push(
          toFailure(
            "EVALUATIVE_INFERENCE",
            "X post uses unsupported evaluation/recommendation to create interest",
          ),
        );
      }
    }
    if (
      /すごい！|必見！|チェック！/.test(artifact.body) &&
      stats.supportedNovelAssertionCount <= 1
    ) {
      failures.push(toFailure("TEMPLATE_FATIGUE", "Generic promotional template feel with low detail"));
    }

    // Scarcity / insufficient concrete claims → defer rather than invent promo copy
    const concreteClaimCount = claimStatements.filter((c) => {
      const s = c.statement.trim();
      if (s.length > 80) return true;
      return !/メーカー|レーベル|配信状態|AVAILABLE|公開ページ上で確認できる|販売／配信/.test(s);
    }).length;
    if (concreteClaimCount === 0 || (corePlan.scarcityMode && stats.supportedNovelAssertionCount < 1)) {
      failures.push(
        toFailure(
          "INSUFFICIENT_SUPPORTED_MATERIAL",
          "Insufficient concrete SUPPORTED material for an editorial X post; defer rather than invent",
          { concreteClaimCount, scarcityMode: corePlan.scarcityMode },
        ),
      );
    }
  }

  const seen = new Set<string>();
  const deduped: EditorialFailure[] = [];
  for (const f of failures) {
    if (seen.has(f.code)) continue;
    seen.add(f.code);
    deduped.push(f);
  }

  const blocking = deduped.some((f) => f.severity === "BLOCKING");
  // Insufficient / catalog-only body: do not invent via repair — defer upstream.
  // CATALOG_NARRATION with scarcity (or no concrete development material left) is the same class.
  const insufficient = deduped.some(
    (f) =>
      f.code === "INSUFFICIENT_SUPPORTED_MATERIAL" ||
      (f.code === "CATALOG_NARRATION" &&
        (corePlan.scarcityMode ||
          !claimStatements.some(
            (c) =>
              !/メーカー|レーベル|配信状態|AVAILABLE|公開ページ上で確認できる|販売／配信/.test(
                c.statement,
              ),
          ))),
  );
  const decision: BrainDecision = !blocking
    ? "PASS"
    : insufficient
      ? "DEFER_INSUFFICIENT_MATERIAL"
      : "TARGETED_REPAIR";

  const gainScore = Math.min(
    1,
    stats.supportedNovelAssertionCount / Math.max(1, corePlan.informationGainTarget),
  );
  const axes = [
    {
      axis: "grounding",
      score: stats.nameDerivedCount + stats.unsupportedAssertionCount > 0 ? 0.25 : 0.85,
    },
    {
      axis: "inference",
      score:
        stats.evaluativeCount + stats.interpretiveCount + stats.nameDerivedCount > 0 ? 0.2 : 0.85,
    },
    {
      axis: "semantic_repetition",
      score: Math.max(0, 1 - stats.repetitionCount / 5),
    },
    { axis: "information_gain", score: gainScore },
    { axis: "filler", score: stats.fillerCount ? 0.4 : 0.9 },
    {
      axis: "length_independence",
      score: 1,
      notes: `bodyUnits=${bodyUnits} ignored as sole judge`,
    },
  ];

  return {
    decision,
    axes,
    failures: deduped,
    lengthWasNotSoleJudge: true,
    metrics: {
      uniqueSupportedDetailEstimate: stats.supportedNovelAssertionCount,
      supportedNovelAssertionCount: stats.supportedNovelAssertionCount,
      unsupportedAssertionCount: stats.unsupportedAssertionCount,
      semanticRepetitionHits: stats.repetitionCount + fullRestatementHits,
      fillerHits: stats.fillerCount,
      bodyUnits,
      assertionSupportStats: {
        ...stats,
        repetitionCount: stats.repetitionCount + (fullRestatementHits >= 1 ? 1 : 0),
      },
    },
    semanticAssertions: semantic.assertions,
  };
}
