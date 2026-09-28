/**
 * SOURCE span → semantic fact with a determined role.
 * A contiguous safe string is not a fact until its role is known.
 * Readings are closed patterns with provenance. They are not free summaries.
 */

import { detectXAdultExpressions } from "./x-social-content-policy.js";
import { hasParticleHole } from "./x-copy-quality.js";
import type {
  FactSalience,
  SemanticFact,
  SemanticFactRole,
  SemanticRelation,
  XViability,
} from "./social-plan.js";

const PHRASE_SPLIT = /[！!？?。．…／/|｜＆&「」『』~～]+|\s+|【|】/u;
const FEATURE_TOKENS = ["完全主観ホラー", "完全主観"] as const;

function isAdultSurface(value: string): boolean {
  return detectXAdultExpressions(value).hit || /エロ|下品|変態|精液|ヌキ|センズリ|中出し/u.test(value);
}

function pushFact(
  facts: SemanticFact[],
  role: SemanticFactRole,
  salience: FactSalience,
  value: string,
  source: string,
  evidence: string,
): void {
  const next = value.trim();
  if (next.length < 2 || next.length > 40 || isAdultSurface(next) || hasParticleHole(next)) return;
  if (facts.some((fact) => fact.value === next)) return;
  facts.push({
    role,
    salience,
    value: next,
    provenance: { source: source.slice(0, 120), evidence },
  });
}

function isMeasurementDump(phrase: string): boolean {
  const rest = phrase
    .replace(/\d+\s*(?:時間|分|作品|枚組|人|名|ヶ月|タイトル)/gu, "")
    .replace(/豪華|収録|約/gu, "")
    .trim();
  return rest.length < 4 && /\d/u.test(phrase);
}

function isPersonPremise(value: string): boolean {
  return /(?:学生|男性|女性|男子|女子|女優|男優)$/u.test(value);
}

function isCampaign(value: string): boolean {
  return value.length >= 8 && /周年|祭り/u.test(value);
}

/** A long official segment that names the project, not a brand, a runtime, or BEST. */
function isContentWorkTitle(value: string): boolean {
  if (value.length < 10 || value.length > 36) return false;
  if (/シリーズ\s*\d*$/u.test(value)) return false;
  if (/ベスト|BEST|総集|枚組|時間|収録|タイトル|コンプリート|vol\.?/iu.test(value)) return false;
  if (/^[A-Za-z0-9ァ-ヶー・\s.]+$/u.test(value)) return false;
  if (isCampaign(value)) return false;
  const kanji = value.match(/[一-龯]{2,}/gu) ?? [];
  return kanji.some((token) => !/^(?:作品|収録|時間|配信|限定|シリーズ)$/u.test(token));
}

function isSupportingSpec(value: string): boolean {
  return (
    /^(?:約)?\d+(?:\.\d+)?(?:時間|分)$/u.test(value) ||
    /^\d+(?:枚組|作品収録|作品|タイトル|ヶ月|人|名)$/u.test(value) ||
    /^(?:撮影期間|応募人数|収録時間)/u.test(value) ||
    /^(?:配信限定|VR|8K)$/u.test(value) ||
    /^vol\.?\s*\d+$/iu.test(value) ||
    value === "ベストをまとめた作品" ||
    /BEST$/iu.test(value)
  );
}

