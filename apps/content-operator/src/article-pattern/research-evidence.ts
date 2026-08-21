/**
 * Research Evidence — observed facts with provenance for Reference-guided generation.
 * Speculation / evaluation language is never Evidence.
 * r17: trait_or_scene is intermediate — fact semantics decide facet type.
 */

import type { BlueprintEvidenceType } from "./reference-editorial-blueprint.js";
import { classifySemanticEvidence } from "./semantic-evidence.js";
import {
  extractAtomsFromPageEvidenceMeta,
  officialPageAtomsToResearchEvidence,
  type PageEvidenceMetaShape,
} from "./official-page-evidence-atoms.js";

export type EvidenceSourceType =
  | "product_title"
  | "product_description"
  | "maker_metadata"
  | "series_metadata"
  | "performer_metadata"
  | "package_or_page_image"
  | "sample_video"
  | "supported_claim"
  | "availability_metadata";

export type ResearchEvidence = {
  evidenceId: string;
  sourceType: EvidenceSourceType;
  sourceRef: string;
  observedFact: string;
  confidence: "high" | "medium" | "low";
  facetType: BlueprintEvidenceType;
  temporalPosition?: string | null;
  visualObservation?: string | null;
  allowedForGeneration: boolean;
  claimId?: string | null;
  semanticFamilyId?: string;
};

const EVAL_BLOCK_RE =
  /魅力的|興奮|話題|おすすめ|心理的|葛藤|必見|最高|素晴らしい|楽しめる|見応え/;

function sourceTypeFromKind(kind: string | null | undefined): EvidenceSourceType | null {
  const k = (kind ?? "").toLowerCase();
  if (k === "maker" || k === "label") return "maker_metadata";
  if (k === "availability" || k === "temporal_sale") return "availability_metadata";
  if (k === "performer" || k === "cast") return "performer_metadata";
  if (k === "series") return "series_metadata";
  return null;
}

/**
 * Build evidence list from product title, claims, and optional image refs.
 * Sample video evidence is only included when explicitly supplied (never invented).
 */
export function buildResearchEvidence(input: {
  productTitle: string;
  claims: Array<{ id: string; statement: string; kind?: string | null; status?: string | null }>;
  imageRefs?: Array<{ role: string; sourceUrl: string; provenance?: string }>;
  sampleVideo?: { playerUrl: string; note?: string } | null;
  /** Official FANZA pageEvidence — concrete atoms only (no raw description dump). */
  pageEvidenceMeta?: PageEvidenceMetaShape | null;
}): ResearchEvidence[] {
  const out: ResearchEvidence[] = [];

  const title = (input.productTitle ?? "").trim();
  if (title.length >= 4) {
    const sem = classifySemanticEvidence(title, {
      sourceType: "product_title",
      titleIdentityToken: false,
    });
    out.push({
      evidenceId: `title::${title.slice(0, 40)}`,
      sourceType: "product_title",
      sourceRef: "product.title",
      observedFact: title,
      confidence: "high",
      facetType: sem.blueprintType,
      allowedForGeneration: true,
      semanticFamilyId: sem.familyId,
    });
    // Title facets — same grain as EvidencePack (profile SSOT)
    const facets = title
      .split(/[\s　【】\[\]\|｜]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2 && p.length <= 40 && /[\u4e00-\u9fffァ-ヶー]/.test(p));
    const qty = title.match(/\d+\s*(?:名|人|時間|分|作品)/g) ?? [];
    for (const [i, facet] of [...new Set([...qty, ...facets])].slice(0, 16).entries()) {
      const fsem = classifySemanticEvidence(facet, {
        sourceType: "product_title",
        titleIdentityToken: true,
      });
      if (fsem.primary === "CATALOG" || fsem.primary === "EVALUATIVE") continue;
      out.push({
        evidenceId: `title_facet::${i}`,
        sourceType: "product_title",
        sourceRef: "product.title",
        observedFact: facet,
        confidence: "high",
        facetType: fsem.blueprintType,
        allowedForGeneration: true,
        semanticFamilyId: fsem.familyId,
      });
    }
  }

  for (const c of input.claims) {
    const statement = (c.statement ?? "").trim();
    if (statement.length < 2) continue;
    const status = (c.status ?? "SUPPORTED").toUpperCase();
    const allowed = status === "SUPPORTED" || status === "AVAILABLE";
    if (EVAL_BLOCK_RE.test(statement) && !/\d+|出演|メーカー|シリーズ/.test(statement)) {
      continue;
    }
    const fromSource = sourceTypeFromKind(c.kind);
    const sem = classifySemanticEvidence(statement, {
      kind: c.kind,
      sourceType: fromSource,
    });
    const sourceType: EvidenceSourceType = fromSource ?? "supported_claim";
    out.push({
      evidenceId: `claim::${c.id}`,
      sourceType,
      sourceRef: c.id,
      observedFact: statement.slice(0, 240),
      confidence: allowed ? "high" : "low",
      facetType: sem.blueprintType,
      allowedForGeneration: allowed && sem.primary !== "EVALUATIVE",
      claimId: c.id,
      semanticFamilyId: sem.familyId,
    });
  }

  for (const [i, img] of (input.imageRefs ?? []).entries()) {
    out.push({
      evidenceId: `image::${i}::${img.role}`,
      sourceType: "package_or_page_image",
      sourceRef: img.sourceUrl,
      observedFact: `package_or_page_image_present:${img.role}`,
      confidence: "medium",
      facetType: "unknown_concrete",
      visualObservation: img.role,
      allowedForGeneration: false,
    });
  }

  if (input.sampleVideo?.playerUrl) {
    out.push({
      evidenceId: `sample_video::player`,
      sourceType: "sample_video",
      sourceRef: input.sampleVideo.playerUrl,
      observedFact: input.sampleVideo.note ?? "sample_video_player_url_present",
      confidence: "low",
      facetType: "scene_or_act",
      temporalPosition: null,
      allowedForGeneration: false,
    });
  }

  if (input.pageEvidenceMeta) {
    const { concrete } = extractAtomsFromPageEvidenceMeta(input.pageEvidenceMeta);
    out.push(...officialPageAtomsToResearchEvidence(concrete));
  }

  return out;
}

export function evidenceAllowedForProse(e: ResearchEvidence): boolean {
  return e.allowedForGeneration && e.confidence !== "low";
}
