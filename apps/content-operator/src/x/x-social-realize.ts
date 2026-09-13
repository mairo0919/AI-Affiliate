/**
 * Social realization: selected facts → natural X copy.
 * Does not change fact selection. Deterministic editorial rewrite (no LLM).
 */

import type { XSocialFact, XSocialFactKind } from "./x-social-facts.js";

export type SocialThinSkip = {
  reason: "SOCIAL_CONTENT_TOO_THIN";
  detail: string;
};

export type SocialRealizeOk = {
  ok: true;
  lines: string[];
  productNameCopyRate: number;
  realizationNotes: string[];
};

export type SocialRealizeSkip = {
  ok: false;
  skip: SocialThinSkip;
  productNameCopyRate: number;
  realizationNotes: string[];
};

export type SocialRealizeResult = SocialRealizeOk | SocialRealizeSkip;

const ROLE_WORD_RE = /幼なじみ|先輩|元カノ|上司|隣人|同僚|義理|義母|義父|義理の母/u;

/** Catalog-only shells that are not enough for a social hook alone. */
const THIN_CATALOG_RE =
  /^(?:[ぁ-んァ-ン一-龯A-Za-z0-9・！!]{0,16})?(?:\d+\s*タイトル|\d+\s*時間|BEST|ベスト|総集編|4時間ベスト)(?:[ぁ-んァ-ン一-龯A-Za-z0-9・！!]{0,16})?$/iu;

function compact(s: string): string {
  return s.replace(/\s+/g, "").replace(/[。．]+$/u, "").trim();
}

function normalizeKey(s: string): string {
  return compact(s).replace(/[、，・！!？?「」『』【】（）()]/gu, "").toLowerCase();
}

