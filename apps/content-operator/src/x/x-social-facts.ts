/**
 * Select work-specific social facts for X adaptation.
 * Taxonomy/genre tags are auxiliary only — never sole hooks when work facts exist.
 */

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
  /** Lower = better. */
  score: number;
};

export type XThreadShape = "SINGLE" | "SHORT_THREAD" | "RICH_THREAD";

const TAXONOMY_ONLY_RE =
  /^(人妻・主婦|人妻|主婦|キス・接吻|キス|接吻|巨巨乳|巨乳|美乳|貧乳|微乳|NTR|寝取られ|ベスト・総集編|ベスト|総集編|熟女|中出し|単体作品|独占配信|ハイビジョン|潮吹き|痴女|主観|騎乗位|手コキ|フェラ|ハーレム|乱交|スレンダー|4時間以上作品|VR専用|8KVR|ハイクオリティVR|コレクター|配信)$/u;

const GENERIC_FILLER_RE =
  /気になる作品|要チェック|好きなら|この設定は|見逃せない|注目作品|結局.{0,12}一番|まとめてチェック/u;

const BODY_ATTR_TAXONOMY_RE =
  /^(貧乳|微乳|巨乳|美乳|爆乳|貧乳・微乳|キス・接吻|ベスト・総集編|女優ベスト・総集編)$/u;

const LOW_SIGNAL_PLAN_RE =
  /^(独占配信|単体作品|ハイビジョン|HD|4K|VR専用|8KVR|ハイクオリティVR|4時間以上作品|中出し|乱交|痴女|主観|騎乗位|手コキ|フェラ|潮吹き|SEX)$/iu;

const ADULT_SPLIT_RE =
  /セックス|sex\b|性交|挿入|ピストン|中出し|生ハメ|ハメ撮り|顔射|口内|フェラ|パイズリ|潮吹[きき]?|絶頂|アクメ|オーガズム|性器|ちんこ|まんこ|ペニス|ヴァギナ|精液|愛液|痴女|わからせ|洗脳|乱交|近親|NTR|寝取[りら]?|拘束|調教|SMプレイ|陵辱|輪姦|チンイラ|イキ狂[いい]|ヌける|エロ[いすすぎ]*|勃起|エッチなこと|豊かな乳|[貧微巨美爆]乳|おも[○*＊]+こ|おま[○*＊]+こ/giu;

/** Strip X-unsafe surface tokens without inventing new facts. */
export function toXSocialSafePhrase(raw: string): string | null {
  let original = raw.replace(/\s+/g, " ").trim();
  if (!original) return null;
  original = original
    .replace(/は公開カタログ上で確認できる。?/u, "")
    .replace(/^コレクター\s+/u, "")
    .replace(/^【VR】/u, "")
    .replace(/\s*8KVR\s*$/u, "")
    .trim();

  const parts = original
    .split(ADULT_SPLIT_RE)
    .map((p) =>
      p
        .replace(/[（(][^）)]*[）)]/g, " ")
        .replace(/[！!？?…「」]/g, " ")
        .replace(/[・、，,]+/g, "、")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .map((p) => p.replace(/^[\sでにをはがともへの、。]+|[\sでにをはがともへの、。]+$/gu, "").trim())
    .filter((p) => {
      if (p.length < 2) return false;
      if (TAXONOMY_ONLY_RE.test(p)) return false;
      if (BODY_ATTR_TAXONOMY_RE.test(p)) return false;
      if (LOW_SIGNAL_PLAN_RE.test(p)) return false;
      if (/^[でにをはがともへの]+$/u.test(p)) return false;
      return true;
    });

  let s = parts.length <= 3 ? parts.join("").trim() : parts.join("、").replace(/、+/g, "、").replace(/^、|、$/g, "").trim();
  s = s.replace(/(?<=[一-龯ぁ-んァ-ンーA-Za-z0-9])\s+(?=[一-龯ぁ-んァ-ンーA-Za-z0-9])/gu, "");

  if (s.length < 4) return null;
  // Short relationship lexicon is allowed; other short shells are not
  if (s.length < 6 && !/幼なじみ|元カノ|再会|合宿|先輩|町内会/u.test(s) && !/^[一-龯ぁ-んァ-ンー]{2,8}$/u.test(s)) {
    return null;
  }
  if (TAXONOMY_ONLY_RE.test(s)) return null;
  if (BODY_ATTR_TAXONOMY_RE.test(s)) return null;
  if (/ベスト、総集編|女優ベスト、総集編|^ベスト$|^総集編$/u.test(s)) return null;
  if (LOW_SIGNAL_PLAN_RE.test(s)) return null;
  if (GENERIC_FILLER_RE.test(s)) return null;
  if (/孫|おじいちゃん|近親/u.test(s)) return null;
  // Broken skeletons after adult-token split
  if (/、する|する極限|何度、|私、教えて|こぼれる$/u.test(s)) return null;
  if ((s.match(/、/g) ?? []).length >= 3) return null;
  if (detectXAdultExpressions(s).hit) return null;
  if (s.length > 64) {
    s = s.slice(0, 60).replace(/[、。\s]+$/u, "");
  }
  return s.length >= 6 ? s : null;
}

