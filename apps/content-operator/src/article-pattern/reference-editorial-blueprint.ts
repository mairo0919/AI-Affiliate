/**
 * ReferenceEditorialBlueprint — paragraph-level editorial function map.
 *
 * Learned from ephemeral reference HTML at observe time.
 * NEVER stores competitor prose, quotes, or reusable sentence templates.
 *
 * FIRST_LOSS fix: writingFeatures compresses paragraphs to length histograms.
 * This module preserves "what editorial job each segment did" at abstract grain
 * sufficient to drive Evidence Mapping — not article text reuse.
 */

export type BlueprintEvidenceType =
  | "scene_or_act"
  | "body_trait"
  | "performer_identity"
  | "quantity_or_runtime"
  | "series_or_event"
  | "setting_or_situation"
  | "maker_or_label"
  | "availability_or_catalog"
  | "evaluative_framing"
  | "audience_framing"
  | "transition_only"
  | "unknown_concrete";

export type BlueprintSegmentRole = "lead" | "development" | "summary" | "cta" | "other";

export type ReferenceBlueprintSegment = {
  index: number;
  role: BlueprintSegmentRole;
  /** Abstract editorial job — not prose */
  editorialFunction: string;
  evidenceTypeUsed: BlueprintEvidenceType[];
  /** primary evidence type this segment advanced with */
  primaryEvidenceType: BlueprintEvidenceType;
  specificityLevel: "low" | "medium" | "high";
  transitionFunction: string;
  approximateInformationDensity: "low" | "medium" | "high";
  /** Char-length bucket of source paragraph — no text */
  lengthBucket: "short" | "medium" | "long" | "very_long";
};

export type ReferenceEditorialBlueprint = {
  schemaVersion: 1;
  referenceId: string | null;
  sourceUrlHost: string | null;
  articleType: "NEW_RELEASE_SINGLE" | "unknown";
  materialDepth: "scarce" | "standard" | "rich";
  segments: ReferenceBlueprintSegment[];
  progression: string[];
  repetitionStrategy: "no_cross_segment_restatement" | "unknown";
  endingStrategy: string;
  avoidPatterns: string[];
  /** Evidence types the reference actually used (selection signal) */
  evidenceTypesAdopted: BlueprintEvidenceType[];
  /** Common catalog types present in adult affiliate pages but unused in body progression */
  evidenceTypesDeferredHint: BlueprintEvidenceType[];
  extractedAt: string;
  extractionMode: "paragraph_functions" | "weak_from_writing_features";
};

const SCENE_RE =
  /キス|舐め|セックス|ピストン|潮|乱交|痴女|わからせ|洗脳|生ハメ|顔面|挿入|絶頂|責め/;
const TRAIT_RE = /巨乳|美乳|敏感|感度|Hカップ|細身|長身|美脚|清楚|ギャル|メスガキ/;
const PERFORMER_RE = /出演|女優|男優|が演じ|キャラ/;
const QTY_RE = /\d+\s*(名|人|時間|分|作品|泊|日)/;
const SERIES_RE = /シリーズ|ツアー|イベント|感謝祭|ベスト/;
const SETTING_RE = /シチュ|設定|舞台|場所|部屋|プール|バス|旅行|同居|姉/;
const MAKER_RE = /メーカー|レーベル|MOODYZ|エスワン|SOD|IDEAPOCKET/;
const AVAIL_RE = /配信|公開|独占|販売|ページで確認/;
const EVAL_RE = /魅力|おすすめ|見どころ|興奮|話題|最高|必見|堪能/;
const AUDIENCE_RE = /向け|好きな人|探している|ファンにとっ/;

function lengthBucket(n: number): ReferenceBlueprintSegment["lengthBucket"] {
  if (n < 40) return "short";
  if (n < 120) return "medium";
  if (n < 240) return "long";
  return "very_long";
}

function specificityFromText(text: string): ReferenceBlueprintSegment["specificityLevel"] {
  const hits =
    (QTY_RE.test(text) ? 1 : 0) +
    (SCENE_RE.test(text) ? 1 : 0) +
    (TRAIT_RE.test(text) ? 1 : 0) +
    (SERIES_RE.test(text) ? 1 : 0);
  if (hits >= 2 || (QTY_RE.test(text) && text.length >= 40)) return "high";
  if (hits >= 1 || text.length >= 60) return "medium";
  return "low";
}

function densityFromText(text: string): ReferenceBlueprintSegment["approximateInformationDensity"] {
  const concrete =
    (text.match(/\d+/g) ?? []).length +
    (text.match(SCENE_RE) ?? []).length +
    (text.match(TRAIT_RE) ?? []).length;
  if (concrete >= 3) return "high";
  if (concrete >= 1) return "medium";
  return "low";
}

