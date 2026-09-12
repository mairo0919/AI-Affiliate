/**
 * Daily-ops / live WordPress runtime wiring contracts (no live LLM).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@ai-affiliate/config";
import { WordPressApiPublisher } from "../../adapters/publisher/wordpress-api-publisher.js";
import {
  publishContentVersionToWordPress,
  resolveWordPressPublishMode,
} from "../../wordpress/wordpress-publish-path.js";
import { BLOG_PUBLICATION_PLATFORMS } from "../publication-history.js";

const here = dirname(fileURLToPath(import.meta.url));

function readSource(relativeFromDailyOps: string): string {
  return readFileSync(join(here, "..", relativeFromDailyOps), "utf8");
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

const sampleStructured = {
  article: {
    title: "WP runtime タイトル",
    sections: [{ heading: null, paragraphs: ["本文段落です。"], lists: [] }],
    cta: { label: "見る", url: "https://video.dmm.co.jp/av/content/?id=halt00091" },
    metaDescription: "メタ",
  },
  canonicalId: "halt00091",
};

describe("wordpress runtime wiring (daily-ops / scheduler)", () => {
  it("live-orchestrator uses WordPress shared path and does not wire Blogger publisher", () => {
    const src = readSource("live-orchestrator.ts");
    const canonical = readFileSync(
      join(here, "../../generation/canonical-article-pipeline.ts"),
      "utf8",
    );
    expect(src).toContain("publishContentVersionToWordPress");
    expect(src).toContain("runCanonicalArticlePipeline");
    expect(canonical).toContain('primaryChannel: "WORDPRESS"');
    expect(src).toContain("ContentReviewService");
    expect(src).not.toMatch(
      /updateContentVersionStatus\(\s*[^,]+,\s*["']APPROVED["']\s*\)/,
    );
    expect(src).not.toContain("createBloggerPublisherFromConfig");
    expect(src).not.toContain("blogger-api-publisher");
    expect(src).not.toMatch(/platform:\s*"BLOGGER"/);
    expect(src).not.toMatch(/imagePipelinePass:\s*true/);
  });

  it("scheduler daily-ops phase delegates to runDailyMultiChannelLive", () => {
    const scheduler = readFileSync(
      join(here, "../../schedules/scheduler-pipeline.ts"),
      "utf8",
    );
    expect(scheduler).toContain("runDailyMultiChannelLive");
    expect(scheduler).not.toContain("createBloggerPublisherFromConfig");
  });

  it("publication history platforms prefer WordPress with Blogger legacy read", () => {
    expect(BLOG_PUBLICATION_PLATFORMS).toEqual(["WORDPRESS", "BLOGGER"]);
    const hist = readSource("publication-history.ts");
    expect(hist).toContain("BLOG_PUBLICATION_PLATFORMS");
    expect(hist).not.toMatch(/platform:\s*"BLOGGER"/);
  });

  it("default publish mode remains draft; direct publish stays disabled by default config", () => {
    expect(
      resolveWordPressPublishMode({
        defaultPublishMode: "draft",
      }),
    ).toBe("draft");
    expect(
      resolveWordPressPublishMode({
        defaultPublishMode: "publish",
      }),
    ).toBe("publish");
    const cfg = baseConfig();
    expect(cfg.wordpressDefaultPublishMode).toBe("draft");
    expect(cfg.wordpressAllowDirectPublish).toBe(false);
    // Scheduler-equivalent resolution: without allowDirectPublish, force draft.
    const mode =
      cfg.wordpressAllowDirectPublish && cfg.wordpressDefaultPublishMode === "publish"
        ? "publish"
        : "draft";
    expect(mode).toBe("draft");
  });

  it("REVIEWING content is not published (APPROVED gate)", async () => {
    const createDraft = vi.fn();
    const publisher = {
      platform: "WORDPRESS" as const,
      capabilities: {
        longForm: true,
        shortForm: false,
        thread: false,
        draft: true,
        schedule: false,
        update: true,
        delete: true,
        affiliateLinks: true,
        adultContent: true,
        publish: true,
        metrics: false,
        createDraft: true,
      },
      prepare: vi.fn(async () => ({ prepared: true })),
      createDraft,
      publish: vi.fn(),
    };
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig(),
        lifecycle: {
          createPublicationTarget: vi.fn(),
          createPublicationRecord: vi.fn(),
        } as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv-reviewing",
              contentId: "c1",
              title: "t",
              summary: null,
              body: "b",
              status: "REVIEWING",
              structuredContent: sampleStructured,
            })),
          },
          publicationTarget: { findMany: vi.fn(async () => []) },
        },
        publisher: publisher as never,
      },
      { contentVersionId: "cv-reviewing", mode: "draft" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("CONTENT_VERSION_NOT_APPROVED");
    }
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("APPROVED content can createDraft via mock WordPress publisher (idempotent key)", async () => {
    const publisher = new WordPressApiPublisher({
      mode: "mock",
      allowExternal: false,
      allowDirectPublish: false,
      defaultPublishMode: "draft",
      apiNamespace: "wp/v2",
    });
    const lifecycle = {
      createPublicationTarget: vi.fn(async (input: Record<string, unknown>) => ({
        id: "target_wp",
        ...input,
      })),
      createPublicationRecord: vi.fn(async (input: Record<string, unknown>) => ({
        id: "rec_wp",
        ...input,
      })),
    };
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig(),
        lifecycle: lifecycle as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv-approved",
              contentId: "c1",
              title: "t",
              summary: null,
              body: "b",
              status: "APPROVED",
              structuredContent: sampleStructured,
            })),
          },
          publicationTarget: { findMany: vi.fn(async () => []) },
        },
        publisher,
      },
      {
        contentVersionId: "cv-approved",
        canonicalId: "halt00091",
        mode: "draft",
        platformMetadata: { dailyIdempotencyKey: "daily:test" },
      },
    );
    expect(result.ok && result.published).toBe(true);
    if (result.ok && result.published) {
      expect(result.status).toBe("DRAFT");
      expect(result.externalId).toBeTruthy();
    }
    expect(lifecycle.createPublicationTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "WORDPRESS",
        status: "DRAFT",
        platformMetadata: expect.objectContaining({
          idempotencyKey: "wordpress:cv-approved:draft",
          dailyIdempotencyKey: "daily:test",
        }),
      }),
    );

    // Second call with same version must skip (idempotency).
    const again = await publishContentVersionToWordPress(
      {
        config: baseConfig(),
        lifecycle: lifecycle as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv-approved",
              contentId: "c1",
              title: "t",
              summary: null,
              body: "b",
              status: "APPROVED",
              structuredContent: sampleStructured,
            })),
          },
          publicationTarget: {
            findMany: vi.fn(async () => [
              {
                id: "target_wp",
                contentVersionId: "cv-approved",
                status: "DRAFT",
                publishedExternalId: "mock-1",
                publishedUrl: "https://example.invalid/?p=1",
                publishedAt: new Date(),
                platformMetadata: { canonicalId: "halt00091" },
              },
            ]),
          },
        },
        publisher,
      },
      { contentVersionId: "cv-approved", mode: "draft" },
    );
    expect(again.ok && again.skipped).toBe(true);
    if (again.ok && again.skipped) {
      expect(again.reason).toBe("DUPLICATE_CONTENT_VERSION");
      expect(again.duplicate).toBe(true);
    }
  });

  it("direct publish remains blocked when allowDirectPublish=false even if default mode says publish", async () => {
    const publish = vi.fn();
    const createDraft = vi.fn(async () => ({
      externalId: "d1",
      url: "https://example.invalid/?p=1",
      status: "DRAFT",
      responseSummary: {},
    }));
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig({
          wordpressAllowDirectPublish: false,
          wordpressDefaultPublishMode: "publish",
        }),
        lifecycle: {
          createPublicationTarget: vi.fn(async (i: Record<string, unknown>) => ({
            id: "t",
            ...i,
          })),
          createPublicationRecord: vi.fn(async (i: Record<string, unknown>) => ({
            id: "r",
            ...i,
          })),
        } as never,
        prisma: {
          contentVersion: {
            findUnique: vi.fn(async () => ({
              id: "cv2",
              contentId: "c2",
              title: "t",
              summary: null,
              body: "b",
              status: "APPROVED",
              structuredContent: sampleStructured,
            })),
          },
          publicationTarget: { findMany: vi.fn(async () => []) },
        },
        publisher: {
          platform: "WORDPRESS",
          capabilities: { createDraft: true, publish: true },
          prepare: vi.fn(async () => ({ prepared: true })),
          createDraft,
          publish,
        } as never,
      },
      // omit mode → path must fall back to draft when allowDirectPublish is false
      { contentVersionId: "cv2" },
    );
    expect(result.ok && result.published).toBe(true);
    expect(createDraft).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("X publication modules remain present (untouched by WordPress switch)", () => {
    const live = readSource("live-orchestrator.ts");
    expect(live).toContain("xPublicationService");
    expect(live).toContain("XPublicationService");
    expect(live).toContain("// ——— X ———");
  });
});
