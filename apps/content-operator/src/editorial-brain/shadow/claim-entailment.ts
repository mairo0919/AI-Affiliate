/**
 * Claim entailment / support classification — general, not lexicon-of-products.
 *
 * Principles:
 * 1. A name token in a naming claim does NOT entail world-setting assertions
 *    unless the claim *statement text* explicitly states those facts
 *    (EXPLICIT_TITLE_FACT → DIRECT / SAFE_COMPOSITION).
 * 2. Name/series/title *word-feel* alone → NAME_DERIVED when assertion invents
 *    setting/theme/relation absent from claim statements.
 * 3. Evaluative relations are unsupported unless a Claim states the same
 *    relation — supported factual facets alone do not license evaluation.
 */

import type { EditorialFailureCode } from "../core/failure-taxonomy.js";
import {
  extractNameTokens,
  extractTextFacets,
  isNamingClaimStatement,
  splitIntoSentences,
} from "./assertion-extract.js";
import {
  CATALOG_READOUT_RE,
  FILLER_META_RELATION_RE,
  SETTING_RELATION_RE,
  SOCIAL_PROOF_RELATION_RE,
  classifyRepetitionKind,
  claimStatesEvaluativeRelation,
  claimStatesInterpretiveRelation,
  detectPredicateFamilies,
  hasEvaluativeRelation,
  hasInterpretiveRelation,
  isRoleExpectedRecap,
  type PredicateFamily,
  type RepetitionKind,
} from "./predicate-families.js";
import type { AssertionSupportType, SemanticAssertion } from "./semantic-types.js";
import {
  isWeakFacet,
  runtimeDurationMinutes,
} from "../generation/contribution-family.js";

export type ClaimInput = { id: string; statement: string; kind?: string };

function catalogRoleFacet(f: string): boolean {
  return /^(シリーズ|メーカー|レーベル|出演|出演者|属する|クレジット|販売|配信|状態|情報|公開|確認|ページ)$/.test(
    f,
  );
}

function claimSupportsFacets(claim: ClaimInput, assertion: string): string[] {
  const claimFacets = extractTextFacets(claim.statement);
  return claimFacets.filter((f) => assertion.includes(f));
}

/**
 * Non-name content facets shared between claim statement and assertion.
 * Used to recognize EXPLICIT_TITLE_FACT (facts written in the claim text).
 */
function explicitContentFacetOverlap(claim: ClaimInput, assertion: string): string[] {
  const names = [
    ...extractNameTokens(claim.statement),
    ...extractNameTokens(assertion),
  ];
  return claimSupportsFacets(claim, assertion).filter(
    (f) => !names.some((n) => n.includes(f) || f.includes(n)) && !catalogRoleFacet(f),
  );
}

/** Assertion content facets that need textual support (excludes names / catalog glue). */
function assertionContentFacets(assertion: string): string[] {
  const names = extractNameTokens(assertion);
  return extractTextFacets(assertion).filter(
    (f) => !names.some((n) => n.includes(f) || f.includes(n)) && !catalogRoleFacet(f),
  );
}

function claimFacetCoversNeeded(claimFacetSet: Set<string>, needed: string): boolean {
  if (claimFacetSet.has(needed)) return true;
  // Quantity paraphrase: claim "1泊2日合同企画" covers assertion "1泊2日"
  if (/\d/.test(needed) && needed.length >= 3) {
    for (const cf of claimFacetSet) {
      if (/\d/.test(cf) && (cf.includes(needed) || needed.includes(cf))) return true;
    }
  }
  // Duration unit conversion: 8時間 ≡ 480分 (same absolute minutes)
  const neededMin = runtimeDurationMinutes(needed);
  if (neededMin != null) {
    for (const cf of claimFacetSet) {
      const cfMin = runtimeDurationMinutes(cf);
      if (cfMin != null && cfMin === neededMin) return true;
    }
  }
  return false;
}

/**
 * True when claim *statement* already states the assertion's factual content
 * (paraphrase of explicit title / identity / series facts — not name-feel alone).
 *
 * Requires coverage of the assertion's own content facets — sharing an unrelated
 * trait facet in the same sentence must not license a new setting.
 * Coverage uses claim *extracted facets* (not raw substring) to avoid
 * 連続展開 covering bare 展開.
 */
