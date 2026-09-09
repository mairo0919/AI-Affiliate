/**
 * Operator confirmation: promote trusted FANZA/DMM official images RC → ALLOWED.
 * Does NOT invent rights. Requires explicit checklist confirmation flag.
 */

import type { DatabaseClient } from "@ai-affiliate/database";
import {
  FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST,
  resolveImageUsageStatus,
} from "../publication/image-usage-decision.js";
import { isTrustedDmmImageUrl, parseArticleImages } from "../generation/article-images.js";

export type ConfirmFanzaImageTermsResult = {
  ok: boolean;
  reason?: string;
  checklist: readonly string[];
  researchImagesUpdated: number;
  contentVersionsUpdated: number;
  skippedUntrusted: number;
};

/**
 * After human verification of FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST,
 * upgrade REQUIRES_CONFIRMATION → ALLOWED for trusted DMM hosts only.
 */
export async function confirmFanzaAffiliateImageTerms(input: {
  prisma: DatabaseClient["prisma"];
  /** Must be true — operator asserts checklist completed. */
  iConfirmChecklist: boolean;
  actor: string;
  /** Limit ContentVersions scanned (APPROVED unused stock preferred). */
  contentVersionLimit?: number;
}): Promise<ConfirmFanzaImageTermsResult> {
  if (!input.iConfirmChecklist) {
    return {
      ok: false,
      reason: "CONFIRMATION_REQUIRED",
      checklist: FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST,
      researchImagesUpdated: 0,
      contentVersionsUpdated: 0,
      skippedUntrusted: 0,
    };
  }

  let researchImagesUpdated = 0;
  let skippedUntrusted = 0;

  const researchImages = await input.prisma.researchImage.findMany({
    where: { usageStatus: "REQUIRES_CONFIRMATION" },
    select: { id: true, sourceUrl: true },
    take: 5000,
  });

  for (const img of researchImages) {
    if (!isTrustedDmmImageUrl(img.sourceUrl)) {
      skippedUntrusted += 1;
      continue;
    }
    const decision = resolveImageUsageStatus({
      sourceUrl: img.sourceUrl,
      sourceKind: "fanza_product_page_gallery",
      fanzaAffiliateImageTermsVerified: true,
    });
    if (decision.usageStatus !== "ALLOWED") {
      skippedUntrusted += 1;
      continue;
    }
    await input.prisma.researchImage.update({
      where: { id: img.id },
      data: {
        usageStatus: "ALLOWED",
        usageNote: `terms_verified_by:${input.actor};${decision.reason}`,
      },
    });
    researchImagesUpdated += 1;
  }

  let contentVersionsUpdated = 0;
  const versions = await input.prisma.contentVersion.findMany({
    where: { status: { in: ["APPROVED", "REVIEWING"] } },
    select: { id: true, structuredContent: true },
    take: input.contentVersionLimit ?? 500,
    orderBy: { updatedAt: "desc" },
  });

  for (const v of versions) {
    const sc =
      v.structuredContent && typeof v.structuredContent === "object"
        ? ({ ...(v.structuredContent as Record<string, unknown>) } as Record<string, unknown>)
        : null;
    if (!sc) continue;
    const images = parseArticleImages(sc.images);
    if (images.length === 0) continue;
    let changed = false;
    const next = images.map((img) => {
      if (img.usageStatus !== "REQUIRES_CONFIRMATION") return img;
      if (!isTrustedDmmImageUrl(img.sourceUrl)) {
        skippedUntrusted += 1;
        return img;
      }
      const decision = resolveImageUsageStatus({
        sourceUrl: img.sourceUrl,
        sourceKind: "fanza_product_page_gallery",
        productCanonicalId:
          typeof sc.productCanonicalId === "string" ? sc.productCanonicalId : null,
        imageRole: img.role === "hero" ? "hero" : "auxiliary",
        fanzaAffiliateImageTermsVerified: true,
      });
      if (decision.usageStatus !== "ALLOWED") return img;
      changed = true;
      return {
        ...img,
        usageStatus: "ALLOWED" as const,
        usageNote: `terms_verified_by:${input.actor};${decision.reason}`,
      };
    });
    if (!changed) continue;
    await input.prisma.contentVersion.update({
      where: { id: v.id },
      data: {
        structuredContent: {
          ...sc,
          images: next,
          fanzaAffiliateImageTermsVerified: true,
          fanzaAffiliateImageTermsVerifiedBy: input.actor,
          fanzaAffiliateImageTermsVerifiedAt: new Date().toISOString(),
        },
      },
    });
    contentVersionsUpdated += 1;
  }

  return {
    ok: true,
    checklist: FANZA_AFFILIATE_IMAGE_TERMS_CHECKLIST,
    researchImagesUpdated,
    contentVersionsUpdated,
    skippedUntrusted,
  };
}
