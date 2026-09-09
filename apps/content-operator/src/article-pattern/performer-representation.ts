/**
 * R145/R146 — Performer representation semantics (internal Planner SSOT).
 *
 * Entity count = performerItems (R143). Mode ≠ cardinality policy.
 * Lead/title behavior changes: dual_host, ensemble, collection, unknown_multi.
 */

import type { PerformerEntity } from "./performer-identity.js";
import { normalizePerformerDisplayName } from "./performer-identity.js";

export type PerformerRepresentationMode =
  | "single"
  | "dual_host"
  | "ensemble"
  | "collection"
  | "unknown_multi";

export type PerformerRepresentationSourceConfidence =
  | "metadata"
  | "description_cue"
  | "unknown";

/** Semantic representation — not Writer prose policy. */
export type PerformerRepresentation = {
  mode: PerformerRepresentationMode;
  entities: PerformerEntity[];
  /** Performers named on official product title — not primary semantics. */
  titleAttested: string[];
  /** DUAL_HOST only — deterministic 「AとB」 from entity order (metadata SSOT). */
  combinedLabel?: string;
  /** Category hint from SOURCE (ensemble_group / collection_form / N名). */
  groupAbstraction?: string;
  /** SOURCE-backed phrase preferred for lead (not individual roster). */
  representationLabel?: string;
  /** Explicit count from SOURCE text (e.g. 19名). */
  countLabel?: string;
  /** Collection form cue from SOURCE (BEST/総集編 snippet). */
  collectionLabel?: string;
  /** UNKNOWN_MULTI — metadata cardinality only (no relationship inference). */
  neutralMultiLabel?: string;
  sourceConfidence: PerformerRepresentationSourceConfidence;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COLLECTION_CUE_RE =
  /総集編|BEST|ベスト|コレクション|まとめ見|\d+作品|\d+タイトル|\d+名.*(?:BEST|ベスト|時間|収録)|大乱交|ファン感謝祭|バスツアー/u;

const ENSEMBLE_GROUP_CUE_RE =
  /(?:\d+人|女子\d+人|ハーレム|バレー女子|アスリート|デカ女子\d+人|高身長|ロング美脚)/u;

/** Both entity names in one span linked by と (combined mention). */
export function hasDualCombinedMention(
  descriptionText: string,
  nameA: string,
  nameB: string,
): boolean {
  const desc = descriptionText ?? "";
  if (!desc.trim()) return false;
  const a = escapeRegExp(normalizePerformerDisplayName(nameA));
  const b = escapeRegExp(normalizePerformerDisplayName(nameB));
  const pair = new RegExp(`${a}\\s*と\\s*${b}|${b}\\s*と\\s*${a}`, "u");
  return pair.test(desc);
}

/** Explicit co-host / joint-subject cues — not scene co-star alone. */
export function hasDualHostCue(descriptionText: string): boolean {
  const desc = descriptionText ?? "";
  if (!desc.trim()) return false;
  if (/この2人|この二人|2人と一緒|二人と一緒|ふたりで|二人で/i.test(desc)) return true;
  if (/(?:学芸員|司会|MC|ホスト|ナビゲーター|パーソナリティ|キャスター).{0,24}と/u.test(desc)) {
    return true;
  }
  return false;
}

/** Count label from SOURCE text (not metadata alone). */
export function extractCountLabelFromSource(
  productTitle: string,
  descriptionText: string,
): string | undefined {
  const text = `${productTitle}\n${descriptionText}`;
  const m =
    text.match(/(?:全)?(\d+)\s*名/u) ??
    text.match(/(\d+)\s*人(?:の)?(?:作品|タイトル|収録|出演)/u) ??
    text.match(/(\d+)\s*人/u);
  if (m?.[1]) return `${m[1]}名`;
  return undefined;
}

/** Metadata-only cardinality label (unknown_multi lead — no role inference). */
export function buildNeutralMultiLabel(entityCount: number): string | undefined {
  if (entityCount < 2) return undefined;
  return `${entityCount}名が出演`;
}

/** SOURCE-backed ensemble/group phrase for lead (longest match wins). */
export function extractEnsembleRepresentationLabel(
  productTitle: string,
  descriptionText: string,
): string | undefined {
  const text = `${productTitle}\n${descriptionText}`;
  const candidates: string[] = [];
  const patterns = [
    /全員\d+cmオーバー.{0,28}?\d+人[^\n◆。]{0,24}/u,
    /長身.{0,16}?バレー女子[^\n◆。]{0,20}/u,
    /デカ女子\d+人[^\n◆。]{0,20}/u,
    /ロング美脚.{0,20}?ハーレム/u,
    /[^\n◆。]{0,40}ハーレム/u,
    /\d+人.{0,12}(?:バレー|女子|共演)/u,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[0]) candidates.push(m[0].trim().slice(0, 48));
  }
  for (const clause of descriptionText.split(/◆|\n/u)) {
    const c = clause.trim();
    if (c.length >= 8 && c.length <= 48 && ENSEMBLE_GROUP_CUE_RE.test(c)) {
      candidates.push(c);
    }
  }
  if (ENSEMBLE_GROUP_CUE_RE.test(productTitle) && productTitle.length <= 48) {
    candidates.push(productTitle.trim());
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

/** SOURCE-backed collection phrase for lead. */
export function extractCollectionRepresentationLabel(
  productTitle: string,
  descriptionText: string,
): string | undefined {
  const text = `${productTitle}\n${descriptionText}`;
  if (productTitle.length >= 8 && productTitle.length <= 80 && COLLECTION_CUE_RE.test(productTitle)) {
    return productTitle.trim().slice(0, 80);
  }
  for (const clause of descriptionText.split(/◆|\n/u)) {
    const c = clause.trim();
    if (c.length >= 8 && c.length <= 80 && COLLECTION_CUE_RE.test(c)) {
      return c;
    }
  }
  const count = extractCountLabelFromSource(productTitle, descriptionText);
  if (count && COLLECTION_CUE_RE.test(text)) {
    return count;
  }
  if (/総集編/u.test(text)) return "総集編";
  if (/BEST|ベスト/u.test(text)) {
    const m = productTitle.match(/[^\n]{6,60}(?:BEST|ベスト)[^\n]{0,30}/u);
    if (m?.[0]) return m[0].trim().slice(0, 80);
  }
  return undefined;
}

function hasCollectionCue(productTitle: string, descriptionText: string): boolean {
  return COLLECTION_CUE_RE.test(`${productTitle}\n${descriptionText}`);
}

function hasEnsembleGroupCue(productTitle: string, descriptionText: string): boolean {
  const text = `${productTitle}\n${descriptionText}`;
  if (!ENSEMBLE_GROUP_CUE_RE.test(text)) return false;
  if (hasCollectionCue(productTitle, descriptionText)) return false;
  return true;
}

/**
 * Strict DUAL_HOST — false positives are worse than unknown_multi.
 */
export function detectDualHost(input: {
  entities: PerformerEntity[];
  descriptionText: string;
  productTitle?: string;
}): boolean {
  if (input.entities.length !== 2) return false;
  const [a, b] = input.entities.map((e) => e.normalizedName);
  const desc = input.descriptionText ?? "";
  const title = input.productTitle ?? "";

  if (hasCollectionCue(title, desc)) return false;
  if (!hasDualCombinedMention(desc, a, b)) return false;
  if (!hasDualHostCue(desc)) return false;
  return true;
}

/** COLLECTION — SOURCE collection cue required; actor count alone is insufficient. */
export function detectCollectionShape(
  productTitle: string,
  descriptionText: string,
): boolean {
  return hasCollectionCue(productTitle, descriptionText);
}

/** ENSEMBLE — group/co-participation cue + not collection; entityCount >= 3. */
export function detectEnsembleShape(
  productTitle: string,
  descriptionText: string,
  entityCount: number,
): boolean {
  if (entityCount < 3) return false;
  if (hasCollectionCue(productTitle, descriptionText)) return false;
  return hasEnsembleGroupCue(productTitle, descriptionText);
}

export function buildCombinedLabel(entities: PerformerEntity[]): string | undefined {
  if (entities.length !== 2) return undefined;
  const a = normalizePerformerDisplayName(entities[0]!.normalizedName);
  const b = normalizePerformerDisplayName(entities[1]!.normalizedName);
  if (!a || !b) return undefined;
  return `${a}と${b}`;
}

export function extractTitleAttested(entities: PerformerEntity[]): string[] {
  return entities.filter((e) => e.inProductTitle).map((e) => e.normalizedName);
}

export function buildPerformerRepresentation(input: {
  entities: PerformerEntity[];
  productTitle?: string;
  descriptionText?: string;
}): PerformerRepresentation {
  const entities = input.entities ?? [];
  const productTitle = (input.productTitle ?? "").trim();
  const descriptionText = (input.descriptionText ?? "").trim();
  const titleAttested = extractTitleAttested(entities);
  const countLabel = extractCountLabelFromSource(productTitle, descriptionText);
  const neutralMultiLabel = buildNeutralMultiLabel(entities.length);

  if (entities.length === 0) {
    return {
      mode: "unknown_multi",
      entities: [],
      titleAttested: [],
      sourceConfidence: "unknown",
    };
  }

  if (entities.length === 1) {
    return {
      mode: "single",
      entities,
      titleAttested,
      countLabel,
      sourceConfidence: "metadata",
    };
  }

  if (detectDualHost({ entities, descriptionText, productTitle })) {
    const combinedLabel = buildCombinedLabel(entities);
    return {
      mode: "dual_host",
      entities,
      titleAttested,
      combinedLabel,
      representationLabel: combinedLabel,
      countLabel,
      groupAbstraction: countLabel ?? "dual_pair",
      sourceConfidence: descriptionText ? "description_cue" : "metadata",
    };
  }

  if (detectCollectionShape(productTitle, descriptionText)) {
    const collectionLabel =
      extractCollectionRepresentationLabel(productTitle, descriptionText) ?? countLabel;
    return {
      mode: "collection",
      entities,
      titleAttested,
      representationLabel: collectionLabel,
      countLabel,
      collectionLabel,
      groupAbstraction: collectionLabel ?? countLabel ?? "collection_form",
      sourceConfidence: descriptionText ? "description_cue" : "unknown",
    };
  }

  if (detectEnsembleShape(productTitle, descriptionText, entities.length)) {
    const ensembleLabel =
      extractEnsembleRepresentationLabel(productTitle, descriptionText) ?? countLabel;
    return {
      mode: "ensemble",
      entities,
      titleAttested,
      representationLabel: ensembleLabel,
      countLabel,
      groupAbstraction: ensembleLabel ?? countLabel ?? "ensemble_group",
      sourceConfidence: descriptionText ? "description_cue" : "unknown",
    };
  }

  return {
    mode: "unknown_multi",
    entities,
    titleAttested,
    representationLabel: neutralMultiLabel,
    countLabel,
    neutralMultiLabel,
    groupAbstraction: countLabel,
    sourceConfidence: entities.length > 0 ? "metadata" : "unknown",
  };
}

/** Lead includes both performer identities (combined or both names). */
export function dualHostLeadCoversFacts(
  facts: string[],
  rep: PerformerRepresentation,
): boolean {
  if (rep.mode !== "dual_host" || rep.entities.length !== 2) return false;
  const [a, b] = rep.entities.map((e) => e.normalizedName);
  return facts.some((f) => {
    if (rep.combinedLabel && f.includes(rep.combinedLabel)) return true;
    return f.includes(a) && f.includes(b);
  });
}

/**
 * Leadless overview (former lead): ensemble/collection/unknown_multi must not
 * force a bare metadata roster when SOURCE group/collection abstraction already covers.
 * dual_host keeps both names / combinedLabel.
 */
export function preferRepresentationOverForcedRoster(
  facts: string[],
  rep: PerformerRepresentation,
): string[] {
  if (rep.mode === "single" || rep.mode === "dual_host" || rep.entities.length <= 1) {
    return facts;
  }
  const isBareEntityName = (f: string): boolean => {
    const trimmed = f.trim();
    if (!trimmed) return false;
    return rep.entities.some((e) => {
      if (trimmed === e.normalizedName || trimmed === e.displayName) return true;
      const base = e.normalizedName.replace(/（[^）]*）|\([^)]*\)/g, "").trim();
      if (base.length >= 2 && (trimmed === base || trimmed === `（${base}）`)) return true;
      // Parenthetical alias crumbs like "（花沢ひまり）"
      if (/^[（(][^）)]+[）)]$/.test(trimmed)) {
        const inner = trimmed.slice(1, -1);
        return e.normalizedName.includes(inner) || e.displayName.includes(inner);
      }
      return false;
    });
  };
  const stripped = facts.filter((f) => !isBareEntityName(f));
  if (stripped.length === 0) return facts;
  if (representationLeadCoversFacts(stripped, rep)) return stripped;
  return facts;
}