function isTaxonomyOnly(text: string): boolean {
  return TAXONOMY_ONLY_RE.test(text.trim());
}

function normalizeKey(text: string): string {
  return text.replace(/\s+/g, "").replace(/[。．、，・]/g, "").toLowerCase();
}

function overlaps(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  const tokens = (s: string) =>
    s
      .split(/[のと・、\s]/u)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !/^(作品|情報|公開)$/u.test(t));
  const ta = new Set(tokens(a));
  for (const t of tokens(b)) {
    if (ta.has(t) && t.length >= 3) return true;
  }
  // Shared 6-gram (catches near-duplicate official title vs claim paraphrase)
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 6) {
    for (let i = 0; i <= shorter.length - 6; i += 1) {
      if (longer.includes(shorter.slice(i, i + 6))) return true;
    }
  }
  return false;
}

function scoreFact(kind: XSocialFactKind, source: XSocialFact["source"], text: string): number {
  let score = 50;
  switch (kind) {
    case "situation":
    case "work_theme":
      score = 10;
      break;
    case "relationship":
      score = 15;
      break;
    case "feature":
      score = 20;
      break;
    case "series":
      score = 28;
      break;
    case "performer":
      score = 35;
      break;
    case "taxonomy_aux":
      score = 90;
      break;
  }
  // Prefer ARTICLE_PLAN / Claims over raw title or tags
  if (source === "article_plan") score -= 8;
  if (source === "claim") score -= 5;
  if (source === "title") score += 4;
  if (text.length >= 18 && text.length <= 56) score -= 3;
  if (text.length >= 28) score -= 2;
  if (/^\d+名?\d*時間/.test(text) || /^[\d名時間]+$/u.test(text)) score += 25;
  if (isTaxonomyOnly(text) || BODY_ATTR_TAXONOMY_RE.test(text)) score += 40;
  if (/ベスト|総集編/u.test(text) && text.length < 18) score += 18;
  return score;
}

function classifyPlanFact(
  text: string,
  sourceType?: string | null,
): XSocialFactKind {
  const st = (sourceType ?? "").toUpperCase();
  if (st === "GENRE_TAG" || isTaxonomyOnly(text)) return "taxonomy_aux";
  if (st === "IDENTITY") return "performer";
  if (/幼なじみ|元カノ|人妻|夫婦|再会|合宿|町内会/u.test(text)) return "relationship";
  if (st === "QUANTITY" || /\d+人|\d+作品|\d+時間/u.test(text)) return "feature";
  if (text.length >= 12) return "situation";
  return "work_theme";
}

