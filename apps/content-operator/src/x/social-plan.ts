/**
 * X Planner — decides HOW to introduce the work on X.
 *
 * Separates:
 * - work understanding (canonical meaning; adult spans stripped, may be longer)
 * - expression-safe facts (X-timeline quotable surfaces)
 *
 * Does not write final copy. Thin material → SKIP.
 */

import {
  hasParticleHole,
  isExpressionSafeFact,
  isParticleFreeTitleStack,
  isTitleFragmentRun,
} from "./x-copy-quality.js";
import { extractSemanticFacts, selectSemanticFacts } from "./semantic-facts.js";
import { detectXAdultExpressions, stripXAdultSpans } from "./x-social-content-policy.js";

export type XPlanSkip = {
  reason: "SOCIAL_CONTENT_TOO_THIN";
  detail: string;
};

/** Publication intent — Planner decides what to introduce; Publication owns reply assembly. */
export type XSocialPublicationIntent = {
  /** Prefer a short WP article reply when a public URL exists. */
  needsArticleReply: boolean;
  /** Prefer a related published X reply when a strong candidate exists. */
  relatedPostUseful: boolean;
  /** Soft order preference when both replies are available. */
  preferredReplyOrder:
    | "parent_only"
    | "wp_only"
    | "related_only"
    | "wp_then_related"
    | "related_then_wp"
    | null;
};

/** Role of a fact the Writer may use. who = person, what = the work, attribute = count/runtime/format, premise = official situation. */
export type SemanticFactRole = "who" | "what" | "attribute" | "premise";

export type SemanticFact = {
  role: SemanticFactRole;
  value: string;
  provenance: { source: string; evidence: string };
};

/** Writer-visible plan — editorial intent, not a fact dump list. */
export type XSocialPlan = {
  subject: string | null;
  contentType: string | null;
  /** What is interesting about this work (editorial, not finished copy). */
  whatIsInteresting: string;
  /** Editorial cut — what to introduce (NOT finished copy). */
  angle: string;
  /** Reader interest hook grounded in understanding. */
  readerHook: string;
  /** Why this work is worth introducing. */
  whyThisWork: string;
  /** Supporting claims the Writer may lean on (expression-safe). */
  supportingClaims: string[];
  /** Understanding notes (adult-stripped meaning; paraphrase boundary, not paste list). */
  workUnderstanding: string[];
  /** Legacy aliases mapped from editorial fields for grounding / tests. */
  corePremise: string | null;
  primaryAppeal: string | null;
  secondaryAppeal: string | null;
  concreteDetails: string[];
  /** X-safe surfaces the Writer may quote into final copy. */
  allowedClaims: string[];
  /** Typed facts. Absent on older fixtures; Writer then treats allowedClaims as premises. */
  semanticFacts?: SemanticFact[];
  /** Soft publication intent — not a fixed thread template. */
  publicationIntent: XSocialPublicationIntent;
  productTitle: string;
  canonicalContext: {
    performers: string[];
    seriesName: string | null;
    claimCount: number;
    droppedAdultCount: number;
  };
};

export type XPlanResult =
  | { ok: true; plan: XSocialPlan }
  | { ok: false; skip: XPlanSkip };

export type XPlannerInput = {
  canonicalTitle: string;
  productTitle?: string | null;
  performerNames?: string[];
  seriesName?: string | null;
  claimStatements?: Array<{ id?: string; statement: string }>;
  groundedPlanFacts?: string[];
};

const SOURCE_VOICE_RE =
  /してあげる|してあげないと|ご体験あれ|ご堪能|いただけると|見ていただけたら|できるんだ|なんだよ|だよね|聞かせて|してね|してほしい|させてくれる|(?:したい|されたい|してみたい)|思います|ご存じですか|エッチができる|思いっきりしたい|の好き[？?]|興奮する[？?]|教えてくれる|と囁かれ|僕は、こんなに|裏切ったんだから/u;

const BRAND_SLOGAN_RE = /KMPVRが変わる|が変わる$/u;
const THIN_CHRONOLOGY_RE = /^復活から約?\d+年$|^約?\d+年ぶり$/u;
const INCOMPLETE_TAIL_RE =
  /(?:たら|たり|って|て|で|ので|のに|から|けれど|けど|だが|ながら|つつ|結果|後は|好き勝手|でしたが|したが|ですが|ますが|確実に|なかったが|出来なかったが|できなかったが)$/u;

