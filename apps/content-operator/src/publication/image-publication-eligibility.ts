/**
 * WordPress publication image eligibility — reuses ArticleImage.usageStatus SSOT.
 * Does not invent a parallel status system or mutate usageStatus.
 */

import {
  parseArticleImages,
  type ArticleImage,
} from "../generation/article-images.js";

export type ImagePublicationMode = "draft" | "publish";

/**
 * Public (status=publish) WordPress posts: only clearly ALLOWED images.
 */
export function isImageEligibleForPublicPublication(image: {
  usageStatus: string;
}): boolean {
  return image.usageStatus === "ALLOWED";
}

/**
 * Draft WordPress posts (layout check): ALLOWED or REQUIRES_CONFIRMATION.
 * UNKNOWN / NOT_ALLOWED never embed.
 */
export function isImageEligibleForDraftPublication(image: {
  usageStatus: string;
}): boolean {
  return (
    image.usageStatus === "ALLOWED" || image.usageStatus === "REQUIRES_CONFIRMATION"
  );
}

export type ImagePublicationEvaluation = {
  pass: boolean;
  /** True when imagePipeline / publish gate may proceed for this mode. */
  imagePipelinePass: boolean;
  failureCodes: string[];
  /** Subset safe to embed in HTML for this mode (usageStatus unchanged). */
  imagesForHtml: ArticleImage[];
  excluded: Array<{ role: string; usageStatus: string; reason: string }>;
  notes: string[];
};

/**
 * Evaluate article images for WordPress draft vs public publish.
 *
 * - draft: REQUIRES_CONFIRMATION hero/sample OK for layout; never mutate usageStatus
 * - publish: hero must be ALLOWED (else BLOCK); non-ALLOWED samples are excluded
 */
export function evaluateImagesForWordPressPublication(input: {
  images: ArticleImage[];
  mode: ImagePublicationMode;
}): ImagePublicationEvaluation {
  const images = input.images ?? [];
  const excluded: ImagePublicationEvaluation["excluded"] = [];
  const notes: string[] = [];

  if (input.mode === "draft") {
    const imagesForHtml: ArticleImage[] = [];
    for (const img of images) {
      if (isImageEligibleForDraftPublication(img)) {
        imagesForHtml.push(img);
      } else {
        excluded.push({
          role: img.role,
          usageStatus: img.usageStatus,
          reason: "not_draft_eligible",
        });
      }
    }
    notes.push(`draft_embed=${imagesForHtml.length};excluded=${excluded.length}`);
    return {
      pass: true,
      imagePipelinePass: true,
      failureCodes: [],
      imagesForHtml,
      excluded,
      notes,
    };
  }

  // ——— public publish ———
  const hero = images.find((i) => i.role === "hero");
  if (hero && !isImageEligibleForPublicPublication(hero)) {
    notes.push(`hero_blocked:${hero.usageStatus}`);
    return {
      pass: false,
      imagePipelinePass: false,
      failureCodes: ["IMAGE_PUBLIC_ELIGIBILITY_HERO", `HERO_${hero.usageStatus}`],
      imagesForHtml: [],
      excluded: [
        {
          role: "hero",
          usageStatus: hero.usageStatus,
          reason: "hero_not_public_eligible",
        },
      ],
      notes,
    };
  }

  const imagesForHtml: ArticleImage[] = [];
  for (const img of images) {
    if (isImageEligibleForPublicPublication(img)) {
      imagesForHtml.push(img);
    } else {
      excluded.push({
        role: img.role,
        usageStatus: img.usageStatus,
        reason: "excluded_from_public_html",
      });
    }
  }
  notes.push(`publish_embed=${imagesForHtml.length};excluded=${excluded.length}`);
  return {
    pass: true,
    imagePipelinePass: true,
    failureCodes: [],
    imagesForHtml,
    excluded,
    notes,
  };
}

export function evaluateStructuredContentImagesForWordPress(input: {
  structuredContent: unknown;
  mode: ImagePublicationMode;
}): ImagePublicationEvaluation {
  const structured =
    input.structuredContent && typeof input.structuredContent === "object"
      ? (input.structuredContent as Record<string, unknown>)
      : {};
  const images = parseArticleImages(structured.images);
  return evaluateImagesForWordPressPublication({ images, mode: input.mode });
}
