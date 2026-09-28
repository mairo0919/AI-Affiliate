/**
 * SOURCE span → semantic fact.
 * Readings are closed patterns with provenance. They are not free summaries.
 */

import { detectXAdultExpressions } from "./x-social-content-policy.js";
import { hasParticleHole } from "./x-copy-quality.js";
import type { SemanticFact, SemanticFactRole } from "./social-plan.js";

const PHRASE_SPLIT = /[！!？?。．…／/|｜＆&「」『』]+|\s+|【|】/u;

function isAdultSurface(value: string): boolean {
  return detectXAdultExpressions(value).hit || /エロ|下品|変態|精液|ヌキ|センズリ|中出し/u.test(value);
}

function pushFact(
  facts: SemanticFact[],
  role: SemanticFactRole,
  value: string,
  source: string,
  evidence: string,
): void {
  const next = value.trim();
  if (next.length < 2 || next.length > 40 || isAdultSurface(next) || hasParticleHole(next)) return;
  if (facts.some((fact) => fact.value === next)) return;
  facts.push({
    role,
    value: next,
    provenance: { source: source.slice(0, 120), evidence },
  });
}

function isMeasurementDump(phrase: string): boolean {
  const rest = phrase
    .replace(/\d+\s*(?:時間|分|作品|枚組|人|名|ヶ月)/gu, "")
    .replace(/豪華|収録|約/gu, "")
    .trim();
  return rest.length < 4 && /\d/u.test(phrase);
}