export function extractSemanticFacts(input: {
  sources: string[];
  performers?: string[];
  seriesName?: string | null;
}): SemanticFact[] {
  const facts: SemanticFact[] = [];
  const performers = (input.performers ?? []).map((name) => name.trim()).filter((name) => name.length >= 2);
  const performerSet = new Set(performers);
  const blob = input.sources.join("\n");

  for (const name of performers) {
    pushFact(facts, "who", "entity", name, name, name);
  }
  const series = input.seriesName?.trim() ?? "";
  if (
    series.length >= 8 &&
    !isAdultSurface(series) &&
    !performerSet.has(series) &&
    !isSupportingSpec(series) &&
    !/\d+\s*(?:時間|分|枚組|タイトル|作品)/u.test(series)
  ) {
    pushFact(facts, "what", "entity", series, series, series);
  }

  const hour = blob.match(/(?<![\d.])(約)?\s*(\d+(?:\.\d+)?)\s*時間/u);
  if (hour?.[2]) pushFact(facts, "attribute", "supporting", `${hour[1] ?? ""}${hour[2]}時間`, blob, hour[0]);
  const minute = blob.match(/(?<![\d.])(\d+)\s*分/u);
  if (minute?.[1] && !/時間/u.test(blob)) {
    pushFact(facts, "attribute", "supporting", `${minute[1]}分`, blob, minute[0]);
  }
  const month = blob.match(/撮影期間\s*(\d+)\s*ヶ?月/u);
  if (month?.[1]) pushFact(facts, "attribute", "supporting", `撮影期間${month[1]}ヶ月`, blob, month[0]);
  const applicants = blob.match(/応募人数\s*(\d{1,3}(?:[,，]\d{3})+|\d+)\s*人/u);
  if (applicants?.[1]) {
    pushFact(facts, "attribute", "supporting", `応募人数${applicants[1]}人`, blob, applicants[0]);
  }
  const titleCount = blob.match(/(?<![\d.])(\d+)\s*タイトル/u);
  if (titleCount?.[1]) pushFact(facts, "attribute", "supporting", `${titleCount[1]}タイトル`, blob, titleCount[0]);
  const works = blob.match(/(?<![\d.])(\d+)\s*作品/u);
  if (works?.[1]) {
    const recorded = blob.includes(`${works[1]}作品収録`);
    pushFact(
      facts,
      "attribute",
      "supporting",
      recorded ? `${works[1]}作品収録` : `${works[1]}作品`,
      blob,
      works[0],
    );
  }
  const discs = blob.match(/(?<![\d.])(\d+)\s*枚組/u);
  if (discs?.[1]) pushFact(facts, "attribute", "supporting", `${discs[1]}枚組`, blob, discs[0]);
  const people = blob.match(/(?<![\d.,，])(\d{1,3}(?:[,，]\d{3})+|\d+)\s*(?:人|名)/u);
  if (people?.[1] && !facts.some((fact) => fact.value.includes(`${people[1]}人`) || fact.value.includes(`${people[1]}名`))) {
    pushFact(
      facts,
      "attribute",
      "supporting",
      `${people[1]}${blob.includes(`${people[1]}名`) ? "名" : "人"}`,
      blob,
      people[0],
    );
  }
  const volume = blob.match(/vol\.?\s*(\d+)/iu);
  if (volume?.[0]) pushFact(facts, "attribute", "supporting", volume[0].replace(/\s+/gu, ""), blob, volume[0]);

  if (blob.includes("配信限定")) pushFact(facts, "attribute", "supporting", "配信限定", blob, "配信限定");
  for (const token of FEATURE_TOKENS) {
    if (blob.includes(token)) pushFact(facts, "what", "primary", token, blob, token);
  }
  if (/【\s*VR\s*】|(?:^|[^A-Za-z])VR(?:[^A-Za-z]|$)/u.test(blob)) {
    pushFact(facts, "attribute", "supporting", "VR", blob, "VR");
  }
  if (/【\s*8K\s*】|(?:^|[^A-Za-z0-9])8K(?:[^A-Za-z0-9]|$)/u.test(blob)) {
    pushFact(facts, "attribute", "supporting", "8K", blob, "8K");
  }
  if (/ベスト|BEST|総集編/iu.test(blob) && !/ベストBOX|BEST\s*BOX/iu.test(blob)) {
    pushFact(facts, "what", "supporting", "ベストをまとめた作品", blob, /ベスト/u.test(blob) ? "ベスト" : "BEST");
  }

  for (const source of input.sources) {
    for (const raw of source.split(PHRASE_SPLIT)) {
      const part = raw.trim();
      if (part.length < 8 || part.length > 36 || isAdultSurface(part) || hasParticleHole(part)) continue;
      if (performerSet.has(part) || isMeasurementDump(part) || isSupportingSpec(part)) continue;
      let phrase = part
        .replace(/(?:約)?\s*\d+(?:\.\d+)?\s*時間$/u, "")
        .replace(/\d+\s*分$/u, "")
        .trim();
      for (const name of performers) {
        if (phrase.startsWith(name)) {
          const rest = phrase.slice(name.length).replace(/^[の\s]+/u, "").trim();
          if (rest.length >= 8) phrase = rest;
        }
      }
      if (phrase.length < 8 || isAdultSurface(phrase) || hasParticleHole(phrase)) continue;
      if (performers.some((name) => phrase === name)) continue;

      const limited = phrase.match(/^配信限定\s*[:：]\s*(.{2,16})$/u);
      if (limited?.[1] && !isAdultSurface(limited[1])) {
        pushFact(facts, "what", "entity", limited[1], source, phrase);
        continue;
      }
      if (/[がを]/u.test(phrase) && !isMeasurementDump(phrase)) {
        pushFact(facts, "premise", "primary", phrase, source, phrase);
        continue;
      }
      if (isCampaign(phrase)) {
        pushFact(facts, "what", "primary", phrase, source, phrase);
        continue;
      }
      const boxAt = phrase.indexOf("ベストBOX");
      if (boxAt > 0) {
        const prefix = phrase.slice(0, boxAt).trim();
        if (prefix.length >= 4) {
          pushFact(facts, "what", "supporting", `${prefix}をまとめた作品`, source, `${prefix} / ベストBOX`);
        }
        continue;
      }
      if (isContentWorkTitle(phrase)) {
        pushFact(facts, "what", "primary", phrase, source, phrase);
        continue;
      }
      if (/\d|ベスト|BEST|時間|枚組|タイトル/iu.test(phrase)) continue;
      if (/[ァ-ヶーA-Za-z]{4,}/u.test(phrase) && phrase.length >= 8 && !/[がを]/u.test(phrase)) {
        pushFact(facts, "what", "entity", phrase, source, phrase);
      }
    }
  }

  return facts;
}