/**
 * Pull ARTICLE_PLAN facts already stored on ContentVersion.structuredContent.
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
    const safe = toXSocialSafePhrase(raw);
    if (!safe) return;
    const kind = preferKind ?? classifyPlanFact(safe, sourceType);
    if (kind === "taxonomy_aux") return; // never primary from plan genre tags
    out.push({
      text: safe,
      kind,
      source: "article_plan",
      score: scoreFact(kind, "article_plan", safe),
    });
  };

  const title = plan.title as { facts?: string[] } | undefined;
  for (const f of title?.facts ?? []) {
    if (typeof f === "string") pushRaw(f, null, classifyPlanFact(f, null));
  }

  const body = plan.body;
  if (Array.isArray(body)) {
    for (const slot of body) {
      if (!slot || typeof slot !== "object") continue;
      const facts = (slot as { facts?: unknown }).facts;
      const types = (slot as { factSourceTypes?: unknown }).factSourceTypes;
      if (!Array.isArray(facts)) continue;
      const identityNames: string[] = [];
      const relationLex: string[] = [];
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
          identityNames.push(f.trim());
        }
        if (/幼なじみ|元カノ|再会|合宿|町内会|先輩/u.test(f)) {
          relationLex.push(f.trim());
        }
        pushRaw(f, st);
      }
      if (
        identityNames[0] &&
        relationLex[0] &&
        identityNames[0] !== relationLex[0]
      ) {
        pushRaw(`${identityNames[0]}と${relationLex[0]}`, "OTHER", "relationship");
      }
    }
  }

  // execution facts often include the realized work axis
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

export function selectXSocialFacts(input: {
  canonicalTitle: string;
  productTitle?: string | null;
  articlePlanFacts?: XSocialFact[];
  claimStatements?: Array<{ statement: string }>;
  performerNames?: string[];
  seriesName?: string | null;
  /** Genre tags — auxiliary only. */
  taxonomyTags?: string[];
}): {
  selected: XSocialFact[];
  discardedTaxonomy: string[];
  threadShape: XThreadShape;
  threadReason: string;
  principalKinds: XSocialFactKind[];
} {
  const pool: XSocialFact[] = [...(input.articlePlanFacts ?? [])];

  for (const c of input.claimStatements ?? []) {
    const safe = toXSocialSafePhrase(c.statement.replace(/は公開カタログ上で確認できる。?$/u, ""));
    if (!safe) continue;
    const kind = safe.length >= 14 ? "situation" : "work_theme";
    pool.push({
      text: safe,
      kind,
      source: "claim",
      score: scoreFact(kind, "claim", safe),
    });
  }

  // Title-derived — only if not body-attr / taxonomy shell
  const titleSafe = toXSocialSafePhrase(input.canonicalTitle);
  if (
    titleSafe &&
    !isTaxonomyOnly(titleSafe) &&
    !BODY_ATTR_TAXONOMY_RE.test(titleSafe) &&
    !/の(貧乳|微乳|巨乳|美乳|キス|接吻|ベスト|総集編)/u.test(titleSafe)
  ) {
    pool.push({
      text: titleSafe,
      kind: titleSafe.length >= 14 ? "situation" : "work_theme",
      source: "title",
      score: scoreFact(titleSafe.length >= 14 ? "situation" : "work_theme", "title", titleSafe),
    });
  }

  if (input.seriesName) {
    const safe = toXSocialSafePhrase(input.seriesName);
    if (safe) {
      pool.push({
        text: safe,
        kind: "series",
        source: "series",
        score: scoreFact("series", "series", safe),
      });
    }
  }

  for (const name of (input.performerNames ?? []).slice(0, 3)) {
    const n = name.trim();
    if (n.length < 2) continue;
    pool.push({
      text: n,
      kind: "performer",
      source: "performer",
      score: scoreFact("performer", "performer", n),
    });
  }

  const discardedTaxonomy: string[] = [];
  for (const tag of input.taxonomyTags ?? []) {
    const t = tag.trim();
    if (!t) continue;
    if (isTaxonomyOnly(t) || LOW_SIGNAL_PLAN_RE.test(t)) {
      discardedTaxonomy.push(t);
      continue;
    }
    const safe = toXSocialSafePhrase(t);
    if (!safe || isTaxonomyOnly(safe)) {
      discardedTaxonomy.push(t);
      continue;
    }
    pool.push({
      text: safe,
      kind: "taxonomy_aux",
      source: "tag",
      score: scoreFact("taxonomy_aux", "tag", safe),
    });
  }

  // Deduplicate / prefer richer text
  pool.sort((a, b) => a.score - b.score || b.text.length - a.text.length);
  const selected: XSocialFact[] = [];
  for (const fact of pool) {
    if (selected.some((s) => overlaps(s.text, fact.text))) continue;
    // Don't add taxonomy_aux while we still lack work-specific facts in selection
    if (fact.kind === "taxonomy_aux") {
      const hasWork = selected.some((s) =>
        ["work_theme", "situation", "relationship", "feature"].includes(s.kind),
      );
      if (!hasWork) continue;
      // at most one aux
      if (selected.some((s) => s.kind === "taxonomy_aux")) continue;
    }
    selected.push(fact);
    if (selected.length >= 4) break;
  }

  // If only performers remain, keep short
  const workFacts = selected.filter((s) =>
    ["work_theme", "situation", "relationship", "feature", "series"].includes(s.kind),
  );
  const principal = workFacts.length > 0 ? workFacts : selected.slice(0, 1);

  // Rebuild final list: principal work facts + optional one performer if not already in text
  const final: XSocialFact[] = [];
  for (const f of principal) {
    if (final.some((s) => overlaps(s.text, f.text))) continue;
    final.push(f);
  }
  const performer = selected.find((s) => s.kind === "performer");
  const performerCount = input.performerNames?.length ?? 0;
  if (
    performer &&
    performerCount > 0 &&
    performerCount <= 2 &&
    !final.some((s) => overlaps(s.text, performer.text)) &&
    final.length < 3
  ) {
    if (!final.some((s) => s.kind === "situation" || s.kind === "work_theme")) {
      final.unshift(performer);
    } else if (final.length === 1 && final[0]!.text.length < 40) {
      // Keep SINGLE-friendly: don't force a second post just for the name
      // (composer may prefix performer into the hook line)
    }
  }

  const distinctWork = final.filter((f) =>
    ["work_theme", "situation", "relationship", "feature"].includes(f.kind),
  ).length;

  let threadShape: XThreadShape = "SINGLE";
  let threadReason = "single_insufficient_distinct_work_facts";
  if (distinctWork >= 3) {
    threadShape = "RICH_THREAD";
    threadReason = "three_or_more_distinct_work_facts";
  } else if (distinctWork === 2) {
    threadShape = "SHORT_THREAD";
    threadReason = "two_distinct_work_facts";
  } else if (final.length >= 2 && final[0]!.kind === "situation" && final[1]!.kind === "performer") {
    threadShape = "SINGLE";
    threadReason = "situation_plus_performer_fit_single";
  }

  return {
    selected: final.slice(0, threadShape === "RICH_THREAD" ? 3 : threadShape === "SHORT_THREAD" ? 2 : 2),
    discardedTaxonomy,
    threadShape,
    threadReason,
    principalKinds: final.map((f) => f.kind),
  };
}