/** Bigram Jaccard — proxy for official productName copy rate. */
export function productNameCopyRate(candidate: string, productTitle: string | null | undefined): number {
  const a = normalizeKey(candidate);
  const b = normalizeKey(productTitle ?? "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) && a.length / b.length >= 0.55) return a.length / b.length;
  if (a.includes(b) && b.length / a.length >= 0.55) return b.length / a.length;

  const grams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

function looksLikeNaturalSentence(text: string): boolean {
  const s = text.trim();
  if (s.length < 10) return false;
  if (/[。！？]/.test(s)) return true;
  // Long catalog dumps often contain が/で but no punctuation — not "already natural"
  if (s.length >= 36 && !/[、，]/.test(s) && !/\s/.test(s)) return false;
  const particles = (s.match(/[はがをにでとへも]/gu) ?? []).length;
  if (particles >= 2 && /(する|した|していく|描く|挑む|香る|恋をする|求め|奪い|溶かし)/u.test(s)) {
    return true;
  }
  if (particles >= 3 && s.length >= 18 && /[、，]/.test(s)) return true;
  // sodah-style already-complete clause without period
  if (/が香る|恋をする|と化した|求め合い|溶かし尽くす/u.test(s) && particles >= 1 && (/[、，]/.test(s) || s.length < 40)) {
    return true;
  }
  return false;
}

function ensureSentence(text: string): string {
  let s = text.replace(/\s+/g, " ").trim();
  s = s.replace(/[。．]+$/u, "").trim();
  if (!s) return s;
  // Avoid double punctuation / trailing 、
  s = s.replace(/[、，]+$/u, "").trim();
  return `${s}。`;
}

function insertPerformerSep(text: string, performers: string[]): string {
  let s = text;
  for (const name of performers) {
    if (name.length < 2) continue;
    // Only when a kanji noun is glued to the name (欲情妻長瀬麻美), not verb stems (こぼれる彩月)
    const re = new RegExp(`([一-龯]{2,10})(${name})(?![ぁ-んァ-ン一-龯])`, "u");
    if (re.test(s) && !s.includes(`・${name}`) && !s.includes(`${name}が`) && !s.includes(`${name}の`)) {
      s = s.replace(re, `$1・$2`);
    }
  }
  return s;
}

/**
 * Structural editorial break for catalog concatenation (no invented events).
 * Prefers situation-first when the string is a long product-title dump.
 */
export function editorialRealizePhrase(
  raw: string,
  kind: XSocialFactKind,
  performers: string[] = [],
): string {
  let s = compact(raw);
  if (!s) return s;

  // 「Aと化したB」→「Bが、Aと化す」
  const henka = s.match(/^(.{4,40}?)と化した(.{4,40})$/u);
  if (henka) {
    const subject = insertPerformerSep(henka[2]!, performers);
    let state = henka[1]!;
    // 唾液敏感女 → 唾液で敏感な女 (particle restore, same tokens)
    state = state.replace(/唾液敏感/u, "唾液で敏感な");
    return ensureSentence(`${subject}が、${state}と化す`);
  }

  // Feature dump ending in runtime/BEST: keep technique clause, demote catalog tail
  const bestTail = s.match(/^(.{10,50}?)(?:悶絶)?(?:凄テク|テク)(?:を)?(\d+時間)?(?:BEST|ベスト)?$/iu);
  if (bestTail && /溶かし|尽くす|理性/u.test(s)) {
    const core = bestTail[1]!
      .replace(/^熟練(?!の)/u, "熟練の")
      .replace(/男の理性を溶かし尽くす/u, "男の理性を溶かす");
    const hours = bestTail[2];
    if (hours) {
      return ensureSentence(`${core}、悶絶の凄テク${hours}`);
    }
    return ensureSentence(`${core}、悶絶の凄テク`);
  }

  // Short relationship "Nameとrole" / "roleとName"
  const rel = s.match(/^(.{2,16})と(.{2,16})$/u);
  if (rel && (kind === "relationship" || ROLE_WORD_RE.test(s))) {
    const a = rel[1]!;
    const b = rel[2]!;
    if (ROLE_WORD_RE.test(b) && !ROLE_WORD_RE.test(a)) {
      return ensureSentence(`${b}の${a}`);
    }
    if (ROLE_WORD_RE.test(a) && !ROLE_WORD_RE.test(b)) {
      return ensureSentence(`${a}の${b}`);
    }
  }

  if (looksLikeNaturalSentence(s)) {
    return ensureSentence(insertPerformerSep(s, performers));
  }

  // Restore missing の after 史上初 before noun
  s = s.replace(/史上初(?!の)(?=[一-龯ぁ-んァ-ン])/u, "史上初の");

  // 10人大集合X → 10人が大集合。X
  s = s.replace(/(\d+人)大集合(?=[一-龯ぁ-んァ-ン])/u, "$1が大集合。");

  // Situation: …で + long continuation → …で、…
  s = s.replace(/([^。、]{4,24}で)([^。、]{10,})/u, (full, left: string, right: string) => {
    if (left.endsWith("、で") || right.startsWith("、")) return full;
    return `${left}、${right}`;
  });

  s = insertPerformerSep(s, performers);

  // Situation-first reorder for long dumps: pull clause that contains で、
  if (s.length >= 48 && /で、/u.test(s)) {
    const parts = s.split("。").map((p) => p.trim()).filter(Boolean);
    const situationIdx = parts.findIndex((p) => /で、/.test(p) || /合宿で|再会で|温泉で/.test(p));
    if (situationIdx > 0) {
      const sit = parts[situationIdx]!;
      const rest = parts.filter((_, i) => i !== situationIdx);
      s = [sit, ...rest].join("。");
    } else {
      // single blob: move from 町内会-like noun before で
      const m = s.match(/^(.*?)((?:[一-龯ぁ-んァ-ン]{2,8}の)?[一-龯ぁ-んァ-ン]{2,12}で、.+)$/u);
      if (m && m[1] && m[1].length >= 8 && m[2]) {
        const lead = m[1].replace(/[。、]+$/u, "");
        s = `${m[2]}。${lead}`;
      }
    }
  }

  // Soft length cap for X — keep first 2 sentences if overlong
  const sentences = s.split("。").map((p) => p.trim()).filter(Boolean);
  if (sentences.length > 2) {
    s = sentences.slice(0, 2).join("。");
  } else if (s.length > 90 && sentences.length === 1) {
    // Prefer the longer で、 clause segment
    const de = s.match(/([^。]{0,20}で、[^。]{10,70})/u);
    if (de) s = de[1]!;
  }

  return ensureSentence(s);
}

function isThinCatalogText(text: string): boolean {
  const s = compact(text);
  if (s.length < 8) return true;
  if (THIN_CATALOG_RE.test(s)) return true;
  // runtime / title-count dominated with little else
  if (/タイトル|時間|BEST|ベスト|総集編/iu.test(s)) {
    const withoutCatalog = s
      .replace(/\d+\s*タイトル/gu, "")
      .replace(/\d+\s*時間/gu, "")
      .replace(/BEST|ベスト|総集編|ギュっと[!！]?/gu, "")
      .replace(/の/gu, "");
    // Only performer / series residue left
    if (withoutCatalog.length <= 8) return true;
  }
  return false;
}

/**
 * Composition-time thinness gate (does not alter selectXSocialFacts).
 */
export function assessSocialContentThinness(
  facts: XSocialFact[],
): SocialThinSkip | null {
  if (facts.length === 0) {
    return { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "no_selected_facts" };
  }

  const work = facts.filter((f) =>
    ["work_theme", "situation", "relationship", "feature"].includes(f.kind),
  );
  const primary = work[0] ?? facts[0]!;

  if (work.length === 0) {
    if (facts.every((f) => f.kind === "performer" || f.kind === "taxonomy_aux" || f.kind === "series")) {
      return { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "performer_or_taxonomy_only" };
    }
  }

  if (work.length === 1 && primary.kind === "performer") {
    return { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "performer_only" };
  }

  if (isThinCatalogText(primary.text)) {
    return { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "catalog_runtime_or_best_only" };
  }

  // Short relationship noun phrase alone — not enough hook without situation
  if (
    work.length === 1 &&
    primary.kind === "relationship" &&
    compact(primary.text).length <= 18 &&
    !/[でをがは]/u.test(primary.text)
  ) {
    return { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "short_relationship_only" };
  }

  // Short bare theme without situation particles
  if (
    work.length === 1 &&
    primary.kind === "work_theme" &&
    compact(primary.text).length <= 16 &&
    isThinCatalogText(primary.text)
  ) {
    return { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "short_theme_catalog" };
  }

  return null;
}

/**
 * Realize selected facts into natural social lines. May SKIP when too thin.
 */
export function realizeXSocialCopy(input: {
  facts: XSocialFact[];
  performers?: string[];
  productTitle?: string | null;
  canonicalTitle?: string | null;
}): SocialRealizeResult {
  const notes: string[] = [];
  const performers = input.performers ?? [];
  const thin = assessSocialContentThinness(input.facts);
  const primaryRaw = input.facts[0]?.text ?? "";
  const copyVsProduct = Math.max(
    productNameCopyRate(primaryRaw, input.productTitle),
    productNameCopyRate(primaryRaw, input.canonicalTitle),
  );

  if (thin) {
    return {
      ok: false,
      skip: thin,
      productNameCopyRate: copyVsProduct,
      realizationNotes: [...notes, thin.detail],
    };
  }

  const lines: string[] = [];
  for (const fact of input.facts.slice(0, 3)) {
    if (fact.kind === "taxonomy_aux") continue;
    let line = editorialRealizePhrase(fact.text, fact.kind, performers);
    line = line.replace(/[。]$/u, ""); // compose adds 。
    if (!line) continue;

    // If still near-identical to official product dump, try situation-first again
    const rate = Math.max(
      productNameCopyRate(line, input.productTitle),
      productNameCopyRate(compact(fact.text), input.productTitle),
    );
    if (rate >= 0.72 && line.length >= 40) {
      notes.push("high_product_name_copy_rebreak");
      const rebroken = editorialRealizePhrase(fact.text, fact.kind, performers);
      line = rebroken.replace(/[。]$/u, "");
    }

    // Drop lines that collapse to performer-only after realize
    if (performers.some((p) => compact(line) === compact(p))) continue;

    if (lines.some((l) => normalizeKey(l) === normalizeKey(line))) continue;
    lines.push(line);
  }

  if (lines.length === 0) {
    return {
      ok: false,
      skip: { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "realization_empty" },
      productNameCopyRate: copyVsProduct,
      realizationNotes: notes,
    };
  }

  // Final thin check on realized primary
  if (isThinCatalogText(lines[0]!) || compact(lines[0]!).length < 8) {
    return {
      ok: false,
      skip: { reason: "SOCIAL_CONTENT_TOO_THIN", detail: "realized_still_thin" },
      productNameCopyRate: productNameCopyRate(lines[0]!, input.productTitle),
      realizationNotes: notes,
    };
  }

  return {
    ok: true,
    lines,
    productNameCopyRate: productNameCopyRate(lines[0]!, input.productTitle),
    realizationNotes: notes,
  };
}
