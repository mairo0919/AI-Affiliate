/**
 * Official FANZA product page → fact atoms for EvidencePack (LLM=0).
 *
 * Does NOT dump full description into Generator.
 * Does NOT treat sample image count as scene/act facts (no Vision).
 * Video object: extract concrete atoms only; keep videoEvidence generationEligible=false.
 */

import { classifySemanticEvidence } from "./semantic-evidence.js";
import type { BlueprintEvidenceType } from "./reference-editorial-blueprint.js";
import type { ResearchEvidence } from "./research-evidence.js";
import { stripCatalogWrapper } from "./evidence-pack.js";

export type OfficialPageFactBucket =
  | "SUPPORTED_CONCRETE_FACT"
  | "CATALOG_METADATA"
  | "EVALUATIVE_OR_PROMOTIONAL"
  | "UNUSABLE";

export type OfficialPageFactAtom = {
  id: string;
  fact: string;
  bucket: OfficialPageFactBucket;
  familyId: string;
  primary: string;
  blueprintType: BlueprintEvidenceType;
  originField: string;
  source: "fanza_product_page";
  generatorAllowed: boolean;
};

export type OfficialPageEvidenceInput = {
  contentId?: string | null;
  descriptionText?: string | null;
  descriptionOriginField?: string;
  videoDescription?: string | null;
  videoOriginField?: string;
  actors?: string[] | null;
  /** Image availability for completeness only — never converted to prose facts. */
  imageContentKeys?: string[] | null;
  uniqueSampleSceneCount?: number | null;
};

const EVAL_PHRASE_RE =
  /キュート|エッチで|生意気|魅力|おすすめ|見逃せ|楽しめる|話題|最高|必見|超可愛|エチえち|本気をみさらせ|最強|天使な|大ボリュームで|詰まった|厳選の|いっちゃん/;

/** Prefer concrete stem when a promotional phrase wraps a known trait/scene. */
function compressToConcreteStem(fact: string): string | null {
  const stems = [
    "メスガキわからせ",
    "メスガキ",
    "わからせ",
    "痴女誘惑",
    "小悪魔痴女",
    "小悪魔",
    "ギャル妹",
    "絶対空域",
    "デカ尻",
    "激ピス",
    "MOODYZベスト",
    "ベスト",
    "総集編",
  ];
  for (const stem of stems) {
    if (fact.includes(stem)) return stem;
  }
  const qty = fact.match(/\d+\s*(?:作品|本番|射精|時間|分)/);
  if (qty) return qty[0]!;
  return null;
}

/** Split marketing copy into candidate phrase segments. */
function splitDescriptionSegments(text: string): string[] {
  return text
    .split(/[！!？?。．、,，／/|｜・…~～]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60);
}

function extractPatternAtoms(text: string): string[] {
  const out: string[] = [];
  const patterns: RegExp[] = [
    /(\d+)\s*作品/g,
    /(\d+)\s*本番/g,
    /(\d+)\s*射精/g,
    /(\d+)\s*時間/g,
    /(\d+)\s*分/g,
    /メスガキ/g,
    /わからせ/g,
    /痴女られ?/g,
    /痴女誘惑/g,
    /激ピス/g,
    /ギャル妹/g,
    /小悪魔痴女/g,
    /小悪魔/g,
    /絶対空域/g,
    /デカ尻/g,
    /MOODYZベスト/g,
    /ベスト第?\d*弾?/g,
    /総集編/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push(m[0]!);
    }
  }
  return out;
}

