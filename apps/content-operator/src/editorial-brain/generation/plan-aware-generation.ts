/**
 * Helpers for ArticlePlan compliance feedback + authority injection.
 */

import type { ArticlePlan } from "../../article-pattern/article-plan.js";
import { articlePlanAllFacts } from "../../article-pattern/article-plan.js";
import {
  blockingSemanticClaims,
  ungroundedTitleStems,
} from "../../article-pattern/article-semantic-claim.js";
import {
  articleSemanticRole,
  buildArticlePlanExecutionContract,
  buildPlanFactExecutionTarget,
  missingAnchorsInSentence,
  missingRelationsInSentence,
} from "../../article-pattern/plan-execution-contract.js";
import type {
  GroundedCorrectionPlan,
  PlanRegenViolation,
  PlanViolationFeedback,
} from "../../generation/generation-authority.js";
import type {
  ArticlePlanComplianceFinding,
  ArticlePlanComplianceResult,
} from "./article-plan-compliance.js";
import type { RawFailureRouting } from "./raw-failure-routing.js";
import { isFactRealized, resolveFactRealization } from "./plan-fact-matching.js";
import { splitIntoSentences } from "./text-surface.js";

export const MAX_PLAN_EXECUTION_ATTEMPTS = Math.max(
  1,
  Math.min(3, Number(process.env.BLOG_MAX_PLAN_ATTEMPTS ?? 3) || 3),
);

export const PLAN_REGEN_CORRECTION_INSTRUCTION =
  "GROUNDED CORRECTION, not a new article. Follow correctionPlan KEEP, REPAIR, and REMOVE. Content words may come only from requiredFacts, allowedSupportingFacts, titleAuthority, and Evidence words already in those facts. Particles and copulas may connect them. Do not invent an evaluation, recommendation, viewing experience, catch copy, interpretation, or a new work-specific content word. Do not paraphrase UNSUPPORTED_EVALUATION into another adjective, RECOMMENDATION into another recommendation, VIEWING_EXPERIENCE into another experience claim, or EDITORIAL_EMBELLISHMENT into another catch copy. Delete that meaning or restate the allowed fact as FACTUAL_DESCRIPTION. Do not drop a requiredFacts item whose mustKeep is true. Do not rewrite ARTICLE_PLAN.";

const CONTRASTIVE_REGEN_HINT =
  "Preserve concessive/contrastive relation (e.g. 言えど, ではあるものの, にもかかわらず) — do not replace with neutral copula (である) that removes the planned contrast.";

const EVAL_REGEN_HINT =
  "For PLAN_UNSUPPORTED_EVAL: REPAIR or REMOVE that sentence. Do not replace UNSUPPORTED_EVALUATION, RECOMMENDATION, VIEWING_EXPERIENCE, or EDITORIAL_EMBELLISHMENT with another word of the same class (印象的, 特徴的, 情熱的, 魅力, おすすめ, 楽しめる, 味わえる, 体験できる, 余すことなく). Restate allowedSupportingFacts only. Maker wording stays only as 公式では…と紹介されている.";

const OMISSION_REGEN_HINT =
  "For PLAN_FACT_OMISSION: realize each requiredFacts item whose coveredBySentence is null. Copy that fact's authority into the body when a paraphrase is unclear. Keep every item whose mustKeep is true. Do not change the agent, relation, or numbers, and do not add an evaluation.";

const TITLE_EDITORIAL_REGEN_HINT =
  "For title defects: emit correctionPlan.title.strongest, or the same authority words joined only by particles such as の. Do not concatenate those words into one token. Do not add a content word absent from titleAuthority. Do not join keywords with spaces. HARD BAN: never write 「が魅せる」「が贈る」.";

