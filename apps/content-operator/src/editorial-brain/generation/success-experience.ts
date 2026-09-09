/**
 * Success / mixed human-quality Experience — LEARN → STORE → RETRIEVE → APPLY.
 *
 * Facts remain ARTICLE_PLAN / Evidence. These lessons are writing-quality guidance only:
 * WHY a pattern worked, never prose to copy and never new product facts.
 *
 * AUTOMATED_PASS ≠ QUALITY_SUCCESS — do not auto-promote validator PASS.
 */

import type { EditorialBrainRepository } from "@ai-affiliate/database";

/** Minimal Experience row shape used by APPLY (Prisma model is not re-exported from database package). */
export type ExperienceRow = {
  id: string;
  outcome: string | null;
  sourceType: string;
  confidence: number;
  lesson: unknown;
  failureCodes?: unknown;
};

export type QualitySignalType =
  | "HUMAN_POSITIVE"
  | "HUMAN_NEGATIVE"
  | "HUMAN_MIXED_IMPROVEMENT"
  | "AUTOMATED_PASS"
  | "AUTOMATED_FAILURE"
  | "PERFORMANCE_SIGNAL";

export type QualityDimension =
  | "STRUCTURE"
  | "SPECIFICITY"
  | "EXPLANATION"
  | "EDITORIAL_INTERPRETATION"
  | "ADULT_APPEAL"
  | "READER_ORIENTATION"
  | "INFORMATION_DENSITY"
  | "PARAGRAPH_PROGRESSION"
  | "REDUNDANCY"
  | "ENDING";

export type SuccessLessonPayload = {
  schemaVersion: 1;
  signalType: QualitySignalType;
  qualityDimensions: QualityDimension[];
  /** Conditions when this lesson applies (abstract, not product-specific prose). */
  applicableWhen: string[];
  /** Abstract positive pattern — WHY it worked. */
  positivePattern: string;
  /** Optional contrast with a weaker pattern. */
  failureContrast?: string;
  rationale: string;
  humanValidated: boolean;
  /** Stable idempotency key for re-registration. */
  experienceKey: string;
};

export type WritingQualityGuidanceItem = {
  experienceId: string;
  signalType: QualitySignalType;
  dimension: QualityDimension;
  applicableWhen: string[];
  guidance: string;
  contrast?: string;
  confidence: number;
  humanValidated: boolean;
  /** Where this lesson should primarily act. */
  applicationPhase: "plan_time" | "write_time" | "both";
};

export type ExperienceExecutionStatus =
  | "EXECUTED"
  | "PARTIALLY_EXECUTED"
  | "NOT_EXECUTED"
  | "NOT_APPLICABLE";

export type ExperienceExecutionObservation = {
  experienceId: string;
  dimension: QualityDimension;
  applicationPhase: "plan_time" | "write_time" | "both";
  injected: true;
  status: ExperienceExecutionStatus;
  outputEvidence: string | null;
  note: string;
};

export type WritingQualityGuidance = {
  note: string;
  success: WritingQualityGuidanceItem[];
  improvements: WritingQualityGuidanceItem[];
  appliedExperienceIds: string[];
  skipped: Array<{ experienceId: string; reason: string }>;
};

export type ArticleExperienceContext = {
  hasQuantityEvidence: boolean;
  hasMultiThemeEvidence: boolean;
  hasBestCompilationShape: boolean;
  materialDepth?: string | null;
  /** SOURCE density — thin SOURCE must not inherit RICH padding lessons. */
  sourceResolution?: string | null;
};

const SUCCESS_OUTCOMES = new Set([
  "QUALITY_SUCCESS",
  "HUMAN_POSITIVE",
  "SUCCESS",
]);
const IMPROVEMENT_OUTCOMES = new Set([
  "QUALITY_IMPROVEMENT",
  "HUMAN_MIXED_IMPROVEMENT",
  "IMPROVEMENT",
]);

