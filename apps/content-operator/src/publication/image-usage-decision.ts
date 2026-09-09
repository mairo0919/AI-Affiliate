/**
 * Image usageStatus decision — preparation for FANZA affiliate media eligibility.
 *
 * IMPORTANT (repo SSOT as of 2026-09):
 * - README / fanza-mapper / page-evidence ingest intentionally set
 *   REQUIRES_CONFIRMATION for FANZA/DMM product & sample images.
 * - "APIに画像があっても無条件で広告利用可とは判定しない" (README).
 * - Official credit copy/URL is still "公式確認後に設定" (README).
 * - requirements-v1.0: 「商品・サンプル画像の利用条件確認」は必須制約。
 *
 * Therefore this module MUST NOT promote FANZA images to ALLOWED unless an
 * explicit operator confirmation flag is set after human verification of
 * DMM/FANZA affiliate media terms. Default remains REQUIRES_CONFIRMATION.
 *
 * Does not invent a parallel status enum — maps into existing ImageUsageStatus.
 */

import { isTrustedDmmImageUrl } from "../generation/article-images.js";

export type ImageUsageStatusDecision =
  | "ALLOWED"
  | "REQUIRES_CONFIRMATION"
  | "UNKNOWN"
  | "NOT_ALLOWED";

export type ImageUsageDecisionReason =
  | "FANZA_OFFICIAL_AFFILIATE_IMAGE_TERMS_VERIFIED"
  | "FANZA_OFFICIAL_AFFILIATE_IMAGE_TERMS_UNVERIFIED"
  | "EXTERNAL_UNKNOWN_HOST"
  | "PROHIBITED_OR_UNTRUSTED_HOST"
  | "INVALID_URL"
  | "AI_GENERATED_UNVERIFIED"
  | "EXPLICIT_NOT_ALLOWED";

export type ImageUsageSourceKind =
  | "fanza_item_list_api"
  | "fanza_product_page_jsonld"
  | "fanza_product_page_gallery"
  | "source_document_image_reference"
  | "ai_generated"
  | "external_unknown"
  | "explicit";

/**
 * Checklist that must be completed before enabling ALLOWED for FANZA images.
 * Keep in code so operators know exactly what to verify (not legal advice).
 */
export const FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST = [
  "Confirm current DMM/FANZA affiliate program terms allow hotlinking/displaying official product package and sample images on affiliate media sites.",
  "Confirm whether credit/attribution text or link is required, and the exact wording/URL.",
  "Confirm whether package (pl/ps/pt) and sample (jp-N) images share the same permission scope.",
  "Confirm prohibition on download/redistribution/editing/AI training input remains enforced (already coded).",
  "Record verification date, document URL/version, and operator identity in ops notes (outside this repo if needed).",
  "Only then set fanzaAffiliateImageTermsVerified=true at the ingestion call site.",
] as const;

export type ResolveImageUsageStatusInput = {
  sourceUrl: string;
  sourceKind: ImageUsageSourceKind;
  /** Product canonical / content_id when known — strengthens provenance, not a license by itself. */
  productCanonicalId?: string | null;
  imageRole?: "hero" | "auxiliary" | "unknown";
  /**
   * Explicit human/ops confirmation that DMM/FANZA affiliate media terms allow
   * URL-reference display of official product images. Default false.
   */
  fanzaAffiliateImageTermsVerified?: boolean;
  /** Force NOT_ALLOWED (policy block). */
  explicitlyProhibited?: boolean;
};

export type ImageUsageDecision = {
  usageStatus: ImageUsageStatusDecision;
  reason: ImageUsageDecisionReason;
  trustedDmmHost: boolean;
  termsVerifiedRequired: boolean;
  notes: string[];
};

function isFanzaOfficialSourceKind(kind: ImageUsageSourceKind): boolean {
  return (
    kind === "fanza_item_list_api" ||
    kind === "fanza_product_page_jsonld" ||
    kind === "fanza_product_page_gallery"
  );
}

/**
 * Resolve usageStatus from provenance + explicit terms verification.
 * Never treats "trusted DMM host" alone as license to publish.
 */
export function resolveImageUsageStatus(
  input: ResolveImageUsageStatusInput,
): ImageUsageDecision {
  const notes: string[] = [];

  if (input.explicitlyProhibited) {
    return {
      usageStatus: "NOT_ALLOWED",
      reason: "EXPLICIT_NOT_ALLOWED",
      trustedDmmHost: false,
      termsVerifiedRequired: false,
      notes: ["explicitlyProhibited=true"],
    };
  }

  if (input.sourceKind === "ai_generated") {
    return {
      usageStatus: "REQUIRES_CONFIRMATION",
      reason: "AI_GENERATED_UNVERIFIED",
      trustedDmmHost: false,
      termsVerifiedRequired: true,
      notes: ["AI-generated assets are never auto-ALLOWED in this path"],
    };
  }

  let trusted = false;
  try {
    trusted = isTrustedDmmImageUrl(input.sourceUrl);
  } catch {
    trusted = false;
  }

  if (!input.sourceUrl?.trim()) {
    return {
      usageStatus: "NOT_ALLOWED",
      reason: "INVALID_URL",
      trustedDmmHost: false,
      termsVerifiedRequired: false,
      notes: ["empty sourceUrl"],
    };
  }

  try {
    // Validate absolute URL shape.
    void new URL(input.sourceUrl);
  } catch {
    return {
      usageStatus: "NOT_ALLOWED",
      reason: "INVALID_URL",
      trustedDmmHost: false,
      termsVerifiedRequired: false,
      notes: ["unparseable sourceUrl"],
    };
  }

  if (input.sourceKind === "external_unknown" || !trusted) {
    notes.push(trusted ? "sourceKind=external_unknown" : "host_not_in_trusted_dmm_list");
    return {
      usageStatus: trusted ? "REQUIRES_CONFIRMATION" : "NOT_ALLOWED",
      reason: trusted ? "EXTERNAL_UNKNOWN_HOST" : "PROHIBITED_OR_UNTRUSTED_HOST",
      trustedDmmHost: trusted,
      termsVerifiedRequired: true,
      notes,
    };
  }

  if (isFanzaOfficialSourceKind(input.sourceKind) || input.sourceKind === "source_document_image_reference") {
    if (input.productCanonicalId?.trim()) {
      notes.push(`canonicalId=${input.productCanonicalId.trim().toLowerCase()}`);
    } else {
      notes.push("canonicalId_missing");
    }
    if (input.imageRole) notes.push(`role=${input.imageRole}`);

    if (input.fanzaAffiliateImageTermsVerified === true && trusted) {
      return {
        usageStatus: "ALLOWED",
        reason: "FANZA_OFFICIAL_AFFILIATE_IMAGE_TERMS_VERIFIED",
        trustedDmmHost: true,
        termsVerifiedRequired: false,
        notes: [
          ...notes,
          "termsVerified=true — operator must have completed FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST",
        ],
      };
    }

    return {
      usageStatus: "REQUIRES_CONFIRMATION",
      reason: "FANZA_OFFICIAL_AFFILIATE_IMAGE_TERMS_UNVERIFIED",
      trustedDmmHost: trusted,
      termsVerifiedRequired: true,
      notes: [
        ...notes,
        "Official FANZA/DMM host + product provenance is necessary but not sufficient without terms verification",
      ],
    };
  }

  return {
    usageStatus: "REQUIRES_CONFIRMATION",
    reason: "EXTERNAL_UNKNOWN_HOST",
    trustedDmmHost: trusted,
    termsVerifiedRequired: true,
    notes,
  };
}
