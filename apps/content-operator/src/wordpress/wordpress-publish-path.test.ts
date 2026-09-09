import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@ai-affiliate/config";
import { WordPressApiPublisher } from "../adapters/publisher/wordpress-api-publisher.js";
import {
  assertWordPressLivePublishAllowed,
  buildWordPressHtmlFromVersion,
  publishContentVersionToWordPress,
  resolveWordPressPublishMode,
  runWordPressPublicationBatch,
} from "./wordpress-publish-path.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    wordpressMode: "mock",
    wordpressAllowExternalRequests: false,
    wordpressAllowDirectPublish: true,
    wordpressDefaultPublishMode: "publish",
    wordpressBaseUrl: "https://example.invalid",
    wordpressUsername: undefined,
    wordpressApplicationPassword: undefined,
    wordpressApiNamespace: "wp/v2",
    ...overrides,
  } as AppConfig;
}

const sampleStructured = {
  article: {
    title: "テスト記事タイトル",
    lead: "リード文です。",
    summary: "要約です。",
    sections: [{ heading: null, paragraphs: ["本文段落"], lists: [] }],
    cta: { label: "見る", url: "https://video.dmm.co.jp/av/content/?id=halt00091" },
    metaDescription: "メタ説明",
  },
  images: [],
  canonicalId: "halt00091",
};

function mockPrisma(status: string) {
  return {
    contentVersion: {
      findUnique: vi.fn(async () => ({
        id: "cv1",
        contentId: "c1",
        title: "t",
        summary: "s",
        body: "plain",
        status,
        structuredContent: sampleStructured,
      })),
    },
    publicationTarget: {
      findMany: vi.fn(async () => []),
    },
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
    updatePublicationTarget: vi.fn(async (id: string, input: Record<string, unknown>) => ({
      id,
      ...input,
    })),
    updateContentVersionStructuredContent: vi.fn(async (id: string, sc: Record<string, unknown>) => ({
      id,
      structuredContent: sc,
    })),
    findContentVersion: vi.fn(async (id: string) => ({
      id,
      contentId: "c1",
      title: "t",
      structuredContent: sampleStructured,
    })),
    findContent: vi.fn(async () => ({ id: "c1", topicCandidateId: null })),
    findTopicCandidate: vi.fn(async () => null),
    listResearchImagesByExternalIds: vi.fn(async () => []),
    listResearchImagesByResearchItemId: vi.fn(async () => []),
    listSourceDocumentsImageReferencesByUrls: vi.fn(async () => []),
  };
}

describe("buildWordPressHtmlFromVersion", () => {
  it("reuses formatBloggerHtml structure with CTA", () => {
    const built = buildWordPressHtmlFromVersion({
      title: "fallback",
      summary: null,
      structuredContent: sampleStructured,
      ctaUrl: "https://video.dmm.co.jp/av/content/?id=halt00091",
    });
    expect(built.title).toBe("テスト記事タイトル");
    expect(built.html).toContain("リード文です。");
    expect(built.html).toContain("本文段落");
    expect(built.html).toContain("https://video.dmm.co.jp/av/content/?id=halt00091");
    expect(built.html).toContain("アフィリエイト");
  });
});