export function extractSemanticFacts(input: {
  sources: string[];
  performers?: string[];
}): SemanticFact[] {
  const facts: SemanticFact[] = [];
  const performers = new Set((input.performers ?? []).map((name) => name.trim()).filter(Boolean));
  const blob = input.sources.join("\n");

  for (const name of performers) {
    pushFact(facts, "who", name, name, name);
  }

  const hour = blob.match(/(?<![\d.])(約)?\s*(\d+(?:\.\d+)?)\s*時間/u);
  if (hour?.[2]) pushFact(facts, "attribute", `${hour[1] ?? ""}${hour[2]}時間`, blob, hour[0]);
  const minute = blob.match(/(?<![\d.])(\d+)\s*分/u);
  if (minute?.[1]) pushFact(facts, "attribute", `${minute[1]}分`, blob, minute[0]);
  const month = blob.match(/(?<![\d.])(\d+)\s*ヶ?月/u);
  if (month?.[1] && /ヶ月|ヵ月|か月/u.test(blob)) {
    pushFact(facts, "attribute", `${month[1]}ヶ月`, blob, month[0]);
  }
  const shoot = blob.match(/撮影期間\s*(\d+)\s*ヶ?月/u);
  if (shoot?.[1]) pushFact(facts, "attribute", `撮影期間${shoot[1]}ヶ月`, blob, shoot[0]);
  const applicants = blob.match(/応募人数\s*(\d{1,3}(?:[,，]\d{3})+|\d+)\s*人/u);
  if (applicants?.[1]) pushFact(facts, "attribute", `応募人数${applicants[1]}人`, blob, applicants[0]);
  const runtimeLabel = blob.match(/収録時間\s*(約)?\s*(\d+(?:\.\d+)?)\s*時間/u);
  if (runtimeLabel?.[2]) {
    pushFact(facts, "attribute", `収録時間${runtimeLabel[1] ?? ""}${runtimeLabel[2]}時間`, blob, runtimeLabel[0]);
  }
  const titleCount = blob.match(/(?<![\d.])(\d+)\s*タイトル/u);
  if (titleCount?.[1]) pushFact(facts, "attribute", `${titleCount[1]}タイトル`, blob, titleCount[0]);
  const works = blob.match(/(?<![\d.])(\d+)\s*作品/u);
  if (works?.[1]) {
    const recorded = blob.includes(`${works[1]}作品収録`);
    pushFact(facts, "attribute", recorded ? `${works[1]}作品収録` : `${works[1]}作品`, blob, works[0]);
  }
  const discs = blob.match(/(?<![\d.])(\d+)\s*枚組/u);
  if (discs?.[1]) pushFact(facts, "attribute", `${discs[1]}枚組`, blob, discs[0]);
  const people = blob.match(/(?<![\d.,，])(\d{1,3}(?:[,，]\d{3})+|\d+)\s*(?:人|名)/u);
  if (people?.[1]) pushFact(facts, "attribute", `${people[1]}${blob.includes(`${people[1]}名`) ? "名" : "人"}`, blob, people[0]);

  for (const token of ["配信限定", "完全主観ホラー", "完全主観", "ベストBOX"]) {
    if (blob.includes(token)) {
      pushFact(facts, token === "配信限定" ? "attribute" : "what", token, blob, token);
    }
  }
  if (/【\s*VR\s*】|(?:^|[^A-Za-z])VR(?:[^A-Za-z]|$)/u.test(blob)) {
    pushFact(facts, "attribute", "VR", blob, "VR");
  }
  if (/【\s*8K\s*】|(?:^|[^A-Za-z0-9])8K(?:[^A-Za-z0-9]|$)/u.test(blob)) {
    pushFact(facts, "attribute", "8K", blob, "8K");
  }
  if (/ベスト|BEST|総集編/iu.test(blob) && !/ベストBOX|BEST\s*BOX/iu.test(blob)) {
    pushFact(facts, "what", "ベストをまとめた作品", blob, /ベスト/u.test(blob) ? "ベスト" : "BEST");
  }

  for (const source of input.sources) {
    for (const raw of source.split(PHRASE_SPLIT)) {
      const part = raw.trim();
      if (part.length < 4 || part.length > 36 || isAdultSurface(part) || hasParticleHole(part)) continue;
      if (performers.has(part) || isMeasurementDump(part)) continue;
      const detached = part
        .replace(/(?:約)?\s*\d+(?:\.\d+)?\s*時間$/u, "")
        .replace(/\d+\s*分$/u, "")
        .replace(/\d+\s*ヶ?月$/u, "")
        .trim();
      let phrase = detached.length >= 4 ? detached : part;
      if (phrase !== part && (isMeasurementDump(phrase) || phrase.length < 4)) continue;
      for (const name of performers) {
        if (name.length >= 2 && phrase.startsWith(name)) {
          const rest = phrase.slice(name.length).replace(/^[の\s]+/u, "").trim();
          if (rest.length >= 4) phrase = rest;
        }
      }
      if (phrase.length < 4 || (phrase.length <= 4 && !/[一-龯]/u.test(phrase))) continue;
      if (
        [...performers].some((name) => {
          if (!phrase.includes(name)) return false;
          const rest = phrase.replace(name, "").replace(/[:：REC\s]/gu, "").trim();
          return rest.length === 0;
        })
      ) {
        continue;
      }
      const boxAt = phrase.indexOf("ベストBOX");
      if (boxAt > 0) {
        const prefix = phrase.slice(0, boxAt).trim();
        if (prefix.length >= 4 && blob.includes(prefix)) {
          pushFact(facts, "what", prefix, source, prefix);
          pushFact(facts, "what", `${prefix}をまとめた作品`, source, `${prefix} / ベストBOX`);
        }
      }
      if (/ベスト|BEST|総集編/iu.test(phrase) && !phrase.includes("ベストBOX") && phrase.length <= 12) {
        pushFact(facts, "what", phrase, source, phrase);
      }
      if (phrase.includes("ベスト") && !phrase.includes("ベストBOX") && /BEST|ベスト|総集編/iu.test(blob)) {
        const label = phrase.replace(/ベスト|BEST|総集編/giu, "").replace(/\d+\s*時間/gu, "").trim();
        if (label.length >= 4 && blob.includes(label)) {
          pushFact(facts, "what", `${label}をまとめた作品`, source, label);
        } else if (!facts.some((fact) => fact.value.endsWith("をまとめた作品"))) {
          pushFact(facts, "what", "ベストをまとめた作品", source, "ベスト");
        }
      }
      const role: SemanticFactRole = /[がを]/u.test(phrase)
        ? "premise"
        : /\d+\s*(?:時間|分|ヶ月|枚組|作品|人|名|タイトル)/u.test(phrase)
          ? "attribute"
          : "what";
      pushFact(facts, role, phrase, source, phrase === part ? part : `${phrase} / ${part}`);
    }
  }

  return facts;
}

/** Keep a handful of grounded facts. Do not pad with guesses. */
function overlaps(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a);
}

export function selectSemanticFacts(facts: SemanticFact[], limit = 4): SemanticFact[] {
  const content = facts.filter((fact) => fact.role !== "who");
  const whats = content
    .filter((fact) => fact.role === "what")
    .sort((a, b) => b.value.length - a.value.length);
  const hasHours = content.some((fact) => /時間/u.test(fact.value));
  const attributes = content
    .filter((fact) => fact.role === "attribute")
    .filter((fact) => !(hasHours && /分$/u.test(fact.value)))
    .sort((a, b) => b.value.length - a.value.length);
  const premises = content
    .filter((fact) => fact.role === "premise")
    .sort((a, b) => b.value.length - a.value.length);
  const picked: SemanticFact[] = [];
  const take = (fact: SemanticFact | undefined) => {
    if (!fact || picked.length >= limit) return;
    if (picked.some((item) => overlaps(item.value, fact.value))) return;
    picked.push(fact);
  };
  take(whats[0]);
  take(premises[0]);
  for (const fact of attributes) take(fact);
  for (const fact of [...whats.slice(1), ...premises.slice(1)]) take(fact);
  return picked.slice(0, limit);
}
