/**
 * X_SOCIAL_CONTENT policy — timeline-safe acquisition copy.
 * Does not modify ARTICLE_CONTENT / Writer prompts.
 * X body is generated from Evidence/claims, never by summarizing the article body.
 */

import { CONTENT_POLICY_SURFACE } from "./content-policy-surfaces.js";
import {
  hasClearAdDisclosure,
  normalizeDisclosureLabel,
  stripLegacyHashPr,
} from "./ops/pre-publish-guard.js";

export const X_SOCIAL_CONTENT_POLICY_VERSION = "x-social-content-v1";

/** Direct adult / sexual surface expressions disallowed on X timeline copy. */
const X_ADULT_EXPRESSION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "sex_act", re: /セックス|SEX|sex\b|性交|挿入|ピストン|中出し|生ハメ|生中出し|即ズボ|ハメ撮り|ハメドリ|ハメ放題|ハメハメ|ハメ潮|顔射|口内|フェラ|パイズリ|潮吹|絶頂|アクメ|オーガズム|射精|発射無制限|しゃぶり尽く|(?<!お)しゃぶり|おしゃぶり|咥え|クンニ|くんに|舐陰|舐める|オーラル|アナル|ファック|突きまくる|バックから|浣腸|排泄|膣奥|手コキ|追い手コキ|センズリ|ヌキ|イカサレ|イかせ|イカセ|お掃除|突っ込み|電マ|チンイラ|ぶっ壊|お仕置き|男潮|女潮|騎乗位|杭打ち|正常位|PtoM|ぶっかけ|口内射精|ごっくん|種付け|生で|ナマで|無修正|喘ぎ|エビ反り|おもらし|ヨガらせ/iu },
  { id: "genital_fluid", re: /性器|ちんこ|ちんコロ|まんこ|マンコ|オマ[〇○]|オマコ|ペニス|ヴァギナ|精液|愛液|母乳|体液|チ[〇○\s]*ポ|ちんぽ|チンポ|ザーメン|子種|パックリ|ぱっくり|唾液|泡立|まみれ|汁/iu },
  { id: "explicit_play", re: /痴女|わからせ|洗脳|乱交|近親|NTR|寝取|拘束|調教|SMプレイ|陵辱|輪姦|輪[●〇]|ハーレム|ハメまくり|淫語|ベロキス|キスしまくり|浮気告白|種付け|炊き出し行列|赤ちゃん作り|赤ちゃん作れ|赤ちゃんを授|近親相姦|媚薬|強襲ハメ|野球拳|初レズ|レズカップル|エッチな|理性を|盗撮|追跡盗撮|ぶっ壊|限界突破|ぶち撒|され大量|イッちゃう|イクイク|イク[…・]|スケベ|羞恥|羞辱|絶倫|たいSP|先生とのたい|風俗嬢|絶対連続|連続追い|追いメンズ|させてくれる|しろうと彼女|M男性|よわよわ特別|マゾランナー|求め合う美義母|恥ずかしいお尻/iu },
  { id: "sexual_body", re: /裸身|全裸|裸体|下着姿|巨乳を|巨乳美女|美乳|爆乳|美巨乳|乳首|おしりを|尻を振り|尻をつか|ケツ肉|美尻|ぷりぷり|お尻を見せ|グラマラスボディ|エロポテンシャル|淫乱|卑猥|官能的|貪欲な姿|エロ顔|締めつけ|ニーソ脚を楽しみ|アヘ|痙攣|ムチムチ|絶対領域|変態熟女|ノーブラ|パイパン|おっぱい|オッパイ|パンティ|熟巨乳|欲情|丸眼鏡巨乳|エロス|カラダ|豊かな乳|無防備にこぼ|肉欲|変態家族|成長した身体|猛悪美巨乳|あどけなかった孫|チラリと見える素肌|ボディラインとチラ|くびれにハリ/iu },
  { id: "arousal_hype", re: /抜きどころ|ヌける|シコシコ|興奮必至|ムラムラ|やりたい|エロすぎ|エロい|エロく|濃厚セックス|激しいピストン|フル勃起|勃起|させる程|性欲を|エロ乳|デカパイ|赤面発情|発情|イキ狂|死んじゃう|放してくれない|Hしたい|貪り|いやらしい|欲求不満|好色|背徳|美味しい身体|ハンパないっぷり|もじゅっぽん|じゅっぽん|パンパンすごい|反りと声|汗が飛び散|制限無しで|けるBEST|心も体も|連射|貪欲な|熱い息遣い|熱い息使い|セックスレス|敏感になった|追いかけていく|火照って|ヒクヒク/iu },
  { id: "adult_front", re: /アダルトビデオ|AV女優として|成人向け作品です|エロティックな(?!映画)/iu },
  { id: "obfuscated", re: /媚[〇○]|[〇○]剤|[〇○]畜|[〇○]ポ|ヤッて|ビクビク|過敏反応|Yutber|Y●ut●ber|チ\s+ポ|オマ\s+コ|（カラダ）|\(\s*カラダ\s*\)|（\s*）|\(\s*\)|まくる$|ところを筋|ひたすら\s*られる|たっぷりとね|に堕ちる|とに堕ちる|品番\s*[:：]|ちゃんとんだ|ムーハメ|」、されて|されて何度も|極限POV|1発のでは|貪欲なを|義父にられて|にしてしまった話|媚\s*効果/iu },
  { id: "scene_narration", re: /陽だまりの中で|手を上げた。|楽しみながら.+(する|した)。|全力ダッシュでハァハァ|力尽きたところ|恥ずかしいポーズ|使い捨ての下着|マッサージ台の上で/iu },
];