describe("resolveWordPressPublishMode / live publish safety", () => {
  it("LIVE_CONFIRM alone does not choose publish; DEFAULT=draft → draft", () => {
    expect(
      resolveWordPressPublishMode({
        explicitMode: null,
        defaultPublishMode: "draft",
      }),
    ).toBe("draft");
  });

  it("PUBLISH_MODE unset falls back to default then draft", () => {
    expect(
      resolveWordPressPublishMode({
        explicitMode: null,
        defaultPublishMode: "publish",
      }),
    ).toBe("publish");
    expect(
      resolveWordPressPublishMode({
        explicitMode: null,
        defaultPublishMode: null,
      }),
    ).toBe("draft");
  });

  it("explicit WORDPRESS_PUBLISH_MODE wins over default", () => {
    expect(
      resolveWordPressPublishMode({
        explicitMode: "draft",
        defaultPublishMode: "publish",
      }),
    ).toBe("draft");
    expect(
      resolveWordPressPublishMode({
        explicitMode: "publish",
        defaultPublishMode: "draft",
      }),
    ).toBe("publish");
  });

  it("PUBLISH_MODE=publish + ALLOW_DIRECT=false → rejected", () => {
    const gate = assertWordPressLivePublishAllowed({
      mode: "publish",
      explicitPublishMode: true,
      allowDirectPublish: false,
      liveConfirm: true,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("WORDPRESS_PUBLISH_REQUIRES_ALLOW_DIRECT");
    }
  });

  it("PUBLISH_MODE=publish + ALLOW_DIRECT=true + LIVE_CONFIRM=1 → allowed", () => {
    const gate = assertWordPressLivePublishAllowed({
      mode: "publish",
      explicitPublishMode: true,
      allowDirectPublish: true,
      liveConfirm: true,
    });
    expect(gate).toEqual({ ok: true });
  });

  it("resolved publish without explicit PUBLISH_MODE → rejected", () => {
    const gate = assertWordPressLivePublishAllowed({
      mode: "publish",
      explicitPublishMode: false,
      allowDirectPublish: true,
      liveConfirm: true,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("WORDPRESS_PUBLISH_REQUIRES_EXPLICIT_MODE");
    }
  });
});

describe("publishContentVersionToWordPress approval gate", () => {
  it("APPROVED → draft publish allowed", async () => {
    const lifecycle = mockLifecycle();
    const publisher = new WordPressApiPublisher({
      mode: "mock",
      allowExternal: false,
      allowDirectPublish: false,
      defaultPublishMode: "draft",
      apiNamespace: "wp/v2",
    });
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig({
          wordpressAllowDirectPublish: false,
          wordpressDefaultPublishMode: "draft",
        }),
        lifecycle: lifecycle as never,
        publisher,
        prisma: mockPrisma("APPROVED") as never,
      },
      { contentVersionId: "cv1", mode: "draft" },
    );
    expect(result.ok && result.published).toBe(true);
    if (result.ok && result.published) {
      expect(result.status).toBe("DRAFT");
    }
    expect(lifecycle.createPublicationTarget).toHaveBeenCalledTimes(1);
  });

  it("REVIEWING → publication rejected", async () => {
    const lifecycle = mockLifecycle();
    const publisher = new WordPressApiPublisher({
      mode: "mock",
      allowExternal: false,
      allowDirectPublish: true,
      defaultPublishMode: "draft",
      apiNamespace: "wp/v2",
    });
    const result = await publishContentVersionToWordPress(
      {
        config: baseConfig(),
        lifecycle: lifecycle as never,
        publisher,
        prisma: mockPrisma("REVIEWING") as never,
      },
      { contentVersionId: "cv1", mode: "draft" },
    );
    expect(result.ok && result.skipped).toBe(true);
    if (result.ok && result.skipped) {
      expect(result.reason).toBe("CONTENT_VERSION_NOT_APPROVED");
    }
    expect(lifecycle.createPublicationTarget).not.toHaveBeenCalled();
  });
});

