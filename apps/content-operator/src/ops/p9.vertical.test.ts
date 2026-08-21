import { describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { createDatabaseClient, LifecycleRepository } from "@ai-affiliate/database";
import { assertSafeOutboundUrl, SsrfBlockedError } from "@ai-affiliate/shared";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";
import { evaluateIntroQuality } from "../generation/intro-quality.js";
import { seedP45Prompts } from "../generation/p45-service.js";
import {
  claimsFromNormalizedPage,
  normalizePublicHtml,
} from "./page-normalize.js";
import { researchPublicUrl } from "./public-url-research.js";
import { buildProductionChecklist } from "./production-checklist.js";
import { runP9MockVertical } from "./p9-vertical.js";
import { buildXExport } from "./x-export.js";
import { createAdminStack } from "../admin/create-admin-stack.js";

loadConfig({ requireDatabaseUrl: false });

const SAMPLE_HTML = `<!doctype html><html><head>
<title>Sample Catalog Item P9T | Store</title>
<meta name="description" content="Public catalog listing for Sample Catalog Item P9T" />
<link rel="canonical" href="https://example.invalid/fanza/p9t" />
</head><body>
<p>メーカー: Test Maker</p>
<p>シリーズ: Test Series</p>
<p>価格: 2,200円</p>
<p>販売中</p>
<a href="https://example.invalid/fanza/p9t-rel">rel</a>
</body></html>`;

describe("P9 page normalize + claims", () => {
  it("normalizes HTML without inventing missing fields", () => {
    const page = normalizePublicHtml({
      html: SAMPLE_HTML,
      sourceUrl: "https://example.invalid/fanza/p9t",
    });
    expect(page.productOrTopicName).toContain("Sample Catalog Item P9T");
    expect(page.makerOrPublisher).toBe("Test Maker");
    expect(page.series).toBe("Test Series");
    expect(page.publiclyConfirmedPrice).toMatch(/2,200/);
    expect(page.performerOrCreator).toBeNull();
    expect(page.normalizedText).not.toContain("<html");
    expect(page.relatedPublicUrls.length).toBeGreaterThan(0);
  });

  it("builds SUPPORTED claims only from observed fields", () => {
    const page = normalizePublicHtml({
      html: SAMPLE_HTML,
      sourceUrl: "https://example.invalid/fanza/p9t",
    });
    const claims = claimsFromNormalizedPage(page);
    expect(claims.every((c) => c.status === "SUPPORTED")).toBe(true);
    expect(claims.some((c) => c.field === "maker")).toBe(true);
    expect(claims.some((c) => c.field === "performer")).toBe(false);
  });
});

describe("P9 intro quality", () => {
  it("flags AI boilerplate openers", () => {
    const bad = evaluateIntroQuality({
      title: "テスト",
      body: "今回は話題の作品をご紹介します。長い前置きです。",
    });
    expect(bad.ok).toBe(false);
    expect(bad.findings.some((f) => f.code === "AI_BOILERPLATE_INTRO")).toBe(true);
  });

  it("accepts direct topic openings", () => {
    const ok = evaluateIntroQuality({
      title: "Sample Catalog Item の公開情報",
      body: "Sample Catalog Item は公開カタログ上で確認できる。\nhttps://example.invalid/fanza/x",
    });
    expect(ok.ok).toBe(true);
  });
});

describe("P9 Mock Blogger IDs", () => {
  it("is deterministic per idempotency key and unique across targets", () => {
    const mock = new MockPublisher("BLOGGER");
    const a = mock.computeExternalId("blogger-draft:t1");
    const a2 = mock.computeExternalId("blogger-draft:t1");
    const b = mock.computeExternalId("blogger-draft:t2");
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });
});

describe("P9 X export reply rules", () => {
  it("keeps reply null when within 140", () => {
    const body = "短い本文です https://example.invalid/b";
    const exported = buildXExport({
      contentId: "c1",
      version: {
        id: "v1",
        title: "t",
        body,
      } as never,
    });
    expect(exported.characterCount).toBeLessThanOrEqual(140);
    expect(exported.reply).toBeNull();
  });

  it("creates reply when over 140 fullwidth chars", () => {
    const body = `${"あ".repeat(150)} 追加事実あり`;
    const exported = buildXExport({
      contentId: "c1",
      version: {
        id: "v1",
        title: "t",
        body,
      } as never,
    });
    expect(exported.mainPost.length).toBeLessThanOrEqual(140);
    expect(exported.reply).toBeTruthy();
  });
});

describe("P9 research + review reuse + vertical", () => {
  it("researches from mock HTML without network", async () => {
    const stack = await createAdminStack({ forceMockAdapters: true });
    try {
      const result = await researchPublicUrl({
        config: stack.config,
        repo: stack.lifecycleRepo,
        lifecycle: stack.lifecycle,
        options: {
          url: "https://example.invalid/fanza/p9-research",
          confirmExternal: true,
          mockHtml: SAMPLE_HTML,
        },
      });
      expect(result.claims.length).toBeGreaterThan(0);
      expect(result.seed.normalizedText.includes("<script")).toBe(false);
      expect(result.productHint?.providerKey).toBe("fanza");
    } finally {
      await stack.disconnect();
    }
  }, 60_000);

  it("rejects research fetch without confirm/allow", async () => {
    const stack = await createAdminStack({ forceMockAdapters: true });
    try {
      await expect(
        researchPublicUrl({
          config: { ...stack.config, researchAllowExternalRequests: false },
          repo: stack.lifecycleRepo,
          lifecycle: stack.lifecycle,
          options: {
            url: "https://example.invalid/fanza/x",
            confirmExternal: false,
          },
        }),
      ).rejects.toThrow(/External research fetch denied/);
      expect(() => assertSafeOutboundUrl("http://127.0.0.1/x")).toThrow(SsrfBlockedError);
    } finally {
      await stack.disconnect();
    }
  }, 30_000);

  it("reuses LLM reviews when body and prompt unchanged", async () => {
    const database = createDatabaseClient();
    await database.connect();
    try {
      const repo = new LifecycleRepository(database.prisma);
      await seedP45Prompts(repo);
      const content = await repo.createContent({ status: "DRAFT" });
      const version = await repo.createContentVersion({
        contentId: content.id,
        versionNumber: 1,
        title: "Reuse Review Fixture",
        body: "十分な長さの本文です。https://example.invalid/p アフィリエイト広告を含む場合があります。確認できる事実だけを書きます。",
        status: "REVIEWING",
      });
      const generation = new ContentGenerationService(repo, new MockLLMProvider(), {
        generation: "mock",
        review: "mock",
        revision: "mock",
      });
      const first = await generation.runQualityReviews(version.id);
      const second = await generation.runQualityReviews(version.id);
      expect(first.newLlmReviewCount).toBeGreaterThan(0);
      expect(second.reusedCount).toBeGreaterThan(0);
      expect(second.newLlmReviewCount).toBe(0);
    } finally {
      await database.disconnect();
    }
  }, 60_000);

  it("invalidates review reuse when body changes", async () => {
    const database = createDatabaseClient();
    await database.connect();
    try {
      const repo = new LifecycleRepository(database.prisma);
      await seedP45Prompts(repo);
      const content = await repo.createContent({ status: "DRAFT" });
      const version = await repo.createContentVersion({
        contentId: content.id,
        versionNumber: 1,
        title: "Invalidate Review Fixture",
        body: "初版本文です。https://example.invalid/p アフィリエイト広告を含む場合があります。",
        status: "REVIEWING",
      });
      const generation = new ContentGenerationService(repo, new MockLLMProvider(), {
        generation: "mock",
        review: "mock",
        revision: "mock",
      });
      await generation.runQualityReviews(version.id);
      await database.prisma.contentVersion.update({
        where: { id: version.id },
        data: {
          body: "改訂本文です。https://example.invalid/p アフィリエイト広告を含む場合があります。追加事実。",
        },
      });
      const again = await generation.runQualityReviews(version.id);
      expect(again.newLlmReviewCount).toBeGreaterThan(0);
    } finally {
      await database.disconnect();
    }
  }, 60_000);

  it("blocks draft when checklist has BLOCKED items", async () => {
    const stack = await createAdminStack({ forceMockAdapters: true });
    try {
      const checklist = await buildProductionChecklist({
        config: {
          ...stack.config,
          bloggerAllowDirectPublish: true,
          bloggerDefaultPublishMode: "publish",
        },
        adminRepo: stack.adminRepo,
        lifecycleRepo: stack.lifecycleRepo,
        p6: stack.p6,
        dbConnected: true,
      });
      expect(checklist.blocked).toBe(true);
      expect(checklist.items.some((i) => i.key === "direct_publish_disabled" && i.status === "BLOCKED")).toBe(
        true,
      );
    } finally {
      await stack.disconnect();
    }
  }, 30_000);

  it("runs P9 mock vertical", async () => {
    const summary = await runP9MockVertical();
    expect(summary.originalBodyUnchanged).toBe(true);
    expect(summary.affiliateApiRequired).toBe(false);
    expect(summary.mockIdsUnique).toBe(true);
    expect(summary.reviewReusedCount).toBeGreaterThan(0);
    expect(Number(summary.xExportChars)).toBeLessThanOrEqual(140);
    expect(summary.bloggerDraftId).toBeTruthy();
    expect(summary.introOk).toBe(true);
  }, 180_000);
});