function regenInstructionForViolations(violations: PlanRegenViolation[]): string {
  const parts = [PLAN_REGEN_CORRECTION_INSTRUCTION];
  if (violations.some((v) => v.code === "PLAN_UNSUPPORTED_EVAL" || v.unsupportedSentence)) {
    parts.push(EVAL_REGEN_HINT);
  }
  if (violations.some((v) => v.code === "PLAN_FACT_OMISSION")) {
    parts.push(OMISSION_REGEN_HINT);
  }
  if (violations.some((v) => v.code === "PLAN_TITLE_EDITORIAL_QUALITY" || v.slot === "title")) {
    parts.push(TITLE_EDITORIAL_REGEN_HINT);
  }
  const needsContrastive = violations.some(
    (v) =>
      v.missingRelations?.includes("CONTRAST") ||
      /言えど|といえど/u.test(v.fact),
  );
  if (needsContrastive) parts.push(CONTRASTIVE_REGEN_HINT);
  return parts.join(" ");
}

const OMISSION_MESSAGE_PREFIX: Record<"title" | "lead" | "body", string> = {
  title: "title slot missing plan fact: ",
  lead: "lead slot missing plan fact: ",
  body: "body missing plan fact: ",
};

const SLOT_VIOLATION_PREFIX = "title plan fact realized only in body: ";

function slotPlanFacts(plan: ArticlePlan, slot: "title" | "lead" | "body"): string[] {
  if (slot === "title") return [...plan.title.facts];
  if (slot === "lead") return [...plan.lead.facts];
  return plan.body.flatMap((b) => b.facts);
}

/** Resolve full plan fact text from Compliance finding + ArticlePlan SSOT. */
export function resolvePlanFactForComplianceFinding(
  plan: ArticlePlan,
  finding: ArticlePlanComplianceFinding,
): string | null {
  const slot = finding.slot;
  if (slot !== "title" && slot !== "lead" && slot !== "body") return null;

  if (finding.code === "PLAN_FACT_OMISSION") {
    const prefix = OMISSION_MESSAGE_PREFIX[slot];
    if (!finding.message.startsWith(prefix)) return null;
    const snippet = finding.message.slice(prefix.length);
    const candidates = slotPlanFacts(plan, slot);
    return (
      candidates.find((f) => f === snippet) ??
      candidates.find((f) => f.startsWith(snippet)) ??
      (snippet.length > 0 ? snippet : null)
    );
  }

  if (finding.code === "PLAN_SLOT_VIOLATION" && slot === "title") {
    if (!finding.message.startsWith(SLOT_VIOLATION_PREFIX)) return null;
    const snippet = finding.message.slice(SLOT_VIOLATION_PREFIX.length);
    return (
      plan.title.facts.find((f) => f === snippet) ??
      plan.title.facts.find((f) => f.startsWith(snippet)) ??
      (snippet.length > 0 ? snippet : null)
    );
  }

  return null;
}

