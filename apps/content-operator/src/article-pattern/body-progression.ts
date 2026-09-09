/**
 * PLAN-TIME body progression — axes for Writer paragraphs without fixed templates.
 *
 * When SOURCE only has theme labels (no scene detail), do not demand invented scenes.
 * When Plan dumps all facts into one slot, progression still assigns open/develop/close roles.
 */

import {
  derivePresentationPurpose,
  type BodyPresentationPurpose,
  WORK_THEME_FACET_RE,
} from "./evidence-material-role.js";
import {
  detectSourceResolution,
  sourceResolutionWriterGuidance,
  type SourceResolution,
} from "./source-resolution.js";

const THEME_ENUM_TOKEN_RE =
  /人妻|NTR|痴女|追撃ピストン|わからせ|杭打ち|騎乗|中出し|パイズリ|巨乳|熟女|美少女|女子校生|ギャル|OL|SM/gu;

const OPEN_PURPOSES = new Set<BodyPresentationPurpose>([
  "PRODUCT_IDENTITY",
  "COLLECTION_SCOPE",
  "QUANTITY_SCALE",
]);

const DEVELOP_PURPOSES = new Set<BodyPresentationPurpose>([
  "SCENE_VARIETY",
  "PLAY_STYLE",
  "PERFORMER_TRAIT_IN_WORK",
]);

export type ThemeSourceResolution =
  | "theme_labels_only"
  | "theme_with_scene_detail"
  | "no_theme_facts";

export type BodyProgressionAxis = {
  role: "open" | "develop" | "close";
  purposes: BodyPresentationPurpose[];
  /** Facts primarily belonging to this axis (informational; Writer still sees full body.facts). */
  focusFacts: string[];
  guidance: string;
};

export type BodyProgressionPlan = {
  schemaVersion: 1;
  themeSourceResolution: ThemeSourceResolution;
  /** Official SOURCE richness for generation strategy. */
  sourceResolution: SourceResolution;
  axes: BodyProgressionAxis[];
  /** Compact note for Writer prompt. */
  writerNote: string;
};