function classifyAtomFact(
  fact: string,
  originField: string,
  idx: number,
): OfficialPageFactAtom {
  let cleaned = stripCatalogWrapper(fact).trim() || fact.trim();
  // Long promo wrappers → compress to stem when possible
  if (cleaned.length > 12 && EVAL_PHRASE_RE.test(cleaned)) {
    const stem = compressToConcreteStem(cleaned);
    if (stem && stem !== cleaned) {
      // Mark original as excluded path by classifying the stem instead
      cleaned = stem;
    } else if (!compressToConcreteStem(cleaned)) {
      const semEval = classifySemanticEvidence(cleaned, {
        sourceType: "product_description",
      });
      return {
        id: `page_atom::${originField.replace(/[^a-zA-Z0-9._-]/g, "_")}::${idx}`,
        fact: cleaned,
        bucket: "EVALUATIVE_OR_PROMOTIONAL",
        familyId: semEval.familyId,
        primary: semEval.primary,
        blueprintType: semEval.blueprintType,
        originField,
        source: "fanza_product_page",
        generatorAllowed: false,
      };
    }
  }

  const sem = classifySemanticEvidence(cleaned, {
    sourceType: "product_description",
  });

  let bucket: OfficialPageFactBucket = "SUPPORTED_CONCRETE_FACT";
  if (sem.primary === "EVALUATIVE" || (EVAL_PHRASE_RE.test(cleaned) && !compressToConcreteStem(cleaned))) {
    bucket = "EVALUATIVE_OR_PROMOTIONAL";
  }
  if (sem.primary === "CATALOG") bucket = "CATALOG_METADATA";
  if (cleaned.length < 2) bucket = "UNUSABLE";
  if (
    /^(etc\.?|いっちゃん|な小悪魔|の本気|で45射精|の大ボリューム)$/i.test(cleaned)
  ) {
    bucket = "UNUSABLE";
  }

  const generatorAllowed = bucket === "SUPPORTED_CONCRETE_FACT";

  return {
    id: `page_atom::${originField.replace(/[^a-zA-Z0-9._-]/g, "_")}::${idx}`,
    fact: cleaned,
    bucket,
    familyId: sem.familyId,
    primary: sem.primary,
    blueprintType: sem.blueprintType,
    originField,
    source: "fanza_product_page",
    generatorAllowed,
  };
}

/**
 * Deterministic fact atomization from official page description / VideoObject / actors.
 */
export function extractOfficialPageFactAtoms(
  input: OfficialPageEvidenceInput,
): {
  atoms: OfficialPageFactAtom[];
  concrete: OfficialPageFactAtom[];
  excluded: OfficialPageFactAtom[];
  imageAvailability: {
    uniqueSampleSceneCount: number | null;
    packagePresent: boolean;
    note: string;
  };
} {
  const atoms: OfficialPageFactAtom[] = [];
  let idx = 0;

  const pushFromText = (text: string | null | undefined, originField: string) => {
    if (!text?.trim()) return;
    const raw = text.trim();
    // Pattern atoms first (high precision)
    for (const p of extractPatternAtoms(raw)) {
      atoms.push(classifyAtomFact(p, originField, idx++));
    }
    // Segment scan
    for (const seg of splitDescriptionSegments(raw)) {
      if (EVAL_PHRASE_RE.test(seg) && compressToConcreteStem(seg)) {
        // Record promo wrapper as excluded; stem already/also extracted via patterns/classify
        const stem = compressToConcreteStem(seg)!;
        if (seg !== stem) {
          const sem = classifySemanticEvidence(seg, { sourceType: "product_description" });
          atoms.push({
            id: `page_atom::${originField.replace(/[^a-zA-Z0-9._-]/g, "_")}::${idx++}`,
            fact: seg,
            bucket: "EVALUATIVE_OR_PROMOTIONAL",
            familyId: sem.familyId,
            primary: sem.primary,
            blueprintType: sem.blueprintType,
            originField,
            source: "fanza_product_page",
            generatorAllowed: false,
          });
        }
      }
      if (
        atoms.some(
          (a) =>
            a.originField === originField &&
            seg.includes(a.fact) &&
            a.fact.length < seg.length &&
            a.generatorAllowed,
        )
      ) {
        const classified = classifyAtomFact(seg, originField, idx++);
        if (classified.bucket !== "SUPPORTED_CONCRETE_FACT") {
          atoms.push(classified);
        }
        continue;
      }
      atoms.push(classifyAtomFact(seg, originField, idx++));
    }
  };

  pushFromText(
    input.descriptionText,
    input.descriptionOriginField ?? "jsonld.Product.description",
  );
  pushFromText(
    input.videoDescription,
    input.videoOriginField ?? "jsonld.VideoObject.description",
  );

  for (const actor of input.actors ?? []) {
    const name = actor.trim();
    if (!name) continue;
    const sem = classifySemanticEvidence(name, {
      kind: "performer",
      sourceType: "performer_metadata",
    });
    atoms.push({
      id: `page_atom::actor::${idx++}`,
      fact: name,
      bucket: "SUPPORTED_CONCRETE_FACT",
      familyId: sem.familyId,
      primary: sem.primary,
      blueprintType: sem.blueprintType,
      originField: "jsonld.VideoObject.actor",
      source: "fanza_product_page",
      generatorAllowed: true,
    });
  }

  // Dedupe by family among concrete; keep first concrete per family; keep excluded for report
  const seenFamily = new Set<string>();
  const seenFact = new Set<string>();
  const deduped: OfficialPageFactAtom[] = [];
  for (const a of atoms) {
    const factKey = a.fact.replace(/\s+/g, "");
    if (seenFact.has(factKey)) continue;
    seenFact.add(factKey);
    if (a.generatorAllowed) {
      if (seenFamily.has(a.familyId)) {
        deduped.push({ ...a, bucket: "UNUSABLE", generatorAllowed: false });
        continue;
      }
      seenFamily.add(a.familyId);
    }
    deduped.push(a);
  }

  const concrete = deduped.filter((a) => a.generatorAllowed);
  const excluded = deduped.filter((a) => !a.generatorAllowed);
  const keys = input.imageContentKeys ?? [];
  const packagePresent = keys.some((k) => k.includes(":package"));

  return {
    atoms: deduped,
    concrete,
    excluded,
    imageAvailability: {
      uniqueSampleSceneCount: input.uniqueSampleSceneCount ?? null,
      packagePresent,
      note: "Image contentKeys are ArticleImages fuel only — never prose scene facts without Vision.",
    },
  };
}