/** Experience keys that push RICH-length / multi-paragraph padding — skip on thin SOURCE. */
const THIN_SOURCE_PADDING_EXPERIENCE_KEYS = new Set([
  "r77.human_positive.specificity.multi_theme",
  "post20.improvement.theme_depth_before_abstraction",
  "post20.improvement.paragraph_progression",
  "r77.human_positive.progression.no_identity_loop",
  "r77.human_positive.ending.grounded_orientation",
  "post20.human_positive.editorial_orientation",
]);

/** R77-style human-positive lessons (abstract WHY — not article copy). */
export const R77_SUCCESS_LESSONS: SuccessLessonPayload[] = [
  {
    schemaVersion: 1,
    signalType: "HUMAN_POSITIVE",
    qualityDimensions: ["SPECIFICITY", "ADULT_APPEAL"],
    applicableWhen: ["multi_theme_evidence", "adult_product_intro"],
    positivePattern:
      "When several sexual theme/play labels are planned, develop their directional differences within Evidence instead of collapsing early into one generic variety summary.",
    failureContrast:
      "Listing themes then closing with only 「幅広いエロティシズム」 removes adult specificity.",
    rationale:
      "Human-valued R77-quality intros kept theme labels informative enough for erotic direction, not as a checklist dump closed by abstraction.",
    humanValidated: true,
    experienceKey: "r77.human_positive.specificity.multi_theme",
  },
  {
    schemaVersion: 1,
    signalType: "HUMAN_POSITIVE",
    qualityDimensions: ["EXPLANATION", "INFORMATION_DENSITY"],
    applicableWhen: ["quantity_evidence", "best_compilation"],
    positivePattern:
      "When multiple quantity/collection facts exist (titles/corners/runtime), explain what that combination means for product structure and reading value — do not only restate the numbers.",
    failureContrast: "Repeating 12 titles / 55 corners / 8 hours across paragraphs without new meaning feels like fact formatting.",
    rationale:
      "Strong baselines turned quantity Evidence into composition understanding for the reader.",
    humanValidated: true,
    experienceKey: "r77.human_positive.explanation.quantity_structure",
  },
  {
    schemaVersion: 1,
    signalType: "HUMAN_POSITIVE",
    qualityDimensions: ["PARAGRAPH_PROGRESSION", "REDUNDANCY"],
    applicableWhen: ["rich_or_standard_depth", "multi_axis_plan"],
    positivePattern:
      "Each paragraph should add a new information axis or a deeper understanding of an already-introduced axis; do not return to product-identity restatement after development has begun.",
    failureContrast:
      "Ending by re-covering the same collection-scope identity as the opening wastes progression.",
    rationale:
      "Human-preferred articles progressed understanding rather than looping identity.",
    humanValidated: true,
    experienceKey: "r77.human_positive.progression.no_identity_loop",
  },
  {
    schemaVersion: 1,
    signalType: "HUMAN_POSITIVE",
    qualityDimensions: ["EDITORIAL_INTERPRETATION", "READER_ORIENTATION", "ENDING"],
    applicableWhen: ["quantity_evidence", "best_compilation"],
    positivePattern:
      "After concrete Evidence is developed, a short grounded editorial wrap (who it suits / how to read the volume) is valuable — without inventing external reputation claims.",
    rationale:
      "Reader orientation worked when it followed developed Evidence rather than replacing it.",
    humanValidated: true,
    experienceKey: "r77.human_positive.ending.grounded_orientation",
  },
];

