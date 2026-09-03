/**
 * R124 — ArticlePlan-native compliance (OPTION B Blogger SSOT).
 *
 * VERIFY against ArticlePlan facts/slots/realization only.
 * On OPTION B generation path: validate → REGENERATE / DEFER (no prose rewrite).
 * Legacy applyArticlePlanComplianceMutations remains available for LEGACY_ONLY callers.
 */

import type { ArticlePlan } from "../../article-pattern/article-plan.js";
import { articlePlanAllFacts } from "../../article-pattern/article-plan.js";
import {
  hasShortThemeSemanticOverreach,
  hasUnsupportedEvaluativeResidue,
  isPureUnsupportedEvaluativePadding,
} from "../../article-pattern/plan-surface-attestation.js";
import { validateTitleSurfaceRealization } from "../../article-pattern/title-eligibility.js";
import { splitIntoSentences } from "./text-surface.js";
import type { RawFailureRouting } from "./raw-failure-routing.js";
import {
  assignedCoverageKeys,
  concreteCoverageKeys,
  hasConcreteSurface,
  isFactRealized,
  isWeakPlanFact,
  paraphraseHit,
  resolveFactRealization,
  setUnion,
  uniqueIn,
  writerVisiblePlanFacts,
} from "./plan-fact-matching.js";

export type ArticlePlanComplianceArticle = {
  title: string;
  summary: string;
  /** Legacy-only; empty/absent on leadless writes. */
  lead?: string;
  sections: Array<{ heading?: string | null; paragraphs: string[]; lists?: string[] }>;
  cta?: { label?: string; url?: string };
};

export type ArticlePlanComplianceCode =
  | "PLAN_FACT_OMISSION"
  | "PLAN_SLOT_VIOLATION"
  | "PLAN_NO_PROGRESSION"
  | "PLAN_UNPLANNED_CONCRETE"
  | "PLAN_UNPLANNED_MEANING"
  | "PLAN_THEME_OVERREACH"
  | "PLAN_UNSUPPORTED_EVAL"
  | "PLAN_TITLE_INVENT"
  | "PLAN_TITLE_SURFACE";

export type ArticlePlanComplianceFinding = {
  code: ArticlePlanComplianceCode | string;
  message: string;
  severity: "BLOCKING" | "WARNING" | "INFO";
  slot?: "title" | "lead" | "body" | "article";
};

export type ArticlePlanComplianceResult = {
  ok: boolean;
  planExecutionFailed: boolean;
  structuralDefect: boolean;
  findings: ArticlePlanComplianceFinding[];
  violatedSlots: string[];
  missingPlanFacts: string[];
  failureSignature: string | null;
  bodyOnlyRestatesLead: boolean;
};

export type ArticlePlanSentenceDecision = {
  sentence: string;
  decision: "KEEP" | "DROP";
  reason: string;
};

export type ArticlePlanComplianceMutationResult = {
  article: ArticlePlanComplianceArticle;
  decisions: ArticlePlanSentenceDecision[];
  droppedSentences: string[];
  coverageBefore: number;
  coverageAfter: number;
  assignedCoverageBefore: number;
  assignedCoverageAfter: number;
  mutated: boolean;
};

/** Concrete scene stems — used only to detect plan-unbacked concrete additions. */
const CONCRETE_STEM_RE =
  /杭打ち|逆3P|逆5P|手コキ|腿コキ|アナル舐め|射精|専属第二弾|性感|12タイトル|ベスト第6弾|回春エステ|催●|学芸員|コインランドリー|ピストン|170cm|痴女|犯される|攻め立て|ガニ股|バレー/g;

function slotText(article: ArticlePlanComplianceArticle, slot: "title" | "lead" | "body"): string {
  if (slot === "title") return article.title;
  if (slot === "lead") return article.lead ?? "";
  return article.sections.flatMap((s) => s.paragraphs).join("\n");
}

function factRealizedIn(text: string, fact: string): boolean {
  return isFactRealized(resolveFactRealization(text, fact, { padBearing: false }).status);
}

