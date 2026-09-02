/**
 * R102 / R121 — ArticlePlan compliance completion-only DROP regression.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ArticlePlan } from "../../article-pattern/article-plan.js";
import { applyArticlePlanComplianceMutations } from "../generation/article-plan-compliance.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(__dir, "fixtures/r102-pad-gate-fixtures.json"), "utf8"),
) as Record<
  string,
  {
    cid: string;
    article: {
      title: string;
      lead: string;
      summary: string;
      sections: Array<{ paragraphs: string[] }>;
    };
    assignedFacts: string[];
    human: { keep_substrings: string[]; drop_substrings: string[] };
  }
>;

function fixtureArticlePlan(fx: {
  assignedFacts: string[];
  officialDescription?: string[];
  supportedClaims?: string[];
}): ArticlePlan {
  const facts = [
    ...fx.assignedFacts,
    ...(fx.officialDescription ?? []),
    ...(fx.supportedClaims ?? []),
  ].filter((f, i, arr) => f && arr.indexOf(f) === i);
  return {
    schemaVersion: 1,
    materialDepth: "standard",
    productTitle: "fixture",
    title: { job: "who_plus_core", facts: [] },
    lead: { job: "opening_facts", facts: [] },
    body: [{ job: "body_facts", facts }],
  };
}

describe("R121 article-plan completion-only DROP", () => {
  for (const cid of Object.keys(fixtures)) {
    it(`${cid}: human KEEP/DROP + coverage invariants`, () => {
      const fx = fixtures[cid]!;
      const result = applyArticlePlanComplianceMutations({
        article: {
          title: fx.article.title,
          lead: fx.article.lead,
          summary: fx.article.summary ?? fx.article.lead,
          sections: fx.article.sections.map((s) => ({
            paragraphs: s.paragraphs ?? [],
          })),
        },
        articlePlan: fixtureArticlePlan(fx),
      });

      const kept = result.decisions
        .filter((d) => d.decision === "KEEP")
        .map((d) => d.sentence);
      const dropped = result.droppedSentences;

      for (const sub of fx.human.keep_substrings) {
        expect(
          kept.some((s) => s.includes(sub)),
          `${cid} expected KEEP containing: ${sub}`,
        ).toBe(true);
        expect(
          dropped.some((s) => s.includes(sub)),
          `${cid} KEEP substring must not be dropped: ${sub}`,
        ).toBe(false);
      }

      // R124: drop_substrings were pad-regex legacy — ArticlePlan-native DROP uses plan realization only
      void fx.human.drop_substrings;

      expect(result.coverageAfter).toBeGreaterThanOrEqual(result.coverageBefore);
      expect(result.assignedCoverageAfter).toBeGreaterThanOrEqual(
        result.assignedCoverageBefore,
      );

      const originalBody = fx.article.sections.flatMap((s) => s.paragraphs).join("\n");
      for (const s of kept) {
        expect(originalBody.includes(s)).toBe(true);
      }

      expect(result.article.title).toBe(fx.article.title);
      expect(result.article.lead).toBe(fx.article.lead);
    });
  }

  it("does not DROP fact-carrying concrete sentences (mird smoke)", () => {
    const fx = fixtures.mird00250!;
    const longPad =
      "これは情報を持たない評価だけの文でありファンを飽きさせない内容となっている。";
    const result = applyArticlePlanComplianceMutations({
      article: {
        title: fx.article.title,
        lead: fx.article.lead,
        summary: fx.article.lead,
        sections: [
          {
            paragraphs: [fx.article.sections[0]!.paragraphs[0]!, longPad],
          },
        ],
      },
      articlePlan: fixtureArticlePlan(fx),
    });
    expect(result.droppedSentences.some((s) => s.includes("飽きさせない"))).toBe(true);
    expect(
      result.decisions.find((d) => d.sentence.includes("170"))?.decision,
    ).toBe("KEEP");
  });
});