/** post 20 mixed: keep wins; record improvement signals. */
export const POST20_MIXED_LESSONS: SuccessLessonPayload[] = [
  {
    schemaVersion: 1,
    signalType: "HUMAN_POSITIVE",
    qualityDimensions: ["EDITORIAL_INTERPRETATION", "READER_ORIENTATION", "ENDING"],
    applicableWhen: ["best_compilation", "quantity_evidence"],
    positivePattern:
      "Evidence-grounded editorial interpretation and reader orientation (向き先) are kept: they improve product understanding without becoming external factual claims.",
    rationale: "post 20 human review treated claim-boundary-safe editorial closes as a positive.",
    humanValidated: true,
    experienceKey: "post20.human_positive.editorial_orientation",
  },
  {
    schemaVersion: 1,
    signalType: "HUMAN_MIXED_IMPROVEMENT",
    qualityDimensions: ["SPECIFICITY", "ADULT_APPEAL"],
    applicableWhen: ["multi_theme_evidence"],
    positivePattern:
      "After naming multiple planned sexual themes, spend Evidence-bounded sentences distinguishing their directions before any generic variety close.",
    failureContrast:
      "post 20 named 人妻/NTR/痴女/追撃ピストン then immediately closed with generic 「幅広いエロティシズム」.",
    rationale: "Human review: adult specificity was under-developed despite correct theme membership.",
    humanValidated: true,
    experienceKey: "post20.improvement.theme_depth_before_abstraction",
  },
  {
    schemaVersion: 1,
    signalType: "HUMAN_MIXED_IMPROVEMENT",
    qualityDimensions: ["PARAGRAPH_PROGRESSION", "REDUNDANCY", "EXPLANATION"],
    applicableWhen: ["best_compilation", "quantity_evidence", "multi_axis_plan"],
    positivePattern:
      "Later paragraphs must add new understanding (theme differentiation, trait-in-work, who-it-suits) rather than re-explaining the same collection identity already established in the opening.",
    failureContrast:
      "post 20 paragraph 3 largely returned to 12タイトル全コーナー identity already covered in paragraph 1.",
    rationale: "Human review: progression/new understanding was the main remaining gap.",
    humanValidated: true,
    experienceKey: "post20.improvement.paragraph_progression",
  },
];

export function deriveArticleExperienceContext(input: {
  planFacts?: readonly string[];
  materialDepth?: string | null;
  sourceResolution?: string | null;
}): ArticleExperienceContext {
  const blob = (input.planFacts ?? []).join("\n");
  const themes = (blob.match(/人妻|NTR|痴女|追撃ピストン|わからせ|杭打ち|ピストン/gu) ?? []).length;
  const thin =
    input.sourceResolution === "THEME_LEVEL_EVIDENCE" ||
    input.sourceResolution === "METADATA_ONLY";
  return {
    hasQuantityEvidence: /\d+\s*(?:時間|コーナー|タイトル|分|本番)/u.test(blob),
    // Thin SOURCE: do not treat a few membership tags as RICH multi-theme expansion duty.
    hasMultiThemeEvidence: themes >= 2 && !thin,
    hasBestCompilationShape: /ベスト|全コーナー|収録/u.test(blob),
    materialDepth: input.materialDepth ?? null,
    sourceResolution: input.sourceResolution ?? null,
  };
}

/** Soft claimProfile facet for Experience retrieval (not a new authority). */
export function claimProfileForExperienceRetrieval(
  ctx: ArticleExperienceContext,
): string {
  const tags: string[] = [];
  if (ctx.hasBestCompilationShape) tags.push("best_compilation");
  if (ctx.hasMultiThemeEvidence) tags.push("multi_theme");
  if (ctx.hasQuantityEvidence) tags.push("quantity");
  return tags.length > 0 ? `quality:${tags.join("+")}` : "quality:product_intro";
}

function lessonApplies(lesson: SuccessLessonPayload, ctx: ArticleExperienceContext): boolean {
  const thin =
    ctx.sourceResolution === "THEME_LEVEL_EVIDENCE" ||
    ctx.sourceResolution === "METADATA_ONLY";
  if (thin && THIN_SOURCE_PADDING_EXPERIENCE_KEYS.has(lesson.experienceKey)) {
    return false;
  }
  const when = lesson.applicableWhen;
  if (when.length === 0) return true;
  const checks: Record<string, boolean> = {
    multi_theme_evidence: ctx.hasMultiThemeEvidence,
    quantity_evidence: ctx.hasQuantityEvidence,
    best_compilation: ctx.hasBestCompilationShape,
    adult_product_intro: true,
    rich_or_standard_depth:
      ctx.materialDepth === "rich" ||
      ctx.materialDepth === "standard" ||
      ctx.materialDepth == null,
    multi_axis_plan: ctx.hasMultiThemeEvidence || ctx.hasQuantityEvidence,
  };
  // Apply when ANY tagged condition matches (OR) — lessons stay conditional, not universal templates.
  return when.some((w) => checks[w] === true);
}