function embedsUnparsedSubject(text: string, subject: string): boolean {
  const s = text.replace(/\s+/gu, "");
  const at = s.indexOf(subject);
  if (at <= 0) return false;
  const before = s.slice(0, at);
  if (/[はがをにでの]/u.test(before)) return false;
  return before.length >= 4;
}

function compact(s: string): string {
  return s.replace(/\s+/g, "").trim();
}

function normalizeKey(s: string): string {
  return compact(s).replace(/[。．、，・！!？?「」『』【】（）()＃#]/gu, "").toLowerCase();
}

function cleanAtom(raw: string): string {
  return compact(raw)
    .replace(/^(?:work_theme|situation|relationship|feature|performer|series|taxonomy_aux):/iu, "")
    .replace(/は公開カタログ上で確認できる。?/u, "")
    .replace(/^【VR】/u, "")
    .replace(/【AIリマスター版】/gu, "")
    .replace(/【8K】/gu, "")
    .replace(/\s*8KVR\s*$/u, "")
    .replace(/[。．！？]+$/u, "");
}

/** Expression-safe or understanding-clean plan text (no adult / hole debris). */
function isCleanPlanText(raw: string, opts?: { maxLen?: number }): boolean {
  const maxLen = opts?.maxLen ?? 56;
  const s = cleanAtom(raw);
  if (s.length < 6 || s.length > maxLen) return false;
  if (detectXAdultExpressions(s).hit) return false;
  if (hasParticleHole(s) || isTitleFragmentRun(s) || isParticleFreeTitleStack(s)) return false;
  if (/エロ|下品|変態|精液|中出し|ヌケ|イカされ/u.test(s)) return false;
  if (SOURCE_VOICE_RE.test(s)) return false;
  if (INCOMPLETE_TAIL_RE.test(s)) return false;
  if (/[はがをにとの]$/u.test(s) && s.length >= 6) return false;
  if (
    /もそうな|ぶりにになりました|鬼オホ|唸り|MAXケ|ダモノ|ハダカ|見えする|僕のとを|とをたち|女の子とのに|」、|されて何度も|極限POV|い・け・な・い|に沼る|KMPVR|制作・著作|おじいちゃんを|体つきになり|打ち解ける母|間違った方向|押し殺してきた性癖|連射|1発のでは|貪欲なを|高身長Wカップル|性癖の開放|巨乳美女|塗りたくり|起き上がり|散らす激しい|＃マッサージ|からしていた|のった|らせて|を吹き|直後の|ヤりまくり|ヤリまくり|やることないからヤ|エッチな姿|肉欲|に堕ちる|ニューハーフ/u.test(
      s,
    )
  ) {
    return false;
  }
  if (/^[」『【（(]/u.test(s)) return false;
  if (/のでは|なを|にを|をー|では満足|1発のでは|若いを|だってのよ|だってH|甘くて姿|て姿$/u.test(s)) return false;
  return true;
}

/** X-timeline quotable atom (strict). */
function isXSafeAtom(raw: string): boolean {
  if (!isCleanPlanText(raw, { maxLen: 42 })) return false;
  const s = cleanAtom(raw);
  if (BRAND_SLOGAN_RE.test(s) && s.length <= 24) return false;
  if (/KMPVR|制作・著作|ケイ・エム・プロデュース/u.test(s)) return false;
  if (THIN_CHRONOLOGY_RE.test(s)) return false;
  if (/^[A-Za-z0-9\-_.]{4,}$/u.test(s)) return false;
  if (/GIRLS?COLLECTION/iu.test(s) && s.length < 28) return false;
  if (/最大のを|のを感|と大量$|だらけのを|生殖器|子宮|セフレ|バチボコ/u.test(s)) return false;
  if (/^(?:BEST|ベスト|総集編|独占配信|単体作品|作品紹介)$/iu.test(s)) return false;
  if (/られるBEST|ひたすらられる|満足するまで|もう死ん|放してくれ/u.test(s)) return false;
  if (/[〇○●]/u.test(s)) return false;
  if (/が出演する作品|を軸にした作品紹介|時間収録のまとめ/u.test(s)) return false;
  if (/のが大好き|で敏感\s|押し殺してきた性癖|一日中イカ|騙して街中/u.test(s)) return false;
  if (/^「[^」]{6,}」$/u.test(s)) return false;
  if (/ずらして|なまくる|をずら|続けて電|と囁かれ|教えてくれる|まくる|のった|らせて|たいSP/u.test(s)) return false;
  if (/七十路|六十路|五十路|勝てば賞金|GET！|^の限界|風俗嬢/u.test(s)) return false;
  if (/マジ天使|とってもかわいい|賞金GET|負ければ|打ち解ける母|間違った方向/u.test(s)) return false;
  if (/ニューハーフ/u.test(s) && s.length <= 8) return false;
  if (/\s/u.test(raw) && (raw.match(/\s/g) || []).length >= 2) return false;
  if (/(?:の|と|を|に|が|は)\s+\S/u.test(s) && s.length <= 40) return false;
  if (/のでは|なを|にを|をー|では満足|1発の\s*では|若いを|柔らかな\s*まくる/u.test(s)) return false;
  if (/制作・著作|株式会社ケイ|イッちゃう|ハァハァ|力尽きた/u.test(s)) return false;
  if (/（\s*）|\(\s*\)|にたっぷりとね|肉欲|変態家族|美尻|ぷりぷり/u.test(s)) return false;
  // Soft-adult / act-adjacent surfaces that are not timeline-safe even if not in adult regex.
  if (/ヤりまくり|ヤリまくり|やることないからヤ|エッチな|肉欲|に堕ちる|アナル|ニューハーフ/u.test(s)) {
    return false;
  }
  return true;
}

/** Understanding note — adult-stripped meaning; not for verbatim X paste. */
function toUnderstandingNote(raw: string): string | null {
  const base = cleanAtom(raw);
  // Deleting an adult word leaves a broken fragment. Drop the phrase instead.
  if (!base || stripXAdultSpans(base) !== base) return null;
  let t = base;
  t = t.replace(/\s+を\s+/gu, " ").replace(/\s+/gu, " ").trim();
  t = t.replace(/[～〜]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (t.length < 8 || t.length > 72) return null;
  if (!isCleanPlanText(t, { maxLen: 72 })) return null;
  if (/^「[^」]{6,}」$/u.test(t)) return null;
  if (/^(?:BEST|ベスト|総集編|独占配信|単体作品)$/iu.test(t)) return null;
  return t.slice(0, 72);
}

export function salvageTitleHook(title: string, subject: string | null): string | null {
  if (detectXAdultExpressions(title).hit) return null;
  let t = title;
  if (subject && t.includes(subject)) {
    t = t.replaceAll(subject, " ");
  }
  t = t.replace(/\s+を\s+/gu, " ").replace(/\s+/gu, " ").trim();
  const compactTitle = t.replace(/\s+/gu, "");
  if (SOURCE_VOICE_RE.test(compactTitle)) return null;
  if (/のでは|なを|にを|をー|では満足|1発の射精/u.test(compactTitle)) return null;
  if (/[\s　＆&]/u.test(title)) return null;
  if (
    compactTitle.length >= 8 &&
    compactTitle.length <= 42 &&
    !detectXAdultExpressions(compactTitle).hit &&
    !hasParticleHole(compactTitle) &&
    !isTitleFragmentRun(compactTitle) &&
    !isParticleFreeTitleStack(compactTitle) &&
    !/エロ|下品|変態|精液|ヌケ/u.test(compactTitle)
  ) {
    return compactTitle;
  }
  return null;
}

function catalogHooksFromTitle(title: string): string[] {
  const hooks: string[] = [];
  const hours = title.match(/(?<![\d.])(\d+(?:\.\d+)?)\s*時間/u);
  if (hours?.[1]) {
    hooks.push(`${hours[1]}時間の収録ボリューム`);
  }
  if (/BEST|ベスト|総集編/iu.test(title)) {
    hooks.push("複数タイトルを横断した総集編");
  }
  const people = title.match(/(?<![\d.])(\d+)\s*名/u);
  if (people?.[1]) {
    hooks.push(`${people[1]}名が出演する企画`);
  }
  // Safe setting nouns that survive adult filtering.
  for (const noun of [
    "メンズエステ",
    "ハンドテク",
    "密室タクシー",
    "タクシードライバー",
    "保育士",
    "ランナー",
    "町内会",
    "合宿",
  ]) {
    if (title.includes(noun) && noun.length >= 4) hooks.push(noun);
  }
  return hooks.filter((h) => h.length >= 6 && (isXSafeAtom(h) || (h.length <= 12 && /エステ|タクシー|ハンドテク|保育士|ランナー/u.test(h))));
}

function splitTitleAtoms(title: string): string[] {
  const raw = title
    .replace(/^【VR】/u, "")
    .replace(/【AIリマスター版】/gu, "")
    .replace(/\s*8KVR\s*$/u, "")
    .trim();
  if (!raw) return [];
  const clauses = raw
    .split(/[！!？?。．…／/|｜＆&]+|\s+/u)
    .map((c) => c.trim())
    .filter((c) => c.length >= 4);
  return clauses.length > 0 ? clauses : [raw];
}

function detectContentType(title: string, series: string | null): string | null {
  const t = title;
  if (/VR|8K/i.test(t)) return "VR作品";
  if (/BEST|ベスト|総集編|コンプリート/i.test(t)) return "ベスト／総集編";
  if (series) return "シリーズ作品";
  if (/単体/u.test(t)) return "単体作品";
  return "作品紹介";
}

function isStrongFeature(text: string): boolean {
  return (
    /\d+タイトル|(?:完全)?コンプリート|\d+作品|\d+人大集合|ギブアップ|業界トップ|尻テク|全コーナー|\d+時間/u.test(
      text,
    ) && text.length >= 8
  );
}

function isPremiseLike(text: string): boolean {
  if (isStrongFeature(text)) return false;
  return (
    text.length >= 12 &&
    (/[はがをにでと]/u.test(text) ||
      /合宿|町内会|ソープ|エステ|企画|設定|出演|タダマン|メンズエステ|ギャル|撮影|タクシー|密室|ランナー|保育士/u.test(
        text,
      ))
  );
}

function pickSubject(performers: string[], title: string): string | null {
  const named = performers
    .map((p) => p.trim())
    .filter(
      (p) =>
        p.length >= 2 &&
        p.length <= 12 &&
        p !== "(none)" &&
        !detectXAdultExpressions(p).hit &&
        !/手のひら|久しぶり|激エロ|塩対応|赤ちゃん|しろうと|フィスト|近親/u.test(p),
    );
  if (named[0]) return named[0]!;
  const m = title.match(/^([一-龯ぁ-んァ-ンー]{2,8})(?:の|と|が|は)/u);
  if (
    m?.[1] &&
    m[1].length >= 3 &&
    !detectXAdultExpressions(m[1]).hit &&
    !/手のひら|久しぶり|激エロ|塩対応|赤ちゃん|しろうと|近親|^しろう$|^本当$/u.test(m[1]!)
  ) {
    // Avoid chopping 「しろうと彼女」 into subject 「しろう」.
    if (/^しろう$/u.test(m[1]!) && /しろうと/u.test(title)) return null;
    return m[1]!;
  }
  return null;
}

function dedupe(atoms: string[]): string[] {
  const out: string[] = [];
  for (const a of atoms) {
    const n = normalizeKey(a);
    if (!n) continue;
    const idx = out.findIndex(
      (x) => normalizeKey(x) === n || normalizeKey(x).includes(n) || n.includes(normalizeKey(x)),
    );
    if (idx >= 0) {
      if (a.length > out[idx]!.length) out[idx] = a;
      continue;
    }
    out.push(a);
  }
  return out;
}

function buildEditorialAngle(input: {
  subject: string | null;
  contentType: string | null;
  corePremise: string | null;
  primaryAppeal: string | null;
  seriesName: string | null;
}): { angle: string; readerHook: string; whyThisWork: string } {
  const { subject, contentType, corePremise, primaryAppeal, seriesName } = input;
  if (contentType?.includes("ベスト") || contentType?.includes("総集")) {
    const hook = primaryAppeal || corePremise || "収録の幅";
    return {
      angle: hook,
      readerHook: hook,
      whyThisWork: hook,
    };
  }
  if (corePremise && subject) {
    return {
      angle: corePremise,
      readerHook: corePremise,
      whyThisWork: corePremise,
    };
  }
  if (corePremise) {
    return {
      angle: corePremise,
      readerHook: corePremise,
      whyThisWork: primaryAppeal || corePremise,
    };
  }
  if (seriesName && subject) {
    return {
      angle: `${subject}の${seriesName}`,
      readerHook: `${seriesName}の流れの一作`,
      whyThisWork: primaryAppeal || `${subject}のシリーズ出演`,
    };
  }
  if (subject && primaryAppeal) {
    return {
      angle: primaryAppeal,
      readerHook: primaryAppeal,
      whyThisWork: primaryAppeal,
    };
  }
  if (subject) {
    return {
      angle: `${subject}の作品`,
      readerHook: `${subject}の作品`,
      whyThisWork: `${subject}の作品`,
    };
  }
  return {
    angle: primaryAppeal || "作品の焦点",
    readerHook: primaryAppeal || "作品の具体点",
    whyThisWork: primaryAppeal || "公開カタログ上の具体点がある",
  };
}

/**
 * Plan an X introduction from canonical Claims / title / identity.
 */
export function planXSocial(input: XPlannerInput): XPlanResult {
  const title = (input.canonicalTitle || input.productTitle || "").trim();
  const productTitle = (input.productTitle || title).trim();
  const provenanceSources = [
    title,
    productTitle,
    input.seriesName ?? "",
    ...(input.performerNames ?? []),
    ...(input.claimStatements ?? []).map((claim) => claim.statement),
    ...(input.groundedPlanFacts ?? []),
  ]
    .map((source) => source.trim())
    .filter((source) => source.length > 0);
  const performers = input.performerNames ?? [];
  const subject = pickSubject(performers, title);
  const contentType = detectContentType(title, input.seriesName ?? null);

  let droppedAdultCount = 0;
  const understandingPool: string[] = [];
  const expressionPool: string[] = [];

  const ingest = (raw: string, opts?: { preferTitle?: boolean }) => {
    const cleaned = cleanAtom(raw);
    if (!cleaned) return;
    const wasAdult = detectXAdultExpressions(cleaned).hit || detectXAdultExpressions(raw).hit;
    const wasVoice = SOURCE_VOICE_RE.test(cleaned) || SOURCE_VOICE_RE.test(raw);
    if (
      wasAdult ||
      wasVoice ||
      /エロ|下品|変態|精液|中出し|ヌケ|イカされ|進化を続ける|今もなお/u.test(cleaned)
    ) {
      droppedAdultCount += 1;
      return;
    }
    if (subject && embedsUnparsedSubject(cleaned, subject)) return;

    // Understanding may use adult-stripped meaning, but reject hole debris.
    const understanding = wasAdult || wasVoice
      ? toUnderstandingNote(stripXAdultSpans(cleaned).replace(SOURCE_VOICE_RE, " "))
      : toUnderstandingNote(cleaned);
    if (understanding) {
      if (opts?.preferTitle) understandingPool.unshift(understanding);
      else understandingPool.push(understanding);
    }

    if (!wasAdult && !wasVoice && isXSafeAtom(cleaned)) {
      expressionPool.push(cleaned);
    }
  };

  for (const c of input.claimStatements ?? []) {
    ingest(c.statement);
  }
  for (const f of input.groundedPlanFacts ?? []) {
    ingest(f);
  }
  for (const clause of splitTitleAtoms(productTitle || title)) {
    let c = clause;
    if (subject && c.startsWith(subject)) {
      c = c.slice(subject.length).replace(/^[のと]/u, "").trim();
    }
    ingest(c, { preferTitle: true });
    ingest(clause, { preferTitle: true });
  }
  const titleHook = salvageTitleHook(productTitle || title, subject);
  if (titleHook) {
    const note = toUnderstandingNote(titleHook);
    if (note) understandingPool.unshift(note);
    const cleanedHook = cleanAtom(titleHook);
    if (cleanedHook && isXSafeAtom(cleanedHook)) expressionPool.unshift(cleanedHook);
  }
  for (const hook of catalogHooksFromTitle(productTitle || title)) {
    expressionPool.push(hook);
    const note = toUnderstandingNote(hook);
    if (note) understandingPool.push(note);
  }
  if (input.seriesName) ingest(input.seriesName);

  const understanding = dedupe(understandingPool).filter(
    (a) => !(subject && normalizeKey(a) === normalizeKey(subject)),
  );
  const expression = dedupe(expressionPool).filter(
    (a) => !(subject && normalizeKey(a) === normalizeKey(subject)),
  );

  const rankedUnderstanding = [...understanding].sort((a, b) => {
    const score = (t: string) => {
      let s = 50;
      if (isPremiseLike(t)) s -= 20;
      if (isStrongFeature(t)) s -= 12;
      if (t.length >= 16 && t.length <= 56) s -= 4;
      return s;
    };
    return score(a) - score(b) || b.length - a.length;
  });

  const rankedExpression = [...expression].sort((a, b) => {
    const score = (t: string) => {
      let s = 50;
      if (isPremiseLike(t)) s -= 18;
      if (isStrongFeature(t)) s -= 16;
      if (t.length >= 12 && t.length <= 40) s -= 4;
      return s;
    };
    return score(a) - score(b) || b.length - a.length;
  });

  let corePremise: string | null = null;
  let primaryAppeal: string | null = null;
  let secondaryAppeal: string | null = null;
  const concreteDetails: string[] = [];

  for (const atom of rankedUnderstanding) {
    if (!corePremise && isPremiseLike(atom) && isCleanPlanText(atom)) {
      corePremise = atom;
      break;
    }
  }
  if (
    !corePremise &&
    rankedUnderstanding[0] &&
    !isStrongFeature(rankedUnderstanding[0]!) &&
    isCleanPlanText(rankedUnderstanding[0]!)
  ) {
    corePremise = rankedUnderstanding[0]!;
  }

  for (const atom of [...rankedExpression, ...rankedUnderstanding]) {
    if (
      !primaryAppeal &&
      (isStrongFeature(atom) || atom.length >= 12) &&
      isCleanPlanText(atom) &&
      (!corePremise || normalizeKey(atom) !== normalizeKey(corePremise))
    ) {
      primaryAppeal = atom;
      continue;
    }
    if (
      !secondaryAppeal &&
      isStrongFeature(atom) &&
      isCleanPlanText(atom) &&
      (!corePremise || normalizeKey(atom) !== normalizeKey(corePremise)) &&
      (!primaryAppeal || normalizeKey(atom) !== normalizeKey(primaryAppeal))
    ) {
      secondaryAppeal = atom;
      continue;
    }
    if (
      concreteDetails.length < 2 &&
      atom.length >= 10 &&
      isCleanPlanText(atom) &&
      (!corePremise || normalizeKey(atom) !== normalizeKey(corePremise)) &&
      (!primaryAppeal || normalizeKey(atom) !== normalizeKey(primaryAppeal))
    ) {
      concreteDetails.push(atom);
    }
  }

  if (!corePremise && !primaryAppeal) {
    const strong = rankedExpression.find((a) => isStrongFeature(a));
    if (strong) primaryAppeal = strong;
  }

  if (!corePremise) {
    const short = [...rankedExpression, ...rankedUnderstanding].find(
      (atom) => atom.length >= 6 && atom.length <= 18 && isCleanPlanText(atom),
    );
    if (short) corePremise = short;
  }

  // Identity salvage — never invent 「出演する作品」 filler as premise.
  if (!corePremise && !primaryAppeal) {
    const seriesSafe =
      input.seriesName && !detectXAdultExpressions(input.seriesName).hit
        ? input.seriesName
        : null;
    if (contentType && /ベスト|総集|VR/u.test(contentType) && subject) {
      primaryAppeal = `${subject}の${contentType}`;
    } else if (contentType && /ベスト|総集|VR/u.test(contentType)) {
      primaryAppeal = contentType;
    } else if (subject && seriesSafe && seriesSafe.length >= 4) {
      corePremise = `${seriesSafe}のシリーズ作`;
    } else if (titleHook && toUnderstandingNote(titleHook)) {
      corePremise = toUnderstandingNote(titleHook);
    } else if (subject && contentType && contentType !== "作品紹介") {
      primaryAppeal = contentType;
    }
  }

  if (!corePremise && !primaryAppeal) {
    return {
      ok: false,
      skip: { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "missing_premise_and_appeal" },
    };
  }

  // No performer subject: promote a lone appeal into premise so catalog hooks can plan.
  if (!corePremise && primaryAppeal && !subject) {
    corePremise = primaryAppeal;
    primaryAppeal = null;
  }

  if (
    !corePremise &&
    primaryAppeal &&
    !isStrongFeature(primaryAppeal) &&
    primaryAppeal.length < 14 &&
    !subject
  ) {
    return {
      ok: false,
      skip: { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "weak_appeal_only" },
    };
  }

  // Prefer expression-safe surfaces for allowedClaims; fall back to understanding notes.
  let allowedClaims = dedupe(
    [
      ...rankedExpression.slice(0, 4),
      corePremise,
      primaryAppeal,
      secondaryAppeal,
      ...concreteDetails,
    ].filter((x): x is string => typeof x === "string" && isXSafeAtom(x)),
  ).slice(0, 6);

  const seriesSafe =
    input.seriesName && !detectXAdultExpressions(input.seriesName).hit
      ? input.seriesName
      : null;

  if (allowedClaims.length === 0) {
    // Last identity/catalog salvage — still X-safe, never adult debris.
    const salvage: string[] = [];
    if (subject && contentType && /ベスト|総集|VR/u.test(contentType)) {
      const cand = `${subject}の${contentType}`;
      if (cand.length >= 6) salvage.push(cand);
    }
    if (titleHook && isXSafeAtom(titleHook)) salvage.push(titleHook);
    if (subject && seriesSafe && isXSafeAtom(`${subject}の${seriesSafe}`)) {
      salvage.push(`${subject}の${seriesSafe}`);
    }
    if (subject && contentType && contentType !== "作品紹介" && isXSafeAtom(contentType)) {
      salvage.push(contentType);
    }
    if (salvage.length === 0) {
      return {
        ok: false,
        skip: { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "no_expression_safe_facts" },
      };
    }
    allowedClaims = dedupe(salvage).slice(0, 6);
    if (!corePremise) corePremise = allowedClaims[0] ?? null;
    if (!primaryAppeal && allowedClaims[1]) primaryAppeal = allowedClaims[1]!;
  }

  if (corePremise && detectXAdultExpressions(corePremise).hit) {
    corePremise = allowedClaims[0] ?? null;
  }
  if (corePremise && /に沼る|KMPVR|制作・著作|ケイ・エム・プロデュース/u.test(corePremise)) {
    corePremise = allowedClaims[0] ?? null;
  }
  if (primaryAppeal && detectXAdultExpressions(primaryAppeal).hit) {
    primaryAppeal = allowedClaims.find((x) => x !== corePremise) ?? null;
  }
  if (primaryAppeal && /KMPVR|制作・著作|ケイ・エム・プロデュース/u.test(primaryAppeal)) {
    primaryAppeal = allowedClaims.find((x) => x !== corePremise) ?? null;
  }
  // Editorial must only be built from clean premises.
  if (corePremise && !isCleanPlanText(corePremise)) {
    corePremise = allowedClaims[0] ?? null;
  }
  if (primaryAppeal && !isCleanPlanText(primaryAppeal)) {
    primaryAppeal = allowedClaims.find((x) => x !== corePremise) ?? null;
  }
  if (corePremise && !allowedClaims.includes(corePremise) && allowedClaims[0]) {
    if (!isXSafeAtom(corePremise)) corePremise = allowedClaims[0]!;
  }

  const faithful = (fact: string | null | undefined): fact is string =>
    typeof fact === "string" && isExpressionSafeFact(fact, provenanceSources);
  allowedClaims = allowedClaims.filter(faithful);
  const officialTitle = (input.productTitle || title).trim();
  const semanticSources = [officialTitle, input.seriesName ?? ""]
    .map((source) => source.trim())
    .filter((source, index, all) => source.length > 0 && all.indexOf(source) === index);
  const semanticFacts = selectSemanticFacts(
    extractSemanticFacts({ sources: semanticSources, performers }).filter((fact) =>
      fact.role === "who"
        ? true
        : faithful(fact.value) &&
          !/魅力|妖艶|珠玉|凝縮|官能|濃密|圧巻|必見|世界観|話題|楽しめる|迫力/u.test(fact.value),
    ),
  );
  const semanticValues = semanticFacts.map((fact) => fact.value);
  if (semanticValues.length > 0) {
    const rest = allowedClaims.filter(
      (claim) =>
        claim !== "複数タイトルを横断した総集編" &&
        !semanticValues.includes(claim) &&
        !/魅力|妖艶|珠玉|凝縮|官能|濃密|圧巻|必見|世界観|話題|楽しめる|迫力|公開カタログ上で確認/u.test(claim),
    );
    allowedClaims = dedupe([...semanticValues, ...rest]).slice(0, 4);
    corePremise = semanticValues.find((value) => value !== subject) ?? allowedClaims[0] ?? null;
  }
  if (!faithful(corePremise)) corePremise = allowedClaims[0] ?? null;
  if (!faithful(primaryAppeal)) primaryAppeal = allowedClaims.find((claim) => claim !== corePremise) ?? null;
  if (!faithful(secondaryAppeal)) secondaryAppeal = null;
  const faithfulDetails = concreteDetails.filter(faithful);
  concreteDetails.length = 0;
  concreteDetails.push(...faithfulDetails);

  const editorial = buildEditorialAngle({
    subject,
    contentType,
    corePremise,
    primaryAppeal,
    seriesName: seriesSafe,
  });

  const workUnderstanding = dedupe([
    editorial.whyThisWork,
    editorial.readerHook,
    ...rankedUnderstanding.slice(0, 4),
  ])
    .filter(
      (w) =>
        faithful(w) &&
        isCleanPlanText(w, { maxLen: 64 }) &&
        !isParticleFreeTitleStack(w) &&
        !isTitleFragmentRun(w),
    )
    .slice(0, 6);

  // Final thin gate: adult-dominated sources with no usable identity/catalog
  // must SKIP — Writer must not invent plot to fill the hole.
  const claimN = input.claimStatements?.length ?? 0;
  const adultHeavy = droppedAdultCount >= 2 && (claimN === 0 || droppedAdultCount >= Math.ceil(claimN * 0.5));
  const hasIdentity = Boolean(subject) || Boolean(seriesSafe);
  const hasCatalogHook = allowedClaims.some((c) =>
    /\d+時間|\d+作品|シリーズ|BEST|ベスト|総集|第\d+弾|VR作品|8K/u.test(c),
  );
  const softAdultOnly =
    allowedClaims.length > 0 &&
    allowedClaims.every(
      (c) =>
        /ヤりまくり|ヤリまくり|エッチな|肉欲|に堕ちる|アナル/u.test(c) &&
        !/\d+時間|\d+作品|シリーズ|BEST|ベスト|総集|第\d+弾/u.test(c),
    );
  // No premise at all after salvage → thin.
  if (!corePremise && !primaryAppeal && allowedClaims.length === 0) {
    return {
      ok: false,
      skip: { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "insufficient_x_safe_grounding" },
    };
  }
  // Adult-heavy + no subject/series + no catalog hook + only soft-adult leftovers → SKIP.
  if (adultHeavy && !hasIdentity && !hasCatalogHook && (softAdultOnly || allowedClaims.length === 0)) {
    return {
      ok: false,
      skip: {
        reason: "SOCIAL_CONTENT_TOO_THIN",
        detail: "adult_claims_without_x_safe_catalog_hook",
      },
    };
  }
  // Soft-adult-only premises with no identity (cannot introduce safely) → SKIP.
  if (softAdultOnly && !hasIdentity && !hasCatalogHook) {
    return {
      ok: false,
      skip: { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "soft_adult_only_no_identity" },
    };
  }

  const supportingClaims = allowedClaims.slice(0, 4);
  const whatIsInteresting =
    editorial.readerHook ||
    primaryAppeal ||
    corePremise ||
    (subject ? `${subject}の作品焦点` : "作品の具体点");

  // Publication intent: not a fixed template. Prefer article reply when there is
  // enough understanding to justify a WP deep-dive; related when identity/series exists.
  const hasRichUnderstanding =
    workUnderstanding.length >= 2 ||
    Boolean(corePremise && corePremise.length >= 12) ||
    allowedClaims.length >= 2;
  const relatedPostUseful = Boolean(subject) || Boolean(seriesSafe);
  const needsArticleReply = hasRichUnderstanding || Boolean(subject);
  let preferredReplyOrder: XSocialPublicationIntent["preferredReplyOrder"] = null;
  if (needsArticleReply && relatedPostUseful) {
    // Series / subject-led works can surface related X before WP; otherwise WP first.
    preferredReplyOrder = seriesSafe ? "related_then_wp" : "wp_then_related";
  } else if (needsArticleReply) {
    preferredReplyOrder = "wp_only";
  } else if (relatedPostUseful) {
    preferredReplyOrder = "related_only";
  } else {
    preferredReplyOrder = "parent_only";
  }

  return {
    ok: true,
    plan: {
      subject,
      contentType,
      whatIsInteresting,
      angle: editorial.angle,
      readerHook: editorial.readerHook,
      whyThisWork: editorial.whyThisWork,
      supportingClaims,
      workUnderstanding,
      corePremise,
      primaryAppeal,
      secondaryAppeal,
      concreteDetails,
      allowedClaims,
      semanticFacts,
      publicationIntent: {
        needsArticleReply,
        relatedPostUseful,
        preferredReplyOrder,
      },
      productTitle,
      canonicalContext: {
        performers: performers.filter((p) => p.length >= 2).slice(0, 5),
        seriesName: seriesSafe,
        claimCount: input.claimStatements?.length ?? 0,
        droppedAdultCount,
      },
    },
  };
}

/** @deprecated alias — prefer XSocialPlan */
export type SocialPlan = XSocialPlan;
export type SocialPlanSkip = XPlanSkip;
export type SocialPlanResult = XPlanResult;
export type SocialPlannerInput = XPlannerInput;