const ENSEMBLE_LEAD_SIGNAL =
  /ハーレム|バレー女子|アスリート|ロング美脚|高身長|\d+人|\d+名|女子\d+人|デカ女子|共演/u;

const COLLECTION_LEAD_SIGNAL =
  /総集編|BEST|ベスト|コレクション|まとめ見|\d+作品|\d+タイトル|大乱交|ツアー|収録/u;

function isExplicitSourceRosterClause(
  text: string,
  rep: PerformerRepresentation,
): boolean {
  const f = text.trim();
  if (entityNamesInText(f, rep.entities) < rep.entities.length) return false;
  if (/\d+\s*[人名]/u.test(f)) return true;
  if (rep.entities.length >= 3 && /[、,]/u.test(f)) return true;
  if (rep.entities.length === 2 && /と/u.test(f) && f.length <= 48) return true;
  return false;
}

/** SOURCE-supported full roster — all entity names present in facts (not a prohibition policy). */
export function sourceRosterCoversFacts(
  facts: string[],
  rep: PerformerRepresentation,
): boolean {
  if (rep.entities.length < 2) return false;
  return entityNamesInText(facts.join(" "), rep.entities) >= rep.entities.length;
}

function entityNamesInText(text: string, entities: PerformerEntity[]): number {
  let n = 0;
  for (const e of entities) {
    if (text.includes(e.normalizedName)) n++;
    else {
      const base = e.normalizedName.replace(/（[^）]*）|\([^)]*\)/g, "").trim();
      if (base.length >= 2 && text.includes(base)) n++;
    }
  }
  return n;
}

