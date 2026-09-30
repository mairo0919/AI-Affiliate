/**
 * X Review / Compliance — publication gate before compose.
 * Publish-quality bar: grounding + safety + natural Japanese + information value.
 */

import {
  hasAwkwardTitleSubject,
  hasJoinedSourcePhrases,
  hasParticleHole,
  hasQuotedTitleFragment,
  hasSemanticRoleMismatch,
  isLoneWorkCopula,
  isSpecReadout,
  classifyXProseQuality,
  isTemplateExplainer,
  isTitleFragmentRun,
  ungroundedContentWord,
} from "./x-copy-quality.js";
import { detectXAdultExpressions } from "./x-social-content-policy.js";
import type { XSocialPlan } from "./social-plan.js";
import { writeXSocialCopy, synthesizeXSocialFromPlan } from "./social-write.js";
import type { LLMProvider } from "../adapters/types.js";

export type SocialReviewDimension =
  | "GROUNDING"
  | "FACTUAL_CONSISTENCY"
  | "NATURAL_JAPANESE"
  | "COHERENCE"
  | "PRODUCT_SPECIFICITY"
  | "VOICE"
  | "MEDIA_FIT"
  | "COMPLIANCE"
  | "PROSE_QUALITY";

export type SocialReviewFinding = {
  code: string;
  message: string;
  severity: "BLOCKING" | "WARNING";
  dimension: SocialReviewDimension;
};

export type SocialReviewResult = {
  ok: boolean;
  findings: SocialReviewFinding[];
  canRewrite: boolean;
  dimensions: Record<SocialReviewDimension, "PASS" | "FAIL" | "N/A">;
  decision: "PASS" | "REWRITE" | "SKIP";
};

const SOURCE_VOICE_RE =
  /してあげる|してあげ|ご体験あれ|できるんだ|聞かせて|したい。|されたい。|思います。|ご存じですか|だよね|なんだよ|がしたい|とがしたい|思いっきりしたい|見ていただけたら|いただけると|の好き[？?]|興奮する[？?]/u;

const MECHANICAL_TEMPLATE_RE =
  /が出演する作品|を軸にした作品紹介|の作品紹介。|時間収録のまとめ|の近作では、|見どころとして、|がどう展開するか気になる/u;

const GENERIC_PUFFERY_RE =
  /魅力を存分に|引き込まれること間違いなし|世界観をじっくりと味わ|核心を成しています|独特の世界観|独特の|没入|味わえ|大きな魅力となっています|魅力を引き立て|雰囲気を引き立て|世界観に注目です|魅力をじっくり|魅力的な作品です|魅力の一作|楽しめる一作|見逃せない一作|引き込まれます|目が離せません|魅力が際立つ|興味深い内容です|注目|入り込みやすい|世界観にじっくりと浸る|魅力をまとめて追える|名にふさわしい内容|魅力を感じ|新たな魅力を感じ|話題です|話題に|ファン必見|楽しめ|活躍|たっぷり|特別な内容で|一線を画す|存在感が際立つ|役柄が際立|際立って|が魅力となって|設定が魅力|知られて/u;

const CATALOG_SUMMARY_RE =
  /ベスト／総集編です。|収録コーナーまとめです|最新タイトルまとめです|公開情報ベースで作品のポイントを整理|ベスト／総集編としての見どころ。/u;

const FRAGMENT_ASSEMBLY_RE =
  /の近作では、.{8,}。見どころとして、|を取り上げるなら、.{6,}がどう展開するか/u;

/** Package / source fragment glue — stimulatory scraps concatenated as "introduction". */
const PACKAGE_FRAGMENT_GLUE_RE =
  /が出演する作品で[、,].{8,}[。．].{0,4}(?:やっぱ|要するに|つまり|結局)|金ヅル|ナメ腐った|生き物の本懐|P活女ども|金よりも性|未成熟なP活/u;

