/**
 * Content policy surfaces — do not mix article SEO/adult detail with X timeline copy/media.
 *
 * ARTICLE_CONTENT: WordPress / blog body (adult detail OK under article policy)
 * X_SOCIAL_CONTENT: X post text (timeline-safe acquisition copy)
 * X_SOCIAL_MEDIA: X attachment images (separate from article package assets)
 */

export const CONTENT_POLICY_SURFACE = {
  ARTICLE_CONTENT: "ARTICLE_CONTENT",
  X_SOCIAL_CONTENT: "X_SOCIAL_CONTENT",
  X_SOCIAL_MEDIA: "X_SOCIAL_MEDIA",
} as const;

export type ContentPolicySurface =
  (typeof CONTENT_POLICY_SURFACE)[keyof typeof CONTENT_POLICY_SURFACE];
