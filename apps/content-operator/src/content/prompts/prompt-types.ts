export interface PromptDefinition {
  version: string;
  build: (params: Record<string, unknown>) => string;
}

export const CONTENT_SYSTEM_PROMPT_VERSION = "content-system-v1";
export const BLOG_PROMPT_VERSION = "blog-v1";
export const X_POST_PROMPT_VERSION = "x-post-v1";
export const SHORT_VIDEO_PROMPT_VERSION = "short-video-v1";
export const PRODUCT_INTRODUCTION_PROMPT_VERSION = "product-introduction-v1";

export function resolvePromptBundleVersion(contentType: string): string {
  switch (contentType) {
    case "BLOG_ARTICLE":
      return `${CONTENT_SYSTEM_PROMPT_VERSION}+${BLOG_PROMPT_VERSION}`;
    case "X_POST":
      return `${CONTENT_SYSTEM_PROMPT_VERSION}+${X_POST_PROMPT_VERSION}`;
    case "SHORT_VIDEO_SCRIPT":
      return `${CONTENT_SYSTEM_PROMPT_VERSION}+${SHORT_VIDEO_PROMPT_VERSION}`;
    case "PRODUCT_INTRODUCTION":
      return `${CONTENT_SYSTEM_PROMPT_VERSION}+${PRODUCT_INTRODUCTION_PROMPT_VERSION}`;
    default:
      return CONTENT_SYSTEM_PROMPT_VERSION;
  }
}
