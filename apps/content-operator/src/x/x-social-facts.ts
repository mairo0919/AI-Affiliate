/**
 * X social publication helpers (non-copy).
 *
 * Copy generation lives in social-plan / social-write / social-review.
 * This module only:
 * - extracts grounded ARTICLE_PLAN atoms (same product understanding as WP; not WP body)
 * - assembles posts with URL / thread shape for publication
 */

import {
  hasClearAdDisclosure,
  normalizeDisclosureLabel,
  stripLegacyHashPr,
} from "./ops/pre-publish-guard.js";
import { detectXAdultExpressions } from "./x-social-content-policy.js";

export type XSocialFactKind =
  | "work_theme"
  | "situation"
  | "relationship"
  | "feature"
  | "performer"
  | "series"
  | "taxonomy_aux";

export type XSocialFact = {
  text: string;
  kind: XSocialFactKind;
  source: "article_plan" | "claim" | "title" | "performer" | "series" | "tag";
  score: number;
};

export type XThreadShape = "SINGLE" | "SHORT_THREAD" | "RICH_THREAD";

const TAXONOMY_ONLY_RE =
  /^(人妻・主婦|人妻|主婦|キス・接吻|キス|接吻|巨巨乳|巨乳|美乳|貧乳|微乳|NTR|寝取られ|ベスト・総集編|ベスト|総集編|熟女|中出し|単体作品|独占配信|ハイビジョン|潮吹き|痴女|主観|騎乗位|手コキ|フェラ|ハーレム|乱交|スレンダー|4時間以上作品|VR専用|8KVR|ハイクオリティVR|コレクター|配信)$/u;

const LOW_SIGNAL_PLAN_RE =
  /^(独占配信|単体作品|ハイビジョン|HD|4K|VR専用|8KVR|ハイクオリティVR|4時間以上作品|中出し|乱交|痴女|主観|騎乗位|手コキ|フェラ|潮吹き|SEX)$/iu;

function compact(s: string): string {
  return s.replace(/\s+/g, "").trim();
}

