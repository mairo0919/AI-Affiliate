/**
 * Publication safety: review authority + image eligibility (no live LLM).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@ai-affiliate/config";
import { WordPressApiPublisher } from "../../adapters/publisher/wordpress-api-publisher.js";
import {
  evaluateImagesForWordPressPublication,
  isImageEligibleForDraftPublication,
  isImageEligibleForPublicPublication,
} from "../../publication/image-publication-eligibility.js";
import {
  publishContentVersionToWordPress,
  resolveWordPressPublishMode,
} from "../../wordpress/wordpress-publish-path.js";
import type { ArticleImage } from "../../generation/article-images.js";
import { loadDailyMultiChannelConfig } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));

function readLiveSource(): string {
  return readFileSync(join(here, "..", "live-orchestrator.ts"), "utf8");
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    wordpressMode: "mock",
    wordpressAllowExternalRequests: false,
    wordpressAllowDirectPublish: false,
    wordpressDefaultPublishMode: "draft",
    wordpressBaseUrl: "https://example.invalid",
    wordpressUsername: undefined,
    wordpressApplicationPassword: undefined,
    wordpressApiNamespace: "wp/v2",
    ...overrides,
  } as AppConfig;
}

const requiresConfirmationHero: ArticleImage = {
  role: "hero",
  sourceUrl: "https://pics.dmm.co.jp/digital/video/ofje00230/ofje00230pl.jpg",
  imageType: "main_large",
  alt: "ofje",
  researchImageId: "img1",
  usageStatus: "REQUIRES_CONFIRMATION",
  provenance: "research_image",
  displayMode: "url_reference",
};

const allowedHero: ArticleImage = {
  ...requiresConfirmationHero,
  usageStatus: "ALLOWED",
};

const requiresConfirmationSample: ArticleImage = {
  role: "auxiliary",
  sourceUrl: "https://pics.dmm.co.jp/digital/video/ofje00230/ofje00230jp-1.jpg",
  imageType: "sample_large",
  alt: "sample",
  researchImageId: "img2",
  usageStatus: "REQUIRES_CONFIRMATION",
  provenance: "research_image",
  displayMode: "url_reference",
};

function structuredWithImages(images: ArticleImage[]) {
  return {
    article: {
      title: "ofje 公開安全性テスト",
      sections: [{ heading: null, paragraphs: ["本文段落です。"], lists: [] }],
      cta: { label: "見る", url: "https://video.dmm.co.jp/av/content/?id=ofje00230" },
      metaDescription: "メタ",
    },
    canonicalId: "ofje00230",
    images,
  };
}

function mockLifecycle() {
  return {
    createPublicationTarget: vi.fn(async (input: Record<string, unknown>) => ({
      id: "target_1",
      ...input,
    })),
    createPublicationRecord: vi.fn(async (input: Record<string, unknown>) => ({
      id: "rec_1",
      ...input,
    })),
  };
}

describe("publication safety — review authority wiring", () => {
  it("live-orchestrator does not directly APPROVE via updateContentVersionStatus", () => {
    const src = readLiveSource();
    expect(src).not.toMatch(
      /updateContentVersionStatus\(\s*generated\.version\.id\s*,\s*["']APPROVED["']\s*\)/,
    );
    expect(src).toContain("ContentReviewService");
    expect(src).toContain('decision: "approve"');
    expect(src).toContain('approvalPolicy: "auto"');
    expect(src).toContain("AWAITING_MANUAL_REVIEW");
    expect(src).not.toMatch(/imagePipelinePass:\s*true/);
  });

  it("default review policy is manual (safe)", () => {
    const cfg = loadDailyMultiChannelConfig({} as NodeJS.ProcessEnv);
    expect(cfg.reviewPolicy).toBe("manual");
    const auto = loadDailyMultiChannelConfig({
      DAILY_OPS_REVIEW_POLICY: "auto",
    } as NodeJS.ProcessEnv);
    expect(auto.reviewPolicy).toBe("auto");
  });
});

describe("publication safety — image eligibility SSOT", () => {
  it("public eligibility is ALLOWED only", () => {
    expect(isImageEligibleForPublicPublication({ usageStatus: "ALLOWED" })).toBe(true);
    expect(
      isImageEligibleForPublicPublication({ usageStatus: "REQUIRES_CONFIRMATION" }),
    ).toBe(false);
    expect(isImageEligibleForPublicPublication({ usageStatus: "UNKNOWN" })).toBe(false);
    expect(isImageEligibleForPublicPublication({ usageStatus: "NOT_ALLOWED" })).toBe(false);
  });

  it("draft eligibility allows REQUIRES_CONFIRMATION", () => {
    expect(isImageEligibleForDraftPublication({ usageStatus: "ALLOWED" })).toBe(true);
    expect(
      isImageEligibleForDraftPublication({ usageStatus: "REQUIRES_CONFIRMATION" }),
    ).toBe(true);
    expect(isImageEligibleForDraftPublication({ usageStatus: "UNKNOWN" })).toBe(false);
  });

  it("ofje-like REQUIRES_CONFIRMATION hero: draft OK, public publish blocked", () => {
    const draft = evaluateImagesForWordPressPublication({
      images: [requiresConfirmationHero, requiresConfirmationSample],
      mode: "draft",
    });
    expect(draft.pass).toBe(true);
    expect(draft.imagePipelinePass).toBe(true);
    expect(draft.imagesForHtml.some((i) => i.role === "hero")).toBe(true);

    const pub = evaluateImagesForWordPressPublication({
      images: [requiresConfirmationHero, requiresConfirmationSample],
      mode: "publish",
    });
    expect(pub.pass).toBe(false);
    expect(pub.imagePipelinePass).toBe(false);
    expect(pub.failureCodes).toContain("IMAGE_PUBLIC_ELIGIBILITY_HERO");
  });

  it("publish with ALLOWED hero excludes REQUIRES_CONFIRMATION samples", () => {
    const pub = evaluateImagesForWordPressPublication({
      images: [allowedHero, requiresConfirmationSample],
      mode: "publish",
    });
    expect(pub.pass).toBe(true);
    expect(pub.imagesForHtml).toHaveLength(1);
    expect(pub.imagesForHtml[0]?.role).toBe("hero");
    expect(pub.excluded.some((e) => e.role === "auxiliary")).toBe(true);
  });
});

describe("publication safety — WordPress path gates", () => {
  it("REVIEWING is rejected (generation alone does not publish)", async () => {
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig(),
        lifecycle: mockLifecycle() as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv-r",
              contentId: "c1",
              title: "t",
              summary: null,
              body: "b",
              status: "REVIEWING",
              structuredContent: structuredWithImages([requiresConfirmationHero]),
            })),
          },
          publicationTarget: { findMany: vi.fn(async () => []) },
        },
        publisher: new WordPressApiPublisher({
          mode: "mock",
          allowExternal: false,
          allowDirectPublish: false,
          defaultPublishMode: "draft",
          apiNamespace: "wp/v2",
        }),
      },
      { contentVersionId: "cv-r", mode: "draft" },
    );
    expect(result.ok && result.skipped).toBe(true);
    if (result.ok && result.skipped) {
      expect(result.reason).toBe("CONTENT_VERSION_NOT_APPROVED");
    }
  });

  it("APPROVED + draft + REQUIRES_CONFIRMATION hero allowed (layout path)", async () => {
    const lifecycle = mockLifecycle();
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig(),
        lifecycle: lifecycle as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv-ofje",
              contentId: "c1",
              title: "t",
              summary: null,
              body: "b",
              status: "APPROVED",
              structuredContent: structuredWithImages([requiresConfirmationHero]),
            })),
          },
          publicationTarget: { findMany: vi.fn(async () => []) },
        },
        publisher: new WordPressApiPublisher({
          mode: "mock",
          allowExternal: false,
          allowDirectPublish: false,
          defaultPublishMode: "draft",
          apiNamespace: "wp/v2",
        }),
      },
      { contentVersionId: "cv-ofje", mode: "draft" },
    );
    expect(result.ok && result.published).toBe(true);
    if (result.ok && result.published) {
      expect(result.status).toBe("DRAFT");
    }
  });

  it("APPROVED + publish + REQUIRES_CONFIRMATION hero blocked", async () => {
    const lifecycle = mockLifecycle();
    const publish = vi.fn();
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig({
          wordpressAllowDirectPublish: true,
          wordpressDefaultPublishMode: "publish",
        }),
        lifecycle: lifecycle as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv-ofje-pub",
              contentId: "c1",
              title: "t",
              summary: null,
              body: "b",
              status: "APPROVED",
              structuredContent: structuredWithImages([requiresConfirmationHero]),
            })),
          },
          publicationTarget: { findMany: vi.fn(async () => []) },
        },
        publisher: {
          platform: "WORDPRESS",
          capabilities: { createDraft: true, publish: true },
          prepare: vi.fn(async () => ({ prepared: true })),
          createDraft: vi.fn(),
          publish,
        } as never,
      },
      { contentVersionId: "cv-ofje-pub", mode: "publish" },
    );
    expect(result.ok && result.skipped).toBe(true);
    if (result.ok && result.skipped) {
      expect(result.reason).toBe("IMAGE_PUBLIC_ELIGIBILITY");
      expect(result.gateFailures).toContain("IMAGE_PUBLIC_ELIGIBILITY_HERO");
    }
    expect(publish).not.toHaveBeenCalled();
    expect(lifecycle.createPublicationTarget).not.toHaveBeenCalled();
  });

  it("APPROVED + publish + ALLOWED hero can publish", async () => {
    const lifecycle = mockLifecycle();
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig({
          wordpressAllowDirectPublish: true,
          wordpressDefaultPublishMode: "publish",
        }),
        lifecycle: lifecycle as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv-ok",
              contentId: "c1",
              title: "t",
              summary: null,
              body: "b",
              status: "APPROVED",
              structuredContent: structuredWithImages([allowedHero]),
            })),
          },
          publicationTarget: { findMany: vi.fn(async () => []) },
        },
        publisher: new WordPressApiPublisher({
          mode: "mock",
          allowExternal: false,
          allowDirectPublish: true,
          defaultPublishMode: "publish",
          apiNamespace: "wp/v2",
        }),
      },
      { contentVersionId: "cv-ok", mode: "publish" },
    );
    expect(result.ok && result.published).toBe(true);
    if (result.ok && result.published) {
      expect(result.status).toBe("PUBLISHED");
    }
  });

  it("default draft mode preserved", () => {
    expect(resolveWordPressPublishMode({ defaultPublishMode: "draft" })).toBe("draft");
    expect(baseConfig().wordpressDefaultPublishMode).toBe("draft");
    expect(baseConfig().wordpressAllowDirectPublish).toBe(false);
  });
});