/** Strip adult surface spans so title/claim remnants can still ground X planning. */
export function stripXAdultSpans(text: string): string {
  let out = text;
  let prev = "";
  while (out !== prev) {
    prev = out;
    for (const p of X_ADULT_EXPRESSION_PATTERNS) {
      const flags = p.re.flags.includes("g") ? p.re.flags : `${p.re.flags}g`;
      out = out.replace(new RegExp(p.re.source, flags), " ");
    }
  }
  return out
    .replace(/[＆&]+/gu, " ")
    .replace(/[〇○●]{1,}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Catalog / acquisition-safe claim signals (Evidence-backed attributes OK on X). */
const X_SAFE_CATALOG_RE =
  /出演|女優|ベスト|総集編|コンピレーション|最新\d+|タイトル|\d+時間|\d+分|収録|シリーズ|メーカー|レーベル|発売|配信|Vol\.?\s*\d+|第\d+弾|まとめ/u;

/**
 * Detect adult expressions unsuitable for X_SOCIAL_CONTENT.
 * ARTICLE_CONTENT may still contain these — this gate is X-only.
 */
export function detectXAdultExpressions(text: string): {
  hit: boolean;
  matches: Array<{ id: string; sample: string }>;
} {
  const matches: Array<{ id: string; sample: string }> = [];
  for (const p of X_ADULT_EXPRESSION_PATTERNS) {
    const m = text.match(p.re);
    if (m?.[0]) {
      matches.push({ id: p.id, sample: m[0].slice(0, 24) });
    }
  }
  return { hit: matches.length > 0, matches };
}

/**
 * Whether a SUPPORTED claim statement is usable as X social evidence
 * (catalog / identity / runtime — not sexual scene detail).
 */
export function isXSocialSafeClaimStatement(statement: string): boolean {
  const s = statement.trim();
  if (!s) return false;
  if (detectXAdultExpressions(s).hit) return false;
  // Short actress / title fragments without sexual framing
  if (s.length <= 40 && !/[。！？]/.test(s) && !detectXAdultExpressions(s).hit) {
    return true;
  }
  return X_SAFE_CATALOG_RE.test(s);
}

export function filterClaimsForXSocialContent<T extends { id: string; statement: string }>(
  claims: T[],
): T[] {
  return claims.filter((c) => isXSocialSafeClaimStatement(c.statement));
}

/**
 * Build timeline-safe X body from Evidence facets (not article body excerpt).
 * Never invents popularity / ranking / evaluation.
 */
export function buildXSocialSafeBodyFromEvidence(input: {
  productTitle: string;
  actressNames?: string[];
  safeFacets: string[];
  destinationUrl?: string | null;
  disclosure?: string | null;
  softCta?: string | null;
}): string {
  const actress =
    input.actressNames?.map((a) => a.trim()).filter(Boolean)[0] ??
    extractActressHint(input.productTitle, input.safeFacets);
  const catalog = pickCatalogHooks(input.productTitle, input.safeFacets);
  const cta = (input.softCta ?? "まとめてチェックしたい人向け。").trim();

  const parts: string[] = [];
  if (actress && catalog.length > 0) {
    parts.push(`${actress}の${catalog.join("・")}。`);
  } else if (catalog.length > 0) {
    parts.push(`${catalog.join("・")}。`);
  } else if (actress) {
    parts.push(`${actress}の作品情報をチェック。`);
  } else {
    parts.push("公開情報ベースで作品のポイントを整理しています。");
  }
  parts.push(cta);

  let body = stripLegacyHashPr(parts.join(""));
  const disclosure = normalizeDisclosureLabel(input.disclosure);
  if (disclosure && !hasClearAdDisclosure(body)) {
    body = `${disclosure}\n${body}`;
  }
  const url = input.destinationUrl?.trim();
  if (url && !body.includes(url)) {
    body = `${body} ${url}`;
  }

  // Final gate — strip any residual adult surface (should be rare)
  if (detectXAdultExpressions(body).hit) {
    const safeOnly = [
      actress ? `${actress}の` : "",
      catalog[0] ?? "作品情報",
      "をまとめて確認。",
      url ? ` ${url}` : "",
    ]
      .join("")
      .trim();
    return disclosure ? `${disclosure}\n${safeOnly}` : safeOnly;
  }
  return body;
}

function extractActressHint(title: string, facets: string[]): string | null {
  for (const f of facets) {
    const t = f.trim();
    if (t.length >= 2 && t.length <= 20 && !X_SAFE_CATALOG_RE.test(t) && !/\d/.test(t)) {
      if (!detectXAdultExpressions(t).hit) return t;
    }
  }
  // Common JP title pattern: leading personal name before product keywords
  const m = title.match(
    /^([一-龯ぁ-んァ-ンー]{2,12})(?=\s|\u3000|の|S1|エスワン|ベスト|総集|8時間|\d)/u,
  );
  return m?.[1] ?? null;
}

function pickCatalogHooks(title: string, facets: string[]): string[] {
  const hooks: string[] = [];
  const pool = [...facets, title];
  for (const raw of pool) {
    const s = raw.trim();
    if (detectXAdultExpressions(s).hit) continue;
    if (/\d+\s*時間/.test(s) || /8時間/.test(s)) {
      pushUnique(hooks, "8時間ベスト");
    } else if (/最新\s*\d+\s*タイトル|最新12タイトル|\d+タイトル/.test(s)) {
      const n = s.match(/(\d+)\s*タイトル/)?.[1];
      pushUnique(hooks, n ? `最新${n}タイトルまとめ` : "最新タイトルまとめ");
    } else if (/ベスト|総集編|コンピレーション/.test(s)) {
      pushUnique(hooks, "ベスト／総集編");
    } else if (/全コーナー/.test(s)) {
      pushUnique(hooks, "収録コーナーまとめ");
    }
    if (hooks.length >= 2) break;
  }
  if (hooks.length === 0 && /ベスト|総集/.test(title)) {
    hooks.push("ベスト作品");
  }
  return hooks.slice(0, 2);
}

function pushUnique(arr: string[], value: string): void {
  if (!arr.includes(value)) arr.push(value);
}

/**
 * Enforce X_SOCIAL_CONTENT after generation. Rewrites via Evidence when adult surface leaks.
 */
export function enforceXSocialContentBody(input: {
  body: string;
  productTitle: string;
  safeFacets: string[];
  actressNames?: string[];
  destinationUrl?: string | null;
  disclosure?: string | null;
}): {
  body: string;
  rewritten: boolean;
  violations: Array<{ id: string; sample: string }>;
  contentPolicySurface: typeof CONTENT_POLICY_SURFACE.X_SOCIAL_CONTENT;
  policyVersion: string;
} {
  const detected = detectXAdultExpressions(input.body);
  if (!detected.hit) {
    return {
      body: input.body.trim(),
      rewritten: false,
      violations: [],
      contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_CONTENT,
      policyVersion: X_SOCIAL_CONTENT_POLICY_VERSION,
    };
  }
  const rebuilt = buildXSocialSafeBodyFromEvidence({
    productTitle: input.productTitle,
    actressNames: input.actressNames,
    safeFacets: input.safeFacets,
    destinationUrl: input.destinationUrl,
    disclosure: input.disclosure,
  });
  return {
    body: rebuilt,
    rewritten: true,
    violations: detected.matches,
    contentPolicySurface: CONTENT_POLICY_SURFACE.X_SOCIAL_CONTENT,
    policyVersion: X_SOCIAL_CONTENT_POLICY_VERSION,
  };
}