/** Convert generator-allowed page atoms into ResearchEvidence for EvidencePack merge. */
export function officialPageAtomsToResearchEvidence(
  atoms: OfficialPageFactAtom[],
): ResearchEvidence[] {
  return atoms
    .filter((a) => a.generatorAllowed)
    .map((a) => ({
      evidenceId: a.id,
      sourceType: "product_description" as const,
      sourceRef: `fanza_product_page:${a.originField}`,
      observedFact: a.fact,
      confidence: "high" as const,
      facetType: a.blueprintType,
      allowedForGeneration: true,
      semanticFamilyId: a.familyId,
    }));
}

export type PageEvidenceMetaShape = {
  description?: { text?: string; originField?: string } | null;
  video?: {
    description?: string | null;
    actor?: string[] | null;
    thumbnailUrl?: string | null;
    contentUrl?: string | null;
    playerUrl?: string | null;
    uploadDate?: string | null;
    allowedForGeneration?: boolean;
    originField?: string;
  } | null;
  actors?: string[];
  images?: Array<{ contentKey?: string; sourceUrl?: string }>;
  uniqueSampleSceneCount?: number;
  uniquePackageCount?: number;
  contentId?: string | null;
};

export function extractAtomsFromPageEvidenceMeta(
  meta: PageEvidenceMetaShape | null | undefined,
): ReturnType<typeof extractOfficialPageFactAtoms> {
  if (!meta) {
    return extractOfficialPageFactAtoms({});
  }
  return extractOfficialPageFactAtoms({
    contentId: meta.contentId,
    descriptionText: meta.description?.text ?? null,
    descriptionOriginField: meta.description?.originField ?? "jsonld.Product.description",
    videoDescription: meta.video?.description ?? null,
    videoOriginField: meta.video?.originField ?? "jsonld.VideoObject.description",
    actors: meta.actors?.length ? meta.actors : meta.video?.actor ?? null,
    imageContentKeys: (meta.images ?? [])
      .map((i) => i.contentKey)
      .filter((k): k is string => Boolean(k)),
    uniqueSampleSceneCount: meta.uniqueSampleSceneCount ?? null,
  });
}