function claimExplicitlyEntailsAssertionFacts(claim: ClaimInput, assertion: string): boolean {
  const needed = assertionContentFacets(assertion);
  if (needed.length === 0) return false;
  const claimFacetSet = new Set(extractTextFacets(claim.statement));
  const covered = needed.filter((f) => claimFacetCoversNeeded(claimFacetSet, f));

  // Quantity / duration in both texts → EXPLICIT_TITLE_FACT
  if (covered.some((f) => /\d/.test(f) && f.length >= 3)) return true;

  const settingAssertion = SETTING_RELATION_RE.test(assertion);
  if (settingAssertion) {
    // Setting needs a rich claim statement (title/identity) or an explicit setting claim.
    // A short trait claim that merely shares backdrop facets must not license new setting.
    const titleRichClaim =
      claimFacetSet.size >= 6 ||
      /は公開ページ上で確認できる|公開ページ上で確認/.test(claim.statement);
    if (claimStatesSetting(claim) && covered.length > 0) return true;
    if (titleRichClaim && covered.filter((f) => f.length >= 2).length >= 3) return true;
    // Title-rich literal spans: compound tokens like 濃厚親父 still cover 濃厚 / 親父
    if (titleRichClaim) {
      const literal = needed.filter((f) => f.length >= 2 && claim.statement.includes(f));
      if (
        literal.filter((f) => f.length >= 3).length >= 2 ||
        literal.length >= Math.min(3, needed.length)
      ) {
        return true;
      }
    }
    return false;
  }

  if (
    covered.filter((f) => f.length >= 3).length >= 2 &&
    covered.length >= Math.ceil(needed.length * 0.5)
  ) {
    return true;
  }
  if (needed.length <= 4 && covered.length >= Math.ceil(needed.length * 0.75)) return true;
  return false;
}

function claimStatesSetting(claim: ClaimInput): boolean {
  return SETTING_RELATION_RE.test(claim.statement);
}

/**
 * Assertion invents setting/theme beyond what claim *statements* entail.
 * Explicit facts written inside identity/title/series claim text count as support
 * even when the claim lacks a SETTING_RELATION surface pattern.
 */
function assertionAddsSettingBeyondClaims(assertion: string, claims: ClaimInput[]): boolean {
  if (!SETTING_RELATION_RE.test(assertion)) return false;
  for (const c of claims) {
    // A. EXPLICIT_TITLE_FACT — statement text already carries the facts
    if (claimExplicitlyEntailsAssertionFacts(c, assertion)) return false;

    if (!claimStatesSetting(c)) continue;
    const names = extractNameTokens(c.statement);
    const nameOverlap = names.some((n) => assertion.includes(n));
    const facetOverlap = claimSupportsFacets(c, assertion).length > 0;
    if (nameOverlap || facetOverlap) return false;
    if (
      c.statement.length >= 8 &&
      assertion.includes(c.statement.slice(0, Math.min(12, c.statement.length)))
    ) {
      return false;
    }
  }
  return true;
}

function onlyNameOverlapWithNamingClaims(
  assertion: string,
  claims: ClaimInput[],
): { hit: boolean; claimIds: string[] } {
  const supporting: string[] = [];
  let nameOnly = false;

  for (const c of claims) {
    const names = extractNameTokens(c.statement);
    const nameHits = names.filter((n) => assertion.includes(n));
    if (nameHits.length === 0) continue;
    supporting.push(c.id);
    if (isNamingClaimStatement(c.statement)) {
      // Explicit title/identity facts overlapping assertion → not name-only
      if (claimExplicitlyEntailsAssertionFacts(c, assertion)) continue;
      const nonNameFacets = claimSupportsFacets(c, assertion).filter(
        (f) => !names.some((n) => n.includes(f) || f.includes(n)) && !catalogRoleFacet(f),
      );
      if (nonNameFacets.length === 0) nameOnly = true;
    }
  }
  return { hit: nameOnly && supporting.length > 0, claimIds: supporting };
}

