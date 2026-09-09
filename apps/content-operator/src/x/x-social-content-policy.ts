/**
 * X_SOCIAL_CONTENT policy — timeline-safe acquisition copy.
 * Does not modify ARTICLE_CONTENT / Writer prompts.
 * X body is generated from Evidence/claims, never by summarizing the article body.
 */

import { CONTENT_POLICY_SURFACE } from "./content-policy-surfaces.js";

export const X_SOCIAL_CONTENT_POLICY_VERSION = "x-social-content-v1";

/** Direct adult / sexual surface expressions disallowed on X timeline copy. */
const X_ADULT_EXPRESSION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "sex_act", re: /セックス|sex\b|性交|挿入|ピストン|中出し|生ハメ|ハメ撮り|顔射|口内|フェラ|パイズリ|潮吹|絶頂|アクメ|オーガズム/iu },
  { id: "genital_fluid", re: /性器|ちんこ|まんこ|ペニス|ヴァギナ|精液|愛液|母乳|体液/iu },
  { id: "explicit_play", re: /痴女|わからせ|洗脳|乱交|近親|NTR|寝取|拘束|調教|SMプレイ|陵辱|輪姦/iu },
  { id: "sexual_body", re: /裸身|全裸|裸体|下着姿|巨乳を|美乳|爆乳|乳首|おしりを|尻を振り|グラマラスボディ|エロポテンシャル|淫乱|卑猥|官能的な(?!映画)/iu },
  { id: "arousal_hype", re: /抜きどころ|ヌける|シコシコ|興奮必至|ムラムラ|やりたい|エロすぎ|エロいシーン|濃厚セックス|激しいピストン/iu },
  { id: "adult_front", re: /アダルトビデオ|AV女優として|成人向け作品です|エロティックな(?!映画)/iu },
];

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

  let body = parts.join("");
  const disclosure = (input.disclosure ?? "").trim();
  if (disclosure && !body.includes(disclosure) && !/#PR/u.test(body)) {
    body = `${body} ${disclosure}`;
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
      disclosure ? ` ${disclosure}` : "",
      url ? ` ${url}` : "",
    ]
      .join("")
      .trim();
    return safeOnly;
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
