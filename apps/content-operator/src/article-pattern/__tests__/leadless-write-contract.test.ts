/**
 * Leadless write contract — Planner/Writer/formatter/WP route (LLM=0).
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  claimStatementsFromPageEvidence,
} from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import { buildArticlePlanExecutionContract } from "../plan-execution-contract.js";
import {
  toWriterVisibleArticlePlan,
  stripArticleLeadKey,
  articleHasLeadKey,
} from "../leadless-article.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import {
  OPTION_B_LLM_REQUIRED_KEYS,
  fillOptionBArticleDefaults,
  getOptionBBloggerArticleLlmJsonSchema,
  parseBloggerArticle,
  structuredToPlainBody,
  applyOptionBDeterministicCta,
} from "../../generation/structured-article.js";
import { OPTION_B_WRITER_SYSTEM } from "../natural-product-intro-policy.js";
import { formatBloggerHtml } from "../../generation/blogger-formatter.js";
import { buildWordPressHtmlFromVersion } from "../../wordpress/wordpress-publish-path.js";
import type { PageEvidenceMetaShape } from "../official-page-evidence-atoms.js";

const OFJE_DESC =
  "AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中！円熟した濃厚なセックスとエロポテンシャル、低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾。今回は彼女の最新12タイトル、なお且つ全コーナーを収録した豪華でスペシャルなベスト版です。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です！！！";

function ofjePlan() {
  const pe = {
    description: { text: OFJE_DESC },
    actors: ["奥田咲"],
  } as PageEvidenceMetaShape;
  const statements = claimStatementsFromPageEvidence({
    pageEvidenceMeta: pe,
    productTitle: "ofje00230",
    actors: pe.actors,
  });
  const pack = buildEvidencePack({
    productTitle: "ofje00230",
    claims: statements.slice(0, 8).map((s, i) => ({
      id: `c${i}`,
      statement: s,
      status: "SUPPORTED" as const,
    })),
    pageEvidenceMeta: pe,
  });
  const profile = buildProductMaterialProfileFromPack(pack);
  const feas = ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
  const plan = buildArticlePlan({
    productTitle: "ofje00230",
    pack,
    assignment: feas.assignment,
    materialDepth: profile.materialDepth,
    profile,
  });
  return { plan, pack, profile };
}

describe("leadless write contract", () => {
  it("opening materials merge into body; plan.lead.facts empty", () => {
    const { plan } = ofjePlan();
    expect(plan.lead.facts).toEqual([]);
    const body = plan.body.flatMap((b) => b.facts);
    expect(body.length).toBeGreaterThan(0);
    // Former lead-class overview material should be present in body.
    expect(
      body.some((f) => /グラマラス|奥田咲|ベスト第6弾|低身長|人妻|NTR|12タイトル/.test(f)),
    ).toBe(true);
  });

  it("Writer-visible plan omits lead key; EXEC has no lead slots", () => {
    const { plan } = ofjePlan();
    const visible = toWriterVisibleArticlePlan(plan as unknown as Record<string, unknown>);
    expect(articleHasLeadKey(visible)).toBe(false);
    const auth = buildOptionBGenerationAuthority({
      articlePlan: plan as unknown as Record<string, unknown>,
    });
    expect(articleHasLeadKey(auth.ARTICLE_PLAN)).toBe(false);
    const exec = buildArticlePlanExecutionContract(plan);
    expect(exec.every((t) => t.slot !== "lead")).toBe(true);
  });

  it("LLM schema/required keys have no lead; defaults strip lead and do not invent from summary", () => {
    expect(OPTION_B_LLM_REQUIRED_KEYS).not.toContain("lead");
    const schema = getOptionBBloggerArticleLlmJsonSchema();
    expect((schema.properties as Record<string, unknown>).lead).toBeUndefined();
    expect(OPTION_B_WRITER_SYSTEM).toMatch(/No separate lead field|Do not output a lead field/);
    const filled = fillOptionBArticleDefaults({
      title: "タイトル",
      lead: "これはlead",
      summary: "summaryだけ",
      sections: [{ paragraphs: ["本文概要です。"] }],
    });
    expect(articleHasLeadKey(filled)).toBe(false);
    expect(filled.summary).toBe("summaryだけ");
  });

  it("parse + persist path strips lead; plain body has no lead line", () => {
    const parsed = parseBloggerArticle(
      fillOptionBArticleDefaults(
        applyOptionBDeterministicCta(
          {
            title: "奥田咲 ベスト",
            lead: "誤って出たlead",
            sections: [{ paragraphs: ["概要段落。", "詳細段落。"] }],
          },
          "https://example.invalid/p",
        ),
      ),
    );
    const stripped = stripArticleLeadKey(parsed as unknown as Record<string, unknown>);
    expect(articleHasLeadKey(stripped)).toBe(false);
    const plain = structuredToPlainBody(stripped as never);
    expect(plain).not.toContain("誤って出たlead");
    expect(plain).toContain("概要段落。");
  });

  it("formatter goes Hero → Body; WP accepts leadless article", () => {
    const html = formatBloggerHtml({
      title: "t",
      sections: [{ paragraphs: ["本文のみ"] }],
      cta: { label: "cta", url: "https://example.invalid/p" },
      images: [
        {
          role: "hero",
          sourceUrl: "https://example.invalid/hero.jpg",
          imageType: "main_large",
          alt: "a",
          researchImageId: "h",
          usageStatus: "REQUIRES_CONFIRMATION",
          provenance: "research_image",
          displayMode: "url_reference",
        },
      ],
    });
    expect(html.indexOf("hero.jpg")).toBeLessThan(html.indexOf("本文のみ"));
    expect(html).not.toMatch(/リード/);

    const wp = buildWordPressHtmlFromVersion({
      title: "t",
      summary: "seo summary must not become lead",
      structuredContent: {
        article: {
          title: "t",
          summary: "seo summary must not become lead",
          sections: [{ paragraphs: ["本文のみ"] }],
          cta: { label: "商品ページを見る", url: "https://example.invalid/p" },
        },
      },
      ctaUrl: "https://example.invalid/p",
    });
    expect(wp.lead).toBe("");
    expect(wp.html).toContain("本文のみ");
    expect(wp.html).not.toContain("seo summary must not become lead");
  });

  it("legacy lead article remains readable via formatter/WP", () => {
    const html = formatBloggerHtml({
      title: "t",
      lead: "旧lead",
      sections: [{ paragraphs: ["本文"] }],
      cta: { label: "cta", url: "https://example.invalid/p" },
    });
    expect(html).toContain("旧lead");
    const wp = buildWordPressHtmlFromVersion({
      title: "t",
      summary: null,
      structuredContent: {
        article: {
          title: "t",
          lead: "旧lead",
          sections: [{ paragraphs: ["本文"] }],
          cta: { label: "cta", url: "https://example.invalid/p" },
        },
      },
      ctaUrl: "https://example.invalid/p",
    });
    expect(wp.lead).toBe("旧lead");
    expect(wp.html).toContain("旧lead");
  });
});