/** R146 — mode-aware representation coverage for lead slot. */
export function representationLeadCoversFacts(
  facts: string[],
  rep: PerformerRepresentation,
): boolean {
  if (rep.mode === "single" || rep.entities.length <= 1) return true;
  if (rep.mode === "dual_host") return dualHostLeadCoversFacts(facts, rep);

  const text = facts.join(" ");

  // SOURCE-supported explicit roster clause (not scene co-star alone)
  if (sourceRosterCoversFacts(facts, rep) && isExplicitSourceRosterClause(text, rep)) {
    return true;
  }


  if (rep.representationLabel && facts.some((f) => f.includes(rep.representationLabel!) || rep.representationLabel!.includes(f))) {
    return true;
  }

  if (rep.mode === "ensemble") {
    if (ENSEMBLE_LEAD_SIGNAL.test(text)) return true;
    if (rep.countLabel && text.includes(rep.countLabel)) return true;
    return false;
  }

  if (rep.mode === "collection") {
    if (COLLECTION_LEAD_SIGNAL.test(text)) return true;
    if (rep.countLabel && text.includes(rep.countLabel)) return true;
    return false;
  }

  // unknown_multi — SOURCE roster, neutral label, or count; partial names alone insufficient
  if (rep.neutralMultiLabel && text.includes(rep.neutralMultiLabel)) return true;
  if (rep.countLabel && text.includes(rep.countLabel)) return true;
  if (COLLECTION_LEAD_SIGNAL.test(text) || ENSEMBLE_LEAD_SIGNAL.test(text)) return true;
  return false;
}