export function parseSuccessLesson(raw: unknown): SuccessLessonPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  if (typeof o.positivePattern !== "string" || !o.positivePattern.trim()) return null;
  if (typeof o.experienceKey !== "string" || !o.experienceKey.trim()) return null;
  if (typeof o.signalType !== "string") return null;
  return {
    schemaVersion: 1,
    signalType: o.signalType as QualitySignalType,
    qualityDimensions: Array.isArray(o.qualityDimensions)
      ? (o.qualityDimensions.filter((x) => typeof x === "string") as QualityDimension[])
      : [],
    applicableWhen: Array.isArray(o.applicableWhen)
      ? o.applicableWhen.filter((x): x is string => typeof x === "string")
      : [],
    positivePattern: o.positivePattern.trim(),
    failureContrast:
      typeof o.failureContrast === "string" ? o.failureContrast.trim() : undefined,
    rationale: typeof o.rationale === "string" ? o.rationale : "",
    humanValidated: o.humanValidated === true,
    experienceKey: o.experienceKey.trim(),
  };
}

export function summarizeWritingQualityGuidance(input: {
  experiences: ExperienceRow[];
  context: ArticleExperienceContext;
  maxSuccess?: number;
  maxImprovements?: number;
}): WritingQualityGuidance {
  const maxSuccess = input.maxSuccess ?? 2;
  const maxImprovements = input.maxImprovements ?? 2;
  const success: WritingQualityGuidanceItem[] = [];
  const improvements: WritingQualityGuidanceItem[] = [];
  const skipped: Array<{ experienceId: string; reason: string }> = [];
  const applied = new Set<string>();

  const ranked = [...input.experiences].sort((a, b) => {
    const ha = a.sourceType === "HUMAN_FEEDBACK" ? 1 : 0;
    const hb = b.sourceType === "HUMAN_FEEDBACK" ? 1 : 0;
    if (hb !== ha) return hb - ha;
    return b.confidence - a.confidence;
  });

  for (const exp of ranked) {
    const lesson = parseSuccessLesson(exp.lesson);
    if (!lesson) {
      if (
        SUCCESS_OUTCOMES.has(exp.outcome ?? "") ||
        IMPROVEMENT_OUTCOMES.has(exp.outcome ?? "") ||
        exp.sourceType === "HUMAN_FEEDBACK"
      ) {
        skipped.push({ experienceId: exp.id, reason: "lesson_payload_unreadable" });
      }
      continue;
    }
    if (lesson.signalType === "AUTOMATED_PASS") {
      skipped.push({ experienceId: exp.id, reason: "automated_pass_not_quality_success" });
      continue;
    }
    if (!lessonApplies(lesson, input.context)) {
      skipped.push({ experienceId: exp.id, reason: "applicableWhen_mismatch" });
      continue;
    }
    const dim = lesson.qualityDimensions[0] ?? "EXPLANATION";
    const applicationPhase = applicationPhaseForDimensions(lesson.qualityDimensions);
    const item: WritingQualityGuidanceItem = {
      experienceId: exp.id,
      signalType: lesson.signalType,
      dimension: dim,
      applicableWhen: lesson.applicableWhen,
      guidance: lesson.positivePattern,
      contrast: lesson.failureContrast,
      confidence: exp.confidence,
      humanValidated: lesson.humanValidated,
      applicationPhase,
    };
    const isImprovement =
      lesson.signalType === "HUMAN_MIXED_IMPROVEMENT" ||
      IMPROVEMENT_OUTCOMES.has(exp.outcome ?? "");
    if (isImprovement) {
      if (improvements.length >= maxImprovements) {
        skipped.push({ experienceId: exp.id, reason: "improvement_cap" });
        continue;
      }
      improvements.push(item);
      applied.add(exp.id);
    } else if (
      lesson.signalType === "HUMAN_POSITIVE" ||
      SUCCESS_OUTCOMES.has(exp.outcome ?? "")
    ) {
      if (success.length >= maxSuccess) {
        skipped.push({ experienceId: exp.id, reason: "success_cap" });
        continue;
      }
      success.push(item);
      applied.add(exp.id);
    } else {
      skipped.push({ experienceId: exp.id, reason: `signal_${lesson.signalType}` });
    }
  }

  return {
    note:
      "WRITING_QUALITY_GUIDANCE from human-validated Brain experiences. Abstract WHY patterns only — do not copy wording, do not invent product facts. ARTICLE_PLAN remains factual SSOT.",
    success,
    improvements,
    appliedExperienceIds: [...applied],
    skipped,
  };
}