const SOURCE_SLOGAN_RE =
  /生き物の本懐|金よりも性|金ヅルとしか|ナメ腐った未成熟|やっぱ.{0,12}とは/u;

const UNSUPPORTED_SWEEP_RE =
  /結局[、,]?.{0,16}がすべて|要するに.{0,20}である|人間の本質は|生き物の本懐/u;

function compact(s: string): string {
  return s.replace(/\s+/g, "").trim();
}

function normalizeKey(s: string): string {
  return compact(s).replace(/[。．、，・！!？?「」『』【】（）()]/gu, "").toLowerCase();
}

function softFact(s: string): string {
  return s
    .replace(/[。．]+$/u, "")
    .replace(/ギブアップ\s*NG/giu, "ギブアップなし")
    .trim();
}

function sentencesOf(body: string): string[] {
  return body
    .split(/[。！？]/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

function groundingCorpus(plan: XSocialPlan): string[] {
  return [
    plan.subject,
    plan.contentType,
    plan.angle,
    plan.readerHook,
    plan.whyThisWork,
    plan.corePremise,
    plan.primaryAppeal,
    plan.secondaryAppeal,
    plan.productTitle,
    ...plan.workUnderstanding,
    ...plan.concreteDetails,
    ...plan.allowedClaims,
    ...plan.canonicalContext.performers,
    plan.canonicalContext.seriesName,
  ].filter((x): x is string => Boolean(x && String(x).trim()));
}

function isGrounded(sentence: string, plan: XSocialPlan): boolean {
  const n = normalizeKey(sentence);
  if (!n) return false;
  if (plan.subject && n.includes(normalizeKey(plan.subject))) return true;
  if (
    /出演|作品|紹介|取り上げ|企画|見どころ|一作|近作/u.test(sentence) &&
    (plan.subject || plan.allowedClaims.length)
  ) {
    return true;
  }
  for (const fact of groundingCorpus(plan)) {
    const f = normalizeKey(softFact(fact));
    if (!f) continue;
    if (n.includes(f) || f.includes(n)) return true;
    const squash = (value: string) => value.replace(/[のとはがをにで]/gu, "");
    const ns = squash(n);
    const fs = squash(f);
    if (fs.length >= 4 && (ns.includes(fs) || fs.includes(ns))) return true;
    const window = f.length >= 10 ? 5 : 6;
    if (f.length >= window && n.length >= window) {
      for (let i = 0; i <= f.length - window; i += 1) {
        if (n.includes(f.slice(i, i + window))) return true;
      }
    }
  }
  return false;
}

function isSoftEditorialWrap(sentence: string): boolean {
  return (
    sentence.length <= 42 &&
    /注目|印象|雰囲気|焦点|紹介できる|取り上げ|気になる点|差別化/u.test(sentence) &&
    !/魅力を存分|間違いなし|核心を成して/u.test(sentence)
  );
}

function isMechanicalIntro(body: string, plan: XSocialPlan): boolean {
  const sents = sentencesOf(body);
  if (MECHANICAL_TEMPLATE_RE.test(body)) return true;
  if (
    plan.subject &&
    sents.length >= 1 &&
    new RegExp(`^${plan.subject}出演$`, "u").test(sents[0]!) &&
    sents.length <= 2
  ) {
    return true;
  }
  if (plan.subject && new RegExp(`${plan.subject}の\\d`, "u").test(body)) return true;
  if (
    plan.subject &&
    new RegExp(`${plan.subject}の(?:今もなお|業界トップ|進化を続ける)`, "u").test(body)
  ) {
    return true;
  }
  return false;
}

export function reviewXSocialCopy(
  body: string,
  plan: XSocialPlan,
  opts?: { maxChars?: number },
): SocialReviewResult {
  const findings: SocialReviewFinding[] = [];
  const maxChars = opts?.maxChars ?? 240;
  const text = body.trim();
  const sents = sentencesOf(text);

  const dim: Record<SocialReviewDimension, "PASS" | "FAIL" | "N/A"> = {
    GROUNDING: "PASS",
    FACTUAL_CONSISTENCY: "PASS",
    NATURAL_JAPANESE: "PASS",
    COHERENCE: "PASS",
    PRODUCT_SPECIFICITY: "PASS",
    VOICE: "PASS",
    MEDIA_FIT: "PASS",
    COMPLIANCE: "PASS",
    PROSE_QUALITY: "PASS",
  };

  const fail = (
    dimension: SocialReviewDimension,
    code: string,
    message: string,
    severity: "BLOCKING" | "WARNING" = "BLOCKING",
  ) => {
    findings.push({ code, message, severity, dimension });
    if (severity === "BLOCKING") dim[dimension] = "FAIL";
  };

  if (!text || sents.length === 0) {
    fail("MEDIA_FIT", "EMPTY_BODY", "empty social body");
  }

  if (detectXAdultExpressions(text).hit) {
    fail("COMPLIANCE", "ADULT_EXPRESSION", "adult expression policy hit");
  }

  if (SOURCE_VOICE_RE.test(text)) {
    fail("VOICE", "SOURCE_VOICE", "non third-party voice");
  }

  if (/KMPVRが変わる|が変わる。|制作・著作株式会社|ケイ・エム・プロデュース/u.test(text)) {
    fail("VOICE", "BRAND_SLOGAN", "detached brand slogan");
  }

  if (
    /チェックしたい人向け|気になる作品|まとめてチェック|詳細は記事|気になる方は|気になる方に|興味がある方に|作品はこちら|詳しい紹介はこちら|作品のポイントは記事に書いています|作品の内容をもう少し詳しく|この作品の見どころはこちら|詳しい見どころは記事|におすすめ/u.test(
      text,
    )
  ) {
    fail("MEDIA_FIT", "STOCK_CTA", "stock CTA / navigation filler (publication owns link replies)");
  }

  if (/（\s*）|\(\s*\)|にたっぷりとね/u.test(text)) {
    fail("NATURAL_JAPANESE", "BROKEN_JAPANESE", "strip residue / empty parentheses");
  }

  if (
    /陽だまりの中で|パックリ開いた|楽しみながら.+(する|した)|手を上げた[。．]|突きまくる|尻をつか|ムチムチの絶対領域|シーンが見どころ/u.test(
      text,
    ) ||
    (sents.length >= 2 &&
      /が手を上げた|脚を楽しみ|クンニする|挿入する|中出しする|バックから/u.test(text) &&
      !/出演|紹介|取り上げ|作品で/u.test(text))
  ) {
    fail(
      "VOICE",
      "PACKAGE_SCENE_NARRATION",
      "package/scene narration voice — not third-party media introduction",
    );
  }
  if (
    sents.some(
      (s) =>
        /^(?:そして|その後|すると)/u.test(s) === false &&
        /しながら.+(する|した)$/u.test(s) &&
        !/出演|紹介|作品/u.test(s),
    )
  ) {
    fail("VOICE", "SCENE_NARRATION", "scene-narration sentence shape");
  }

  if (MECHANICAL_TEMPLATE_RE.test(text) || isMechanicalIntro(text, plan)) {
    fail(
      "NATURAL_JAPANESE",
      "MECHANICAL_TEMPLATE",
      "mechanical template / fact-formatter intro — not publish-quality media prose",
    );
  }

  if (FRAGMENT_ASSEMBLY_RE.test(text)) {
    fail(
      "NATURAL_JAPANESE",
      "FRAGMENT_ASSEMBLY",
      "claim/title fragment assembly — Writer must compose natural prose",
    );
  }

  if (hasParticleHole(text)) {
    fail(
      "NATURAL_JAPANESE",
      "BROKEN_PHRASE",
      "grammatically incomplete phrase — a word was dropped inside the clause",
    );
  }

  if (
    isTitleFragmentRun(text) ||
    sents.some((sent) => isTitleFragmentRun(sent)) ||
    (plan.productTitle ? hasJoinedSourcePhrases(text, plan.productTitle) : false)
  ) {
    fail(
      "NATURAL_JAPANESE",
      "TITLE_FRAGMENT_GLUE",
      "title fragments joined into a sentence without a real clause",
    );
  }

  if (hasQuotedTitleFragment(text)) {
    fail(
      "NATURAL_JAPANESE",
      "TITLE_FRAGMENT_GLUE",
      "quoted title fragment with no clause inside the quotes",
    );
  }

  if (sents.length >= 2) {
    const head = compact(sents[0] ?? "");
    const tail = compact(sents[1] ?? "");
    if ((tail.length >= 6 && head.includes(tail)) || (head.length >= 6 && tail.includes(head))) {
      fail(
        "NATURAL_JAPANESE",
        "TEMPLATE_EXPLAINER",
        "second sentence only repeats the first",
      );
    }
  }

  const primaryValues = (plan.semanticFacts ?? [])
    .filter((fact) => fact.salience === "primary")
    .map((fact) => fact.value);
  for (const code of classifyXProseQuality(text, { focus: plan.angle, productTitle: plan.productTitle })) {
    fail("PROSE_QUALITY", code, `x prose quality: ${code}`);
  }

  if (
    isTemplateExplainer(text) ||
    isLoneWorkCopula(text) ||
    hasSemanticRoleMismatch(text) ||
    ((plan.semanticFacts?.length ?? 0) > 0 && isSpecReadout(text, primaryValues)) ||
    (plan.productTitle ? hasAwkwardTitleSubject(text, plan.productTitle) : false)
  ) {
    fail(
      "NATURAL_JAPANESE",
      "TEMPLATE_EXPLAINER",
      "explainer template — 作品は〜だ / 状況設定が特徴 / として制作されています / 出演作では",
    );
  }

  if (PACKAGE_FRAGMENT_GLUE_RE.test(text) || SOURCE_SLOGAN_RE.test(text)) {
    fail(
      "VOICE",
      "PACKAGE_FRAGMENT_GLUE",
      "package/source fragment glue — not grounded third-party work introduction",
    );
  }

  if (UNSUPPORTED_SWEEP_RE.test(text)) {
    fail(
      "PRODUCT_SPECIFICITY",
      "UNSUPPORTED_SWEEP",
      "unsupported grand summary / slogan leap beyond grounded facts",
    );
  }

  if (CATALOG_SUMMARY_RE.test(text)) {
    fail("PRODUCT_SPECIFICITY", "CATALOG_SUMMARY", "catalog summary voice");
  }

  if (GENERIC_PUFFERY_RE.test(text)) {
    fail("PRODUCT_SPECIFICITY", "GENERIC_PUFFERY", "unsupported generic puffery closure");
  }

  const compactLen = compact(text).length;
  const typedFactInBody = (plan.semanticFacts ?? []).some((fact) => {
    const c = compact(fact.value);
    return (
      c.length >= 2 &&
      compact(text).includes(c) &&
      (c.length >= 3 || /^(?:VR|8K|配信限定)$/u.test(fact.value))
    );
  });
  const concreteHook =
    (plan.subject ? compact(text).includes(compact(plan.subject)) : true) &&
    [plan.corePremise, ...plan.allowedClaims, ...(plan.semanticFacts ?? []).map((fact) => fact.value)].some(
      (fact) => {
        const c = fact ? compact(fact) : "";
        return c.length >= 6 && compact(text).includes(c);
      },
    );
  const honestShort =
    Boolean(plan.subject) &&
    typedFactInBody &&
    compactLen >= 16 &&
    /収録している|収録されている|出演している/u.test(text);

  if (/という作品です|という設定が|という独特な舞台設定|という設定も|という設定を|という企画|を描く|描いて/u.test(text)) {
    fail("VOICE", "GENERIC_FRAME", "generic 「という作品／設定」 frame concentration");
  }

  // Publish bar: too short / name-only stubs.
  if (compactLen > 0 && compactLen < 36 && !(concreteHook && compactLen >= 16) && !honestShort) {
    fail("PRODUCT_SPECIFICITY", "LOW_INFORMATION", "body too short for publish-quality intro");
  } else if (
    sents.length <= 1 &&
    compactLen < 48 &&
    !concreteHook &&
    !honestShort &&
    (Boolean(plan.corePremise) || plan.workUnderstanding.length >= 1)
  ) {
    fail(
      "PRODUCT_SPECIFICITY",
      "THIN_WORK_INTRO",
      "parent copy too thin — expect multi-sentence work introduction",
      "BLOCKING",
    );
  }

  const semanticValues = (plan.semanticFacts ?? []).map((fact) => fact.value);
  const groundedForWords = [
    plan.subject,
    plan.contentType,
    plan.canonicalContext.seriesName,
    ...plan.canonicalContext.performers,
    ...(semanticValues.length > 0 ? semanticValues : plan.allowedClaims),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
  const extraWord = ungroundedContentWord(text, groundedForWords);
  if (extraWord) {
    fail("GROUNDING", "UNGROUNDED", `ungrounded word: ${extraWord}`);
  }

  if (/がの|のでは|なを|にを|をー|男かせ|たち顔|＆まで|ただしが|お姉さんがの|ひたすらられる|強。$|っぷりでされ|され大量|のった敏感/u.test(text)) {
    fail("NATURAL_JAPANESE", "BROKEN_JAPANESE", "broken japanese / strip residue");
  }

  for (const sent of sents) {
    if (/(?:たら|けど|だが|結果|後は|でしたが|したが|ですが|ますが|確実に)$/u.test(sent)) {
      fail("NATURAL_JAPANESE", "INCOMPLETE_SENTENCE", `incomplete: ${sent.slice(0, 24)}`);
    }
  }

  // Fragment assembly: single sentence that is essentially a raw claim paste.
  if (
    sents.length === 1 &&
    plan.allowedClaims.some((c) => {
      const f = softFact(c);
      return f.length >= 16 && text.includes(f) && compactLen <= f.length + 8;
    })
  ) {
    fail("NATURAL_JAPANESE", "FRAGMENT_ASSEMBLY", "raw claim fragment pasted as body");
  }

  for (const sent of sents) {
    if (/出演$/u.test(sent) && plan.subject && sent.includes(plan.subject)) continue;
    if (isSoftEditorialWrap(sent) && plan.subject && text.includes(plan.subject)) continue;
    if (!isGrounded(sent, plan)) {
      fail("GROUNDING", "UNGROUNDED", `ungrounded: ${sent.slice(0, 32)}`);
    }
  }

  if (
    sents.length <= 2 &&
    /復活から約?\d+年/.test(text) &&
    !plan.primaryAppeal &&
    !(plan.corePremise && plan.corePremise.length >= 16)
  ) {
    fail("PRODUCT_SPECIFICITY", "TOO_THIN", "identity/chronology insufficient");
  }

  if (compactLen > maxChars) {
    fail("MEDIA_FIT", "TOO_LONG", `body exceeds ${maxChars}`);
  }

  if (sents.length >= 2) {
    const groundedCount = sents.filter(
      (s) =>
        isGrounded(s, plan) ||
        (isSoftEditorialWrap(s) && !!plan.subject && text.includes(plan.subject)),
    ).length;
    if (groundedCount < sents.length) {
      fail("COHERENCE", "COHERENCE", "sentences not coherently about the same work");
    }
  }

  if (/ちゃんとエッチができるんだ|KMPVRが変わる/u.test(text)) {
    fail("VOICE", "HISTORIC_NG_VOICE", "historic NG persona/slogan shape");
  }

  const blocking = findings.filter((f) => f.severity === "BLOCKING");
  // Prefer rewrite over skip for Writer drift — including CTA/scene leaks.
  const rewriteable = new Set([
    "MECHANICAL_INTRO",
    "MECHANICAL_TEMPLATE",
    "TOO_LONG",
    "EMPTY_BODY",
    "THIN_WORK_INTRO",
    "LOW_INFORMATION",
    "UNGROUNDED",
    "COHERENCE",
    "ADULT_EXPRESSION",
    "BROKEN_JAPANESE",
    "INCOMPLETE_SENTENCE",
    "CATALOG_SUMMARY",
    "GENERIC_PUFFERY",
    "GENERIC_FRAME",
    "FRAGMENT_ASSEMBLY",
    "PACKAGE_FRAGMENT_GLUE",
    "BROKEN_PHRASE",
    "TITLE_FRAGMENT_GLUE",
    "TEMPLATE_EXPLAINER",
    "ARTICLE_SUMMARY_STYLE",
    "CATALOG_DESCRIPTION_STYLE",
    "TITLE_PARAPHRASE_STYLE",
    "GENERIC_WORK_INTRO",
    "FOCUS_NOT_SPECIFIC",
    "UNSUPPORTED_SWEEP",
    "TOO_THIN",
    "STOCK_CTA",
    "PACKAGE_SCENE_NARRATION",
    "SCENE_NARRATION",
    "SOURCE_VOICE",
    "BRAND_SLOGAN",
    "PARENT_URL_FORCED",
    "THREAD_DUPLICATE",
    "IRRELEVANT_RELATED",
    "LINK_OVERLOAD",
    "FIXED_THREAD_TEMPLATE",
  ]);
  const hardFail = new Set(["HISTORIC_NG_VOICE"]);
  const canRewrite =
    blocking.length > 0 &&
    blocking.every((f) => rewriteable.has(f.code)) &&
    !blocking.some((f) => hardFail.has(f.code));

  const decision: SocialReviewResult["decision"] =
    blocking.length === 0 ? "PASS" : canRewrite ? "REWRITE" : "SKIP";

  return {
    ok: blocking.length === 0,
    findings,
    canRewrite: decision === "REWRITE",
    dimensions: dim,
    decision,
  };
}

export type XPublicationUnitPost = {
  sequence: number;
  threadRole?: string;
  body: string;
  linkKind?: string;
  relatedPublicationId?: string;
};

/**
 * Review the full publication unit (parent + replies).
 * Does not invent copy — only blocks bad structure / navigation.
 */
export function reviewXSocialPublicationUnit(input: {
  plan: XSocialPlan;
  parentBody: string;
  posts: XPublicationUnitPost[];
  relatedReasons?: string[];
}): SocialReviewResult {
  const parentReview = reviewXSocialCopy(input.parentBody, input.plan);
  const findings = [...parentReview.findings];
  const dim = { ...parentReview.dimensions };

  const fail = (
    dimension: SocialReviewDimension,
    code: string,
    message: string,
    severity: "BLOCKING" | "WARNING" = "BLOCKING",
  ) => {
    findings.push({ code, message, severity, dimension });
    if (severity === "BLOCKING") dim[dimension] = "FAIL";
  };

  const parent = input.posts.find((p) => p.sequence === 1) ?? input.posts[0];
  if (parent && /https?:\/\//i.test(parent.body)) {
    fail(
      "MEDIA_FIT",
      "PARENT_URL_FORCED",
      "parent post must not carry WP/affiliate/related URLs — use replies",
    );
  }

  const replies = input.posts.filter((p) => p.sequence > 1);
  const linkReplies = replies.filter((p) => /https?:\/\//i.test(p.body));
  if (linkReplies.length > 2) {
    fail("MEDIA_FIT", "LINK_OVERLOAD", "too many link replies in one publication unit");
  }

  const related = replies.find(
    (p) =>
      p.threadRole === "RELATED_REPLY" ||
      /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(p.body),
  );
  if (related) {
    const reasons = input.relatedReasons ?? [];
    const strong =
      reasons.includes("sameActress") ||
      reasons.includes("samePerformer") ||
      reasons.includes("sameSeries") ||
      (reasons.includes("sameGenre") && reasons.includes("sameMaker")) ||
      reasons.filter((r) => r.startsWith("same")).length >= 2;
    if (!strong) {
      fail(
        "COHERENCE",
        "IRRELEVANT_RELATED",
        "related X reply lacks strong canonical relation",
      );
    }
  }

  // Parent body text duplicated into a WP/related reply (aside from short nav).
  const parentCompact = input.parentBody.replace(/\s+/g, "");
  for (const r of replies) {
    const replyText = r.body.replace(/https?:\/\/\S+/gu, "").replace(/\s+/g, "");
    if (replyText.length >= 24 && parentCompact.includes(replyText.slice(0, 24))) {
      fail("COHERENCE", "THREAD_DUPLICATE", "reply duplicates parent introduction copy");
    }
  }

  // Soft warning when every reply is identical fixed CTA shape across roles.
  const navBodies = replies.map((r) => r.body.replace(/https?:\/\/\S+/gu, "").trim());
  if (
    navBodies.length >= 2 &&
    navBodies.every((b) => /^(記事はこちら|詳しくはこちら|作品のポイントは記事に)/u.test(b))
  ) {
    fail(
      "MEDIA_FIT",
      "FIXED_THREAD_TEMPLATE",
      "fixed identical navigation template across replies",
      "WARNING",
    );
  }

  const blocking = findings.filter((f) => f.severity === "BLOCKING");
  // Structural thread failures → SKIP (do not rewrite parent body to "fix" nav).
  const structuralHard = blocking.some((f) =>
    ["IRRELEVANT_RELATED", "LINK_OVERLOAD", "PARENT_URL_FORCED", "THREAD_DUPLICATE"].includes(
      f.code,
    ),
  );
  const decision: SocialReviewResult["decision"] =
    blocking.length === 0
      ? "PASS"
      : structuralHard
        ? "SKIP"
        : parentReview.canRewrite
          ? "REWRITE"
          : "SKIP";

  return {
    ok: blocking.length === 0,
    findings,
    canRewrite: decision === "REWRITE",
    dimensions: dim,
    decision,
  };
}

function findingsToHints(findings: SocialReviewFinding[]): string[] {
  const codes = new Set(findings.map((f) => f.code));
  const hints: string[] = [];
  if (codes.has("ADULT_EXPRESSION")) {
    hints.push("Remove adult/sexual wording; paraphrase only with EXPRESSION_SAFE_FACTS.");
  }
  if (codes.has("MECHANICAL_TEMPLATE") || codes.has("MECHANICAL_INTRO")) {
    hints.push("Avoid が出演する作品で / 作品紹介 templates; write a varied natural opening.");
  }
  if (codes.has("CATALOG_SUMMARY") || codes.has("GENERIC_PUFFERY") || codes.has("GENERIC_FRAME")) {
    hints.push(
      "Remove every evaluation (魅力, 話題, 世界観, 没入, 味わえる, 楽しめる, 活躍). The sentence may only name the performer and one EXPRESSION_SAFE_FACT.",
    );
  }
  if (
    codes.has("FRAGMENT_ASSEMBLY") ||
    codes.has("BROKEN_JAPANESE") ||
    codes.has("BROKEN_PHRASE") ||
    codes.has("TITLE_FRAGMENT_GLUE") ||
    codes.has("TEMPLATE_EXPLAINER") ||
    codes.has("PACKAGE_FRAGMENT_GLUE")
  ) {
    hints.push(
      "Write only a relation that is already in RELATIONS. Put the primary fact in the sentence. Do not make the post a runtime, disc count, BEST, or 配信限定 readout. Do not write 「の作品は、〜だ」. Do not treat a campaign as something that 収録される, or a person as the work.",
    );
  }
  if (codes.has("UNSUPPORTED_SWEEP")) {
    hints.push("Remove unsupported grand summaries; stay inside grounded work facts.");
  }
  if (
    codes.has("ARTICLE_SUMMARY_STYLE") ||
    codes.has("CATALOG_DESCRIPTION_STYLE") ||
    codes.has("TITLE_PARAPHRASE_STYLE") ||
    codes.has("GENERIC_WORK_INTRO") ||
    codes.has("FOCUS_NOT_SPECIFIC")
  ) {
    hints.push(
      "Fact overlap is not enough. Write one natural X post about FOCUS only. Do not use 本作は, として制作, が特徴, or a title paraphrase as an overview.",
    );
  }
  if (codes.has("THIN_WORK_INTRO") || codes.has("LOW_INFORMATION") || codes.has("TOO_THIN")) {
    hints.push("Write one or two sentences about FOCUS. Do not expand into a work overview.");
  }
  if (codes.has("UNGROUNDED") || codes.has("COHERENCE")) {
    hints.push(
      "Stay inside ANGLE / WORK_UNDERSTANDING / EXPRESSION_SAFE_FACTS. Do not invent cast history, jobs, or scenes absent from the plan.",
    );
  }
  if (codes.has("TOO_LONG")) {
    hints.push("Shorten to fit X length while keeping the work-specific hook.");
  }
  if (codes.has("STOCK_CTA")) {
    hints.push("Remove CTA / navigation filler; publication adds the URL.");
  }
  if (hints.length === 0) {
    hints.push("Rewrite as publish-quality third-party media introduction.");
  }
  return hints;
}

export async function rewriteXSocialCopyOnce(
  previous: string,
  plan: XSocialPlan,
  findings: SocialReviewFinding[],
  opts?: { llm?: LLMProvider | null; model?: string },
): Promise<string | null> {
  const codes = new Set(findings.map((f) => f.code));
  const hints = findingsToHints(findings);
  if (codes.has("EMPTY_BODY") || !previous.trim()) {
    hints.unshift(
      "Previous draft was empty or discarded. Write a fresh publish-quality body from EXPRESSION_SAFE_FACTS / SUBJECT / ANGLE only.",
    );
  }
  hints.push(
    "Rewrite as a complete publish-quality third-party intro from the same grounded understanding — not a partial patch that invents new claims.",
  );

  if (opts?.llm) {
    const anchorOnPrevious =
      !codes.has("TEMPLATE_EXPLAINER") &&
      !codes.has("TITLE_FRAGMENT_GLUE") &&
      !codes.has("GENERIC_PUFFERY") &&
      !codes.has("ARTICLE_SUMMARY_STYLE") &&
      !codes.has("CATALOG_DESCRIPTION_STYLE") &&
      !codes.has("TITLE_PARAPHRASE_STYLE") &&
      !codes.has("GENERIC_WORK_INTRO") &&
      !codes.has("FOCUS_NOT_SPECIFIC");
    const rewritten = await writeXSocialCopy(plan, {
      llm: opts.llm,
      model: opts.model,
      revisionHints: hints,
      previousBody: anchorOnPrevious ? previous.trim() || null : null,
    });
    if (rewritten.body && rewritten.body !== previous) {
      return rewritten.body;
    }
    return null;
  }

  // Offline / tests only — never the production publish path when LLM is configured.
  if (codes.has("TOO_LONG")) {
    const short = synthesizeXSocialFromPlan({
      ...plan,
      secondaryAppeal: null,
      concreteDetails: [],
    });
    return short.sentences.slice(0, 2).join("") || null;
  }
  const synthesized = synthesizeXSocialFromPlan(plan);
  if (synthesized.body && synthesized.body !== previous) return synthesized.body;
  return null;
}