function overlaps(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a);
}

/** Prefer a primary fact. Do not fill the list with specs. */
export function selectSemanticFacts(facts: SemanticFact[], limit = 4): SemanticFact[] {
  const rank = (fact: SemanticFact) =>
    fact.salience === "primary" ? 0 : fact.salience === "entity" ? 1 : 2;
  const content = facts
    .filter((fact) => fact.role !== "who")
    .sort((a, b) => rank(a) - rank(b) || b.value.length - a.value.length);
  const picked: SemanticFact[] = [];
  for (const fact of content) {
    if (picked.length >= limit) break;
    if (picked.some((item) => overlaps(item.value, fact.value))) continue;
    picked.push(fact);
  }
  const who = facts.find((fact) => fact.role === "who");
  return who ? [who, ...picked].slice(0, limit + 1) : picked;
}

export function buildSemanticRelations(input: {
  facts: SemanticFact[];
  subject: string | null;
}): SemanticRelation[] {
  const facts = input.facts;
  const performer = input.subject?.trim() || facts.find((fact) => fact.role === "who")?.value || "";
  const campaign = facts.find((fact) => fact.salience === "primary" && isCampaign(fact.value))?.value ?? null;
  const feature = facts.find((fact) => fact.salience === "primary" && FEATURE_TOKENS.includes(fact.value as (typeof FEATURE_TOKENS)[number]))?.value ?? null;
  const premise = facts.find((fact) => fact.role === "premise" && fact.salience === "primary")?.value ?? null;
  const project =
    facts.find((fact) => fact.salience === "primary" && fact.role === "what" && !isCampaign(fact.value) && fact.value !== feature)?.value ??
    null;
  const work =
    facts.find((fact) => fact.salience === "entity" && fact.role === "what")?.value ??
    project ??
    campaign ??
    null;
  const relations: SemanticRelation[] = [];
  const add = (type: SemanticRelation["type"], from: string | null, to: string | null) => {
    if (!from || !to || from === to) return;
    if (relations.some((relation) => relation.type === type && relation.from === from && relation.to === to)) return;
    relations.push({ type, from, to });
  };
  if (performer && work) add("appears_in", performer, work);
  if (work && campaign && work !== campaign) add("belongs_to", work, campaign);
  if (feature && (project || campaign || work)) add("has_feature", project ?? work ?? campaign, feature);
  if (premise && isPersonPremise(premise) && performer) add("described_as", performer, premise);
  else if (premise && work) add("has_premise", work, premise);
  for (const fact of facts.filter((item) => item.salience === "supporting")) {
    if (!work) continue;
    if (fact.value.endsWith("をまとめた作品")) add("compilation_of", work, fact.value);
    else if (/^(?:配信限定|VR|8K)$/u.test(fact.value)) add("has_format", work, fact.value);
    else if (/時間|ヶ月/u.test(fact.value)) add("has_runtime", work, fact.value);
    else if (/枚組|作品|タイトル|人|名|vol/iu.test(fact.value)) add("has_volume", work, fact.value);
  }
  return relations;
}

export function assessXViability(facts: SemanticFact[]): XViability {
  return facts.some((fact) => fact.salience === "primary") ? "X_POSTABLE" : "X_INSUFFICIENT_MATERIAL";
}
