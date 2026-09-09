import { describe, expect, it, vi } from "vitest";
import {
  WordPressApiPublisher,
  WordPressPublisherError,
  createWordPressPublisherFromConfig,
} from "./wordpress-api-publisher.js";

describe("WordPressApiPublisher mock mode", () => {
  it("prepare / publish / getStatus are deterministic by contentVersionId", async () => {
    const pub = createWordPressPublisherFromConfig({
      wordpressMode: "mock",
      wordpressAllowExternalRequests: false,
      wordpressAllowDirectPublish: true,
      wordpressDefaultPublishMode: "publish",
      wordpressApiNamespace: "wp/v2",
    });

    const prepared = await pub.prepare({
      contentVersionId: "cv_test_1",
      title: "タイトル",
      body: "<p>本文</p>",
      metadata: { mode: "publish", idempotencyKey: "wp:cv_test_1:publish" },
    });
    const a = await pub.publish({ prepared });
    const b = await pub.publish({ prepared });
    expect(a.externalId).toBe(b.externalId);
    expect(a.url).toContain("wordpress/posts/");
    expect(a.status).toBe("PUBLISHED");

    const status = await pub.getStatus(a.externalId);
    expect(status.status).toBe("PUBLISHED");
    expect(status.url).toBe(a.url);
  });

  it("createDraft uses distinct id space from publish", async () => {
    const pub = new WordPressApiPublisher({
      mode: "mock",
      allowExternal: false,
      allowDirectPublish: false,
      defaultPublishMode: "draft",
      apiNamespace: "wp/v2",
    });
    const prepared = await pub.prepare({
      contentVersionId: "cv_draft",
      title: "t",
      body: "b",
      metadata: { mode: "draft" },
    });
    const draft = await pub.createDraft!({ prepared });
    expect(draft.status).toBe("DRAFT");
    expect(draft.externalId).toContain("draft");
  });

  it("mode=future wins over defaultPublishMode=draft", async () => {
    const pub = new WordPressApiPublisher({
      mode: "mock",
      allowExternal: false,
      allowDirectPublish: false,
      defaultPublishMode: "draft",
      apiNamespace: "wp/v2",
    });
    const prepared = await pub.prepare({
      contentVersionId: "cv_future",
      title: "future",
      body: "body",
      metadata: {
        mode: "future",
        status: "future",
        wpStatus: "future",
        wpDate: "2026-09-10T21:00:00",
        wpDateGmt: "2026-09-10T12:00:00",
      },
    });
    const result = await pub.publish({ prepared });
    expect(result.responseSummary).toMatchObject({ action: "schedule", wpStatus: "future" });
    expect(result.status).toBe("DRAFT"); // internal map of WP future
  });

  it("update works in mock", async () => {
    const pub = createWordPressPublisherFromConfig({
      wordpressMode: "mock",
      wordpressAllowExternalRequests: false,
      wordpressAllowDirectPublish: true,
      wordpressDefaultPublishMode: "publish",
      wordpressApiNamespace: "wp/v2",
    });
    const prepared = await pub.prepare({
      contentVersionId: "cv_u",
      title: "t2",
      body: "b2",
    });
    const updated = await pub.update!({ externalId: "99", prepared });
    expect(updated.externalId).toBe("99");
    expect(updated.status).toBe("UPDATED");
  });
});

describe("WordPressApiPublisher api guards", () => {
  it("refuses publish when external disabled", async () => {
    const pub = createWordPressPublisherFromConfig({
      wordpressMode: "api",
      wordpressAllowExternalRequests: false,
      wordpressAllowDirectPublish: true,
      wordpressDefaultPublishMode: "publish",
      wordpressBaseUrl: "https://example.invalid",
      wordpressUsername: "u",
      wordpressApplicationPassword: "p",
      wordpressApiNamespace: "wp/v2",
    });
    const prepared = await pub.prepare({
      contentVersionId: "cv",
      title: "t",
      body: "b",
      metadata: { mode: "publish" },
    });
    await expect(pub.publish({ prepared })).rejects.toBeInstanceOf(WordPressPublisherError);
  });

  it("posts to REST with Basic auth (fetch replay)", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: 42,
          link: "https://example.invalid/2026/08/hello/",
          status: "publish",
          slug: "hello",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    };

    const pub = createWordPressPublisherFromConfig({
      wordpressMode: "api",
      wordpressAllowExternalRequests: true,
      wordpressAllowDirectPublish: true,
      wordpressDefaultPublishMode: "publish",
      wordpressBaseUrl: "https://example.invalid",
      wordpressUsername: "editor",
      wordpressApplicationPassword: "xxxx xxxx xxxx xxxx",
      wordpressApiNamespace: "wp/v2",
      fetchImpl,
    });

    const prepared = await pub.prepare({
      contentVersionId: "cv_live",
      title: "Hello",
      body: "<p>body</p>",
      metadata: { mode: "publish", excerpt: "ex", slug: "hello" },
    });
    const result = await pub.publish({ prepared });
    expect(result.externalId).toBe("42");
    expect(result.url).toBe("https://example.invalid/2026/08/hello/");
    expect(result.status).toBe("PUBLISHED");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.invalid/wp-json/wp/v2/posts");
    const auth = new Headers(calls[0]!.init.headers).get("authorization");
    expect(auth?.startsWith("Basic ")).toBe(true);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      title: "Hello",
      content: "<p>body</p>",
      status: "publish",
      excerpt: "ex",
      slug: "hello",
    });
  });

  it("update hits /posts/{id}", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: 7, link: "https://example.invalid/p/7", status: "publish" }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const pub = createWordPressPublisherFromConfig({
      wordpressMode: "api",
      wordpressAllowExternalRequests: true,
      wordpressAllowDirectPublish: true,
      wordpressDefaultPublishMode: "publish",
      wordpressBaseUrl: "https://example.invalid/",
      wordpressUsername: "u",
      wordpressApplicationPassword: "pass",
      wordpressApiNamespace: "wp/v2",
      fetchImpl,
    });
    const prepared = await pub.prepare({
      contentVersionId: "cv",
      title: "t",
      body: "b",
    });
    await pub.update!({ externalId: "7", prepared });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/wp-json/wp/v2/posts/7");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    // Default update must not promote to publish without explicit mode=publish.
    expect(body.status).toBe("draft");
  });
});