export function resolveDualHostLeadFact(
  rep: PerformerRepresentation,
  packFacts: Array<{ fact: string }>,
): string | undefined {
  if (rep.mode !== "dual_host" || rep.entities.length !== 2) return undefined;
  const [a, b] = rep.entities.map((e) => e.normalizedName);
  const label = rep.combinedLabel;

  for (const item of packFacts) {
    const f = (item.fact ?? "").trim();
    if (!f) continue;
    if (label && f === label) return f;
    if (f.includes(a) && f.includes(b) && /と/u.test(f) && f.length <= 48) return f;
  }

  return label;
}

/** Resolve SOURCE-backed representation fact from pack pool, else profile label. */
export function resolveRepresentationLeadFact(
  rep: PerformerRepresentation,
  packFacts: Array<{ fact: string }>,
): string | undefined {
  if (rep.mode === "dual_host") {
    return resolveDualHostLeadFact(rep, packFacts);
  }

  const label = rep.representationLabel;
  if (!label) return undefined;

  for (const item of packFacts) {
    const f = (item.fact ?? "").trim();
    if (!f) continue;
    if (f === label || label.includes(f) || f.includes(label)) return f;
  }

  if (rep.mode === "unknown_multi" || rep.mode === "ensemble") {
    for (const item of packFacts) {
      const f = (item.fact ?? "").trim();
      if (!f || f.length > 80) continue;
      if (isExplicitSourceRosterClause(f, rep)) return f;
    }
  }

  if (rep.mode === "unknown_multi" && rep.neutralMultiLabel) {
    return rep.neutralMultiLabel;
  }

  if (label.length >= 4 && label.length <= 80) return label;
  return undefined;
}

/** Count individual entity names listed in title+lead (roster detection). */
export function countRosterNamesInFacts(
  facts: string[],
  rep: PerformerRepresentation,
): number {
  return entityNamesInText(facts.join(" "), rep.entities);
}

export type RepresentationCoverage =
  | "individual"
  | "dual_combined"
  | "group_abstraction"
  | "collection_abstraction"
  | "neutral_multi"
  | "none";

export function representationCoverage(
  planFacts: { title: string[]; lead: string[] },
  rep: PerformerRepresentation,
): RepresentationCoverage {
  if (rep.mode === "single") return "individual";
  if (rep.mode === "dual_host") {
    return dualHostLeadCoversFacts(planFacts.lead, rep) ? "dual_combined" : "none";
  }
  if (rep.mode === "ensemble") {
    return representationLeadCoversFacts(planFacts.lead, rep) ? "group_abstraction" : "none";
  }
  if (rep.mode === "collection") {
    return representationLeadCoversFacts(planFacts.lead, rep) ? "collection_abstraction" : "none";
  }
  if (representationLeadCoversFacts(planFacts.lead, rep)) return "neutral_multi";
  return "none";
}
