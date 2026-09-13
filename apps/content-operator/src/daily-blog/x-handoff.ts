/**
 * Legacy blog→X handoff payload (state only).
 *
 * Production X auto-post reachability is via daily-ops / XPublicationService
 * (`apps/content-operator/src/x/**` + `daily-ops/live-orchestrator.ts`).
 * This module does NOT call X API and must not be treated as a second publish route.
 */

export interface BlogPublishXHandoff {
  publishedBlogUrl: string;
  canonicalId: string;
  affiliateUrl: string;
  imageUrls: string[];
  title: string;
  bloggerPostId: string;
  contentVersionId: string;
  createdAt: string;
  /** Always false — auto-post is owned by daily-ops X phase, not this handoff. */
  xAutoPostConnected: false;
  /** Explicit pointer to the production X path. */
  productionXPath: "daily-ops/x-publication-service";
}

export function buildXHandoffPayload(input: {
  publishedBlogUrl: string;
  canonicalId: string;
  affiliateUrl: string;
  imageUrls: string[];
  title: string;
  bloggerPostId: string;
  contentVersionId: string;
  now?: Date;
}): BlogPublishXHandoff {
  return {
    publishedBlogUrl: input.publishedBlogUrl,
    canonicalId: input.canonicalId,
    affiliateUrl: input.affiliateUrl,
    imageUrls: input.imageUrls.slice(0, 4),
    title: input.title,
    bloggerPostId: input.bloggerPostId,
    contentVersionId: input.contentVersionId,
    createdAt: (input.now ?? new Date()).toISOString(),
    xAutoPostConnected: false,
    productionXPath: "daily-ops/x-publication-service",
  };
}
