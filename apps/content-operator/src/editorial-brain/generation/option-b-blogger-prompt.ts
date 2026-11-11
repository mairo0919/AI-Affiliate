/**
 * OPTION B Blogger channel — Writer realizes ARTICLE_PLAN as Japanese JSON.
 * Planner owns WHAT / FACT boundary; Writer owns natural prose + editorial interpretation.
 * R151: ARTICLE_PLAN_EXECUTION carries identity/relation safety — not prose templates.
 * CTA is system-appended (not Writer-generated).
 */

import {
  getOptionBBloggerArticleLlmJsonSchema,
  getOptionBBloggerArticleContractExample,
  OPTION_B_LLM_REQUIRED_KEYS,
} from "../../generation/structured-article.js";
import type { ArticleOutputContract } from "../../generation/article-output-contract.js";
import { applyArticleOutputContractToLlmSchema } from "../../generation/article-output-contract.js";
import { OPTION_B_WRITER_SYSTEM, WP_HEADLINE_SHAPE } from "../../article-pattern/natural-product-intro-policy.js";
import { formatWritingQualityGuidanceForWriter } from "./success-experience.js";

/**
 * Writer-visible ARTICLE_PLAN: keep facts/jobs; hide internal HOW taxonomy dumps.
 * bodyProgression / factSourceTypes stay Planner-internal (FACT safety uses EXECUTION.notAllowed).
 */
export function toWriterVisibleArticlePlan(plan: unknown): unknown {
  if (!plan || typeof plan !== "object") return plan;
  const p = plan as Record<string, unknown>;
  // FANZA genre tags stay on the post as taxonomy. Handed to the Writer as facts to cover, they
  // came back as data lines (「淫乱・ハード系のジャンルに属しています」, user review 2026-11-10).
  const slots = Array.isArray(p.body) ? (p.body as Array<Record<string, unknown>>) : [];
  const withoutGenreTags = (slot: Record<string, unknown>): unknown[] => {
    const facts = Array.isArray(slot.facts) ? slot.facts : [];
    const types = Array.isArray(slot.factSourceTypes) ? slot.factSourceTypes : [];
    return facts.filter((_, i) => types[i] !== "GENRE_TAG");
  };
  const dropGenreTags = slots.some((slot) => withoutGenreTags(slot).length > 0);
  const body = Array.isArray(p.body)
    ? slots.map((slot) => {
        const next = { ...slot };
        if (dropGenreTags) next.facts = withoutGenreTags(slot);
        delete next.factSourceTypes;
        // Keep presentationPurpose lightly if present — optional grouping hint only.
        return next;
      })
    : p.body;
  const out: Record<string, unknown> = {
    schemaVersion: p.schemaVersion,
    materialDepth: p.materialDepth,
    productTitle: p.productTitle,
    title: p.title
      ? {
          ...(typeof p.title === "object" && p.title ? (p.title as object) : {}),
          groundingOnly: true,
        }
      : p.title,
    lead: p.lead,
    body,
  };
  if (p.purpose) out.purpose = p.purpose;
  if (p.coreAngle) out.coreAngle = p.coreAngle;
  if (p.editorialDecision) out.editorialDecision = p.editorialDecision;
  if (p.seoSearchIntent && typeof p.seoSearchIntent === "object") {
    out.seoSearchIntent = p.seoSearchIntent;
  }
  // SOURCE density ceiling — length permission, not a paragraph template.
  if (p.sourceExpansion && typeof p.sourceExpansion === "object") {
    const se = p.sourceExpansion as Record<string, unknown>;
    out.sourceExpansion = {
      resolution: se.resolution,
      writerDensityNote: se.writerDensityNote,
    };
  }
  // Intentionally omit bodyProgression.writerNote / full progression dump from Writer surface.
  return out;
}

/** Slim EXECUTION for Writer: FACT safety fields only — no taxonomy lecture notes. */
export function toWriterVisibleExecution(execution: unknown): unknown {
  if (!Array.isArray(execution)) return execution;
  const isGenreTag = (row: unknown) =>
    Boolean(row && typeof row === "object" && (row as Record<string, unknown>).articleRole === "GENRE");
  const rows = execution.some((row) => !isGenreTag(row))
    ? execution.filter((row) => !isGenreTag(row))
    : execution;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const r = row as Record<string, unknown>;
    return {
      contributionId: r.contributionId,
      slot: r.slot,
      fact: r.fact,
      executionMode: r.executionMode,
      requiredAnchors: r.requiredAnchors,
      requiredRelations: r.requiredRelations,
      mustPreserve: r.mustPreserve,
      allowed: r.allowed,
      notAllowed: r.notAllowed,
      ...(r.informationAxis ? { informationAxis: r.informationAxis } : {}),
      ...(r.articleRole ? { articleRole: r.articleRole } : {}),
    };
  });
}

