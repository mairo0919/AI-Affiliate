/**
 * Repair quality guard — apply only when AFTER clearly improves BEFORE.
 * Prevents mechanical genre titles and full-regen regressions.
 */

import {
  classifyCastShape,
  extractItemListCatalogFacts,
  shouldAvoidSingularPerformerFraming,
} from "./ensure-official-enrichment.js";

const BARE_GENRE_TOKENS = new Set([
  "ntr",
  "寝取り",
  "寝取られ",
  "人妻",
  "主婦",
  "痴女",
  "巨乳",
  "中出し",
  "フェラ",
  "ベスト",
  "総集編",
  "女優ベスト",
  "ハイビジョン",
  "独占配信",
  "単体作品",
  "企画",
  "vr",
  "美少女",
  "熟女",
  "お姉さん",
  "近親相姦",
  "レズ",
  "ハメ撮り",
]);

const STORY_MARKERS =
  /再会|家出|元カノ|夫婦|喧嘩|アパート|誘惑|同居|同窓会|初|記念|記録|流出|スマホ|教え子|部下|上司|隣人|同棲|結婚|離婚|旅行|温泉|合宿|寮|オフィス|教室|夜勤|残業/;

export type RepairScope = "NONE" | "TITLE_ONLY" | "FULL";

export type QualityAxes = {
  factual: number;
  specificity: number;
  naturalness: number;
  density: number;
  productUnderstanding: number;
  titleQuality: number;
  bodyQuality: number;
};

export type ArticleSnapshot = {
  title: string;
  bodyText: string;
  productTitle: string;
  rawData: unknown;
};

export type RepairDecision =
  | { apply: true; scope: RepairScope; axesBefore: QualityAxes; axesAfter: QualityAxes; overallDelta: number }
  | {
      apply: false;
      reason: string;
      scope: RepairScope;
      axesBefore: QualityAxes;
      axesAfter?: QualityAxes;
      overallDelta?: number;
    };

function plain(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeGenreKey(s: string): string {
  return s.replace(/[・\s]/g, "").toLowerCase();
}

export function isBareGenreToken(value: string): boolean {
  const k = normalizeGenreKey(value);
  if (!k) return false;
  if (BARE_GENRE_TOKENS.has(k)) return true;
  // compound genre lists like 寝取り・寝取られ・NTR
  const parts = value.split(/[・\/／、,|｜]/u).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => BARE_GENRE_TOKENS.has(normalizeGenreKey(p)));
}

/**
 * Extract a work-specific synopsis theme from the official product title.
 * Prefers story/setting over bare genre tags. Not a hardcoded product list.
 */
export function extractSynopsisTheme(officialTitle: string, performers: string[] = []): string | null {
  let t = officialTitle.replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const name of performers) {
    if (name.length >= 2) t = t.replace(new RegExp(`${escapeReg(name)}\\s*$`), "").trim();
  }
  t = t.replace(/^【[^】]*】\s*/, "").trim();

  const clauses = t
    .split(/[！!？?。．\n]/u)
    .map((c) => c.trim())
    .filter((c) => c.length >= 6);

  const scored = clauses
    .map((c) => {
      let score = 0;
      if (STORY_MARKERS.test(c)) score += 40;
      if (/\d+\s*年ぶり|\d+\s*時間|\d+\s*分/.test(c)) score += 20;
      if (isBareGenreToken(c)) score -= 50;
      // prefer mid-length editorial hooks
      if (c.length >= 10 && c.length <= 32) score += 15;
      if (c.length > 40) score -= 10;
      // strip trailing genre-only tails for candidate
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored[0]) {
    let theme = scored[0].c;
    // Trim overly long theme to a natural window around story markers.
    if (theme.length > 28) {
      const m = theme.match(
        /.{0,8}(?:再会|家出|元カノ|夫婦喧嘩|記録|流出|教え子|部下|上司).{0,14}/,
      );
      if (m?.[0] && m[0].length >= 8) theme = m[0].trim();
      else theme = theme.slice(0, 28).trim();
    }
    if (!isBareGenreToken(theme) && theme.length >= 6) return theme;
  }

  // Fallback: compact prefix before trailing performer-less genre dump
  const compact = t.slice(0, 28).trim();
  if (compact.length >= 8 && STORY_MARKERS.test(compact) && !isBareGenreToken(compact)) {
    return compact;
  }
  return null;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when title is mostly performer + bare genre enumeration. */
export function isPerformerGenreListTitle(title: string, performers: string[]): boolean {
  const t = title.trim();
  if (!t) return false;
  for (const name of performers) {
    if (name.length < 2) continue;
    const re = new RegExp(`^${escapeReg(name)}の(.+)$`);
    const m = t.match(re);
    if (!m?.[1]) continue;
    const rest = m[1].trim();
    if (isBareGenreToken(rest)) return true;
    const parts = rest.split(/[・\/／、,|｜]/u).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.filter((p) => isBareGenreToken(p)).length >= 2) return true;
  }
  return false;
}

