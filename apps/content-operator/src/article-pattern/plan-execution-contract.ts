/**
 * R151 — ArticlePlan fact execution contract (Planner-derived, Writer-visible).
 *
 * Planner decides WHAT. Writer decides HOW TO CONNECT.
 * Writer must not decide fact identity / semantic relations / title meaning.
 *
 * R158 — informationAxis is a coarse grouping hint from existing semantic-evidence
 * (not a new Planner). Coverage stays mandatory; prose expansion groups by axis.
 */

import { classifySemanticEvidence } from "./semantic-evidence.js";
import { isBareWorkThemeFact } from "./plan-surface-attestation.js";
import { WORK_THEME_FACET_RE } from "./evidence-material-role.js";

export type PlanExecutionMode = "EXACT_SURFACE" | "SEMANTIC_PRESERVE" | "FREE_CONNECTIVE";

export type PlanRequiredRelation =
  | "CONTRAST"
  | "CAUSE"
  | "COMPARISON"
  | "NEGATION"
  | "EXCLUSIVITY"
  | "QUANTITY"
  | "ROLE"
  | "TEMPORAL";

/** Coarse Writer grouping axis — derived from existing semantic primary (no new Planner). */
export type PlanInformationAxis =
  | "scene"
  | "trait"
  | "quantity"
  | "cast"
  | "form"
  | "other";

export type PlanFactExecutionTarget = {
  contributionId: string;
  slot: "title" | "lead" | "body";
  fact: string;
  executionMode: PlanExecutionMode;
  requiredAnchors: string[];
  requiredRelations: PlanRequiredRelation[];
  allowed: string[];
  notAllowed: string[];
  /** R158 — group related body facts; not a length quota */
  informationAxis?: PlanInformationAxis;
  /** V2 — reader job id when slot is body */
  readerJob?: string;
  /** Lightweight: what product aspect this fact explains (not a fact source). */
  presentationPurpose?: string;
};

const CONTRAST_MARKERS =
  /(?:と|といえ|とは)言えど|ではあるものの|ものの|にもかかわらず|それでも|それなのに|だけれども|けれども/u;
const CAUSE_MARKERS = /(?:のため|ので|ことから|した結果|せいで)/u;
const COMPARISON_MARKERS = /(?:より|と比べ|に比べ)/u;
const EXCLUSIVITY_MARKERS = /(?:だけ|のみ|しか)/u;
const NEGATION_MARKERS = /(?:ない|ぬ|ず|決して|まったく|全く)/u;
const TEMPORAL_MARKERS = /(?:その後|そして|から|てから|後に|前に|一晩中|何度も)/u;
const ROLE_MARKERS = /(?:先生|生徒|学芸員|教師|立場)/u;
const QUANTITY_MARKERS = /\d+\s*(?:回|発|本|名|人|時間|分|作品|タイトル|cm|コーナー|発射|射精|本番)/u;

const DISTINCTIVE_TERM =
  /(?:連発射精|追撃ピストン|杭打ち|激ピス|マン毛モロ出し|逆\s*[35]P|ノンストップ)/u;

const DURATION_LIKE = /^\d+\s*(?:時間|分)$/u;

/** Scene / trait / series stems — short tokens that must NOT be frozen as performer EXACT. */
const NON_PERFORMER_NAME_STEM_RE =
  /(?:わからせ|痴女|空域|妹|悪魔|生意気|デカ尻|巨乳|美乳|激ピス|ピストン|本番|射精|ベスト|表情|お仕置き|レ[○●]プ|メスガキ|ギャル|中出し|パンスト|騎乗|ハーレム|タイトル|作品|時間|分|コーナー|誘惑|絶対|小悪魔|顔|尻|脚|乳|オナニー|壁ドン|キス|人妻|NTR|熟女|美少女|女子校生|グラマラス|低身長|円熟|濃厚)/iu;

/**
 * Likely bare performer-name token (identity-critical).
 * Excludes scene/trait/series crumbs that share short Japanese length.
 */
function isLikelyPerformerNameToken(fact: string): boolean {
  const f = fact.trim();
  if (f.length < 2 || f.length > 8) return false;
  if (!/^[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fffー]+$/u.test(f)) return false;
  if (NON_PERFORMER_NAME_STEM_RE.test(f)) return false;
  if (QUANTITY_MARKERS.test(f) || DISTINCTIVE_TERM.test(f)) return false;
  const hasKanji = /[\u4e00-\u9fff]/.test(f);
  const hasKana = /[\u3040-\u309f\u30a0-\u30ff]/.test(f);
  if (hasKanji && hasKana) return true;
  if (hasKanji && f.length >= 2 && f.length <= 5) return true;
  return false;
}