/** Build deduped structured violations for Writer regen — ArticlePlan facts are SSOT. */
export function buildStructuredPlanRegenViolations(
  plan: ArticlePlan,
  result: ArticlePlanComplianceResult,
  articleText?: { title?: string; lead?: string; body?: string },
): PlanRegenViolation[] {
  const seen = new Set<string>();
  const violations: PlanRegenViolation[] = [];
  const surfaceBlob = [articleText?.title, articleText?.lead, articleText?.body]
    .filter(Boolean)
    .join("\n");

  for (const finding of result.findings) {
    if (finding.severity !== "BLOCKING") continue;

    // Unsupported expansion / theme overreach — cite the offending sentence.
    if (
      finding.code === "PLAN_UNSUPPORTED_EVAL" ||
      finding.code === "PLAN_THEME_OVERREACH"
    ) {
      const unsupportedSentence = extractUnsupportedSentenceFromFinding(finding, articleText);
      const key = `${finding.code}::${unsupportedSentence ?? finding.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const planFacts = articlePlanAllFacts(plan);
      const claims = unsupportedSentence
        ? blockingSemanticClaims(unsupportedSentence, planFacts)
        : [];
      const allowedSupportingFacts = planFacts
        .filter((f) => {
          const anchors = buildPlanFactExecutionTarget(f, "body", 0).requiredAnchors;
          return anchors.some((a) => (unsupportedSentence ?? "").includes(a));
        })
        .slice(0, 6);
      violations.push({
        code: finding.code,
        slot: finding.slot ?? "body",
        fact: "",
        reason:
          finding.code === "PLAN_THEME_OVERREACH"
            ? "Short theme fact expanded beyond membership/attested surface — remove the invented psychology/role/plot meaning."
            : "Restate allowedSupportingFacts as FACTUAL_DESCRIPTION. Do not replace unsupportedMeaning with another word of the same violationType. Do not add a fact. Maker wording stays only as 公式では…と紹介されている.",
        unsupportedSentence: unsupportedSentence ?? undefined,
        violationType: claims[0]?.class ?? "UNSUPPORTED_EVALUATION",
        offendingSentence: unsupportedSentence ?? undefined,
        unsupportedMeaning:
          claims.map((c) => `${c.class}:${c.span}`).join("; ") || finding.message.slice(0, 180),
        allowedSupportingFacts,
      });
      continue;
    }

    if (
      finding.code !== "PLAN_FACT_OMISSION" &&
      finding.code !== "PLAN_SLOT_VIOLATION" &&
      finding.code !== "PLAN_TITLE_EDITORIAL_QUALITY" &&
      finding.code !== "PLAN_TITLE_INVENT"
    ) {
      continue;
    }

    if (finding.code === "PLAN_TITLE_EDITORIAL_QUALITY" || finding.code === "PLAN_TITLE_INVENT") {
      const key = `${finding.code}::${finding.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const titleAuthority = [
        ...plan.title.facts,
        ...plan.body.flatMap((b) => b.facts),
        plan.productTitle ?? "",
      ]
        .map((f) => f.trim())
        .filter(Boolean)
        .slice(0, 12);
      const title = articleText?.title ?? "";
      const stems = ungroundedTitleStems(title, titleAuthority);
      violations.push({
        code: finding.code,
        slot: "title",
        fact: "",
        reason:
          "Rewrite the title from titleAuthority only. Particles and word order may change. Do not add an editorial frame.",
        unsupportedSentence: title.slice(0, 120) || undefined,
        violationType: stems[0]?.class ?? "EDITORIAL_EMBELLISHMENT",
        offendingSentence: title.slice(0, 120) || undefined,
        unsupportedMeaning: stems.map((s) => `${s.class}:${s.span}`).join("; ") || finding.message.slice(0, 180),
        titleAuthority,
      });
      continue;
    }

    const fact = resolvePlanFactForComplianceFinding(plan, finding);
    if (!fact) continue;

    const slot = finding.slot ?? "article";
    const key = `${finding.code}::${slot}::${fact}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const execSlot =
      slot === "title" || slot === "lead" || slot === "body" ? slot : "body";
    const target = buildPlanFactExecutionTarget(fact, execSlot, 0);
    const probeText =
      (slot === "title"
        ? articleText?.title
        : slot === "lead"
          ? articleText?.lead
          : articleText?.body) ?? surfaceBlob;
    const missingRelations = missingRelationsInSentence(
      probeText ?? "",
      target.requiredRelations,
    );
    const missingAnchors = missingAnchorsInSentence(
      probeText ?? "",
      target.requiredAnchors,
    );

    violations.push({
      code: finding.code,
      slot,
      fact,
      reason:
        finding.code === "PLAN_SLOT_VIOLATION"
          ? "plan fact must be realized in assigned slot"
          : missingRelations.length > 0
            ? `missing plan fact / relation: ${missingRelations.join(",")}`
            : "Realize requiredFactCoverage. Keep the same agent, relation, and numbers. A natural paraphrase is enough. Do not add a fact or an evaluation.",
      missingAnchors: missingAnchors.length > 0 ? missingAnchors : undefined,
      missingRelations: missingRelations.length > 0 ? missingRelations : undefined,
      violationType: finding.code === "PLAN_FACT_OMISSION" ? "FACT_OMISSION" : finding.code,
      requiredFactCoverage: [fact],
      allowedSupportingFacts: [fact],
    });
  }

  return violations;
}

/** Pull the offending sentence from compliance finding message / article body. */
function extractUnsupportedSentenceFromFinding(
  finding: ArticlePlanComplianceFinding,
  articleText?: { title?: string; lead?: string; body?: string },
): string | null {
  const colon = finding.message.lastIndexOf(": ");
  if (colon >= 0) {
    const snippet = finding.message.slice(colon + 2).trim();
    if (snippet.length >= 8) {
      const body = articleText?.body ?? "";
      if (body && snippet.length < 80) {
        const hit = body
          .split(/(?<=[。！？\n])/)
          .map((s) => s.trim())
          .find((s) => s.includes(snippet.slice(0, Math.min(24, snippet.length))));
        if (hit && hit.length >= 8) return hit.slice(0, 240);
      }
      return snippet.slice(0, 240);
    }
  }
  return null;
}

function titleAuthorityOf(plan: ArticlePlan): string[] {
  return [...plan.title.facts, ...plan.body.flatMap((b) => b.facts), plan.productTitle ?? ""]
    .map((f) => f.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function strongestTitle(plan: ArticlePlan, authority: string[]): string {
  const clean = (f: string) => f.trim();
  const usable = authority.map(clean).filter((f) => f.length >= 2 && f.length <= 32 && !/[。！？]/.test(f));
  const titleFacts = plan.title.facts.map(clean).filter((f) => usable.includes(f) || (f.length >= 2 && f.length <= 32 && !/[。！？]/.test(f)));
  const names = usable.filter(
    (f) => /^[\u4e00-\u9fffぁ-んァ-ヶー]{2,8}$/u.test(f) && articleSemanticRole({ fact: f }) === "WHO",
  );
  const who = names
    .filter((n) => !names.some((other) => other !== n && other.includes(n)))
    .sort((a, b) => b.length - a.length)[0];
  const work = [...titleFacts, ...usable].find(
    (f) =>
      f !== who &&
      !/\s/u.test(f) &&
      f.length <= 24 &&
      articleSemanticRole({ fact: f }) !== "WHO" &&
      articleSemanticRole({ fact: f }) !== "VOLUME",
  );
  const series = usable.find((f) => articleSemanticRole({ fact: f }) === "SERIES" && !/\s/u.test(f));
  if (who && work && !work.includes(who)) return `${who}の${work}`.slice(0, 40);
  if (titleFacts[0] && !/[。！？]/.test(titleFacts[0])) return titleFacts[0].slice(0, 40);
  if (series && work) return `${series}の${work}`.slice(0, 40);
  if (work) return work;
  return usable[0]?.slice(0, 32) ?? "";
}

function sentenceCoversFact(sentence: string, fact: string): boolean {
  return isFactRealized(resolveFactRealization(sentence, fact, { padBearing: false }).status);
}

/** Correction plan for the production rewrite call. Does not change Review. */
export function buildGroundedCorrectionPlan(
  plan: ArticlePlan,
  articleText?: { title?: string; lead?: string; body?: string },
  titleNeedsRepair = false,
): GroundedCorrectionPlan {
  const authority = titleAuthorityOf(plan);
  const body = [articleText?.lead, articleText?.body].filter(Boolean).join("\n");
  const sentences = splitIntoSentences(body).map((s) => s.trim()).filter((s) => s.length >= 8);
  const facts = articlePlanAllFacts(plan);
  const keep: GroundedCorrectionPlan["keep"] = [];
  const repair: GroundedCorrectionPlan["repair"] = [];
  const remove: GroundedCorrectionPlan["remove"] = [];

  for (const sentence of sentences) {
    const claims = blockingSemanticClaims(sentence, facts);
    const covered = facts.filter((f) => sentenceCoversFact(sentence, f));
    if (claims.length === 0) {
      if (covered.length > 0) keep.push({ sentence: sentence.slice(0, 240), facts: covered.slice(0, 6) });
      continue;
    }
    const violationType = claims[0]?.class ?? "UNSUPPORTED_EVALUATION";
    const unsupportedMeaning = claims.map((c) => `${c.class}:${c.span}`).join("; ");
    if (covered.length === 0) {
      remove.push({ sentence: sentence.slice(0, 240), violationType, unsupportedMeaning });
      continue;
    }
    repair.push({
      sentence: sentence.slice(0, 240),
      violationType,
      unsupportedMeaning,
      replaceWithFacts: covered.slice(0, 4),
    });
  }

  let targets: ReturnType<typeof buildArticlePlanExecutionContract> = [];
  try {
    targets = buildArticlePlanExecutionContract(plan);
  } catch {
    targets = [];
  }
  const requiredFacts: GroundedCorrectionPlan["requiredFacts"] = [];
  const seenFact = new Set<string>();
  for (const target of targets) {
    if (target.slot === "title") continue;
    const fact = target.fact.trim();
    if (!fact || seenFact.has(fact)) continue;
    seenFact.add(fact);
    const coveredBy = sentences.find((s) => sentenceCoversFact(s, fact)) ?? null;
    requiredFacts.push({
      factId: target.contributionId,
      fact,
      articleRole: articleSemanticRole({
        fact,
        sourceFactType: target.sourceFactType,
        informationAxis: target.informationAxis,
      }),
      authority: fact,
      coveredBySentence: coveredBy ? coveredBy.slice(0, 180) : null,
      mustKeep: coveredBy != null,
    });
  }
  const titleBlocked =
    titleNeedsRepair || ungroundedTitleStems(articleText?.title ?? "", authority).length > 0;
  return {
    mode: "GROUNDED_CORRECTION",
    keep: keep.slice(0, 8),
    repair: repair.slice(0, 6),
    remove: remove.slice(0, 6),
    title: {
      action: titleBlocked ? "REPAIR" : "KEEP",
      current: (articleText?.title ?? "").slice(0, 80),
      titleAuthority: authority,
      strongest: strongestTitle(plan, authority),
    },
    requiredFacts: [
      ...requiredFacts.filter((f) => !f.mustKeep),
      ...requiredFacts.filter((f) => f.mustKeep),
    ].slice(0, 16),
  };
}

export function buildArticlePlanViolationFeedback(
  attempt: number,
  result: ArticlePlanComplianceResult,
  routing?: RawFailureRouting | null,
  articlePlan?: ArticlePlan | null,
  articleText?: { title?: string; lead?: string; body?: string },
): PlanViolationFeedback {
  const violations =
    articlePlan != null
      ? buildStructuredPlanRegenViolations(articlePlan, result, articleText)
      : [];
  const titleNeedsRepair = result.findings.some(
    (f) =>
      f.severity === "BLOCKING" &&
      (f.code === "PLAN_TITLE_INVENT" ||
        f.code === "PLAN_TITLE_EDITORIAL_QUALITY" ||
        f.code === "PLAN_TITLE_SURFACE"),
  );
  const correctionPlan =
    articlePlan != null
      ? buildGroundedCorrectionPlan(articlePlan, articleText, titleNeedsRepair)
      : undefined;

  return {
    attempt,
    violatedSegments: result.violatedSlots,
    missingRequiredContributionIds: result.missingPlanFacts,
    forbiddenReusedContributionIds: [],
    prematurelyConsumedContributionIds: [],
    codes: [...new Set(result.findings.filter((f) => f.severity === "BLOCKING").map((f) => f.code))],
    consumedContributionFacets: [],
    semanticReuseFamilies: [],
    failureClass: routing?.failureClass ?? undefined,
    failureSignature: result.failureSignature ?? undefined,
    note: [
      "Bounded regen — fix only listed violations.",
      "Realize any omitted ARTICLE_PLAN facts in assigned slots.",
      "If unsupportedSentence is an evaluation, recommendation, viewing-experience claim, or external factual claim, delete that claim and keep the planned facts. Do not add a new evaluation or a new fact.",
      "Coverage of planned facts is required. Do not add a review ending.",
    ].join(" "),
    violations: violations.length > 0 ? violations : undefined,
    instruction:
      violations.length > 0 ? regenInstructionForViolations(violations) : undefined,
    correctionPlan,
  };
}

/** Serialize Writer-visible regen note — includes structured violations when present. */
export function buildPlanViolationRegenNote(feedback: PlanViolationFeedback): string {
  if (feedback.violations?.length) {
    return JSON.stringify({
      codes: feedback.codes,
      violatedSegments: feedback.violatedSegments,
      correctionPlan: feedback.correctionPlan,
      violations: feedback.violations,
      instruction: feedback.instruction ?? PLAN_REGEN_CORRECTION_INSTRUCTION,
    });
  }
  return JSON.stringify({
    codes: feedback.codes,
    violatedSegments: feedback.violatedSegments,
    note: feedback.note,
  });
}

const OPTION_B_BANNER = [
  "GENERATION AUTHORITY (SSOT OPTION B — ARTICLE_PLAN first):",
  "1) ARTICLE_PLAN 2) FACTUAL/SAFETY 3) CLAIM_ALLOWLIST.",
  "Realize ArticlePlan slot facts. Never invent concrete facts absent from the plan.",
].join(" ");

export function ensureGenerationAuthorityInUserPrompt(
  userPrompt: string,
  generationAuthority: Record<string, unknown>,
): string {
  const authJson = JSON.stringify(generationAuthority);
  if (
    userPrompt.includes("generationAuthority=") &&
    userPrompt.includes("ARTICLE_PLAN") &&
    !/generationAuthority=\s*($|\n)/.test(userPrompt)
  ) {
    return userPrompt;
  }
  if (userPrompt.includes("generationAuthority={{generationAuthority}}")) {
    return userPrompt.replace(
      "generationAuthority={{generationAuthority}}",
      `generationAuthority=${authJson}`,
    );
  }
  return `${userPrompt}\n\ngenerationAuthority=${authJson}`;
}

export function ensureGenerationAuthorityInSystem(systemInstruction: string): string {
  if (systemInstruction.includes("GENERATION AUTHORITY (SSOT")) {
    if (systemInstruction.includes("OPTION B") && systemInstruction.includes("ARTICLE_PLAN")) {
      return systemInstruction;
    }
    return systemInstruction.replace(/GENERATION AUTHORITY \(SSOT[^\n]*/, OPTION_B_BANNER);
  }
  return `${OPTION_B_BANNER}\n${systemInstruction}`;
}

/** R147 — minimal per-attempt diagnostic (no full system prompt / PII). */
export type GenerationAttemptTrace = {
  attempt: number;
  writerOutput: {
    title: string;
    lead: string;
    summary: string;
    bodyParagraphCount: number;
    bodyPreview: string;
  };
  complianceFindings: Array<{ code: string; slot?: string; message: string }>;
  factRealizationSummary: Array<{
    fact: string;
    title: string;
    lead: string;
    body: string;
  }>;
  regenInput: PlanViolationFeedback | null;
  regenOutputOrNextFeedback: PlanViolationFeedback | null;
};

export function buildGenerationAttemptTrace(input: {
  attempt: number;
  article: {
    title: string;
    lead: string;
    summary?: string;
    sections: Array<{ paragraphs: string[] }>;
  };
  articlePlan: ArticlePlan;
  compliance: { findings: Array<{ code: string; message: string; slot?: string }> };
  regenInput: PlanViolationFeedback | null;
  regenOutputOrNextFeedback: PlanViolationFeedback | null;
}): GenerationAttemptTrace {
  const bodyText = input.article.sections.flatMap((s) => s.paragraphs).join("\n");
  const facts = articlePlanAllFacts(input.articlePlan).slice(0, 12);
  return {
    attempt: input.attempt,
    writerOutput: {
      title: input.article.title,
      lead: input.article.lead,
      summary: input.article.summary ?? "",
      bodyParagraphCount: input.article.sections.reduce((n, s) => n + s.paragraphs.length, 0),
      bodyPreview: bodyText.slice(0, 400),
    },
    complianceFindings: input.compliance.findings.map((f) => ({
      code: f.code,
      slot: f.slot,
      message: f.message.slice(0, 120),
    })),
    factRealizationSummary: facts.map((fact) => ({
      fact: fact.slice(0, 60),
      title: resolveFactRealization(input.article.title, fact).status,
      lead: resolveFactRealization(input.article.lead, fact).status,
      body: resolveFactRealization(bodyText, fact).status,
    })),
    regenInput: input.regenInput,
    regenOutputOrNextFeedback: input.regenOutputOrNextFeedback,
  };
}