/**
 * Compose X posts from already-realized social lines (not raw fact dump).
 * Thread shape / link assembly only — realization happens in x-social-realize.
 */
export function composeXSocialPosts(input: {
  facts: XSocialFact[];
  /** Realized copy lines (editorial). Falls back to fact.text if omitted. */
  realizedLines?: string[];
  threadShape: XThreadShape;
  linkMode: "WP_TRAFFIC" | "DIRECT_AFFILIATE" | "COMBINED";
  wpUrl: string | null;
  fanzaUrl: string | null;
  disclosure: string;
  performers?: string[];
}): Array<{ sequence: number; role: "ROOT" | "REPLY" | "CTA"; body: string; linkKind: "none" | "wp" | "fanza" }> {
  const disclosure = input.disclosure;
  const withDisc = (body: string) => {
    if (!disclosure) return body.trim();
    if (body.includes(disclosure) || /#PR/u.test(body)) return body.trim();
    return `${body.trim()} ${disclosure}`.trim();
  };
  const withUrl = (body: string, url: string | null) => {
    if (!url || body.includes(url)) return body;
    return `${body} ${url}`.trim();
  };

  const lines = (input.realizedLines?.length
    ? input.realizedLines
    : input.facts.map((f) => f.text)
  )
    .map((t) => t.replace(/[。．]+$/u, "").trim())
    .filter(Boolean);

  const primary = lines[0];
  const secondary = lines[1];
  const tertiary = lines[2];

  const hookLine = (): string => primary ?? input.performers?.[0] ?? "公開情報ベースの作品ポイント";

  const supportLine = (text: string | undefined, fallback: string): string => {
    if (!text) return fallback;
    if (overlaps(text, primary ?? "")) return fallback;
    return text;
  };

  if (input.threadShape === "SINGLE") {
    let body = `${hookLine()}。`;
    // Realized copy may already be multi-sentence in one line — do not glue raw second fact.
    if (
      secondary &&
      !overlaps(secondary, primary ?? "") &&
      !body.includes(secondary) &&
      body.length + secondary.length < 72
    ) {
      body = `${hookLine()}。${secondary}。`;
    }
    if (input.linkMode === "WP_TRAFFIC") {
      body = `${body}詳細は記事で。`;
      body = withDisc(body);
      body = withUrl(body, input.wpUrl);
      return [{ sequence: 1, role: "ROOT", body, linkKind: "wp" }];
    }
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
    body: withDisc(`${hookLine()}。`),
    linkKind: "none",
  });

  if (input.threadShape === "SHORT_THREAD") {
    let body = `${supportLine(secondary, "")}。`;
    if (!secondary) {
      body = `${hookLine()}。`;
    }
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
    if (input.linkMode === "WP_TRAFFIC") {
      body = withDisc(`${body}詳細は記事で。`);
      body = withUrl(body, input.wpUrl);
      posts.push({ sequence: 2, role: "CTA", body, linkKind: "wp" });
      return posts;
    }
    body = withDisc(body);
    body = withUrl(body, input.fanzaUrl);
    posts.push({ sequence: 2, role: "CTA", body, linkKind: "fanza" });
    return posts;
  }

  // RICH_THREAD
  const support2 = supportLine(secondary, "");
  if (support2) {
    posts.push({
      sequence: 2,
      role: "REPLY",
      body: `${support2}。`,
      linkKind: "none",
    });
  }

  if (input.linkMode === "COMBINED" && input.wpUrl && input.fanzaUrl) {
    const t = supportLine(tertiary, support2 || hookLine());
    let wpBody = withDisc(`${t}。詳細は記事で。`);
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

  const t = supportLine(tertiary, "");
  let last = t ? `${t}。` : "";
  if (!last) {
    const only = posts.length === 1 ? `${hookLine()}。` : "";
    if (only && input.linkMode !== "WP_TRAFFIC") {
      return [
        {
          sequence: 1,
          role: "ROOT",
          body: withUrl(withDisc(only), input.fanzaUrl),
          linkKind: "fanza",
        },
      ];
    }
  }
  if (input.linkMode === "WP_TRAFFIC") {
    last = withDisc(`${last || `${hookLine()}。`}詳細は記事で。`);
    last = withUrl(last, input.wpUrl);
    posts.push({ sequence: posts.length + 1, role: "CTA", body: last, linkKind: "wp" });
    return posts.map((p, i) => ({ ...p, sequence: i + 1 }));
  }
  last = withDisc(last || `${hookLine()}。`);
  last = withUrl(last, input.fanzaUrl);
  posts.push({ sequence: posts.length + 1, role: "CTA", body: last, linkKind: "fanza" });
  return posts.map((p, i) => ({ ...p, sequence: i + 1 }));
}