export function deriveRequiredRelations(fact: string): PlanRequiredRelation[] {
  const f = (fact ?? "").trim();
  if (!f) return [];
  const out: PlanRequiredRelation[] = [];
  if (CONTRAST_MARKERS.test(f)) out.push("CONTRAST");
  if (CAUSE_MARKERS.test(f)) out.push("CAUSE");
  if (COMPARISON_MARKERS.test(f)) out.push("COMPARISON");
  if (EXCLUSIVITY_MARKERS.test(f) && !/だけれど|だけど/u.test(f)) out.push("EXCLUSIVITY");
  if (NEGATION_MARKERS.test(f) && /ない|ぬ|ず/.test(f) && f.length <= 40) {
    /* soft — only when short negation-bearing phrase */
  }
  if (QUANTITY_MARKERS.test(f)) out.push("QUANTITY");
  if (ROLE_MARKERS.test(f) && (f.includes("先生") || f.includes("生徒") || f.includes("学芸員"))) {
    out.push("ROLE");
  }
  if (TEMPORAL_MARKERS.test(f) && /その後|てから|一晩中/.test(f)) out.push("TEMPORAL");
  return [...new Set(out)];
}

/** Compact anchors for realization checks — entity/qty/distinctive terms. */
export function deriveRequiredAnchors(fact: string): string[] {
  const f = (fact ?? "").trim();
  if (!f) return [];
  const anchors: string[] = [];

  const qty = f.match(/\d+\s*(?:回|発|本|名|人|時間|分|作品|タイトル|cm|コーナー|発射)/gu) ?? [];
  anchors.push(...qty.map((q) => q.replace(/\s+/g, "")));

  const distinctive = f.match(DISTINCTIVE_TERM) ?? [];
  anchors.push(...distinctive.map((d) => d.replace(/\s+/g, "")));

  // Short proper-name / noun phrases (2–8 chars) near start
  const nameLike = f.match(/[\u4e00-\u9fffァ-ヶー]{2,8}/gu) ?? [];
  for (const n of nameLike.slice(0, 3)) {
    if (n.length >= 2 && !/と言えど|ではある|立場を|快感に/.test(n)) {
      anchors.push(n);
    }
  }

  // Bracket inner content is an anchor
  const bracket = f.match(/【([^】]{2,40})】/u);
  if (bracket?.[1]) anchors.push(bracket[1]);

  return [...new Set(anchors)].filter((a) => a.length >= 2).slice(0, 8);
}

/**
 * Map existing semantic primary (+ light stem fallbacks already used in article-plan)
 * → coarse information axis for Writer grouping. Not a new Planner taxonomy.
 */
export function deriveInformationAxis(fact: string): PlanInformationAxis {
  const f = (fact ?? "").trim();
  if (!f) return "other";

  // Work theme / scene facets before cast — 人妻/NTR are product content, not names.
  if (
    /^(?:人妻|NTR|熟女|美少女|女子校生|ギャル|痴女|OL|SM)$/iu.test(f) ||
    /(?:追撃ピストン|激ピス|杭打ち|わからせ|お仕置き)/u.test(f)
  ) {
    if (/^(?:人妻|NTR|熟女|美少女|女子校生|ギャル|痴女|OL|SM)$/iu.test(f)) {
      return "trait";
    }
    return "scene";
  }

  const bareName = f.replace(/[（(][^）)]+[）)]/gu, "").trim();
  // Cast: performer-like tokens without clause particles (avoids 背徳の極み etc.)
  const nameCandidate = bareName || f;
  if (
    (isLikelyPerformerNameToken(f) || isLikelyPerformerNameToken(nameCandidate)) &&
    !/[のをがにはでと]/u.test(nameCandidate)
  ) {
    return "cast";
  }

  const primary = classifySemanticEvidence(f).primary;
  // Pure quantity/duration tokens are their own axis (even if a scene stem substring matches, e.g. 射精).
  if (
    primary === "QUANTITY" ||
    primary === "DURATION" ||
    ((QUANTITY_MARKERS.test(f) || DURATION_LIKE.test(f)) && f.length <= 12)
  ) {
    return "quantity";
  }
  // Compound scene phrases may also carry body-trait stems (美尻+杭打ち) — prefer scene for grouping.
  const looksScene =
    primary === "SCENE_ACTION" ||
    primary === "RELATIONSHIP" ||
    /(?:騎乗|逆\s*[35]P|中出し|腿コキ|杭打ち|ピストン|激ピス|オナニー|わからせ|お仕置き|空域|ハーレム|バック|壁ドン|キス|踏みつけ|脚責め|摩擦音)/u.test(
      f,
    );
  if (looksScene) return "scene";
  if (
    primary === "BODY_TRAIT" ||
    primary === "CHARACTER_TRAIT" ||
    primary === "PERFORMER_TRAIT" ||
    /(?:生意気|小悪魔|メスガキ|ギャル|デカ尻|美尻|美脚|表情|痴女|エリート|人妻|低身長|グラマラス)/u.test(
      f,
    )
  ) {
    return "trait";
  }
  if (
    primary === "PRODUCT_FORM" ||
    primary === "SERIES_CONCEPT" ||
    primary === "SERIES_CONTEXT" ||
    primary === "TITLE_LABEL" ||
    primary === "EVENT" ||
    /(?:ベスト|第\d+弾|総集編|コレクション|収録)/u.test(f)
  ) {
    return "form";
  }
  return "other";
}