export function isMechanicalTemplateTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^.+が魅せる.+$/u.test(t) && t.length <= 28) return true;
  if (/^.+が贈る.+$/u.test(t)) return true;
  if (/^注目は.+｜.+$/u.test(t)) return true;
  if (/^(?:ベストと総集編|ベスト・総集編|女優ベスト・総集編|ベスト|総集編)(?:の見どころ(?:整理)?|ガイド)?$/u.test(t)) {
    return true;
  }
  return false;
}

export function scoreArticleAxes(snap: ArticleSnapshot): QualityAxes {
  const catalog = extractItemListCatalogFacts(snap.rawData);
  const actors = catalog.actors;
  const title = snap.title.trim();
  const body = plain(snap.bodyText);
  const synopsis = extractSynopsisTheme(snap.productTitle, actors);
  const castShape = classifyCastShape({ actors, productTitle: snap.productTitle });

  let factual = 80;
  let specificity = 50;
  let naturalness = 60;
  let density = Math.min(100, Math.round(body.length / 25));
  let productUnderstanding = 50;
  let titleQuality = 50;
  let bodyQuality = 55;

  // Factual / multi-performer
  if (shouldAvoidSingularPerformerFraming({ actors, productTitle: snap.productTitle })) {
    const named = actors.filter((a) => a.length >= 2 && title.includes(a));
    if (
      named.length === 1 &&
      (title.includes(`${named[0]}出演`) ||
        title.includes(`${named[0]}が魅せる`) ||
        title.includes(`${named[0]}が贈る`) ||
        (/^注目は.+｜/.test(title) && title.includes(named[0]!)))
    ) {
      factual -= 45;
      titleQuality -= 40;
      productUnderstanding -= 30;
    }
  }

  // Title specificity vs synopsis
  if (synopsis) {
    productUnderstanding += 20;
    if (title.includes(synopsis.slice(0, Math.min(8, synopsis.length))) || overlapRatio(title, synopsis) >= 0.35) {
      specificity += 35;
      titleQuality += 30;
      productUnderstanding += 15;
    } else if (isPerformerGenreListTitle(title, actors) || isBareGenreToken(title.replace(/^[^の]+の/, ""))) {
      specificity -= 35;
      titleQuality -= 40;
      productUnderstanding -= 25;
    }
  }

  if (isPerformerGenreListTitle(title, actors)) {
    titleQuality -= 35;
    naturalness -= 20;
    specificity -= 25;
  }
  if (isMechanicalTemplateTitle(title)) {
    titleQuality -= 30;
    naturalness -= 25;
  }
  if (/^(?:ベストと総集編|ベスト・総集編)/.test(title)) {
    titleQuality -= 40;
    specificity -= 30;
  }

  // Official title dump is also weak editorial
  if (title.length >= 36 && title === snap.productTitle.slice(0, title.length)) {
    titleQuality -= 15;
    naturalness -= 10;
  }

  // Body quality heuristics
  const genericHits = (
    body.match(/魅力を存分に味わえる|濃厚な内容|おすすめです|じっくり楽しみたい方|ボリューム感|刺激的な展開/g) ?? []
  ).length;
  const sentences = Math.max(1, body.split(/[。．.!?！？\n]/).filter((s) => s.trim().length > 8).length);
  if (genericHits / sentences >= 0.35 && genericHits >= 2) {
    bodyQuality -= 30;
    naturalness -= 20;
  }
  const bulletish = (body.match(/[・●■]/g) ?? []).length;
  if (bulletish >= 8 && body.length < 1800) {
    bodyQuality -= 20;
    naturalness -= 15;
  }
  if (/収録時間:|出演:|メーカー:|ジャンル:/.test(body) && body.length < 1200) {
    bodyQuality -= 25;
    naturalness -= 20;
  }
  if (body.length < 280) {
    density = Math.min(density, 25);
    bodyQuality -= 25;
  } else if (body.length < 420 && (castShape === "BEST_COMPILATION" || actors.length >= 2)) {
    density = Math.min(density, 40);
    bodyQuality -= 15;
  }
  if (body.length >= 1500 && genericHits <= 1) {
    bodyQuality += 10;
    density = Math.min(100, density + 10);
  }

  // Story markers in body when synopsis exists
  if (synopsis && STORY_MARKERS.test(body)) {
    productUnderstanding += 10;
    bodyQuality += 5;
  }

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    factual: clamp(factual),
    specificity: clamp(specificity),
    naturalness: clamp(naturalness),
    density: clamp(density),
    productUnderstanding: clamp(productUnderstanding),
    titleQuality: clamp(titleQuality),
    bodyQuality: clamp(bodyQuality),
  };
}