function factExactlyIn(text: string, fact: string): boolean {
  return resolveFactRealization(text, fact, { padBearing: false }).status === "EXACT";
}

function realizedPlanFacts(text: string, facts: string[]): string[] {
  return facts.filter((f) => !isWeakPlanFact(f) && factRealizedIn(text, f));
}

/** All plan facts REALIZED (EXACT|SEMANTIC) in text — weak facts included for mutation safety. */
function realizedFactKeys(text: string, facts: string[]): Set<string> {
  const keys = new Set<string>();
  for (const fact of facts) {
    if (factRealizedIn(text, fact)) keys.add(fact);
  }
  return keys;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

type RealizationSnapshot = {
  global: Set<string>;
  bodySlot: Set<string>;
};

function snapshotPlannedRealization(
  fixed: string,
  bodySentences: string[],
  allFacts: string[],
  bodySlotFacts: string[],
): RealizationSnapshot {
  const bodyText = bodySentences.join("\n");
  const globalBlob = [fixed, bodyText].filter(Boolean).join("\n");
  return {
    global: realizedFactKeys(globalBlob, allFacts),
    bodySlot: realizedFactKeys(bodyText, bodySlotFacts),
  };
}

/** DROP safe only when removing the sentence preserves all planned fact realizations. */
function dropPreservesPlannedRealization(
  fixed: string,
  bodySentences: string[],
  dropAt: number,
  allFacts: string[],
  bodySlotFacts: string[],
): boolean {
  const before = snapshotPlannedRealization(fixed, bodySentences, allFacts, bodySlotFacts);
  const afterBody = bodySentences.filter((_, j) => j !== dropAt);
  const after = snapshotPlannedRealization(fixed, afterBody, allFacts, bodySlotFacts);
  return setsEqual(before.global, after.global) && setsEqual(before.bodySlot, after.bodySlot);
}

function checkOmissions(
  plan: ArticlePlan,
  article: ArticlePlanComplianceArticle,
): ArticlePlanComplianceFinding[] {
  const findings: ArticlePlanComplianceFinding[] = [];

  for (const fact of plan.title.facts) {
    if (isWeakPlanFact(fact)) continue;
    if (!factRealizedIn(article.title, fact)) {
      findings.push({
        code: "PLAN_FACT_OMISSION",
        message: `title slot missing plan fact: ${fact.slice(0, 80)}`,
        severity: "BLOCKING",
        slot: "title",
      });
    }
  }

  for (const fact of plan.lead?.facts ?? []) {
    if (isWeakPlanFact(fact)) continue;
    if (!factRealizedIn(article.lead ?? "", fact)) {
      findings.push({
        code: "PLAN_FACT_OMISSION",
        message: `lead slot missing plan fact: ${fact.slice(0, 80)}`,
        severity: "BLOCKING",
        slot: "lead",
      });
    }
  }

  const bodyText = slotText(article, "body");
  for (const fact of plan.body.flatMap((b) => b.facts)) {
    if (isWeakPlanFact(fact)) continue;
    if (!factRealizedIn(bodyText, fact)) {
      findings.push({
        code: "PLAN_FACT_OMISSION",
        message: `body missing plan fact: ${fact.slice(0, 80)}`,
        severity: "BLOCKING",
        slot: "body",
      });
    }
  }

  return findings;
}

function checkSlotFidelity(
  plan: ArticlePlan,
  article: ArticlePlanComplianceArticle,
): ArticlePlanComplianceFinding[] {
  const findings: ArticlePlanComplianceFinding[] = [];
  const bodyText = slotText(article, "body");

  for (const fact of plan.title.facts) {
    if (isWeakPlanFact(fact)) continue;
    if (!factRealizedIn(article.title, fact) && factExactlyIn(bodyText, fact)) {
      findings.push({
        code: "PLAN_SLOT_VIOLATION",
        message: `title plan fact realized only in body: ${fact.slice(0, 60)}`,
        severity: "BLOCKING",
        slot: "title",
      });
    }
  }

  return findings;
}

const TITLE_STRUCTURAL_GLUE_RE =
  /^(?:作品|ベスト|版|編|出演|収録|記念|特集|コレクション)$/u;

/**
 * Title must realize only title.facts surfaces (Plan authority).
 * Body-plan material must not spill into title (ssis 究極ピストン case).
 */
function checkTitleAuthority(
  plan: ArticlePlan,
  article: ArticlePlanComplianceArticle,
): ArticlePlanComplianceFinding[] {
  const findings: ArticlePlanComplianceFinding[] = [];
  const title = (article.title ?? "").trim();
  if (!title) return findings;

  const surface = validateTitleSurfaceRealization(title);
  for (const code of surface.codes) {
    findings.push({
      code: "PLAN_TITLE_SURFACE",
      message: `title surface defect ${code}: ${title.slice(0, 80)}`,
      severity: "BLOCKING",
      slot: "title",
    });
  }

  const allowed = [...plan.title.facts, plan.productTitle ?? ""].map((f) => f.trim()).filter(Boolean);
  const allowedBlob = allowed.join("");
  const runs = title.match(/[\u4e00-\u9fffァ-ヶーA-Za-z0-9]{2,}/gu) ?? [];
  for (const run of runs) {
    if (TITLE_STRUCTURAL_GLUE_RE.test(run)) continue;
    if (/^\d+$/u.test(run)) continue;
    const backed = allowed.some(
      (f) => f.includes(run) || run.includes(f) || allowedBlob.includes(run),
    );
    if (!backed) {
      findings.push({
        code: "PLAN_TITLE_INVENT",
        message: `title contains material absent from title.facts: ${run}`,
        severity: "BLOCKING",
        slot: "title",
      });
    }
  }

  return findings;
}

/**
 * Progression = body realizes planned body facts that lead did not already realize.
 * Same-fact reuse is allowed; missing new planned information is not.
 */
function checkProgression(
  plan: ArticlePlan,
  article: ArticlePlanComplianceArticle,
): { findings: ArticlePlanComplianceFinding[]; bodyOnlyRestatesLead: boolean } {
  const findings: ArticlePlanComplianceFinding[] = [];
  const bodyFacts = plan.body.flatMap((b) => b.facts).filter((f) => !isWeakPlanFact(f));
  if (bodyFacts.length === 0) {
    return { findings, bodyOnlyRestatesLead: false };
  }

  const bodyText = slotText(article, "body");
  const leadText = article.lead ?? "";
  const newInBody = bodyFacts.filter(
    (f) => factRealizedIn(bodyText, f) && !factRealizedIn(leadText, f),
  );
  const anyBodyRealization = bodyFacts.some((f) => factRealizedIn(bodyText, f));

  if (!anyBodyRealization || newInBody.length === 0) {
    findings.push({
      code: "PLAN_NO_PROGRESSION",
      message:
        "body does not advance new planned body facts beyond lead — planned information did not progress",
      severity: "BLOCKING",
      slot: "body",
    });
    return { findings, bodyOnlyRestatesLead: true };
  }

  return { findings, bodyOnlyRestatesLead: false };
}

function checkUnplannedConcrete(
  plan: ArticlePlan,
  article: ArticlePlanComplianceArticle,
): ArticlePlanComplianceFinding[] {
  const findings: ArticlePlanComplianceFinding[] = [];
  const planFacts = articlePlanAllFacts(plan);
  const bodyParas = article.sections.flatMap((s) => s.paragraphs);

  for (let i = 0; i < bodyParas.length; i++) {
    const p = bodyParas[i]!;
    const stems = p.match(CONCRETE_STEM_RE) ?? [];
    for (const stem of stems) {
      const backed = planFacts.some(
        (f) =>
          f.includes(stem) ||
          paraphraseHit(p, f) ||
          isFactRealized(resolveFactRealization(p, f, { padBearing: false }).status),
      );
      if (!backed && stem.length >= 3) {
        findings.push({
          code: "PLAN_UNPLANNED_CONCRETE",
          message: `body paragraph ${i} concrete stem not in ArticlePlan: ${stem}`,
          severity: "BLOCKING",
          slot: "body",
        });
      }
    }
  }

  return findings;
}

/**
 * Unplanned meaning: body sentence realizes no plan fact and adds no plan concrete
 * coverage, yet is non-trivial content (not a mere restatement of already-covered facts).
 * Natural modifiers on planned facts realize plan facts → not flagged.
 */
function checkUnplannedMeaning(
  plan: ArticlePlan,
  article: ArticlePlanComplianceArticle,
): ArticlePlanComplianceFinding[] {
  const findings: ArticlePlanComplianceFinding[] = [];
  const planFacts = writerVisiblePlanFacts(articlePlanAllFacts(plan));
  const bodyParas = article.sections.flatMap((s) => s.paragraphs);
  const prior = [article.title, article.lead].join("\n");
  let covered = concreteCoverageKeys(prior, planFacts);

  for (let i = 0; i < bodyParas.length; i++) {
    const p = bodyParas[i]!;
    if (p.replace(/\s+/g, "").length < 8) {
      covered = setUnion(covered, concreteCoverageKeys(p, planFacts));
      continue;
    }
    const realizes = planFacts.some(
      (f) => !isWeakPlanFact(f) && factRealizedIn(p, f),
    );
    const keys = concreteCoverageKeys(p, planFacts);
    const novelConcrete = uniqueIn(keys, covered);
    if (!realizes && novelConcrete.size === 0 && hasConcreteSurface(p) === false) {
      // Non-plan content with no plan realization — new semantic axis candidate
      const onlyRestatesPrior =
        realizedPlanFacts(p, planFacts).length === 0 &&
        [...concreteCoverageKeys(p, planFacts)].every((k) => covered.has(k));
      if (onlyRestatesPrior && p.replace(/\s+/g, "").length >= 12) {
        // Pure pad / meaning-only continuation without plan job — WARNING (mutation may DROP)
        findings.push({
          code: "PLAN_UNPLANNED_MEANING",
          message: `body paragraph ${i} adds no planned fact realization or concrete plan coverage`,
          severity: "WARNING",
          slot: "body",
        });
      }
    }
    covered = setUnion(covered, keys);
  }

  return findings;
}

/**
 * Short theme membership OK; inventing psychology/story/role from genre tags is not.
 * Evaluative residue after plan surfaces removed is unsupported padding.
 */
function checkPlanAttestationSurplus(
  plan: ArticlePlan,
  article: ArticlePlanComplianceArticle,
): ArticlePlanComplianceFinding[] {
  const findings: ArticlePlanComplianceFinding[] = [];
  const planFacts = writerVisiblePlanFacts(articlePlanAllFacts(plan));
  const bodyParas = article.sections.flatMap((s) => s.paragraphs);
  for (let i = 0; i < bodyParas.length; i++) {
    const p = bodyParas[i]!;
    for (const sent of splitIntoSentences(p)) {
      if (sent.replace(/\s+/g, "").length < 10) continue;
      if (hasShortThemeSemanticOverreach(sent, planFacts)) {
        findings.push({
          code: "PLAN_THEME_OVERREACH",
          message: `body paragraph ${i} expands short theme facts beyond membership/attested surface: ${sent.slice(0, 200)}`,
          severity: "BLOCKING",
          slot: "body",
        });
      }
      if (hasUnsupportedEvaluativeResidue(sent, planFacts)) {
        // Validate only — no post-LLM strip. Pure padding → REGENERATE; mixed → WARNING.
        const pure = isPureUnsupportedEvaluativePadding(sent, planFacts);
        findings.push({
          code: "PLAN_UNSUPPORTED_EVAL",
          message: `body paragraph ${i} has evaluative residue not attested by ARTICLE_PLAN: ${sent.slice(0, 200)}`,
          severity: pure ? "BLOCKING" : "WARNING",
          slot: "body",
        });
      }
    }
  }
  return findings;
}

export function validateArticlePlanCompliance(input: {
  article: ArticlePlanComplianceArticle;
  articlePlan: ArticlePlan;
}): ArticlePlanComplianceResult {
  const findings: ArticlePlanComplianceFinding[] = [
    ...checkOmissions(input.articlePlan, input.article),
    ...checkSlotFidelity(input.articlePlan, input.article),
    ...checkTitleAuthority(input.articlePlan, input.article),
    ...checkUnplannedConcrete(input.articlePlan, input.article),
    ...checkUnplannedMeaning(input.articlePlan, input.article),
    ...checkPlanAttestationSurplus(input.articlePlan, input.article),
  ];

  const progression = checkProgression(input.articlePlan, input.article);
  findings.push(...progression.findings);

  const blocking = findings.filter((f) => f.severity === "BLOCKING");
  const missingPlanFacts = findings
    .filter((f) => f.code === "PLAN_FACT_OMISSION")
    .map((f) => f.message);
  const violatedSlots = [...new Set(blocking.map((f) => f.slot ?? "article"))];
  const failureSignature =
    blocking.length > 0 ? `ARTICLE_PLAN::${blocking.map((f) => f.code).join(",")}` : null;

  return {
    ok: blocking.length === 0,
    planExecutionFailed: blocking.length > 0,
    structuralDefect: blocking.length > 0,
    findings,
    violatedSlots,
    missingPlanFacts,
    failureSignature,
    bodyOnlyRestatesLead: progression.bodyOnlyRestatesLead,
  };
}

/**
 * Deterministic, coverage-preserving removal of pure unsupported evaluative closers.
 *
 * Not a general prose rewrite: only drops sentences that are pure eval padding
 * (isPureUnsupportedEvaluativePadding) when every planned-fact realization is preserved.
 * Needed so Writer promotional closers do not force regen loops as the steady-state design.
 */
export function stripPureUnsupportedEvalClosers(input: {
  article: ArticlePlanComplianceArticle;
  articlePlan: ArticlePlan;
}): {
  article: ArticlePlanComplianceArticle;
  droppedSentences: string[];
  mutated: boolean;
} {
  const planFacts = writerVisiblePlanFacts(articlePlanAllFacts(input.articlePlan));
  const bodySlotFacts = writerVisiblePlanFacts(input.articlePlan.body.flatMap((b) => b.facts));
  const fixed = articleFixedText(input.article);
  const body = collectBodySentences(input.article);
  if (body.length === 0) {
    return { article: input.article, droppedSentences: [], mutated: false };
  }

  const keptFlags = body.map(() => true);
  const dropped: string[] = [];

  for (let i = 0; i < body.length; i++) {
    const sentence = body[i]!.sentence;
    if (!isPureUnsupportedEvaluativePadding(sentence, planFacts)) continue;

    const currentKept = body.map((b) => b.sentence).filter((_, j) => keptFlags[j]);
    const dropIdx = currentKept.indexOf(sentence);
    if (dropIdx < 0) continue;
    if (!dropPreservesPlannedRealization(fixed, currentKept, dropIdx, planFacts, bodySlotFacts)) {
      continue;
    }
    keptFlags[i] = false;
    dropped.push(sentence);
  }

  if (dropped.length === 0) {
    return { article: input.article, droppedSentences: [], mutated: false };
  }

  const sections = input.article.sections.map((sec, sectionIndex) => {
    const paragraphs: string[] = [];
    sec.paragraphs.forEach((para, paragraphIndex) => {
      const keptSentences = body
        .filter(
          (b, idx) =>
            b.sectionIndex === sectionIndex &&
            b.paragraphIndex === paragraphIndex &&
            keptFlags[idx],
        )
        .map((b) => b.sentence);
      if (keptSentences.length === 0) return;
      const rebuilt = rejoinSentences(para, keptSentences);
      if (rebuilt.trim().length > 0) paragraphs.push(rebuilt);
    });
    return { ...sec, paragraphs };
  });

  return {
    article: { ...input.article, sections },
    droppedSentences: dropped,
    mutated: true,
  };
}

type BodySent = {
  sectionIndex: number;
  paragraphIndex: number;
  sentenceIndex: number;
  sentence: string;
};

function collectBodySentences(article: ArticlePlanComplianceArticle): BodySent[] {
  const out: BodySent[] = [];
  article.sections.forEach((sec, sectionIndex) => {
    sec.paragraphs.forEach((para, paragraphIndex) => {
      const sentences = splitIntoSentences(para);
      const parts = sentences.length > 0 ? sentences : para.trim() ? [para.trim()] : [];
      parts.forEach((sentence, sentenceIndex) => {
        out.push({ sectionIndex, paragraphIndex, sentenceIndex, sentence });
      });
    });
  });
  return out;
}

function articleFixedText(article: ArticlePlanComplianceArticle): string {
  return [article.title, article.lead, article.summary].filter(Boolean).join("\n");
}

function measure(
  fixedText: string,
  bodySentences: string[],
  facts: string[],
  assigned: string[],
): { concrete: Set<string>; assigned: Set<string> } {
  const blob = [fixedText, ...bodySentences].join("\n");
  return {
    concrete: concreteCoverageKeys(blob, facts),
    assigned: assignedCoverageKeys(blob, assigned),
  };
}

function rejoinSentences(originalPara: string, kept: string[]): string {
  if (kept.length === 0) return "";
  const originalSentences = splitIntoSentences(originalPara);
  if (
    originalSentences.length === kept.length &&
    originalSentences.every((s, i) => s === kept[i])
  ) {
    return originalPara;
  }
  return kept.join("");
}

function bodySentencesToArticle(
  article: ArticlePlanComplianceArticle,
  body: BodySent[],
  keptFlags: boolean[],
  dropIndex: number,
): ArticlePlanComplianceArticle {
  const trialFlags = keptFlags.map((k, j) => (j === dropIndex ? false : k));
  const sections = article.sections.map((sec, sectionIndex) => {
    const paragraphs: string[] = [];
    sec.paragraphs.forEach((para, paragraphIndex) => {
      const keptSentences = body
        .filter(
          (b, idx) =>
            b.sectionIndex === sectionIndex &&
            b.paragraphIndex === paragraphIndex &&
            trialFlags[idx],
        )
        .map((b) => b.sentence);
      if (keptSentences.length === 0) return;
      const rebuilt = rejoinSentences(para, keptSentences);
      if (rebuilt.trim().length > 0) paragraphs.push(rebuilt);
    });
    return { ...sec, paragraphs };
  });
  return { ...article, sections };
}

/**
 * Completion-only DROP — R130 realization-safe (fail-open):
 * DROP only when removing the sentence leaves every planned fact realization unchanged
 * (global + body slot, fact identity — not coverage count).
 * EXACT and SEMANTIC both count as REALIZED; weak plan facts are not exempt.
 */
export function applyArticlePlanComplianceMutations(input: {
  article: ArticlePlanComplianceArticle;
  articlePlan: ArticlePlan;
}): ArticlePlanComplianceMutationResult {
  const planFacts = writerVisiblePlanFacts(articlePlanAllFacts(input.articlePlan));
  const assigned = writerVisiblePlanFacts(input.articlePlan.body.flatMap((b) => b.facts));
  const bodySlotFacts = assigned;
  const fixed = articleFixedText(input.article);
  const body = collectBodySentences(input.article);
  const originalBodyTexts = body.map((b) => b.sentence);
  const before = measure(fixed, originalBodyTexts, planFacts, assigned);
  const beforeSnapshot = snapshotPlannedRealization(
    fixed,
    originalBodyTexts,
    planFacts,
    bodySlotFacts,
  );

  const decisions: ArticlePlanSentenceDecision[] = [];
  const keptFlags = body.map(() => true);

  let coveredConcrete = concreteCoverageKeys(fixed, planFacts);
  let coveredAssigned = assignedCoverageKeys(fixed, assigned);

  const complianceBefore = validateArticlePlanCompliance({
    article: input.article,
    articlePlan: input.articlePlan,
  });

  for (let i = 0; i < body.length; i++) {
    const sentence = body[i]!.sentence;
    const skConcrete = concreteCoverageKeys(sentence, planFacts);
    const skAssigned = assignedCoverageKeys(sentence, assigned);
    const sentencePlanned = realizedFactKeys(sentence, planFacts);

    const currentKept = originalBodyTexts.filter((_, j) => keptFlags[j]);
    const dropIdx = currentKept.indexOf(sentence);
    const realizationSafe =
      dropIdx >= 0 &&
      dropPreservesPlannedRealization(fixed, currentKept, dropIdx, planFacts, bodySlotFacts);

    if (!realizationSafe) {
      keptFlags[i] = true;
      coveredConcrete = setUnion(coveredConcrete, skConcrete);
      coveredAssigned = setUnion(coveredAssigned, skAssigned);
      decisions.push({
        sentence,
        decision: "KEEP",
        reason:
          sentencePlanned.size > 0
            ? "preserves_unique_planned_realization"
            : "fail_open_realization",
      });
      continue;
    }

    const trialKept = currentKept.filter((_, j) => j !== dropIdx);
    const trialArticle = bodySentencesToArticle(input.article, body, keptFlags, i);
    const complianceIfDropped = validateArticlePlanCompliance({
      article: trialArticle,
      articlePlan: input.articlePlan,
    });

    if (complianceBefore.ok && !complianceIfDropped.ok) {
      keptFlags[i] = true;
      coveredConcrete = setUnion(coveredConcrete, skConcrete);
      coveredAssigned = setUnion(coveredAssigned, skAssigned);
      decisions.push({
        sentence,
        decision: "KEEP",
        reason: "fail_open_compliance_would_worsen",
      });
      continue;
    }

    keptFlags[i] = false;
    decisions.push({
      sentence,
      decision: "DROP",
      reason: "completion_only_no_planned_realization_loss",
    });
  }

  const sections = input.article.sections.map((sec, sectionIndex) => {
    const paragraphs: string[] = [];
    sec.paragraphs.forEach((para, paragraphIndex) => {
      const keptSentences = body
        .filter(
          (b, idx) =>
            b.sectionIndex === sectionIndex &&
            b.paragraphIndex === paragraphIndex &&
            keptFlags[idx],
        )
        .map((b) => b.sentence);
      if (keptSentences.length === 0) return;
      const rebuilt = rejoinSentences(para, keptSentences);
      if (rebuilt.trim().length > 0) paragraphs.push(rebuilt);
    });
    return { ...sec, paragraphs };
  });

  const finalBody = collectBodySentences({ ...input.article, sections }).map((b) => b.sentence);
  const after = measure(fixed, finalBody, planFacts, assigned);
  const afterSnapshot = snapshotPlannedRealization(fixed, finalBody, planFacts, bodySlotFacts);

  if (
    after.concrete.size < before.concrete.size ||
    after.assigned.size < before.assigned.size ||
    !setsEqual(beforeSnapshot.global, afterSnapshot.global) ||
    !setsEqual(beforeSnapshot.bodySlot, afterSnapshot.bodySlot)
  ) {
    return {
      article: input.article,
      decisions: body.map((b) => ({
        sentence: b.sentence,
        decision: "KEEP" as const,
        reason: "fail_open_final_invariant",
      })),
      droppedSentences: [],
      coverageBefore: before.concrete.size,
      coverageAfter: before.concrete.size,
      assignedCoverageBefore: before.assigned.size,
      assignedCoverageAfter: before.assigned.size,
      mutated: false,
    };
  }

  const droppedSentences = decisions.filter((d) => d.decision === "DROP").map((d) => d.sentence);

  return {
    article: { ...input.article, sections },
    decisions,
    droppedSentences,
    coverageBefore: before.concrete.size,
    coverageAfter: after.concrete.size,
    assignedCoverageBefore: before.assigned.size,
    assignedCoverageAfter: after.assigned.size,
    mutated: droppedSentences.length > 0,
  };
}

export function articlePlanComplianceAllowsPersist(
  optionB: boolean,
  result: ArticlePlanComplianceResult,
): boolean {
  if (!optionB) return !result.planExecutionFailed;
  return result.ok;
}

export function buildOptionBArticlePlanRouting(): RawFailureRouting {
  return {
    failureClass: null,
    route: "PASS",
    allowTargetedRepair: true,
    allowPlanAwareRegen: false,
    defer: false,
    codes: [],
    reason: "article_plan_compliance_pass",
  };
}

const ARTICLE_PLAN_STRUCTURAL_CODES = new Set([
  "PLAN_FACT_OMISSION",
  "PLAN_SLOT_VIOLATION",
  "PLAN_NO_PROGRESSION",
  "PLAN_UNPLANNED_CONCRETE",
  "PLAN_THEME_OVERREACH",
  "PLAN_UNSUPPORTED_EVAL",
  "PLAN_TITLE_INVENT",
  "PLAN_TITLE_SURFACE",
]);

export function routeArticlePlanFailure(input: {
  result: ArticlePlanComplianceResult;
  insufficientDevelopmentMaterial?: boolean;
  scarcityMode?: boolean;
  bodyOnlyRestatesLead?: boolean;
}): RawFailureRouting {
  if (input.result.ok) return buildOptionBArticlePlanRouting();

  const blocking = input.result.findings.filter((f) => f.severity === "BLOCKING");
  const codes = [...new Set(blocking.map((f) => f.code))];

  if (input.insufficientDevelopmentMaterial) {
    return {
      failureClass: "INSUFFICIENT_MATERIAL",
      route: "DEFER_INSUFFICIENT_MATERIAL",
      allowTargetedRepair: false,
      allowPlanAwareRegen: false,
      defer: true,
      codes,
      reason: "article_plan_insufficient_material",
    };
  }

  if (input.bodyOnlyRestatesLead || input.result.bodyOnlyRestatesLead) {
    return {
      failureClass: "STRUCTURAL_PLAN_FAILURE",
      route: "PLAN_AWARE_REGEN",
      allowTargetedRepair: false,
      allowPlanAwareRegen: true,
      defer: false,
      codes,
      reason: "body_only_restates_lead",
    };
  }

  if (codes.some((c) => ARTICLE_PLAN_STRUCTURAL_CODES.has(c))) {
    return {
      failureClass: "STRUCTURAL_PLAN_FAILURE",
      route: "PLAN_AWARE_REGEN",
      allowTargetedRepair: false,
      allowPlanAwareRegen: true,
      defer: false,
      codes,
      reason: "article_plan_structural_violation",
    };
  }

  return {
    failureClass: "LOCAL_GENERATION_DEFECT",
    route: "PLAN_AWARE_REGEN",
    allowTargetedRepair: false,
    allowPlanAwareRegen: true,
    defer: false,
    codes,
    reason: "article_plan_local_defect",
  };
}

export function buildArticlePlanComplianceMeta(input: {
  attempt: number;
  compliance: ArticlePlanComplianceResult;
  postIntegrity: { ok: boolean };
  routing: RawFailureRouting;
  mutations?: ArticlePlanComplianceMutationResult | null;
}): Record<string, unknown> {
  return {
    attempt: input.attempt,
    optionB: true,
    ok: input.compliance.ok,
    planExecutionFailed: input.compliance.planExecutionFailed,
    structuralDefect: input.compliance.structuralDefect,
    findings: input.compliance.findings,
    violatedSlots: input.compliance.violatedSlots,
    missingPlanFacts: input.compliance.missingPlanFacts,
    failureSignature: input.compliance.failureSignature,
    bodyOnlyRestatesLead: input.compliance.bodyOnlyRestatesLead,
    postTransformIntegrity: input.postIntegrity,
    routing: input.routing,
    completionOnlyMutations: input.mutations
      ? {
          mutated: input.mutations.mutated,
          droppedSentences: input.mutations.droppedSentences,
          decisions: input.mutations.decisions,
          coverageBefore: input.mutations.coverageBefore,
          coverageAfter: input.mutations.coverageAfter,
        }
      : null,
  };
}