export function classifyEvidenceTypesInText(text: string): BlueprintEvidenceType[] {
  const types: BlueprintEvidenceType[] = [];
  if (SCENE_RE.test(text)) types.push("scene_or_act");
  if (TRAIT_RE.test(text)) types.push("body_trait");
  if (PERFORMER_RE.test(text)) types.push("performer_identity");
  if (QTY_RE.test(text)) types.push("quantity_or_runtime");
  if (SERIES_RE.test(text)) types.push("series_or_event");
  if (SETTING_RE.test(text)) types.push("setting_or_situation");
  if (MAKER_RE.test(text)) types.push("maker_or_label");
  if (AVAIL_RE.test(text)) types.push("availability_or_catalog");
  if (EVAL_RE.test(text)) types.push("evaluative_framing");
  if (AUDIENCE_RE.test(text)) types.push("audience_framing");
  if (types.length === 0) {
    types.push(text.length >= 20 ? "unknown_concrete" : "transition_only");
  }
  return [...new Set(types)];
}

function editorialFunctionFor(
  role: BlueprintSegmentRole,
  types: BlueprintEvidenceType[],
  index: number,
): string {
  const primary = types[0] ?? "unknown_concrete";
  if (role === "lead") {
    if (primary === "scene_or_act") return "open_with_strongest_concrete_scene";
    if (primary === "body_trait") return "open_with_strongest_concrete_trait";
    if (primary === "quantity_or_runtime") return "open_with_identity_quantity_hook";
    if (primary === "audience_framing") return "open_with_audience_framing";
    return "open_with_strongest_concrete_fact";
  }
  if (role === "development") {
    if (primary === "scene_or_act") return "advance_with_different_concrete_scene";
    if (primary === "body_trait") return "deepen_with_new_body_trait";
    if (primary === "performer_identity") return "add_performer_contextual_fact";
    if (primary === "series_or_event") return "add_series_or_event_context";
    if (primary === "quantity_or_runtime") return "add_quantity_or_runtime_detail";
    if (primary === "setting_or_situation") return "add_setting_or_situation_detail";
    return `advance_with_new_supported_detail_step_${index}`;
  }
  if (role === "summary") return "list_snippet_not_body_restatement";
  if (role === "cta") return "bridge_from_established_interest_to_cta";
  return "other_editorial_step";
}

function transitionFor(
  prev: BlueprintEvidenceType[] | null,
  curr: BlueprintEvidenceType[],
): string {
  if (!prev || prev.length === 0) return "establish_opening_interest";
  const prevSet = new Set(prev);
  const novel = curr.filter((t) => !prevSet.has(t) && t !== "evaluative_framing");
  if (novel.length > 0) return `shift_to_${novel[0]}`;
  if (curr.some((t) => t === "evaluative_framing")) return "evaluative_padding_avoid";
  return "advance_interest_to_next_supported_detail";
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roleForIndex(
  index: number,
  total: number,
  types: BlueprintEvidenceType[],
): BlueprintSegmentRole {
  if (index === 0) return "lead";
  if (index === total - 1 && types.includes("availability_or_catalog") && total >= 3) {
    return "cta";
  }
  if (index >= total - 1 && total >= 4) return "summary";
  return "development";
}

/**
 * Extract blueprint from ephemeral HTML. Discards all prose after classification.
 */
export function extractReferenceEditorialBlueprint(input: {
  html: string;
  title?: string | null;
  sourceUrl?: string | null;
  referenceId?: string | null;
  articleType?: "NEW_RELEASE_SINGLE" | "unknown";
}): ReferenceEditorialBlueprint {
  const paragraphs = [...input.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1] ?? ""))
    .filter((p) => p.length >= 12);

  // Fallback: sentence chunks if few <p>
  const units =
    paragraphs.length >= 2
      ? paragraphs
      : stripTags(input.html)
          .split(/[。．!！?？\n]+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 16)
          .slice(0, 12);

  const segments: ReferenceBlueprintSegment[] = [];
  let prevTypes: BlueprintEvidenceType[] | null = null;
  for (let i = 0; i < units.length; i++) {
    const text = units[i]!;
    const types = classifyEvidenceTypesInText(text);
    const role = roleForIndex(i, units.length, types);
    const primary = types.find((t) => t !== "evaluative_framing" && t !== "transition_only") ??
      types[0]!;
    segments.push({
      index: i,
      role,
      editorialFunction: editorialFunctionFor(role, types, i),
      evidenceTypeUsed: types,
      primaryEvidenceType: primary,
      specificityLevel: specificityFromText(text),
      transitionFunction: transitionFor(prevTypes, types),
      approximateInformationDensity: densityFromText(text),
      lengthBucket: lengthBucket(text.length),
    });
    prevTypes = types;
  }

  const adopted = [...new Set(segments.flatMap((s) => s.evidenceTypeUsed))];
  const deferredHint: BlueprintEvidenceType[] = (
    ["maker_or_label", "availability_or_catalog"] as BlueprintEvidenceType[]
  ).filter((t) => !adopted.includes(t));

  const concreteSegs = segments.filter(
    (s) =>
      s.role === "lead" ||
      s.role === "development",
  );
  const highCount = concreteSegs.filter((s) => s.specificityLevel === "high").length;
  const materialDepth: ReferenceEditorialBlueprint["materialDepth"] =
    concreteSegs.length <= 1 || highCount === 0
      ? "scarce"
      : highCount >= 3 || concreteSegs.length >= 4
        ? "rich"
        : "standard";

  let host: string | null = null;
  try {
    if (input.sourceUrl) host = new URL(input.sourceUrl).hostname.toLowerCase();
  } catch {
    host = null;
  }

  const progression = segments.map(
    (s) => `${s.role}:${s.editorialFunction}:${s.primaryEvidenceType}`,
  );

  const avoidPatterns = [
    "unsupported_evaluation_padding",
    "catalog_metadata_detour",
    "cross_segment_restatement",
  ];
  if (segments.some((s) => s.evidenceTypeUsed.includes("evaluative_framing"))) {
    avoidPatterns.push("evaluative_framing_as_body_substance");
  }

  return {
    schemaVersion: 1,
    referenceId: input.referenceId ?? null,
    sourceUrlHost: host,
    articleType: input.articleType ?? "NEW_RELEASE_SINGLE",
    materialDepth,
    segments,
    progression,
    repetitionStrategy: "no_cross_segment_restatement",
    endingStrategy:
      segments.some((s) => s.role === "cta")
        ? "cta_bridge_from_interest"
        : "end_on_last_supported_detail",
    avoidPatterns,
    evidenceTypesAdopted: adopted,
    evidenceTypesDeferredHint: deferredHint,
    extractedAt: new Date().toISOString(),
    extractionMode: "paragraph_functions",
  };
}