function overlapRatio(a: string, b: string): number {
  const aa = new Set([...a.replace(/\s/g, "")]);
  const bb = [...b.replace(/\s/g, "")];
  if (bb.length === 0) return 0;
  let hit = 0;
  for (const ch of bb) if (aa.has(ch)) hit += 1;
  return hit / bb.length;
}

export function overallScore(axes: QualityAxes): number {
  return (
    axes.factual * 0.2 +
    axes.specificity * 0.15 +
    axes.naturalness * 0.15 +
    axes.density * 0.1 +
    axes.productUnderstanding * 0.15 +
    axes.titleQuality * 0.15 +
    axes.bodyQuality * 0.1
  );
}

export function detectRepairScope(snap: ArticleSnapshot): RepairScope {
  const catalog = extractItemListCatalogFacts(snap.rawData);
  const actors = catalog.actors;
  const title = snap.title.trim();
  const bodyLen = plain(snap.bodyText).length;
  const axes = scoreArticleAxes(snap);
  const synopsis = extractSynopsisTheme(snap.productTitle, actors);

  const titleBad =
    isPerformerGenreListTitle(title, actors) ||
    isMechanicalTemplateTitle(title) ||
    (Boolean(synopsis) &&
      axes.titleQuality < 55 &&
      (isBareGenreToken(title.replace(/^[^の]+の/, "")) || axes.specificity < 45)) ||
    (shouldAvoidSingularPerformerFraming({ actors, productTitle: snap.productTitle }) &&
      actors.filter((a) => title.includes(a)).length === 1 &&
      /出演|が魅せる|が贈る|^注目は/.test(title));

  const bodyBad =
    bodyLen < 280 ||
    (bodyLen < 420 && (actors.length >= 2 || /ベスト|総集編|BEST/i.test(snap.productTitle))) ||
    axes.bodyQuality < 45 ||
    axes.density < 35;

  if (!titleBad && !bodyBad && axes.factual >= 70 && axes.titleQuality >= 55) return "NONE";
  if (titleBad && !bodyBad) return "TITLE_ONLY";
  if (titleBad || bodyBad) return "FULL";
  return "NONE";
}

const AXIS_KEYS: (keyof QualityAxes)[] = [
  "factual",
  "specificity",
  "naturalness",
  "density",
  "productUnderstanding",
  "titleQuality",
  "bodyQuality",
];

/**
 * Apply only when AFTER is a clear improvement and no major axis regresses.
 */