function normalizeKey(s: string): string {
  return compact(s).replace(/[。．、，・！!？?「」『』【】（）()＃#]/gu, "").toLowerCase();
}

function overlaps(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 8 && nb.includes(na)) return true;
  if (nb.length >= 8 && na.includes(nb)) return true;
  return false;
}

function isTaxonomyOnly(text: string): boolean {
  return TAXONOMY_ONLY_RE.test(compact(text));
}

/**
 * Drop-only sanitize for plan atoms: never strip adult tokens and re-glue.
 * Adult / empty / taxonomy shells → null.
 */
export function toGroundedPlanAtom(raw: string): string | null {
  let s = compact(raw)
    .replace(/は公開カタログ上で確認できる。?/u, "")
    .replace(/^コレクター/u, "")
    .replace(/^【VR】/u, "")
    .replace(/【AIリマスター版】/gu, "")
    .replace(/\s*8KVR\s*$/u, "")
    .replace(/[。．！？]+$/u, "")
    .trim();
  if (!s || s.length < 4) return null;
  if (detectXAdultExpressions(s).hit) return null;
  if (isTaxonomyOnly(s) || LOW_SIGNAL_PLAN_RE.test(s)) return null;
  if (/^[A-Za-z0-9\-_.]{4,}$/u.test(s)) return null;
  if (/GIRLS?COLLECTION/iu.test(s) && s.length < 28) return null;
  return s;
}

function classifyPlanFact(text: string, sourceType?: string | null): XSocialFactKind {
  const st = (sourceType ?? "").toUpperCase();
  if (st === "IDENTITY") {
    if (text.length >= 14 || /女優|トップ|テク|美尻|連射/u.test(text)) {
      return text.length >= 12 ? "feature" : "work_theme";
    }
    return "performer";
  }
  if (/幼なじみ|元カノ|人妻|夫婦|再会|合宿|町内会/u.test(text)) return "relationship";
  if (st === "QUANTITY" || /\d+人|\d+作品|\d+時間|\d+タイトル|完全コンプリート/u.test(text)) {
    return "feature";
  }
  if (text.length >= 12) return "situation";
  return "work_theme";
}

function scoreFact(kind: XSocialFactKind, source: XSocialFact["source"], text: string): number {
  let s = 50;
  if (source === "article_plan") s -= 15;
  if (source === "claim") s -= 10;
  if (kind === "situation" || kind === "relationship") s -= 12;
  if (kind === "feature") s -= 8;
  if (kind === "performer") s -= 4;
  if (kind === "taxonomy_aux") s += 40;
  if (text.length >= 16 && text.length <= 48) s -= 4;
  return s;
}

/**
 * Pull ARTICLE_PLAN facts already stored on ContentVersion.structuredContent.
 * Adult-unsafe atoms are dropped entirely (no strip-and-glue).
 */
export function extractArticlePlanSocialFacts(structuredContent: unknown): XSocialFact[] {
  const sc =
    structuredContent && typeof structuredContent === "object"
      ? (structuredContent as Record<string, unknown>)
      : {};
  const contract = sc.brainGenerationContract as Record<string, unknown> | undefined;
  const layers = contract?.layers as Record<string, unknown> | undefined;
  const plan = layers?.ARTICLE_PLAN as Record<string, unknown> | undefined;
  if (!plan) return [];

  const out: XSocialFact[] = [];
  const pushRaw = (raw: string, sourceType?: string | null, preferKind?: XSocialFactKind) => {
    const safe = toGroundedPlanAtom(raw);
    if (!safe) return;
    const kind = preferKind ?? classifyPlanFact(safe, sourceType);
    if (kind === "taxonomy_aux") return;
    out.push({
      text: safe,
      kind,
      source: "article_plan",
      score: scoreFact(kind, "article_plan", safe),
    });
  };

  const title = plan.title as { facts?: string[] } | undefined;
  for (const f of title?.facts ?? []) {
    if (typeof f === "string") pushRaw(f, null);
  }

  const body = plan.body;
  if (Array.isArray(body)) {
    for (const slot of body) {
      if (!slot || typeof slot !== "object") continue;
      const facts = (slot as { facts?: unknown }).facts;
      const types = (slot as { factSourceTypes?: unknown }).factSourceTypes;
      if (!Array.isArray(facts)) continue;
      for (let i = 0; i < facts.length; i += 1) {
        const f = facts[i];
        if (typeof f !== "string") continue;
        const st = Array.isArray(types) && typeof types[i] === "string" ? types[i] : null;
        if (
          st === "GENRE_TAG" &&
          f.length < 8 &&
          !/幼なじみ|元カノ|再会|合宿|町内会|先輩/u.test(f)
        ) {
          continue;
        }
        if (st === "IDENTITY") {
          const name = f.trim();
          const looksLikePersonName =
            name.length >= 2 &&
            name.length <= 12 &&
            !/[0-9]/.test(name) &&
            !/スペシャル|BEST|ベスト|総集編|専属|SEX|ハメ|リマスター|収録|版$/iu.test(name);
          if (looksLikePersonName && !detectXAdultExpressions(name).hit) {
            out.push({
              text: name,
              kind: "performer",
              source: "article_plan",
              score: scoreFact("performer", "article_plan", name),
            });
          }
          continue;
        }
        pushRaw(f, st);
      }
    }
  }

  const execution = plan.execution;
  if (Array.isArray(execution)) {
    for (const row of execution) {
      if (!row || typeof row !== "object") continue;
      const fact = (row as { fact?: unknown }).fact;
      if (typeof fact === "string") pushRaw(fact, null);
    }
  }

  return out;
}

/** Text strings for Social Planner (drops adult / taxonomy shells). */
export function groundedPlanFactTexts(facts: XSocialFact[] | undefined): string[] {
  if (!facts?.length) return [];
  const out: string[] = [];
  for (const f of facts) {
    if (f.kind === "performer" || f.kind === "taxonomy_aux") continue;
    const atom = toGroundedPlanAtom(f.text);
    if (atom) out.push(atom);
  }
  return out;
}

/**
 * Compose X posts from already-written social body lines.
 * Thread shape / link assembly only — does not invent copy.
 */
export function composeXSocialPosts(input: {
  facts?: XSocialFact[];
  realizedLines?: string[];
  threadShape: XThreadShape;
  linkMode: "WP_TRAFFIC" | "DIRECT_AFFILIATE" | "COMBINED";
  wpUrl: string | null;
  fanzaUrl: string | null;
  disclosure: string;
  performers?: string[];
}): Array<{ sequence: number; role: "ROOT" | "REPLY" | "CTA"; body: string; linkKind: "none" | "wp" | "fanza" }> {
  const label = normalizeDisclosureLabel(input.disclosure);
  const withDisc = (body: string) => {
    const cleaned = stripLegacyHashPr(body);
    if (!label) return cleaned;
    if (hasClearAdDisclosure(cleaned)) return cleaned;
    return `${label}\n${cleaned}`.trim();
  };
  const withUrl = (body: string, url: string | null) => {
    if (!url || body.includes(url)) return body;
    return `${body} ${url}`.trim();
  };

  const lines = (input.realizedLines?.length
    ? input.realizedLines
    : (input.facts ?? []).map((f) => f.text)
  )
    .map((t) => t.replace(/[。．]+$/u, "").trim())
    .filter(Boolean);

  const asSentence = (text: string): string => {
    const t = text.replace(/[。．]+$/u, "").trim();
    if (!t) return "";
    if (/[。！？]/.test(t) && !/[。！？]$/u.test(t)) return `${t}。`;
    if (/[。！？]$/u.test(t)) return t;
    return `${t}。`;
  };

  const primary = lines[0];
  const hookLine = (): string => primary ?? input.performers?.[0] ?? "公開情報ベースの作品ポイント";

  // WP_TRAFFIC: parent intro only — WP URL is a reply (publication navigation).
  if (input.linkMode === "WP_TRAFFIC") {
    const parts: string[] = [];
    const maxTotal = 240;
    for (const line of lines.slice(0, 4)) {
      const s = asSentence(line);
      if (!s) continue;
      if (parts.some((p) => overlaps(p, line))) continue;
      if (parts.join("").length + s.length > maxTotal) break;
      parts.push(s);
    }
    let body = stripLegacyHashPr(parts.join("") || asSentence(hookLine()));
    const posts: Array<{
      sequence: number;
      role: "ROOT" | "REPLY" | "CTA";
      body: string;
      linkKind: "none" | "wp" | "fanza";
    }> = [{ sequence: 1, role: "ROOT", body, linkKind: "none" }];
    if (input.wpUrl) {
      const ctaBody = label
        ? `${label}\n記事はこちら\n${input.wpUrl}`
        : `記事はこちら\n${input.wpUrl}`;
      posts.push({
        sequence: 2,
        role: "CTA",
        body: ctaBody,
        linkKind: "wp",
      });
    }
    return posts;
  }

  if (input.threadShape === "SINGLE") {
    const parts: string[] = [];
    parts.push(asSentence(hookLine()));
    for (const line of lines.slice(1, 4)) {
      if (
        line &&
        !overlaps(line, primary ?? "") &&
        !parts.join("").includes(line) &&
        parts.join("").length + line.length < 240
      ) {
        parts.push(asSentence(line));
      }
    }
    let body = parts.join("");
    body = withDisc(body);
    body = withUrl(body, input.fanzaUrl ?? input.wpUrl);
    return [
      {
        sequence: 1,
        role: "ROOT",
        body,
        linkKind: input.fanzaUrl ? "fanza" : input.wpUrl ? "wp" : "none",
      },
    ];
  }

  const posts: Array<{
    sequence: number;
    role: "ROOT" | "REPLY" | "CTA";
    body: string;
    linkKind: "none" | "wp" | "fanza";
  }> = [];

  posts.push({
    sequence: 1,
    role: "ROOT",
    body: withDisc(asSentence(hookLine())),
    linkKind: "none",
  });

  const secondary = lines[1];
  const tertiary = lines[2];

  if (input.threadShape === "SHORT_THREAD") {
    let body = asSentence(secondary ?? hookLine());
    if (input.linkMode === "COMBINED" && input.wpUrl && input.fanzaUrl) {
      body = withDisc(`${body}記事はこちら。`);
      body = withUrl(body, input.wpUrl);
      posts.push({ sequence: 2, role: "CTA", body, linkKind: "wp" });
      posts.push({
        sequence: 3,
        role: "CTA",
        body: withUrl(withDisc("配信ページはこちら。"), input.fanzaUrl),
        linkKind: "fanza",
      });
      return posts;
    }
    body = withDisc(body);
    body = withUrl(body, input.fanzaUrl);
    posts.push({ sequence: 2, role: "CTA", body, linkKind: "fanza" });
    return posts;
  }

  if (secondary) {
    posts.push({
      sequence: 2,
      role: "REPLY",
      body: asSentence(secondary),
      linkKind: "none",
    });
  }

  if (input.linkMode === "COMBINED" && input.wpUrl && input.fanzaUrl) {
    const t = tertiary ?? secondary ?? hookLine();
    let wpBody = withDisc(`${asSentence(t)}記事で詳しく紹介しています。`);
    wpBody = withUrl(wpBody, input.wpUrl);
    posts.push({ sequence: posts.length + 1, role: "CTA", body: wpBody, linkKind: "wp" });
    posts.push({
      sequence: posts.length + 1,
      role: "CTA",
      body: withUrl(withDisc("配信ページはこちら。"), input.fanzaUrl),
      linkKind: "fanza",
    });
    return posts.map((p, i) => ({ ...p, sequence: i + 1 }));
  }

  let last = tertiary ? asSentence(tertiary) : "";
  if (!last) {
    return [
      {
        sequence: 1,
        role: "ROOT",
        body: withUrl(withDisc(asSentence(hookLine())), input.fanzaUrl),
        linkKind: "fanza",
      },
    ];
  }
  last = withDisc(last);
  last = withUrl(last, input.fanzaUrl);
  posts.push({ sequence: posts.length + 1, role: "CTA", body: last, linkKind: "fanza" });
  return posts.map((p, i) => ({ ...p, sequence: i + 1 }));
}

/** @deprecated Stock CTA abolished — always empty. Kept for call-site stability. */
export function chooseWpTrafficCta(_input?: unknown): string {
  return "";
}