describe("publishContentVersionToWordPress idempotency", () => {
  it("publishes once then skips duplicate contentVersion", async () => {
    const targets: Array<Record<string, unknown>> = [];
    const records: Array<Record<string, unknown>> = [];

    const prisma = {
      contentVersion: {
        findUnique: vi.fn(async () => ({
          id: "cv1",
          contentId: "c1",
          title: "t",
          summary: "s",
          body: "plain",
          status: "APPROVED",
          structuredContent: sampleStructured,
        })),
      },
      publicationTarget: {
        findMany: vi.fn(async () =>
          targets.map((t) => ({
            id: String(t.id),
            contentVersionId: String(t.contentVersionId),
            status: String(t.status),
            publishedExternalId: (t.publishedExternalId as string | null) ?? null,
            publishedUrl: (t.publishedUrl as string | null) ?? null,
            publishedAt: (t.publishedAt as Date | null) ?? null,
            platformMetadata: t.platformMetadata ?? null,
          })),
        ),
      },
    };

    const lifecycle = {
      createPublicationTarget: vi.fn(async (input: Record<string, unknown>) => {
        const row = {
          id: `target_${targets.length + 1}`,
          ...input,
        };
        targets.push(row);
        return row;
      }),
      createPublicationRecord: vi.fn(async (input: Record<string, unknown>) => {
        const row = { id: `rec_${records.length + 1}`, ...input };
        records.push(row);
        return row;
      }),
      updatePublicationTarget: vi.fn(async () => ({})),
      updateContentVersionStructuredContent: vi.fn(async () => ({})),
      findContentVersion: vi.fn(async () => ({
        id: "cv1",
        contentId: "c1",
        title: "t",
        structuredContent: sampleStructured,
      })),
      findContent: vi.fn(async () => ({ id: "c1", topicCandidateId: null })),
      findTopicCandidate: vi.fn(async () => null),
      listResearchImagesByExternalIds: vi.fn(async () => []),
      listResearchImagesByResearchItemId: vi.fn(async () => []),
      listSourceDocumentsImageReferencesByUrls: vi.fn(async () => []),
    };

    const publisher = new WordPressApiPublisher({
      mode: "mock",
      allowExternal: false,
      allowDirectPublish: true,
      defaultPublishMode: "publish",
      apiNamespace: "wp/v2",
    });

    const deps = {
      config: baseConfig(),
      lifecycle: lifecycle as never,
      publisher,
      prisma: prisma as never,
    };

    const first = await publishContentVersionToWordPress(deps, {
      contentVersionId: "cv1",
      canonicalId: "halt00091",
      mode: "publish",
    });
    expect(first.ok && first.published).toBe(true);
    if (first.ok && first.published) {
      expect(first.externalId).toBeTruthy();
      expect(first.publicationTargetId).toBe("target_1");
    }

    const second = await publishContentVersionToWordPress(deps, {
      contentVersionId: "cv1",
      canonicalId: "halt00091",
      mode: "publish",
    });
    expect(second.ok && second.skipped && second.duplicate).toBe(true);
    if (second.ok && second.skipped) {
      expect(second.reason).toBe("DUPLICATE_CONTENT_VERSION");
    }
    expect(lifecycle.createPublicationTarget).toHaveBeenCalledTimes(1);
  });

  it("batch continues after one failure", async () => {
    const prisma = {
      contentVersion: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === "bad") return null;
          return {
            id: where.id,
            contentId: "c",
            title: "t",
            summary: "s",
            body: "b",
            status: "APPROVED",
            structuredContent: sampleStructured,
          };
        }),
      },
      publicationTarget: {
        findMany: vi.fn(async () => []),
      },
    };
    const lifecycle = {
      createPublicationTarget: vi.fn(async (input: Record<string, unknown>) => ({
        id: `t_${input.contentVersionId}`,
        ...input,
      })),
      createPublicationRecord: vi.fn(async (input: Record<string, unknown>) => ({
        id: `r_${input.externalId}`,
        ...input,
      })),
      findContentVersion: vi.fn(async (id: string) => ({
        id,
        contentId: "c",
        title: "t",
        structuredContent: sampleStructured,
      })),
      findContent: vi.fn(async () => ({ id: "c", topicCandidateId: null })),
      listResearchImagesByExternalIds: vi.fn(async () => []),
    };
    const publisher = new WordPressApiPublisher({
      mode: "mock",
      allowExternal: false,
      allowDirectPublish: true,
      defaultPublishMode: "publish",
      apiNamespace: "wp/v2",
    });

    const batch = await runWordPressPublicationBatch(
      {
        config: baseConfig(),
        lifecycle: lifecycle as never,
        publisher,
        prisma: prisma as never,
      },
      {
        contentVersionIds: ["good1", "bad", "good2"],
        limit: 10,
        mode: "publish",
      },
    );
    expect(batch.attempted).toBe(3);
    expect(batch.published).toBe(2);
    expect(batch.failed).toBe(1);
    expect(batch.skipped).toBe(0);
  });
});