export function formatWritingQualityGuidanceForWriter(
  guidance: WritingQualityGuidance | null | undefined,
): string | null {
  if (!guidance) return null;
  const lines: string[] = [
    "Abstract quality reminders only — write naturally; do not satisfy these as a checklist.",
  ];
  // Cap surface pressure: at most 2 success + 2 improve lines.
  for (const s of guidance.success.slice(0, 2)) {
    lines.push(`SUCCESS: ${s.guidance}`);
  }
  for (const i of guidance.improvements.slice(0, 2)) {
    lines.push(
      `IMPROVE: ${i.guidance}${i.contrast ? ` Avoid: ${i.contrast}` : ""}`,
    );
  }
  if (lines.length <= 1) return null;
  return lines.join("\n");
}

function applicationPhaseForDimensions(
  dims: QualityDimension[],
): "plan_time" | "write_time" | "both" {
  const planish = dims.some((d) =>
    d === "PARAGRAPH_PROGRESSION" || d === "REDUNDANCY" || d === "STRUCTURE",
  );
  const writeish = dims.some((d) =>
    d === "SPECIFICITY" ||
    d === "ADULT_APPEAL" ||
    d === "EDITORIAL_INTERPRETATION" ||
    d === "READER_ORIENTATION" ||
    d === "ENDING" ||
    d === "EXPLANATION" ||
    d === "INFORMATION_DENSITY",
  );
  if (planish && writeish) return "both";
  if (planish) return "plan_time";
  return "write_time";
}

/**
 * Post-generation observation: INJECTED ≠ EXECUTED.
 * Heuristic only — used for TRACE / metrics, not LearningRule mutation.
 */
