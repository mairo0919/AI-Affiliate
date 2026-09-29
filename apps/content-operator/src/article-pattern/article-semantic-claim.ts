/**
 * Meaning classes for article sentences and titles.
 * A hit is a construction (judgment, recommendation, experience, editorial frame)
 * that is not entailed by a planned fact. Product-word lists are not the classifier.
 */

export type ArticleSemanticClaimClass =
  | "FACTUAL_DESCRIPTION"
  | "SOURCE_ATTRIBUTED_EVALUATION"
  | "UNSUPPORTED_EVALUATION"
  | "RECOMMENDATION"
  | "VIEWING_EXPERIENCE"
  | "EDITORIAL_EMBELLISHMENT";

export type SemanticClaimHit = {
  class: ArticleSemanticClaimClass;
  span: string;
  reason: string;
};

const BLOCKING_CLASS = new Set<ArticleSemanticClaimClass>([
  "UNSUPPORTED_EVALUATION",
  "RECOMMENDATION",
  "VIEWING_EXPERIENCE",
  "EDITORIAL_EMBELLISHMENT",
]);

const ATTRIBUTION_RE = /公式では|公式紹介|と紹介され/;

function planBlob(planFacts: readonly string[]): string {
  return planFacts.map((f) => f.trim()).filter(Boolean).join("\n");
}

/**
 * The span is source wording when a planned fact contains it and the sentence
 * either quotes the surrounding fact slice or attributes the maker.
 */
function spanEntailedByPlan(
  sentence: string,
  span: string,
  planFacts: readonly string[],
): "quoted" | "attributed" | "absent" {
  const attributed = ATTRIBUTION_RE.test(sentence);
  let inPlan = false;
  for (const raw of planFacts) {
    const fact = raw.trim();
    if (!fact.includes(span)) continue;
    inPlan = true;
    if (fact.length >= 8) {
      const i = fact.indexOf(span);
      const slice = fact.slice(
        Math.max(0, i - 4),
        Math.min(fact.length, i + span.length + 4),
      );
      if (slice.length >= span.length + 2 && sentence.includes(slice)) return "quoted";
    } else if (sentence.includes(fact)) {
      return "quoted";
    }
  }
  if (inPlan && attributed) return "attributed";
  return "absent";
}

function pushHit(
  hits: SemanticClaimHit[],
  klass: ArticleSemanticClaimClass,
  span: string,
  reason: string,
): void {
  if (!span.trim()) return;
  if (hits.some((h) => h.span === span && h.class === klass)) return;
  hits.push({ class: klass, span, reason });
}

/**
 * Classify constructions in one sentence relative to planned facts.
 * FACTUAL_DESCRIPTION is the default and is not emitted as a hit.
 */
export function classifyArticleSentence(
  sentence: string,
  planFacts: readonly string[],
): SemanticClaimHit[] {
  const sent = sentence.trim();
  if (!sent) return [];
  const facts = planFacts.map((f) => f.trim()).filter(Boolean);
  const hits: SemanticClaimHit[] = [];

  const consider = (
    span: string,
    klass: ArticleSemanticClaimClass,
    reason: string,
  ): void => {
    const entailed = spanEntailedByPlan(sent, span, facts);
    if (entailed === "quoted") return;
    if (entailed === "attributed") {
      pushHit(hits, "SOURCE_ATTRIBUTED_EVALUATION", span, "maker wording kept with attribution");
      return;
    }
    pushHit(hits, klass, span, reason);
  };

  // Judgment morphology: unknown synonyms such as 革新的 / 印象的 / 魅力的.
  for (const m of sent.matchAll(/([\u4e00-\u9fff]{2,8})的(?:な|に|だ|です)/gu)) {
    consider(m[0], "UNSUPPORTED_EVALUATION", "adjectival judgment not in the planned facts");
  }

  // Speaker verdict and completeness praise, including paraphrases of the same act.
  for (const m of sent.matchAll(/とも言える|と言っても過言ではない|余すことなく|余すところなく|存分に/gu)) {
    consider(m[0], "UNSUPPORTED_EVALUATION", "speaker verdict or completeness praise");
  }

  // Reader-directed recommendation speech act.
  for (const m of sent.matchAll(
    /おすすめ|オススメ|お勧め|必見|見逃せ|ぴったり|見どころ|(?:見たい|楽しみたい|味わいたい)(?:人|方)/gu,
  )) {
    consider(m[0], "RECOMMENDATION", "reader recommendation not in the planned facts");
  }

  // Experience and spectacle frames. Unknown evaluative synonyms are the 的-adjective class above.
  for (const m of sent.matchAll(
    /堪能|味わ[えいう]|楽し[めむ]|体験でき|魅了|たまらな|臨場感|惹きつ|存在感|印象的|濃密|圧巻|刺激的|リアルな|禁断|快楽劇|繰り広げ/gu,
  )) {
    const klass =
      /堪能|味わ|楽し|体験|臨場感|魅了/.test(m[0])
        ? "VIEWING_EXPERIENCE"
        : /繰り広げ/.test(m[0])
          ? "EDITORIAL_EMBELLISHMENT"
          : "UNSUPPORTED_EVALUATION";
    consider(m[0], klass, "evaluative or editorial frame not in the planned facts");
  }

  return hits;
}

export function blockingSemanticClaims(
  sentence: string,
  planFacts: readonly string[],
): SemanticClaimHit[] {
  return classifyArticleSentence(sentence, planFacts).filter((h) => BLOCKING_CLASS.has(h.class));
}

const TITLE_PARTICLE_OR_GLUE = new Set([
  "作品",
  "ベスト",
  "収録",
  "出演",
  "記念",
  "特集",
  "版",
  "編",
]);

/**
 * Title stems that are not in the title authority (performer, work identity,
 * series, campaign, premise, factual feature). Particles are not stems.
 */
export function ungroundedTitleStems(
  title: string,
  authorityFacts: readonly string[],
): SemanticClaimHit[] {
  const authority = planBlob(authorityFacts);
  const hits: SemanticClaimHit[] = [];
  const runs = title.match(/[\u4e00-\u9fffァ-ヶーA-Za-z0-9]{2,}/gu) ?? [];
  for (const run of runs) {
    if (TITLE_PARTICLE_OR_GLUE.has(run) || /^\d+$/.test(run)) continue;
    if (authority.includes(run)) continue;
    const editorial = /世界|物語|禁断|濃密|艶やか|魅惑|究極|多彩|厳選/.test(run);
    pushHit(
      hits,
      editorial ? "EDITORIAL_EMBELLISHMENT" : "UNSUPPORTED_EVALUATION",
      run,
      editorial
        ? "editorial title frame is not in the title authority"
        : "title stem is not in the title authority",
    );
  }
  for (const m of title.matchAll(/繰り広げ|味わ[えう]|の世界/gu)) {
    const span = m[0] === "の世界" ? "世界" : m[0];
    if (authority.includes(span)) continue;
    pushHit(
      hits,
      "EDITORIAL_EMBELLISHMENT",
      span,
      "editorial title frame is not in the title authority",
    );
  }
  return hits;
}