/** Expand 「人妻・NTR・痴女・追撃ピストンなどを収録」 into membership labels. */
export function expandThemeEnumerationFacts(facts: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (f: string) => {
    const t = f.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  for (const raw of facts) {
    const f = raw.trim();
    if (!f) continue;
    const tokens = f.match(THEME_ENUM_TOKEN_RE) ?? [];
    const unique = [...new Set(tokens)];
    const isEnumCompound =
      unique.length >= 2 &&
      (/などを収録|といった|など/.test(f) || /[・、,]/.test(f)) &&
      f.length <= 48;
    if (isEnumCompound) {
      for (const tok of unique) push(tok);
      continue;
    }
    push(f);
  }
  return out;
}

/**
 * Drop near-duplicate collection/quantity identity restatements.
 * Keeps the most informative surface per normalized key.
 */
export function compactCollectionScopeFacts(facts: readonly string[]): string[] {
  const scored: Array<{ fact: string; key: string; score: number }> = [];
  for (const fact of facts) {
    const f = fact.trim();
    if (!f) continue;
    const purpose = derivePresentationPurpose(f);
    if (purpose !== "COLLECTION_SCOPE" && purpose !== "QUANTITY_SCALE") {
      scored.push({ fact: f, key: `keep:${f}`, score: 1000 });
      continue;
    }
    let key = "collection";
    if (/\d+\s*時間/.test(f)) key = "runtime";
    else if (/\d+\s*コーナー/.test(f)) key = "corners";
    else if (/12タイトル|最新\d+タイトル|全コーナー/.test(f)) key = "titles_coverage";
    else if (/ベスト第?\d*弾|ベスト/.test(f)) key = "best_form";
    else if (/周年|デビュー/.test(f)) key = "anniversary";
    const score =
      f.length +
      (/\d/.test(f) ? 8 : 0) +
      (/全コーナー/.test(f) ? 6 : 0) +
      (/収録/.test(f) ? 4 : 0);
    scored.push({ fact: f, key, score });
  }

  const best = new Map<string, { fact: string; score: number }>();
  const passthrough: string[] = [];
  for (const row of scored) {
    if (row.key.startsWith("keep:")) {
      passthrough.push(row.fact);
      continue;
    }
    const prev = best.get(row.key);
    if (!prev || row.score > prev.score) best.set(row.key, { fact: row.fact, score: row.score });
  }
  // Preserve relative order: first occurrence of each key's winner, then other facts.
  const winners = new Set([...best.values()].map((v) => v.fact));
  const ordered: string[] = [];
  const used = new Set<string>();
  for (const fact of facts) {
    const f = fact.trim();
    if (!f || used.has(f)) continue;
    if (winners.has(f) || passthrough.includes(f)) {
      ordered.push(f);
      used.add(f);
    }
  }
  return ordered;
}

export function detectThemeSourceResolution(
  facts: readonly string[],
): ThemeSourceResolution {
  const themeish = facts.filter((f) => {
    const p = derivePresentationPurpose(f);
    const hasThemeTok = THEME_ENUM_TOKEN_RE.test(f);
    return (
      p === "SCENE_VARIETY" ||
      WORK_THEME_FACET_RE.test(f) ||
      (hasThemeTok && (p === "PLAY_STYLE" || /などを収録|といった|など/.test(f) || f.length <= 12))
    );
  });
  if (themeish.length === 0) {
    // Bare play-style tokens without scene verbs still count as labels
    const barePlay = facts.filter(
      (f) =>
        derivePresentationPurpose(f) === "PLAY_STYLE" &&
        (THEME_ENUM_TOKEN_RE.test(f) || f.length <= 12),
    );
    if (barePlay.length === 0) return "no_theme_facts";
    return "theme_labels_only";
  }

  const hasSceneDetail = themeish.some((f) => {
    if (WORK_THEME_FACET_RE.test(f) && f.length <= 8) return false;
    if (/などを収録|といった|など/.test(f) && (f.match(THEME_ENUM_TOKEN_RE) ?? []).length >= 2) {
      return false;
    }
    if (THEME_ENUM_TOKEN_RE.test(f) && f.length <= 12) return false;
    // Scene-like verbs / situation beyond bare membership
    return /(?:する|される|され|抱|喘|絶頂|寝取|誘惑|責め|挿入|性交)/u.test(f) && f.length >= 14;
  });
  return hasSceneDetail ? "theme_with_scene_detail" : "theme_labels_only";
}

export function buildBodyProgressionPlan(input: {
  bodyFacts: readonly string[];
  materialDepth?: string | null;
  /** Prefer pack-level resolution when Planner already detected it. */
  sourceResolution?: SourceResolution | null;
}): BodyProgressionPlan {
  const facts = [...input.bodyFacts];
  const themeSourceResolution = detectThemeSourceResolution(facts);
  const sourceResolution =
    input.sourceResolution ?? detectSourceResolution(facts);

  const openFacts = facts.filter((f) => OPEN_PURPOSES.has(derivePresentationPurpose(f)));
  const developFacts = facts.filter((f) => DEVELOP_PURPOSES.has(derivePresentationPurpose(f)));
  const otherFacts = facts.filter(
    (f) =>
      !OPEN_PURPOSES.has(derivePresentationPurpose(f)) &&
      !DEVELOP_PURPOSES.has(derivePresentationPurpose(f)),
  );

  const thin =
    sourceResolution === "THEME_LEVEL_EVIDENCE" || sourceResolution === "METADATA_ONLY";

  const developGuidance =
    sourceResolution === "METADATA_ONLY"
      ? "SOURCE is metadata-heavy: explain form/quantity/cast. Do not force adult scene concreteness absent from planned facts."
      : sourceResolution === "THEME_LEVEL_EVIDENCE" ||
          themeSourceResolution === "theme_labels_only"
        ? "Theme/genre membership only (no per-scene SOURCE script). Use a few representative planned tags as product directions — do not explain every genre, invent roles/scenes/relationships, or pad to RICH length."
        : "Develop recorded scene/play/situation detail from planned facts before any variety wrap. Do not invent beyond the plan.";

  const closeGuidance = thin
    ? "Optional brief reader fit only if natural. Do not force wrap-up evaluation, genre summary, or identity restatement. Stopping after develop is OK when the intro is complete."
    : "End with grounded reader orientation / soft recommendation from axes already developed. Do not restate the same collection-identity / title-coverage sentence used in the opening.";

  const axes: BodyProgressionAxis[] = [
    {
      role: "open",
      purposes: ["PRODUCT_IDENTITY", "COLLECTION_SCOPE", "QUANTITY_SCALE"],
      focusFacts: openFacts.slice(0, thin ? 5 : 8),
      guidance:
        "Identify the product and explain what quantity/collection facts mean for structure — once. Do not spend the ending budget here.",
    },
    {
      role: "develop",
      purposes: ["SCENE_VARIETY", "PLAY_STYLE", "PERFORMER_TRAIT_IN_WORK"],
      focusFacts: [...developFacts, ...otherFacts].slice(0, thin ? 6 : 10),
      guidance: developGuidance,
    },
    {
      role: "close",
      purposes: [],
      focusFacts: [],
      guidance: closeGuidance,
    },
  ];

  const writerNote = [
    "BODY_PROGRESSION (plan-time axes — not a fixed paragraph count template):",
    sourceResolutionWriterGuidance(sourceResolution),
    ...axes.map(
      (a) =>
        `- ${a.role.toUpperCase()}: ${a.guidance}${
          a.focusFacts.length ? ` Focus facts: ${a.focusFacts.slice(0, 6).join(" / ")}` : ""
        }`,
    ),
    `themeSourceResolution=${themeSourceResolution}`,
    `sourceResolution=${sourceResolution}`,
  ].join("\n");

  return {
    schemaVersion: 1,
    themeSourceResolution,
    sourceResolution,
    axes,
    writerNote,
  };
}