export function deriveExecutionMode(
  fact: string,
  slot: "title" | "lead" | "body",
): PlanExecutionMode {
  const f = (fact ?? "").trim();
  if (!f) return "FREE_CONNECTIVE";

  // Title stays EXACT_SURFACE — prevents Evidence-外 theme drift (R151).
  if (slot === "title") return "EXACT_SURFACE";

  // Identity-critical body/lead atoms only — do NOT freeze scene/trait/theme/play nouns.
  // (R157) Blanket 2–16 kana/kanji EXACT caused checklist compression despite rich plans.
  // Quantities/durations stay EXACT; play-style DISTINCTIVE terms use SEMANTIC on body/lead
  // so Writer can form product-understanding prose (not bare tag drops).
  if (QUANTITY_MARKERS.test(f) && f.length <= 24) return "EXACT_SURFACE";
  if (isLikelyPerformerNameToken(f)) return "EXACT_SURFACE";

  const relations = deriveRequiredRelations(f);
  if (relations.length > 0) return "SEMANTIC_PRESERVE";

  // Descriptive scene / trait / theme / series / setting → SEMANTIC_PRESERVE so Writer can
  // form natural product-intro prose (R77-style expansion within ARTICLE_PLAN boundary).
  return "SEMANTIC_PRESERVE";
}

function allowedForMode(mode: PlanExecutionMode): string[] {
  if (mode === "EXACT_SURFACE") {
    return ["minimal presentation punctuation already balanced in plan", "natural particle adjustment only if surface identity preserved"];
  }
  if (mode === "SEMANTIC_PRESERVE") {
    return ["natural grammar adjustment", "equivalent concessive connectors when CONTRAST required", "pronoun use when identity preserved", "word order"];
  }
  return ["sentence connection", "paragraph transition", "grammatical inflection"];
}

function notAllowedFor(
  mode: PlanExecutionMode,
  relations: PlanRequiredRelation[],
  fact: string,
): string[] {
  const base = [
    "new concrete facts",
    "new promotional meaning",
    "quantity alteration",
    "performer role alteration",
    "title reinterpretation",
  ];
  if (relations.includes("CONTRAST")) {
    base.push("turning contrast into simple identity/property (e.g. である without concessive)");
  }
  if (relations.includes("CAUSE")) {
    base.push("dropping causal relation into mere sequence");
  }
  if (relations.includes("COMPARISON")) {
    base.push("dropping comparison into mere juxtaposition");
  }
  if (relations.includes("EXCLUSIVITY")) {
    base.push("weakening exclusivity (だけ→も)");
  }
  if (mode === "EXACT_SURFACE") {
    base.push("paraphrasing away surface identity");
  }
  // Short work-theme tags: SEMANTIC may connect/paraphrase membership, not invent psychology/story.
  if (isBareWorkThemeFact(fact) || (WORK_THEME_FACET_RE.test(fact.trim()) && fact.trim().length <= 8)) {
    base.push(
      "inventing emotions, psychology, narrative role, plot, or situation detail not present in the planned fact surface",
    );
    base.push("genre-knowledge expansion beyond recorded-theme membership / variety");
  }
  return base;
}

export function buildPlanFactExecutionTarget(
  fact: string,
  slot: "title" | "lead" | "body",
  index: number,
  readerJob?: string,
  presentationPurpose?: string,
): PlanFactExecutionTarget {
  const mode = deriveExecutionMode(fact, slot);
  const requiredRelations = deriveRequiredRelations(fact);
  const requiredAnchors = deriveRequiredAnchors(fact);
  const informationAxis = deriveInformationAxis(fact);
  const contributionId =
    slot === "body" && readerJob ? `${readerJob}::${index}` : `${slot}::${index}`;
  const allowed = allowedForMode(mode);
  if (isBareWorkThemeFact(fact) && mode === "SEMANTIC_PRESERVE") {
    allowed.push("membership / recorded-variety framing (含む・収録・要素)");
  }
  return {
    contributionId,
    slot,
    fact,
    executionMode: mode,
    requiredAnchors,
    requiredRelations,
    allowed,
    notAllowed: notAllowedFor(mode, requiredRelations, fact),
    informationAxis,
    ...(readerJob ? { readerJob } : {}),
    ...(presentationPurpose ? { presentationPurpose } : {}),
  };
}