export function buildOptionBBloggerGeneratorPrompt(input: {
  productTitle: string;
  ctaUrl: string;
  articleFormat: string;
  generationAuthority: Record<string, unknown>;
  /** Optional bounded regen feedback only */
  planViolationNote?: string | null;
  /** r79 — section cardinality bound into embedded + returned schema */
  articleOutputContract?: ArticleOutputContract | null;
  /** Official blurb, so the writer understands how the planned facts relate. */
  officialDescription?: string | null;
  /** Findings from this work's earlier rejected versions. */
  priorReviewFindings?: string[] | null;
}): { systemInstruction: string; userPrompt: string; outputSchema: Record<string, unknown> } {
  const baseSchema = getOptionBBloggerArticleLlmJsonSchema();
  const outputSchema = applyArticleOutputContractToLlmSchema(
    baseSchema,
    input.articleOutputContract,
  );
  const example = getOptionBBloggerArticleContractExample();
  const required = OPTION_B_LLM_REQUIRED_KEYS.join(", ");
  const maxItems =
    input.articleOutputContract?.maxArticleSections ??
    (typeof (outputSchema as { properties?: { sections?: { maxItems?: number } } }).properties
      ?.sections?.maxItems === "number"
      ? (outputSchema as { properties: { sections: { maxItems: number } } }).properties.sections
          .maxItems
      : null);

  const planRaw =
    input.generationAuthority.ARTICLE_PLAN &&
    typeof input.generationAuthority.ARTICLE_PLAN === "object"
      ? input.generationAuthority.ARTICLE_PLAN
      : null;
  const plan = toWriterVisibleArticlePlan(planRaw);

  const executionRaw = Array.isArray(input.generationAuthority.ARTICLE_PLAN_EXECUTION)
    ? input.generationAuthority.ARTICLE_PLAN_EXECUTION
    : null;
  const execution = toWriterVisibleExecution(executionRaw);

  const qualityGuidanceText = formatWritingQualityGuidanceForWriter(
    input.generationAuthority.WRITING_QUALITY_GUIDANCE &&
      typeof input.generationAuthority.WRITING_QUALITY_GUIDANCE === "object"
      ? (input.generationAuthority.WRITING_QUALITY_GUIDANCE as Parameters<
          typeof formatWritingQualityGuidanceForWriter
        >[0])
      : null,
  );

  const systemInstruction = [
    OPTION_B_WRITER_SYSTEM,
    "Return ONLY one JSON object. No markdown code fences. No commentary.",
    `Required top-level fields: ${required}. Do not output cta — the system appends it.`,
    "Do not output a lead field. Do not output summary as article prose.",
    maxItems != null
      ? `sections: array with minItems=1 and maxItems=${maxItems}; heading string|null; paragraphs string[]; lists string[] (use [] if empty). Emit one section per ARTICLE_PLAN.body slot in order; optional heading may match the slot heading. First body paragraphs are the product overview.`
      : "sections: non-empty array; heading string|null; paragraphs string[]; lists string[] (use [] if empty). Emit one section per ARTICLE_PLAN.body slot in order. First body paragraphs are the product overview.",
    "If ARTICLE_PLAN.body is empty, emit one section with paragraphs:[] (no invented body facts).",
    "JSON Schema (structure only):",
    JSON.stringify(outputSchema),
    "Example JSON shape only (not style guidance):",
    JSON.stringify(example),
  ].join("\n");

  const correcting = Boolean(input.planViolationNote);
  const seoIntent =
    plan &&
    typeof plan === "object" &&
    "seoSearchIntent" in (plan as object) &&
    (plan as { seoSearchIntent?: unknown }).seoSearchIntent &&
    typeof (plan as { seoSearchIntent?: unknown }).seoSearchIntent === "object"
      ? ((plan as { seoSearchIntent: {
          status?: string;
          primaryQuery?: string;
          secondaryQueries?: string[];
          searchIntent?: string;
        } }).seoSearchIntent)
      : null;
  const seoBlock = seoIntent
    ? [
        "SEO_SEARCH_INTENT (locked; do not replace primaryQuery, secondaryQueries, or searchIntent):",
        JSON.stringify(seoIntent),
        seoIntent.status === "NO_NATURAL_QUERY" || !seoIntent.primaryQuery
          ? "No natural search query was found. Do not invent one."
          : [
              "This says what the reader came to confirm. It is not a fact source and not title authority.",
              "Do not repeat primaryQuery mechanically. Do not add a content word absent from ARTICLE_PLAN.",
              "Use primaryQuery in the title only when it states a fact already in ARTICLE_PLAN.",
              "seoTitle and metaDescription may differ from the headline, but must not change its meaning. Use planned facts only. Do not add evaluation, おすすめ, a viewing experience, or a scene that is not in the plan.",
            ].join(" "),
        correcting ? "Do not change the locked primaryQuery during correction." : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const userPrompt = [
    correcting
      ? "GROUNDED CORRECTION. Do not freely regenerate. Apply correctionPlan: keep KEEP sentences and mustKeep facts, repair REPAIR sentences from replaceWithFacts only, delete REMOVE sentences. Do not paraphrase an evaluation, recommendation, viewing experience, or editorial frame into another word of the same class. When correctionPlan.title.action is REPAIR, write a new headline in your own words from the facts in correctionPlan.title.titleAuthority. Do not join keywords with spaces."
      : `Write ARTICLE_PLAN as a natural Japanese product intro (${required}). productTitle in the plan is identity only — do not reuse 8 or more consecutive characters of productTitle in the title (performer names excepted); the article prints the official title separately.`,
    `outputChannel=BLOGGER articleFormat=${JSON.stringify(input.articleFormat)}`,
    "ARTICLE_PLAN (factual boundary — weave into prose; do not dump as taxonomy):",
    JSON.stringify(plan),
    input.officialDescription?.trim()
      ? [
          "OFFICIAL_DESCRIPTION (context only — read it to understand how the planned facts relate, then write in your own words. Do not copy its sentences: a sentence that carries 30 or more consecutive characters of it is rejected. Concrete facts still come from ARTICLE_PLAN):",
          input.officialDescription.trim(),
        ].join("\n")
      : "",
    input.priorReviewFindings?.length
      ? [
          "PRIOR_REVIEW_FINDINGS (an earlier article for this work was rejected for these; do not repeat them):",
          ...input.priorReviewFindings.map((line) => `- ${line}`),
        ].join("\n")
      : "",
    seoBlock,
    execution
      ? [
          "ARTICLE_PLAN_EXECUTION (FACT safety per contribution — obey executionMode / mustPreserve / notAllowed; do not invent):",
          JSON.stringify(execution),
          correcting
            ? `TITLE CORRECTION: ${WP_HEADLINE_SHAPE} ` +
              "Rewrite the headline in your own natural Japanese: who appears and what the work is about, stating only facts in titleAuthority (the planned facts). Paraphrase freely; do not string planned words or official-title fragments together, and do not borrow the official title's phrasing. Keep the performer name(s), the genre, and the setting as natural Japanese. Do not reuse 8 or more consecutive characters of productTitle (performer names excepted). Do not add evaluation or viewing copy (堪能, 味わう, 濃密, 禁断, 繰り広げる). HARD BAN: 「が魅せる」「が贈る」."
            : `TITLE: one natural Japanese headline in your own words that says who appears and what the work is about. ${WP_HEADLINE_SHAPE} ` +
              "State only facts in ARTICLE_PLAN (performer, work identity, series, campaign, premise, a work-specific feature); OFFICIAL_DESCRIPTION shows how they relate. editorialDecision is only a factual cut. title.facts are hints, not words to string together. Carry the words a searcher would type — performer name(s), the genre, the setting — as natural Japanese, not as a keyword list. Do not borrow the official title's phrasing. Do not reuse 8 or more consecutive characters of productTitle in the title (performer names excepted); the article prints the official title separately. Do not add editorial copy that is not in that authority (の世界, 繰り広げられる, 禁断, 濃密, 味わう, おすすめ). HARD BAN in title: 魅せる, が贈る, or 「注目は…｜」. Also forbidden: package-copy rephrase, performer+keyword glue, catalog shells.",
          correcting
            ? "On correction, do not write a new article. Copy KEEP. Restate REPAIR from replaceWithFacts as factual sentences. Delete REMOVE. Do not drop mustKeep facts. Other requiredFacts may be explained in your own words where they fit; do not paste them. Do not add a fact that is not in ARTICLE_PLAN."
            : [
                "articleRole on each execution target is WHO / WORK / PREMISE / FEATURE / FORMAT / VOLUME / SERIES / GENRE / SOURCE_ATTRIBUTED. Explain PREMISE and FEATURE as concrete prose. SOURCE_ATTRIBUTED wording stays attributed (公式では…と紹介されている) and is not your verdict.",
                "SEMANTIC_PRESERVE body: natural grammar that restates planned facts. No new concrete facts. No evaluation, recommendation, or claim that you watched or experienced the work. Combine related facts into coherent paragraphs.",
                "Write continuous adult product explanation. Weave short tags into what the work specifically contains — do not explain internal labels, and do not turn tags into a scene you were not given.",
                "Stop when the planned facts are covered. Do not close with おすすめ / 楽しめる / 味わえる / 見逃せません / 体験できる. Forbidden unless planned and attributed: external reputation/market claims (～で知られている / 売上No.1 / 大人気 / ファンから高評価).",
                "If ARTICLE_PLAN.sourceExpansion.writerDensityNote is present, obey it as a length/expansion ceiling. Stop when planned facts are naturally covered.",
              ].join("\n"),
        ].join("\n")
      : "",
    qualityGuidanceText
      ? [
          "WRITING_QUALITY_GUIDANCE (optional abstract HOW — not new facts; do not copy wording; do not override FACT boundary):",
          qualityGuidanceText,
        ].join("\n")
      : "",
    input.planViolationNote
      ? `Bounded regen (fix only listed violations; do not rewrite ARTICLE_PLAN): ${input.planViolationNote}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { systemInstruction, userPrompt, outputSchema };
}

/** Approximate UTF-8 byte length for prompt size regressions (LLM=0). */
export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