function claimSupportsEvaluation(claim: ClaimInput, assertion: string): boolean {
  if (!claimStatesEvaluativeRelation(claim.statement)) return false;
  const hits = claimSupportsFacets(claim, assertion);
  if (hits.some((f) => !isWeakFacet(f))) return true;
  // Official / Writer-visible source texts: weak-only overlap (e.g. shared 魅力)
  // may still license promotional paraphrase of the same evaluative content.
  // Regular Claims still require a non-weak facet share.
  if (claim.id.startsWith("source_text:") && hits.length > 0 && hasEvaluativeRelation(assertion)) {
    return true;
  }
  return false;
}

function claimSupportsInterpretation(claim: ClaimInput, assertion: string): boolean {
  return (
    claimStatesInterpretiveRelation(claim.statement) &&
    claimSupportsFacets(claim, assertion).filter((f) => !isWeakFacet(f)).length > 0
  );
}

/** Merge Writer-visible source texts (e.g. officialDescription) into entailment claims. */
export function sourceTextsAsClaims(sourceTexts: string[] | undefined): ClaimInput[] {
  if (!sourceTexts?.length) return [];
  return sourceTexts
    .map((t) => t.trim())
    .filter((t) => t.length >= 8)
    .map((statement, i) => ({ id: `source_text:${i}`, statement }));
}

function applyRepetitionPolicy(input: {
  sourceSegment: string;
  supportType: AssertionSupportType;
  novelFacets: string[];
  reusedFacets: string[];
  failureCodes: EditorialFailureCode[];
  optionBNaturalIntro?: boolean;
}): { supportType: AssertionSupportType; repetitionKind: RepetitionKind } {
  const substantialReuse = input.reusedFacets.filter((f) => {
    if (isWeakFacet(f)) return false;
    // Katakana brand / Latin tokens alone are name-like echo, not prose restatement
    if (/^[\u30a0-\u30ff]{2,}$/.test(f) || /^[A-Za-z][A-Za-z0-9_-]{1,}$/.test(f)) return false;
    // Short kanji stems (松本 etc.) are name echo, not informational restatement alone
    if (f.length < 3 && !/^\d/.test(f)) return false;
    return true;
  });
  const qtyOrDurationOnly =
    substantialReuse.length > 0 &&
    substantialReuse.every(
      (f) => /^\d+(?:作品|名|人)$/.test(f) || runtimeDurationMinutes(f) != null,
    );

  // OPTION B product intro: lead overview → body scale echo is natural expansion, not BLOCKING restatement.
  // Equivalent duration is still normalized elsewhere (family / facetsSemanticallyEquivalent).
  if (input.optionBNaturalIntro && qtyOrDurationOnly && input.novelFacets.length === 0) {
    return { supportType: input.supportType, repetitionKind: "PARTIAL_OVERLAP_WITH_GAIN" };
  }

  const repetitionKind = classifyRepetitionKind({
    sourceSegment: input.sourceSegment,
    novelFacetCount: input.novelFacets.length,
    reusedFacetCount: substantialReuse.length,
    primarySupportType: input.supportType,
  });

  if (repetitionKind === "FULL_RESTATEMENT") {
    if (!isRoleExpectedRecap(input.sourceSegment)) {
      input.failureCodes.push("REPETITION");
      return { supportType: "REPETITION", repetitionKind };
    }
  }
  // ROLE_EXPECTED_RECAP / PARTIAL_OVERLAP_WITH_GAIN → no REPETITION failure
  return { supportType: input.supportType, repetitionKind };
}