export function observeWritingQualityExecution(input: {
  guidance: WritingQualityGuidance | null | undefined;
  bodyText: string;
  themeSourceResolution?: string | null;
}): ExperienceExecutionObservation[] {
  if (!input.guidance) return [];
  const body = (input.bodyText ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p &&
        !/^詳細を確認/.test(p) &&
        !/アフィリエイト広告/.test(p) &&
        !/掲載情報は確認時点/.test(p) &&
        !/18歳未満/.test(p) &&
        !/^https?:\/\//.test(p),
    )
    .join("\n");
  const paras = body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const first = paras[0] ?? "";
  const last = paras.length > 1 ? paras[paras.length - 1]! : "";
  const mid = paras.slice(1, -1).join("\n");
  const themes = ["人妻", "NTR", "痴女", "追撃ピストン"].filter((t) => body.includes(t));
  const genericClose =
    /幅広いエロティシズム|様々な方向性のエロティシズム|多様なエロティシズム/.test(body);
  const identityLoop =
    /最新\d+タイトル|全コーナー/.test(first) &&
    /最新\d+タイトル|全コーナー/.test(last) &&
    paras.length >= 2;
  const readerOrient =
    /まとめて見たい|ファンはもちろん|おすすめ|適した|じっくり/.test(last) ||
    /まとめて見たい|ファンはもちろん|おすすめ|適した/.test(body);
  const quantityExplained =
    (/\d+\s*時間|\d+\s*コーナー|12タイトル/.test(body) &&
      /ボリューム|構成|収録|ベスト|網羅/.test(body));

  const items = [...input.guidance.success, ...input.guidance.improvements];
  return items.map((item) => {
    let status: ExperienceExecutionStatus = "NOT_EXECUTED";
    let outputEvidence: string | null = null;
    let note = "";

    if (item.dimension === "SPECIFICITY" || item.dimension === "ADULT_APPEAL") {
      if (themes.length >= 2 && !genericClose) {
        status = "EXECUTED";
        outputEvidence = themes.join(",");
        note = "themes present without immediate generic variety-only close";
      } else if (themes.length >= 2 && genericClose) {
        // Labels listed then collapsed — partial when theme_labels_only (safe ceiling)
        status =
          input.themeSourceResolution === "theme_labels_only"
            ? "PARTIALLY_EXECUTED"
            : "NOT_EXECUTED";
        outputEvidence = (mid || body).slice(0, 160);
        note = "themes listed but closed with generic variety summary";
      } else {
        status = "NOT_EXECUTED";
        note = "theme differentiation not observed";
      }
    } else if (
      item.dimension === "PARAGRAPH_PROGRESSION" ||
      item.dimension === "REDUNDANCY"
    ) {
      if (identityLoop && !readerOrient) {
        status = "NOT_EXECUTED";
        outputEvidence = last.slice(0, 120);
        note = "closing restates opening collection identity";
      } else if (identityLoop && readerOrient) {
        status = "PARTIALLY_EXECUTED";
        outputEvidence = last.slice(0, 120);
        note = "reader orientation present but collection identity also restated";
      } else if (paras.length >= 2 && readerOrient) {
        status = "EXECUTED";
        outputEvidence = last.slice(0, 120);
        note = "closing advances to reader orientation without bare identity loop";
      } else {
        status = "PARTIALLY_EXECUTED";
        note = "progression signal weak/unclear";
      }
    } else if (item.dimension === "EXPLANATION" || item.dimension === "INFORMATION_DENSITY") {
      status = quantityExplained ? "EXECUTED" : "PARTIALLY_EXECUTED";
      note = quantityExplained
        ? "quantity facts appear with structural framing"
        : "quantity present but structural explanation weak";
    } else if (
      item.dimension === "EDITORIAL_INTERPRETATION" ||
      item.dimension === "READER_ORIENTATION" ||
      item.dimension === "ENDING"
    ) {
      status = readerOrient ? "EXECUTED" : "NOT_EXECUTED";
      outputEvidence = readerOrient ? last.slice(0, 120) : null;
      note = readerOrient ? "grounded reader orientation observed" : "no reader orientation close";
    } else {
      status = "NOT_APPLICABLE";
      note = "no heuristic for dimension";
    }

    return {
      experienceId: item.experienceId,
      dimension: item.dimension,
      applicationPhase: item.applicationPhase,
      injected: true as const,
      status,
      outputEvidence,
      note,
    };
  });
}

export async function findExperienceByKey(
  repo: EditorialBrainRepository,
  experienceKey: string,
): Promise<ExperienceRow | null> {
  // Bounded scan — Experience table is append-only and still small; key lives in lesson JSON.
  const rows = await repo.listExperiencesForRetrieval({
    channel: "BLOG",
    contentType: "blogger-article",
    limit: 40,
  });
  for (const row of rows) {
    const lesson = parseSuccessLesson(row.lesson);
    if (lesson?.experienceKey === experienceKey) return row;
  }
  // Also check CORE-scoped via a second channel-agnostic pull if needed
  const coreish = rows.find((r) => {
    const lesson = parseSuccessLesson(r.lesson);
    return lesson?.experienceKey === experienceKey;
  });
  return coreish ?? null;
}

