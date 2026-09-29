/**
 * Production SEO search intent.
 * Decided once from official Evidence. Later stages must not replace it.
 * A query is kept only when a person could type it and this article can answer it.
 * Runtime, price, contentId, URLs, and format-only labels are not queries.
 * No SERP volume, no invented entities, no keyword stuffing.
 */

import {
  isBareGenreToken,
  isPerformerGenreListTitle,
} from "../stock/repair-quality-guard.js";

export type SeoSearchIntentStatus = "VALID" | "NO_NATURAL_QUERY";

export type SeoSearchIntent = {
  status: SeoSearchIntentStatus;
  primaryQuery: string;
  secondaryQueries: string[];
  /** What the reader is trying to confirm. Not a search-volume claim. */
  searchIntent: string;
  queryRationale: string;
};

export type SeoIntentEvidence = {
  productTitle: string;
  contentId?: string | null;
  performers?: string[] | null;
  maker?: string | null;
  series?: string | null;
  genres?: string[] | null;
  /** Already-projected claim / description surfaces. Not a raw synopsis dump. */
  attestedFacts?: string[] | null;
};

const WEAK_SERIES_SHELL_RE = /^(?:\d+\s*時間|BEST|ベスト|総集編|VR|8K|4K|配信限定)$/iu;
const CONTENT_ID_RE = /^[a-z][a-z0-9]{2,31}$/i;
const FORMAT_ONLY_RE = /^(?:配信限定|BEST|ベスト|VR|【VR】|8K|4K|HD|総集編|単体作品)$/iu;
const EDITION_SHELL_RE = /^(?:AIリマスター版|リマスター版|完全版|HD版|配信限定版)$/u;
const UNSUPPORTED_SEO_RE =
  /高検索|検索ボリューム|検索数|売上\s*No|大人気|ランキング\s*1位|必見|見逃せない/u;
const SEO_COPY_INVENTION_RE =
  /おすすめ|オススメ|必見|見逃せ|楽しめる|味わえる|体験でき|印象的|見どころ|魅力的|臨場感|大人気|高検索|検索ボリューム|禁断|リアルな|人間ドラマ|デビュー作|繰り広げ|の世界|お届けします/gu;

function compact(value: string): string {
  return value.replace(/[\s・、,|｜]/gu, "").toLowerCase();
}