export function classifyAssertionSupport(input: {
  sentence: string;
  sourceSegment: string;
  claims: ClaimInput[];
  previouslyUsedFacets: Set<string>;
  /** Writer-visible source texts (officialDescription etc.) — not Claim FKs. */
  sourceTexts?: string[];
  /** OPTION B natural intro: overview quantity echo is not FULL_RESTATEMENT. */
  optionBNaturalIntro?: boolean;
}): SemanticAssertion {
  const assertion = input.sentence.trim();
  const failureCodes: EditorialFailureCode[] = [];
  let supportType: AssertionSupportType | null = null;
  let supportingClaimIds: string[] = [];
  let confidence = 0.4;
  let addsInformation = false;
  const novelFacets: string[] = [];
  let reusedFacets: string[] = [];
  let repetitionKind: RepetitionKind = "NONE";
  const predicateFamilies: PredicateFamily[] = detectPredicateFamilies(assertion);
  const entailmentClaims = [...input.claims, ...sourceTextsAsClaims(input.sourceTexts)];

  if (CATALOG_READOUT_RE.test(assertion)) {
    failureCodes.push("CATALOG_NARRATION");
  }

  if (SOCIAL_PROOF_RELATION_RE.test(assertion)) {
    const socialSupported = entailmentClaims.some(
      (c) =>
        SOCIAL_PROOF_RELATION_RE.test(c.statement) && claimSupportsFacets(c, assertion).length > 0,
    );
    if (!socialSupported) {
      return {
        assertion,
        sourceSegment: input.sourceSegment,
        supportingClaimIds: [],
        supportType: "SOCIAL_PROOF",
        confidence: 0.75,
        addsInformation: false,
        failureCodes: ["SOCIAL_PROOF"],
        novelFacets: [],
        predicateFamilies,
        repetitionKind: "NONE",
      };
    }
  }

  const nameGate = onlyNameOverlapWithNamingClaims(assertion, input.claims);
  if (nameGate.hit && assertionAddsSettingBeyondClaims(assertion, entailmentClaims)) {
    return {
      assertion,
      sourceSegment: input.sourceSegment,
      supportingClaimIds: nameGate.claimIds,
      supportType: "NAME_DERIVED",
      confidence: 0.8,
      addsInformation: false,
      failureCodes: ["NAME_DERIVED_INFERENCE", "UNSUPPORTED_INFERENCE"],
      novelFacets: [],
      predicateFamilies,
      repetitionKind: "NONE",
    };
  }

  if (assertionAddsSettingBeyondClaims(assertion, entailmentClaims)) {
    failureCodes.push("UNSUPPORTED_INFERENCE", "GROUNDING");
    supportType = "UNSUPPORTED";
  }

  const hasEval = hasEvaluativeRelation(assertion);
  const hasInterp = hasInterpretiveRelation(assertion);
  const evalUnsupported =
    hasEval && !entailmentClaims.some((c) => claimSupportsEvaluation(c, assertion));
  const interpUnsupported =
    hasInterp && !entailmentClaims.some((c) => claimSupportsInterpretation(c, assertion));
  if (evalUnsupported) {
    supportType = "EVALUATIVE";
    failureCodes.push("EVALUATIVE_INFERENCE");
  }
  if (interpUnsupported) {
    supportType = supportType === "EVALUATIVE" ? "EVALUATIVE" : "INTERPRETIVE";
    failureCodes.push("INTERPRETIVE_INFERENCE");
  }

  const perClaimHits = entailmentClaims.map((c) => ({
    id: c.id,
    hits: claimSupportsFacets(c, assertion),
  }));
  const withHits = perClaimHits.filter((c) => c.hits.length > 0);
  supportingClaimIds = withHits
    .map((c) => c.id)
    .filter((id) => !id.startsWith("source_text:"));

  const isInferenceFail =
    supportType === "EVALUATIVE" ||
    supportType === "INTERPRETIVE" ||
    supportType === "UNSUPPORTED";

  if (!isInferenceFail && withHits.length === 1) {
    supportType = "DIRECT";
    confidence = 0.75;
  } else if (!isInferenceFail && withHits.length >= 2) {
    if (
      assertionAddsSettingBeyondClaims(assertion, entailmentClaims) ||
      evalUnsupported ||
      interpUnsupported
    ) {
      supportType = "UNSUPPORTED";
      failureCodes.push("UNSUPPORTED_INFERENCE");
    } else {
      supportType = "SAFE_COMPOSITION";
      confidence = 0.7;
    }
  }

  const allHits = withHits.flatMap((h) => h.hits);
  reusedFacets = [];
  for (const f of allHits) {
    const mins = runtimeDurationMinutes(f);
    const already =
      input.previouslyUsedFacets.has(f) ||
      (mins != null &&
        (input.previouslyUsedFacets.has(`${mins}分`) ||
          (Number.isInteger(mins / 60) &&
            input.previouslyUsedFacets.has(`${mins / 60}時間`))));
    if (!already) {
      novelFacets.push(f);
      input.previouslyUsedFacets.add(f);
      if (mins != null) {
        input.previouslyUsedFacets.add(`${mins}分`);
        if (Number.isInteger(mins / 60)) {
          input.previouslyUsedFacets.add(`${mins / 60}時間`);
        }
      }
    } else if (!reusedFacets.includes(f)) {
      reusedFacets.push(f);
    }
  }

  if (supportType === "DIRECT" || supportType === "SAFE_COMPOSITION") {
    addsInformation = novelFacets.length > 0;
    const policy = applyRepetitionPolicy({
      sourceSegment: input.sourceSegment,
      supportType,
      novelFacets,
      reusedFacets,
      failureCodes,
      optionBNaturalIntro: input.optionBNaturalIntro,
    });
    supportType = policy.supportType;
    repetitionKind = policy.repetitionKind;
    if (supportType === "REPETITION") {
      addsInformation = false;
      confidence = 0.7;
    }
  }

  if (supportType === "EVALUATIVE" || supportType === "INTERPRETIVE") {
    // Unsupported evaluation/interpretation is not REPETITION.
    // FILLER only when zero novel supported facets AND relation is suitability/recommendation/meta
    // (not every evaluative assertion is filler — e.g. invented "gap charm" is inference-primary).
    addsInformation = false;
    repetitionKind = classifyRepetitionKind({
      sourceSegment: input.sourceSegment,
      novelFacetCount: novelFacets.length,
      reusedFacetCount: reusedFacets.length,
      primarySupportType: supportType,
    });
    const suitabilityOrMeta =
      predicateFamilies.includes("SUITABILITY") ||
      predicateFamilies.includes("RECOMMENDATION") ||
      predicateFamilies.includes("FILLER_META") ||
      FILLER_META_RELATION_RE.test(assertion);
    if (
      novelFacets.length === 0 &&
      suitabilityOrMeta &&
      !isRoleExpectedRecap(input.sourceSegment)
    ) {
      failureCodes.push("FILLER");
    }
  }

  if (supportType === "UNSUPPORTED") {
    addsInformation = false;
  }

  // Filler-meta sentences: CTA / page-check encouragement without novel supported facts
  if (
    FILLER_META_RELATION_RE.test(assertion) &&
    novelFacets.length === 0 &&
    supportType !== "SOCIAL_PROOF" &&
    supportType !== "NAME_DERIVED"
  ) {
    if (!failureCodes.includes("FILLER")) failureCodes.push("FILLER");
    if (supportType === null || supportType === "DIRECT") {
      supportType = "FILLER";
      addsInformation = false;
      confidence = 0.7;
    }
  }

  if (supportType === null) {
    if (withHits.length === 0) {
      supportType = "DIRECT";
      addsInformation = false;
      confidence = 0.25;
    } else {
      supportType = "DIRECT";
      confidence = 0.55;
      addsInformation = novelFacets.length > 0;
      const policy = applyRepetitionPolicy({
        sourceSegment: input.sourceSegment,
        supportType,
        novelFacets,
        reusedFacets,
        failureCodes,
        optionBNaturalIntro: input.optionBNaturalIntro,
      });
      supportType = policy.supportType;
      repetitionKind = policy.repetitionKind;
      if (supportType === "REPETITION") addsInformation = false;
    }
  }

  return {
    assertion,
    sourceSegment: input.sourceSegment,
    supportingClaimIds,
    supportType,
    confidence,
    addsInformation,
    failureCodes: [...new Set(failureCodes)],
    novelFacets,
    predicateFamilies,
    repetitionKind,
  };
}

export function analyzeSegments(input: {
  segments: Array<{ role: string; text: string }>;
  claims: ClaimInput[];
  sourceTexts?: string[];
  optionBNaturalIntro?: boolean;
}): { assertions: SemanticAssertion[]; previouslyUsedFacets: Set<string> } {
  const previouslyUsedFacets = new Set<string>();
  const assertions: SemanticAssertion[] = [];
  for (const seg of input.segments) {
    for (const sentence of splitIntoSentences(seg.text)) {
      assertions.push(
        classifyAssertionSupport({
          sentence,
          sourceSegment: seg.role,
          claims: input.claims,
          previouslyUsedFacets,
          sourceTexts: input.sourceTexts,
          optionBNaturalIntro: input.optionBNaturalIntro,
        }),
      );
    }
  }
  return { assertions, previouslyUsedFacets };
}