export function decideRepairApply(input: {
  before: ArticleSnapshot;
  after: ArticleSnapshot;
  scope: RepairScope;
}): RepairDecision {
  const axesBefore = scoreArticleAxes(input.before);
  const axesAfter = scoreArticleAxes(input.after);
  const beforeScore = overallScore(axesBefore);
  const afterScore = overallScore(axesAfter);
  const overallDelta = afterScore - beforeScore;

  const majorRegressions = AXIS_KEYS.filter((k) => axesAfter[k] <= axesBefore[k] - 15);
  // Title-only: body axes should stay ~equal
  if (input.scope === "TITLE_ONLY") {
    if (axesAfter.bodyQuality < axesBefore.bodyQuality - 5 || axesAfter.density < axesBefore.density - 5) {
      return {
        apply: false,
        reason: "TITLE_ONLY_TOUCHED_BODY_QUALITY",
        scope: input.scope,
        axesBefore,
        axesAfter,
        overallDelta,
      };
    }
  }

  if (majorRegressions.length > 0 && overallDelta < 8) {
    return {
      apply: false,
      reason: `REGRESSION:${majorRegressions.join(",")}`,
      scope: input.scope,
      axesBefore,
      axesAfter,
      overallDelta,
    };
  }

  if (overallDelta < 3 && axesAfter.titleQuality <= axesBefore.titleQuality + 2) {
    return {
      apply: false,
      reason: "NO_CLEAR_IMPROVEMENT",
      scope: input.scope,
      axesBefore,
      axesAfter,
      overallDelta,
    };
  }

  // Never apply if factual got worse
  if (axesAfter.factual < axesBefore.factual - 5) {
    return {
      apply: false,
      reason: "FACTUAL_REGRESSION",
      scope: input.scope,
      axesBefore,
      axesAfter,
      overallDelta,
    };
  }

  // Never apply if title naturalness collapsed for a small factual win
  if (axesAfter.naturalness <= axesBefore.naturalness - 15 && axesAfter.titleQuality < 55) {
    return {
      apply: false,
      reason: "NATURALNESS_REGRESSION",
      scope: input.scope,
      axesBefore,
      axesAfter,
      overallDelta,
    };
  }

  return {
    apply: true,
    scope: input.scope,
    axesBefore,
    axesAfter,
    overallDelta,
  };
}

/**
 * Build an editorial title from Evidence — synopsis first, not genre dump.
 * Does not hardcode product CIDs.
 */
export function buildEvidenceEditorialTitle(input: {
  officialTitle: string;
  performers: string[];
  genres: string[];
  makers: string[];
  series: string[];
}): string {
  const synopsis = extractSynopsisTheme(input.officialTitle, input.performers);
  const castShape = classifyCastShape({
    actors: input.performers,
    productTitle: input.officialTitle,
  });
  const isMulti =
    castShape === "MULTI_PERFORMER" || castShape === "BEST_COMPILATION";
  const single = !isMulti && input.performers.length === 1 ? input.performers[0]! : null;
  const maker = input.makers[0] ?? null;
  const collection = extractCollectionThemeLite(input.officialTitle);

  if (synopsis) {
    // Prefer work-specific hook; attach performer only when clearly single-cast and short.
    if (single && synopsis.length <= 22) {
      return clip(`${synopsis}｜${single}`, 48);
    }
    return clip(synopsis, 48);
  }

  if (isMulti && collection) {
    if (maker && !collection.includes(maker)) return clip(`${maker}の${collection}`, 48);
    return clip(collection, 48);
  }

  if (single && collection) return clip(`${single}の${collection}`, 48);
  if (single) {
    // Avoid performer+bare-genre; use a soft work guide only as last resort with non-genre cue
    const nonGenre = input.genres.find((g) => !isBareGenreToken(g));
    if (nonGenre) return clip(`${single}｜${nonGenre}`, 48);
    return clip(`${single}の作品ガイド`, 40);
  }
  if (collection) return clip(collection, 48);
  if (maker) return clip(`${maker}の作品ガイド`, 40);
  return clip(input.officialTitle, 36);
}

function extractCollectionThemeLite(officialTitle: string): string | null {
  const t = officialTitle.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const runtime = t.match(/(\d+)\s*時間(?:BEST|ベスト)?/i)?.[0];
  if (/フェラ|おしゃぶり/.test(t)) return runtime ? `フェラBEST（${runtime}）` : "フェラBEST";
  if (/浣腸|羞恥|排泄/.test(t)) return "オフィス浣腸羞恥ベスト";
  if (runtime && /ベスト|総集編|BEST/i.test(t)) return `${runtime}ベスト`;
  if (/ベスト|総集編|BEST/i.test(t)) {
    const before = t.split(/ベスト|総集編|\bBEST\b/i)[0]?.trim() ?? "";
    const compact = before.replace(/^【[^】]*】\s*/, "").slice(-20).trim();
    if (compact.length >= 6 && !isBareGenreToken(compact)) return compact;
  }
  return null;
}

function clip(title: string, max: number): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}