function uniq(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const text = raw?.trim() ?? "";
    if (!text) continue;
    const key = compact(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function tokens(value: string): string[] {
  return value
    .split(/[\s・、,|｜]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function isSeoQueryReorder(left: string, right: string): boolean {
  if (compact(left) === compact(right)) return true;
  const a = tokens(left).map((token) => token.toLowerCase()).sort();
  const b = tokens(right).map((token) => token.toLowerCase()).sort();
  if (a.length < 2 || a.length !== b.length) return false;
  return a.every((token, index) => token === b[index]);
}

function isContentId(value: string): boolean {
  return CONTENT_ID_RE.test(value.trim());
}

function charLen(text: string): number {
  return [...text].length;
}

function sameText(left: string, right: string): boolean {
  return compact(left) === compact(right);
}

function isListedName(text: string, names: string[]): boolean {
  return names.some((name) => sameText(name, text));
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Catalog attributes identify a property of a work, not the work.
 * Presence in Evidence, or a digit/latin character, is not identity.
 */
function isNonIdentifyingAttributeValue(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/https?:\/\/|www\./i.test(value)) return true;
  if (/\.(?:jpe?g|png|webp|gif)\b/i.test(value)) return true;
  if (/サンプル画像|パッケージ画像|画像URL|サムネイル|サムネ/u.test(value)) return true;
  if (/(?:^|\s)(?:¥|￥)\s*\d/u.test(value) || /\d[\d,]*\s*円/u.test(value)) return true;
  if (/^(?:価格|税込|税抜|発売日|配信開始日|収録時間|再生時間|画像枚数)$/u.test(value)) return true;
  if (/^\d{4}年(?:\d{1,2}月(?:\d{1,2}日)?)?$/u.test(value)) return true;
  if (/^\d{1,2}月\d{1,2}日$/u.test(value)) return true;
  if (/^約?\d+\s*(?:分|時間|秒|枚|本|名|人|作品|タイトル|ページ|GB|MB)$/iu.test(value)) return true;
  if (/^\d+$/u.test(value)) return true;
  if (FORMAT_ONLY_RE.test(value) || WEAK_SERIES_SHELL_RE.test(value)) return true;
  if (isEditionOrFormatShell(value)) return true;
  return false;
}

/** Edition labels and short genre-series shells identify a catalog bucket, not one work. */
function isEditionOrFormatShell(text: string): boolean {
  const value = text.trim();
  const bare = value.replace(/[【】\s]/g, "");
  if (EDITION_SHELL_RE.test(bare)) return true;
  if (/シリーズ$/u.test(value) && charLen(value) <= 16) return true;
  return false;
}

/** Runtime, price, count, URL, content id, or a format label anywhere in the string. */
function containsNonQueryAtom(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (isNonIdentifyingAttributeValue(value) || isContentId(value)) return true;
  if (/(?:約)?\d+\s*(?:分|時間|秒)/u.test(value)) return true;
  if (/\d+\s*(?:タイトル|枚|本|作品)/u.test(value)) return true;
  if (/(?:^|[^\p{L}])(?:VR|8K|4K|HD)(?:[^\p{L}]|$)/iu.test(value)) return true;
  if (/配信限定|総集編/u.test(value)) return true;
  return false;
}

/** A shorter official-title phrase, not a catalog atom that merely co-occurs. */
function isPhraseInsideOfficialTitle(fact: string, productTitle: string): boolean {
  const factKey = compact(fact);
  const titleKey = compact(productTitle);
  if (!factKey || !titleKey || factKey === titleKey) return false;
  return titleKey.includes(factKey);
}

/**
 * Narrow enough that a single-work article can be the right result.
 * Short official strings are not specific just because they are short.
 */
function isWorkSpecificPhrase(
  text: string,
  performers: string[],
  maker: string | null,
  genres: string[],
): boolean {
  const value = text.trim();
  if (charLen(value) < 4 || charLen(value) > 32) return false;
  if (/[。！？!?]/.test(value)) return false;
  if (containsNonQueryAtom(value)) return false;
  if (isContentId(value) || isBareGenreToken(value) || WEAK_SERIES_SHELL_RE.test(value)) {
    return false;
  }
  if (isListedName(value, performers)) return false;
  if (maker && sameText(maker, value)) return false;
  if (isListedName(value, genres)) return false;
  if (isPerformerGenreGlue(value, performers, genres)) return false;
  const katakana = /[\u30a0-\u30ff]{3,}/u.test(value);
  const latin = /[A-Za-z]{2,}/.test(value);
  const hiragana = (value.match(/[\u3040-\u309f]/gu) ?? []).length;
  const kanji = (value.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  if (katakana || latin) return true;
  if (kanji >= 4 && hiragana === 0) return true;
  return charLen(value) >= 12 && hiragana <= 4;
}

/** Official title a person could type, but too generic to identify one work. */
function isAmbiguousShortTitle(
  title: string,
  performers: string[],
  maker: string | null,
  genres: string[],
): boolean {
  const value = title.trim();
  if (charLen(value) < 2 || charLen(value) > 12) return false;
  if (/[。！？!?]/.test(value) || containsNonQueryAtom(value)) return false;
  if (isContentId(value) || isBareGenreToken(value) || WEAK_SERIES_SHELL_RE.test(value)) {
    return false;
  }
  if (isListedName(value, performers)) return false;
  if (maker && sameText(maker, value)) return false;
  if (isListedName(value, genres)) return false;
  return !isWorkSpecificPhrase(value, performers, maker, genres);
}

/** Named series that would match many works, not a shell like ベスト / 4時間. */
function isBroadNamedSeries(
  series: string,
  performers: string[],
  maker: string | null,
  genres: string[],
): boolean {
  const value = series.trim();
  if (charLen(value) < 4 || charLen(value) > 16) return false;
  if (containsNonQueryAtom(value) || WEAK_SERIES_SHELL_RE.test(value)) return false;
  if (isBareGenreToken(value) || isContentId(value)) return false;
  if (isListedName(value, performers) || (maker && sameText(maker, value))) return false;
  return !isWorkSpecificPhrase(value, performers, maker, genres);
}

function compoundQuery(anchor: string, qualifier: string): string | null {
  const left = anchor.trim();
  const right = qualifier.trim();
  if (!left || !right || sameText(left, right)) return null;
  if (containsNonQueryAtom(left) || containsNonQueryAtom(right)) return null;
  const query = `${left} ${right}`;
  if (charLen(query) > 28) return null;
  if (tokens(query).length !== 2) return null;
  return query;
}

function isPerformerGenreGlue(
  title: string,
  performers: string[],
  genres: string[],
): boolean {
  if (isPerformerGenreListTitle(title, performers)) return true;
  const parts = tokens(title);
  if (parts.length < 2) return false;
  const genreSet = new Set(genres.map((genre) => compact(genre)));
  const performerSet = new Set(performers.map((name) => compact(name)));
  const hasPerformer = parts.some((part) => performerSet.has(compact(part)));
  const hasGenre = parts.some(
    (part) => genreSet.has(compact(part)) || isBareGenreToken(part),
  );
  const rest = parts.filter(
    (part) =>
      !performerSet.has(compact(part)) &&
      !genreSet.has(compact(part)) &&
      !isBareGenreToken(part),
  );
  return hasPerformer && hasGenre && rest.length === 0;
}

function isUnnaturalFragment(value: string): boolean {
  const bare = value.trim().replace(/^[～〜]+|[～〜]+$/gu, "");
  return /^(?:しかも|そして|さらに|これで|ついに)/u.test(bare);
}

function isSearchableClause(value: string): boolean {
  if (charLen(value) < 4 || charLen(value) > 12) return false;
  if (isUnnaturalFragment(value)) return false;
  if (containsNonQueryAtom(value) || isContentId(value) || FORMAT_ONLY_RE.test(value)) return false;
  if (isBareGenreToken(value)) return false;
  if (/[のをにではがへともてしるたすく]$/u.test(value)) return false;
  if (/^(?:の|を|に|で|は|が)/u.test(value)) return false;
  const kanji = (value.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  const katakana = (value.match(/[\u30a0-\u30ff]/gu) ?? []).length;
  return kanji >= 2 || katakana >= 3;
}

/** Whole official clauses only. Never slices an adult word in half. */
function pickPremiseClause(title: string, performers: string[]): string | null {
  let text = title.replace(/【[^】]*】/g, " ");
  const names = performers
    .map((name) => name.trim())
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    text = text.replace(new RegExp(escapeReg(name), "g"), " ");
  }
  text = text.replace(/(?:約)?\d+\s*(?:分|時間|秒)/gu, " ");
  text = text.replace(/\d+\s*タイトル/gu, " ");
  text = text.replace(/配信限定|総集編|単体作品/gu, " ");
  text = text.replace(/(?:BEST|ベスト|8K|4K)/giu, " ");
  text = text.replace(/(?:^|[^\p{L}])VR(?:[^\p{L}]|$)/giu, " ");
  const parts = text
    .split(/[\s　！!？?。．、,|｜・]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const natural = parts.filter(isSearchableClause).sort((a, b) => charLen(b) - charLen(a));
  return natural[0] ?? null;
}

/** A whole katakana or latin word already in the official title. Never a mid-word slice. */
function distinctiveContentWord(title: string, performers: string[]): string | null {
  let text = title.replace(/【[^】]*】/g, " ");
  const names = performers
    .map((name) => name.trim())
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const name of names) text = text.replace(new RegExp(escapeReg(name), "g"), " ");
  const words = text.match(/[\u30a0-\u30ffA-Za-z][\u30a0-\u30ffA-Za-z0-9]{3,11}/gu) ?? [];
  return (
    words.find(
      (word) =>
        charLen(word) >= 4 &&
        charLen(word) <= 12 &&
        !/\d/u.test(word) &&
        !/タイトル|ベスト|リマスター/u.test(word) &&
        !containsNonQueryAtom(word) &&
        !isEditionOrFormatShell(word) &&
        !isBareGenreToken(word),
    ) ?? null
  );
}

function pickCampaign(series: string | null, title: string): string | null {
  for (const raw of [series, title]) {
    const value = raw?.trim() ?? "";
    if (!value || !/周年|記念|キャンペーン|リクエスト祭|ユーザーリクエスト/u.test(value)) continue;
    if (containsNonQueryAtom(value) || /[。！？]/u.test(value)) continue;
    if (charLen(value) < 4 || charLen(value) > 24) continue;
    return value;
  }
  return null;
}

function pushEligible(
  bucket: string[],
  candidate: string | null | undefined,
  primary: string,
): void {
  const text = candidate?.trim() ?? "";
  if (!text || bucket.length >= 3) return;
  if (containsNonQueryAtom(text) && isContentId(text) === false && !CONTENT_ID_RE.test(text)) {
    if (isNonIdentifyingAttributeValue(text) || containsNonQueryAtom(text)) return;
  }
  if (isNonIdentifyingAttributeValue(text)) return;
  if (isSeoQueryReorder(text, primary)) return;
  if (bucket.some((existing) => isSeoQueryReorder(existing, text))) return;
  bucket.push(text);
}

type QueryChoice = {
  primaryQuery: string;
  searchIntent: string;
  reasons: string[];
  status: SeoSearchIntentStatus;
};

/**
 * One SEO intent for this work. Call once from article generation.
 * Downstream Planner / Writer / Review / publication metadata must reuse it.
 */
export function decideSeoSearchIntent(input: SeoIntentEvidence): SeoSearchIntent {
  const productTitle = input.productTitle.trim();
  const performers = uniq(input.performers ?? []);
  const genres = uniq(input.genres ?? []);
  const contentId =
    input.contentId && isContentId(input.contentId) ? input.contentId.trim().toLowerCase() : null;
  const series = input.series?.trim() || null;
  const maker = input.maker?.trim() || null;
  const solePerformer = performers.length === 1 ? performers[0]! : null;
  const titleHasPerformer = performers.some((name) => name.length >= 2 && productTitle.includes(name));
  const specificTitle =
    !titleHasPerformer &&
    !containsNonQueryAtom(productTitle) &&
    charLen(productTitle) <= 16 &&
    isWorkSpecificPhrase(productTitle, performers, maker, genres)
      ? productTitle
      : null;
  const ambiguousTitle = isAmbiguousShortTitle(productTitle, performers, maker, genres)
    ? productTitle
    : null;
  const specificSeries =
    series &&
    !containsNonQueryAtom(series) &&
    charLen(series) <= 16 &&
    isWorkSpecificPhrase(series, performers, maker, genres)
      ? series
      : null;
  const broadSeries =
    series && isBroadNamedSeries(series, performers, maker, genres) ? series : null;
  const premiseClause = pickPremiseClause(productTitle, performers);
  const featureWord = premiseClause ? null : distinctiveContentWord(productTitle, performers);
  const performerFeature =
    solePerformer && featureWord ? compoundQuery(solePerformer, featureWord) : null;
  const performerPremise =
    solePerformer && premiseClause && !(ambiguousTitle && sameText(premiseClause, ambiguousTitle))
      ? compoundQuery(solePerformer, premiseClause)
      : null;
  const titlePerformer =
    ambiguousTitle && solePerformer ? compoundQuery(ambiguousTitle, solePerformer) : null;
  const seriesPerformer =
    broadSeries && solePerformer ? compoundQuery(broadSeries, solePerformer) : null;
  const campaign = pickCampaign(series, productTitle);
  const campaignQuery =
    campaign && solePerformer && !campaign.includes(solePerformer) && charLen(campaign) > 18
      ? compoundQuery(solePerformer, campaign) ?? campaign
      : campaign;

  const specificFact = (input.attestedFacts ?? [])
    .map((fact) => fact.trim())
    .find(
      (fact) =>
        !containsNonQueryAtom(fact) &&
        !isUnnaturalFragment(fact) &&
        isPhraseInsideOfficialTitle(fact, productTitle) &&
        charLen(fact) <= 18 &&
        isWorkSpecificPhrase(fact, performers, maker, genres) &&
        !sameText(fact, productTitle) &&
        !(series && sameText(fact, series)) &&
        !(premiseClause && sameText(fact, premiseClause)),
    );
  const sawNonIdentifyingAttribute = (input.attestedFacts ?? []).some((fact) =>
    isNonIdentifyingAttributeValue(fact.trim()) || containsNonQueryAtom(fact.trim()),
  );

  let choice: QueryChoice;
  if (specificTitle) {
    choice = {
      status: "VALID",
      primaryQuery: specificTitle,
      searchIntent: "作品固有の正式作品名から、この作品の内容を確認したい",
      reasons: [`正式作品名「${specificTitle}」は作品固有性を持つのでprimaryQueryにした。`],
    };
  } else if (specificSeries) {
    choice = {
      status: "VALID",
      primaryQuery: specificSeries,
      searchIntent: "作品固有のシリーズ名から、この作品の内容を確認したい",
      reasons: [`シリーズ名「${specificSeries}」はこの作品を狭く特定できるのでprimaryQueryにした。`],
    };
  } else if (performerPremise) {
    choice = {
      status: "VALID",
      primaryQuery: performerPremise,
      searchIntent: "出演者名と公式の前提から、この作品の内容を確認したい",
      reasons: [
        `長い公式題名はそのまま使わず、出演者名と公式の前提「${premiseClause}」から「${performerPremise}」をprimaryQueryにした。`,
      ],
    };
  } else if (specificFact) {
    choice = {
      status: "VALID",
      primaryQuery: specificFact,
      searchIntent: "公式情報にある作品固有の語句から、この作品の内容を確認したい",
      reasons: [`公式語句「${specificFact}」はこの作品を狭く特定できるのでprimaryQueryにした。`],
    };
  } else if (titlePerformer) {
    choice = {
      status: "VALID",
      primaryQuery: titlePerformer,
      searchIntent: "作品名と出演者名で、この作品を特定して内容を確認したい",
      reasons: [
        `正式作品名「${ambiguousTitle}」は単独では曖昧なので、出演者名で特定性を補い「${titlePerformer}」をprimaryQueryにした。`,
      ],
    };
  } else if (seriesPerformer) {
    choice = {
      status: "VALID",
      primaryQuery: seriesPerformer,
      searchIntent: "シリーズ名と出演者名で、この作品を特定して内容を確認したい",
      reasons: [
        `シリーズ名「${broadSeries}」は広すぎるため単独のtargetから除外し、出演者名で特定性を補い「${seriesPerformer}」をprimaryQueryにした。`,
      ],
    };
  } else if (performerFeature) {
    choice = {
      status: "VALID",
      primaryQuery: performerFeature,
      searchIntent: "出演者名と公式の前提から、この作品の内容を確認したい",
      reasons: [
        `長い公式文はそのまま使わず、出演者名と公式にある語句「${featureWord}」から「${performerFeature}」をprimaryQueryにした。`,
      ],
    };
  } else if (campaignQuery && !containsNonQueryAtom(campaignQuery)) {
    choice = {
      status: "VALID",
      primaryQuery: campaignQuery,
      searchIntent: "キャンペーン名から、この作品を特定して内容を確認したい",
      reasons: [`キャンペーン名「${campaignQuery}」をprimaryQueryにした。`],
    };
  } else {
    choice = {
      status: "NO_NATURAL_QUERY",
      primaryQuery: "",
      searchIntent: "",
      reasons: [
        "作品を自然な検索語として特定できる公式の語句がないので、primaryQueryは作らなかった。",
      ],
    };
  }

  const secondaryQueries: string[] = [];
  if (choice.status === "VALID" && contentId && contentId !== choice.primaryQuery) {
    pushEligible(secondaryQueries, contentId, choice.primaryQuery);
    choice.reasons.push(`品番${contentId}は作品を直接特定できるのでsecondaryQueryにした。`);
  }
  if (contentId && choice.status === "NO_NATURAL_QUERY") {
    choice.reasons.push("品番をprimaryQueryにしていない。");
  }
  if (specificTitle && specificTitle !== choice.primaryQuery) {
    pushEligible(secondaryQueries, specificTitle, choice.primaryQuery);
  }
  if (specificSeries && specificSeries !== choice.primaryQuery) {
    pushEligible(secondaryQueries, specificSeries, choice.primaryQuery);
  }

  if (ambiguousTitle && ambiguousTitle !== choice.primaryQuery) {
    choice.reasons.push(`正式作品名「${ambiguousTitle}」は一般語だけで、単独ではtargetにしていない。`);
  }
  if (broadSeries && !choice.reasons.some((reason) => reason.includes(broadSeries))) {
    choice.reasons.push(`シリーズ名「${broadSeries}」は広すぎるためtargetから除外した。`);
  }
  if (performers.length > 0) {
    choice.reasons.push("出演者名だけでは1作品記事のtargetにしていない。");
  }
  if (maker) {
    choice.reasons.push("メーカー名だけでは1作品記事のtargetにしていない。");
  }
  if (genres.length > 0) {
    choice.reasons.push("一般ジャンル名だけでは1作品記事のtargetにしていない。");
  }
  if (sawNonIdentifyingAttribute || containsNonQueryAtom(productTitle)) {
    choice.reasons.push(
      "収録時間・価格・発売日・点数・画像・URLなどの属性値は作品を特定しないのでtargetにしていない。",
    );
  }
  choice.reasons.push("検索ボリュームは取得していない。");

  return {
    status: choice.status,
    primaryQuery: choice.primaryQuery,
    secondaryQueries,
    searchIntent: choice.searchIntent,
    queryRationale: choice.reasons.join(""),
  };
}

export function readSeoSearchIntent(
  seo: Record<string, unknown> | null | undefined,
): SeoSearchIntent | null {
  if (!seo) return null;
  const status =
    seo.status === "NO_NATURAL_QUERY"
      ? "NO_NATURAL_QUERY"
      : seo.status === "VALID"
        ? "VALID"
        : null;
  const primaryQuery = typeof seo.primaryQuery === "string" ? seo.primaryQuery.trim() : "";
  if (!primaryQuery && status !== "NO_NATURAL_QUERY") return null;
  const secondaryQueries = Array.isArray(seo.secondaryQueries)
    ? seo.secondaryQueries.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const searchIntent =
    typeof seo.searchIntent === "string" && seo.searchIntent.trim()
      ? seo.searchIntent.trim()
      : status === "NO_NATURAL_QUERY"
        ? ""
        : "この作品の内容を確認したい";
  const queryRationale =
    typeof seo.queryRationale === "string" ? seo.queryRationale.trim() : "";
  return {
    status: status ?? "VALID",
    primaryQuery,
    secondaryQueries,
    searchIntent,
    queryRationale,
  };
}

/** Later SEO title/description edits must keep the original intent fields. */
export function preserveSeoSearchIntentFields(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const locked = readSeoSearchIntent(previous ?? undefined);
  if (!locked) return next;
  return {
    ...next,
    status: locked.status,
    primaryQuery: locked.primaryQuery,
    secondaryQueries: locked.secondaryQueries,
    searchIntent: locked.searchIntent,
    queryRationale: locked.queryRationale,
  };
}

export function seoCopyAddsUngroundedClaim(text: string, allowedText: string): boolean {
  const hits = text.match(SEO_COPY_INVENTION_RE) ?? [];
  return hits.some((hit) => !allowedText.includes(hit));
}

export function groundSeoCopy(input: {
  seoTitle: string;
  metaDescription: string;
  articleTitle: string;
  body: string;
  allowedText: string;
}): { seoTitle: string; metaDescription: string } {
  const allowed = input.allowedText;
  const seoTitle = input.seoTitle.trim();
  const meta = input.metaDescription.trim();
  const groundedTitle = seoCopyAddsUngroundedClaim(seoTitle, allowed)
    ? `${input.articleTitle.trim().slice(0, 36)}｜オトナセレクト`.slice(0, 70)
    : seoTitle.slice(0, 70);
  let groundedMeta = seoCopyAddsUngroundedClaim(meta, allowed) ? "" : meta;
  if (!groundedMeta || groundedMeta.length < 28) {
    const sentence = input.body
      .split(/[。\n]/u)
      .map((part) => part.trim())
      .find((part) => part.length >= 28 && !seoCopyAddsUngroundedClaim(part, allowed));
    groundedMeta = sentence
      ? `${sentence}。`.slice(0, 120)
      : "公開情報で確認できる作品の内容を、短く整理した記事です。";
  }
  return { seoTitle: groundedTitle, metaDescription: groundedMeta.slice(0, 120) };
}

export function buildSeoReviewPrompt(input: {
  intent: SeoSearchIntent | null;
  title: string;
  body: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
}): { system: string; user: string } {
  const system = [
    "あなたは日本語記事のSEOレビュー担当です。JSONのみ返してください。",
    "判定は primaryQuery と searchIntent に記事が沿っているかです。",
    "primaryQueryの完全一致を何度も要求しない。検索意図が満たされていれば足りる。",
    "keyword stuffing、検索意図と無関係な語の追加、Evidenceにない評価・人気・検索ボリュームの捏造はFAILED。",
    "事実を足してPASSにしない。不足ならFAILEDかWARNING。",
    "primaryQueryを別のクエリへ変える修正は要求しない。",
    "返すJSONは {result, score, findings, requiredActions}。resultは PASSED|WARNING|FAILED。",
  ].join("");
  const user = JSON.stringify({
    status: input.intent?.status ?? null,
    primaryQuery: input.intent?.primaryQuery ?? null,
    secondaryQueries: input.intent?.secondaryQueries ?? [],
    searchIntent: input.intent?.searchIntent ?? null,
    queryRationale: input.intent?.queryRationale ?? null,
    title: input.title,
    body: input.body.slice(0, 4000),
    seoTitle: input.seoTitle ?? null,
    metaDescription: input.metaDescription ?? null,
    legacyWithoutIntent: input.intent == null,
    checks: [
      "primaryQuery/searchIntentと記事内容が一致しているか",
      "titleが検索意図を表しているか",
      "seoTitleが内容と一致しているか",
      "metaDescriptionが記事内容を正確に要約しているか",
      "keyword stuffingがないか",
      "検索意図と無関係な語をSEO目的で追加していないか",
      "EvidenceにないSEO表現を作っていないか",
    ],
  });
  return { system, user };
}

function countOccurrences(haystack: string, needle: string): number {
  const n = needle.trim();
  if (n.length < 2) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(n, from);
    if (at < 0) break;
    count += 1;
    from = at + n.length;
  }
  return count;
}

function looksLikeKeywordListTitle(title: string): boolean {
  const text = title.replace(/[|｜]\s*オトナセレクト$/u, "").trim();
  if (!text || /[をにでへはが]/.test(text)) return false;
  const parts = tokens(text);
  return parts.length >= 3 && parts.every((part) => part.length <= 12);
}

/**
 * Hard SEO failures that must not be overridden by a generous LLM PASS.
 * Missing intent on older ContentVersions is not a failure.
 */
export function evaluateSeoIntentReview(input: {
  intent: SeoSearchIntent | null;
  title: string;
  body: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  allowedText?: string | null;
}): { hardFail: boolean; findings: string[] } {
  const findings: string[] = [];
  const seoTitle = input.seoTitle?.trim() ?? "";
  const meta = input.metaDescription?.trim() ?? "";
  const combined = [input.title, input.body, seoTitle, meta].join("\n");
  const allowed = input.allowedText ?? "";
  if (UNSUPPORTED_SEO_RE.test(`${seoTitle}\n${meta}`)) {
    findings.push("SEO_UNSUPPORTED_CLAIM");
  } else if (seoCopyAddsUngroundedClaim(`${seoTitle}\n${meta}`, allowed)) {
    findings.push("SEO_UNSUPPORTED_CLAIM");
  }
  if (looksLikeKeywordListTitle(input.title) || looksLikeKeywordListTitle(seoTitle)) {
    findings.push("SEO_KEYWORD_LIST");
  }
  const primary = input.intent?.primaryQuery?.trim() ?? "";
  if (primary && countOccurrences(input.body, primary) >= 4) {
    findings.push("SEO_KEYWORD_STUFFING");
  }
  return { hardFail: findings.length > 0, findings };
}