/**
 * Weak compatibility blueprint from already-compressed writingFeatures
 * (legacy observations that cannot recover paragraph progression).
 */
export function buildWeakBlueprintFromWritingFeatures(input: {
  sectionPurposeSequence?: string[] | null;
  introHookType?: string | null;
  informationDensityBucket?: string | null;
  referenceId?: string | null;
  sourceUrlHost?: string | null;
}): ReferenceEditorialBlueprint {
  const seq = input.sectionPurposeSequence?.length
    ? input.sectionPurposeSequence
    : ["intro_hook", "product_sections", "cta"];
  const segments: ReferenceBlueprintSegment[] = seq.map((purpose, i) => {
    const role: BlueprintSegmentRole =
      i === 0 || purpose.includes("intro")
        ? "lead"
        : purpose.includes("cta")
          ? "cta"
          : "development";
    const primary: BlueprintEvidenceType =
      role === "lead"
        ? input.introHookType === "audience_framing"
          ? "audience_framing"
          : "scene_or_act"
        : role === "cta"
          ? "availability_or_catalog"
          : "unknown_concrete";
    return {
      index: i,
      role,
      editorialFunction: editorialFunctionFor(role, [primary], i),
      evidenceTypeUsed: [primary],
      primaryEvidenceType: primary,
      specificityLevel: "medium",
      transitionFunction:
        i === 0 ? "establish_opening_interest" : "advance_interest_to_next_supported_detail",
      approximateInformationDensity:
        input.informationDensityBucket === "high"
          ? "high"
          : input.informationDensityBucket === "low"
            ? "low"
            : "medium",
      lengthBucket: "medium",
    };
  });
  return {
    schemaVersion: 1,
    referenceId: input.referenceId ?? null,
    sourceUrlHost: input.sourceUrlHost ?? null,
    articleType: "NEW_RELEASE_SINGLE",
    materialDepth: "standard",
    segments,
    progression: segments.map(
      (s) => `${s.role}:${s.editorialFunction}:${s.primaryEvidenceType}`,
    ),
    repetitionStrategy: "no_cross_segment_restatement",
    endingStrategy: "cta_bridge_from_interest",
    avoidPatterns: ["unsupported_evaluation_padding", "catalog_metadata_detour"],
    evidenceTypesAdopted: [...new Set(segments.map((s) => s.primaryEvidenceType))],
    evidenceTypesDeferredHint: ["maker_or_label"],
    extractedAt: new Date().toISOString(),
    extractionMode: "weak_from_writing_features",
  };
}

export function isReferenceEditorialBlueprint(value: unknown): value is ReferenceEditorialBlueprint {
  if (!value || typeof value !== "object") return false;
  const v = value as ReferenceEditorialBlueprint;
  return v.schemaVersion === 1 && Array.isArray(v.segments) && Array.isArray(v.progression);
}
