/**
 * Future X promotion handoff — store state only; do not auto-post in R54.
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
  xAutoPostConnected: false;
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
  };
}