export function buildArticlePlanExecutionContract(input: {
  title: { facts: string[]; job?: string };
  lead: { facts: string[]; job?: string };
  body: Array<{
    facts: string[];
    job?: string;
    presentationPurpose?: string | null;
    factPurposes?: Array<string | null> | null;
  }>;
}): PlanFactExecutionTarget[] {
  const out: PlanFactExecutionTarget[] = [];
  input.title.facts.forEach((f, i) => out.push(buildPlanFactExecutionTarget(f, "title", i)));
  input.lead.facts.forEach((f, i) => out.push(buildPlanFactExecutionTarget(f, "lead", i)));
  let bodyIdx = 0;
  for (const slot of input.body) {
    const readerJob =
      slot.job && slot.job !== "body_facts" && slot.job !== "body" ? slot.job : undefined;
    slot.facts.forEach((f, i) => {
      const purpose =
        slot.factPurposes?.[i] ?? slot.presentationPurpose ?? undefined;
      out.push(
        buildPlanFactExecutionTarget(
          f,
          "body",
          bodyIdx++,
          readerJob,
          purpose ?? undefined,
        ),
      );
    });
  }
  return out;
}

/** Slim Writer-visible view — identity/qty EXACT; scene/trait HOW left to Writer. */
export function toWriterExecutionContractView(
  targets: PlanFactExecutionTarget[],
): Array<{
  contributionId: string;
  slot: string;
  fact: string;
  executionMode: PlanExecutionMode;
  requiredAnchors: string[];
  requiredRelations: PlanRequiredRelation[];
  mustPreserve: string[];
  allowed: string[];
  notAllowed: string[];
  informationAxis?: PlanInformationAxis;
  readerJob?: string;
  presentationPurpose?: string;
}> {
  return targets.map((t) => {
    const exact = t.executionMode === "EXACT_SURFACE";
    // Minimize second-planner pressure on descriptive facts: keep fact + axis + notAllowed.
    // Relations/anchors stay for EXACT (names/qty) and for QUANTITY/ROLE relations only.
    const keepRelations = exact
      ? t.requiredRelations
      : t.requiredRelations.filter((r) => r === "QUANTITY" || r === "ROLE");
    const keepAnchors = exact
      ? t.requiredAnchors
      : t.requiredAnchors.filter((a) => /\d/.test(a) || a.length >= 4);
    return {
      contributionId: t.contributionId,
      slot: t.slot,
      fact: t.fact,
      executionMode: t.executionMode,
      requiredAnchors: keepAnchors,
      requiredRelations: keepRelations,
      mustPreserve: [
        ...keepRelations.map((r) => `relation:${r}`),
        ...(exact ? ["surface_identity"] : []),
      ],
      allowed: t.allowed,
      notAllowed: t.notAllowed,
      ...(t.informationAxis ? { informationAxis: t.informationAxis } : {}),
      ...(t.readerJob ? { readerJob: t.readerJob } : {}),
      ...(t.presentationPurpose ? { presentationPurpose: t.presentationPurpose } : {}),
    };
  });
}

/** Relation presence in Writer surface — category markers only. */
export function sentencePreservesRelation(
  sentence: string,
  relation: PlanRequiredRelation,
): boolean {
  const s = sentence ?? "";
  switch (relation) {
    case "CONTRAST":
      return CONTRAST_MARKERS.test(s);
    case "CAUSE":
      return CAUSE_MARKERS.test(s) || /(?:ため|ので)/u.test(s);
    case "COMPARISON":
      return COMPARISON_MARKERS.test(s);
    case "EXCLUSIVITY":
      return /(?:だけ|のみ)/u.test(s) && !/だけれど|だけど/u.test(s);
    case "NEGATION":
      return NEGATION_MARKERS.test(s);
    case "QUANTITY":
      return QUANTITY_MARKERS.test(s) || /\d/.test(s);
    case "ROLE":
      return ROLE_MARKERS.test(s);
    case "TEMPORAL":
      return TEMPORAL_MARKERS.test(s);
    default:
      return true;
  }
}

export function missingRelationsInSentence(
  sentence: string,
  required: PlanRequiredRelation[],
): PlanRequiredRelation[] {
  return required.filter((r) => !sentencePreservesRelation(sentence, r));
}

export function missingAnchorsInSentence(sentence: string, anchors: string[]): string[] {
  const s = (sentence ?? "").replace(/\s+/g, "");
  return anchors.filter((a) => {
    const n = a.replace(/\s+/g, "");
    if (n.length < 2) return false;
    return !s.includes(n);
  });
}