export async function registerHumanQualityLesson(
  repo: EditorialBrainRepository,
  input: {
    lesson: SuccessLessonPayload;
    contentVersionId?: string | null;
    claimProfile?: string | null;
    formatKey?: string | null;
    confidence?: number;
  },
): Promise<{ created: boolean; experience: ExperienceRow }> {
  const existing = await findExperienceByKey(repo, input.lesson.experienceKey);
  if (existing) {
    return { created: false, experience: existing };
  }
  const outcome =
    input.lesson.signalType === "HUMAN_MIXED_IMPROVEMENT"
      ? "QUALITY_IMPROVEMENT"
      : input.lesson.signalType === "HUMAN_POSITIVE"
        ? "QUALITY_SUCCESS"
        : input.lesson.signalType === "HUMAN_NEGATIVE"
          ? "QUALITY_NEGATIVE"
          : "QUALITY_NOTE";
  const experience = await repo.createExperience({
    scope: "CHANNEL",
    channel: "BLOG",
    formatKey: input.formatKey ?? "NEW_RELEASE_SINGLE",
    contentType: "blogger-article",
    claimProfile: input.claimProfile ?? "quality:product_intro",
    failureCodes: [],
    outcome,
    sourceType: "HUMAN_FEEDBACK",
    confidence: input.confidence ?? (input.lesson.humanValidated ? 0.9 : 0.5),
    sampleEvidence: 1,
    contentVersionId: input.contentVersionId ?? null,
    lesson: input.lesson,
    metadata: {
      signalType: input.lesson.signalType,
      experienceKey: input.lesson.experienceKey,
      humanValidated: input.lesson.humanValidated,
      qualityDimensions: input.lesson.qualityDimensions,
      registeredAt: new Date().toISOString(),
    },
  });
  return { created: true, experience };
}

/** Seed R77 positive + post20 mixed lessons (idempotent by experienceKey). */
export async function ensureBaselineHumanQualityExperiences(
  repo: EditorialBrainRepository,
  opts?: { post20ContentVersionId?: string | null },
): Promise<{ createdKeys: string[]; reusedKeys: string[] }> {
  const createdKeys: string[] = [];
  const reusedKeys: string[] = [];
  for (const lesson of R77_SUCCESS_LESSONS) {
    const r = await registerHumanQualityLesson(repo, {
      lesson,
      claimProfile: "quality:best_compilation+multi_theme+quantity",
      confidence: 0.92,
    });
    (r.created ? createdKeys : reusedKeys).push(lesson.experienceKey);
  }
  for (const lesson of POST20_MIXED_LESSONS) {
    const r = await registerHumanQualityLesson(repo, {
      lesson,
      contentVersionId: opts?.post20ContentVersionId ?? null,
      claimProfile: "quality:best_compilation+multi_theme+quantity",
      confidence: 0.88,
    });
    (r.created ? createdKeys : reusedKeys).push(lesson.experienceKey);
  }
  return { createdKeys, reusedKeys };
}

/** Ranking helpers used by retrieval. */
export function successExperienceRankBonus(input: {
  sourceType: string;
  outcome: string | null;
}): number {
  let bonus = 0;
  if (input.sourceType === "HUMAN_FEEDBACK") bonus += 2.2;
  if (SUCCESS_OUTCOMES.has(input.outcome ?? "")) bonus += 1.6;
  if (IMPROVEMENT_OUTCOMES.has(input.outcome ?? "")) bonus += 1.2;
  if (input.sourceType === "SYSTEM_VALIDATOR" && input.outcome === "SUCCESS") {
    // Automated pass must not outrank human lessons.
    bonus -= 1.5;
  }
  return bonus;
}

export function isFailureExperienceRow(exp: {
  outcome: string | null;
  failureCodes: unknown;
  sourceType: string;
}): boolean {
  const codes = Array.isArray(exp.failureCodes) ? exp.failureCodes : [];
  if (codes.length > 0) return true;
  if (exp.outcome === "PLAN_EXECUTION_FAILED") return true;
  if (SUCCESS_OUTCOMES.has(exp.outcome ?? "") || IMPROVEMENT_OUTCOMES.has(exp.outcome ?? "")) {
    return false;
  }
  return exp.sourceType === "INITIAL_GENERATION" && Boolean(exp.outcome);
}
