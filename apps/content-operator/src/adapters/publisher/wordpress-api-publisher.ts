import { createHash } from "node:crypto";
import type { PublicationPlatform } from "@ai-affiliate/database";
import type {
  PublisherAdapter,
  PublisherCapabilities,
  PublisherDraftInput,
  PublisherPrepareInput,
  PublisherPrepareResult,
  PublisherPublishInput,
  PublisherPublishResult,
  PublisherStatusResult,
  PublisherUpdateInput,
  PublisherValidateInput,
} from "../types.js";

export interface WordPressApiPublisherConfig {
  mode: "mock" | "api";
  allowExternal: boolean;
  allowDirectPublish: boolean;
  defaultPublishMode: "draft" | "publish";
  baseUrl?: string;
  username?: string;
  applicationPassword?: string;
  apiNamespace: string;
  fetchImpl?: typeof fetch;
}

export class WordPressPublisherError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "WordPressPublisherError";
  }
}

type WpPostJson = {
  id?: number;
  link?: string;
  status?: string;
  slug?: string;
  message?: string;
  code?: string;
};

/**
 * WordPress REST API publisher (Application Password over HTTPS).
 * Defaults refuse external calls unless mode=api + allow flags + credentials.
 * Direct publish requires WORDPRESS_ALLOW_DIRECT_PUBLISH=true.
 */
export class WordPressApiPublisher implements PublisherAdapter {
  readonly platform: PublicationPlatform = "WORDPRESS";
  readonly capabilities: PublisherCapabilities = {
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
  };

  private readonly statuses = new Map<string, PublisherStatusResult>();
  private seq = 0;

  constructor(private readonly config: WordPressApiPublisherConfig) {}

  assertCanCallApi(action: "createDraft" | "publish" | "update" | "delete" | "getStatus"): void {
    if (this.config.mode !== "api") {
      throw new WordPressPublisherError(
        "WORDPRESS_MODE is not api (use mock or set WORDPRESS_MODE=api)",
        "MODE_NOT_API",
      );
    }
    if (!this.config.allowExternal) {
      throw new WordPressPublisherError(
        "WORDPRESS_ALLOW_EXTERNAL_REQUESTS must be true",
        "EXTERNAL_DISABLED",
      );
    }
    if (action === "publish" && !this.config.allowDirectPublish) {
      throw new WordPressPublisherError(
        "WORDPRESS_ALLOW_DIRECT_PUBLISH must be true for live publish",
        "DIRECT_PUBLISH_DISABLED",
      );
    }
    if (!this.config.baseUrl?.trim()) {
      throw new WordPressPublisherError("WORDPRESS_BASE_URL is required", "BASE_URL_MISSING");
    }
    if (!this.config.username?.trim() || !this.config.applicationPassword?.trim()) {
      throw new WordPressPublisherError(
        "WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD are required",
        "CREDENTIALS_MISSING",
      );
    }
  }

  async validate(input: PublisherValidateInput): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!input.title.trim()) errors.push("title is required");
    if (!input.body.trim()) errors.push("body is required");
    return { ok: errors.length === 0, errors };
  }

  async prepare(input: PublisherPrepareInput): Promise<PublisherPrepareResult> {
    const validation = await this.validate(input);
    if (!validation.ok) {
      throw new WordPressPublisherError(validation.errors.join(", "), "VALIDATION_FAILED");
    }
    return {
      payload: {
        platform: "WORDPRESS",
        contentVersionId: input.contentVersionId,
        title: input.title,
        body: input.body,
        targetFormat: input.targetFormat ?? "article",
        destinationRef: input.destinationRef ?? this.config.baseUrl ?? null,
        metadata: input.metadata ?? {},
      },
      warnings: [],
    };
  }

  async createDraft(input: PublisherDraftInput): Promise<PublisherPublishResult> {
    if (this.config.mode === "mock") {
      return this.mockCreate(input, true);
    }
    this.assertCanCallApi("createDraft");
    return this.createOrUpdatePost(input, { status: "draft" });
  }

  async publish(input: PublisherPublishInput): Promise<PublisherPublishResult> {
    const meta = asRecord(input.prepared.payload.metadata);
    const asDraft =
      this.config.defaultPublishMode === "draft" ||
      meta.mode === "draft" ||
      meta.status === "draft";
    if (asDraft) {
      return this.createDraft(input);
    }
    if (this.config.mode === "mock") {
      return this.mockCreate(input, false);
    }
    this.assertCanCallApi("publish");
    return this.createOrUpdatePost(input, { status: "publish" });
  }

  async update(input: PublisherUpdateInput): Promise<PublisherPublishResult> {
    if (this.config.mode === "mock") {
      const url = `https://example.invalid/wordpress/posts/${input.externalId}`;
      const result: PublisherPublishResult = {
        externalId: input.externalId,
        url,
        status: "UPDATED",
        responseSummary: { wordpressMode: "mock", action: "update" },
      };
      this.statuses.set(input.externalId, {
        externalId: input.externalId,
        status: "UPDATED",
        url,
      });
      return result;
    }
    this.assertCanCallApi("update");
    return this.createOrUpdatePost(
      { prepared: input.prepared },
      { status: "publish", externalId: input.externalId },
    );
  }

  async delete(externalId: string): Promise<{ ok: boolean }> {
    if (this.config.mode === "mock") {
      this.statuses.delete(externalId);
      return { ok: true };
    }
    this.assertCanCallApi("delete");
    const response = await this.request(`/posts/${externalId}?force=true`, { method: "DELETE" });
    if (!response.ok && response.status !== 200 && response.status !== 410) {
      throw new WordPressPublisherError(
        `WordPress delete failed (${response.status})`,
        "DELETE_FAILED",
      );
    }
    this.statuses.delete(externalId);
    return { ok: true };
  }

  async getStatus(externalId: string): Promise<PublisherStatusResult> {
    if (this.config.mode === "mock") {
      return this.statuses.get(externalId) ?? { externalId, status: "UNKNOWN", url: null };
    }
    this.assertCanCallApi("getStatus");
    const response = await this.request(`/posts/${externalId}`, { method: "GET" });
    if (!response.ok) {
      return { externalId, status: "UNKNOWN", url: null };
    }
    const json = (await response.json()) as WpPostJson;
    return {
      externalId: String(json.id ?? externalId),
      status: mapWpStatus(json.status),
      url: json.link ?? null,
    };
  }

  private async createOrUpdatePost(
    input: PublisherDraftInput | PublisherPublishInput,
    opts: { status: "draft" | "publish"; externalId?: string },
  ): Promise<PublisherPublishResult> {
    const title = String(input.prepared.payload.title ?? "");
    const content = String(input.prepared.payload.body ?? "");
    const meta = asRecord(input.prepared.payload.metadata);
    const excerpt =
      typeof meta.excerpt === "string"
        ? meta.excerpt
        : typeof meta.summary === "string"
          ? meta.summary
          : undefined;
    const slug = typeof meta.slug === "string" && meta.slug.trim() ? meta.slug.trim() : undefined;

    const body: Record<string, unknown> = {
      title,
      content,
      status: opts.status,
    };
    if (excerpt) body.excerpt = excerpt;
    if (slug) body.slug = slug;

    const path = opts.externalId ? `/posts/${opts.externalId}` : "/posts";
    const method = opts.externalId ? "POST" : "POST";
    const response = await this.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await safeWpError(response);
      throw new WordPressPublisherError(
        `WordPress ${opts.externalId ? "update" : "create"} failed (${response.status}): ${err}`,
        opts.externalId ? "UPDATE_FAILED" : "CREATE_FAILED",
      );
    }
    const json = (await response.json()) as WpPostJson;
    const externalId = String(json.id ?? opts.externalId ?? `wp-${++this.seq}`);
    const result: PublisherPublishResult = {
      externalId,
      url: json.link ?? "",
      status: mapWpStatus(json.status ?? opts.status),
      responseSummary: {
        wordpressMode: "api",
        action: opts.externalId ? "update" : opts.status === "draft" ? "createDraft" : "publish",
        wpStatus: json.status ?? opts.status,
        slug: json.slug ?? slug ?? null,
      },
    };
    this.statuses.set(result.externalId, {
      externalId: result.externalId,
      status: result.status,
      url: result.url,
    });
    return result;
  }

  private mockCreate(
    input: PublisherDraftInput | PublisherPublishInput,
    isDraft: boolean,
  ): PublisherPublishResult {
    const meta = asRecord(input.prepared.payload.metadata);
    const key =
      (typeof meta.idempotencyKey === "string" && meta.idempotencyKey) ||
      (typeof input.prepared.payload.contentVersionId === "string" &&
        input.prepared.payload.contentVersionId) ||
      `${String(input.prepared.payload.title)}:${String(input.prepared.payload.body).slice(0, 64)}`;
    const digest = createHash("sha256")
      .update(`WORDPRESS|${isDraft ? "draft" : "publish"}|${key}`)
      .digest("hex")
      .slice(0, 16);
    const externalId = `mock-wordpress-${isDraft ? "draft-" : ""}${digest}`;
    const url = `https://example.invalid/wordpress/${isDraft ? "drafts" : "posts"}/${externalId}`;
    const status = isDraft ? "DRAFT" : "PUBLISHED";
    const result: PublisherPublishResult = {
      externalId,
      url,
      status,
      responseSummary: {
        wordpressMode: "mock",
        action: isDraft ? "createDraft" : "publish",
      },
    };
    this.statuses.set(externalId, { externalId, status, url });
    return result;
  }

  private postsBaseUrl(): string {
    const base = this.config.baseUrl!.replace(/\/+$/, "");
    const ns = this.config.apiNamespace.replace(/^\/+|\/+$/g, "");
    return `${base}/wp-json/${ns}`;
  }

  private authHeader(): string {
    const user = this.config.username!;
    const pass = this.config.applicationPassword!.replace(/\s+/g, "");
    const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const url = `${this.postsBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers);
    headers.set("authorization", this.authHeader());
    return fetchImpl(url, { ...init, headers });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapWpStatus(status: string | undefined): string {
  if (!status) return "UNKNOWN";
  if (status === "publish") return "PUBLISHED";
  if (status === "draft" || status === "pending" || status === "future") return "DRAFT";
  return status.toUpperCase();
}

async function safeWpError(response: Response): Promise<string> {
  try {
    const j = (await response.json()) as WpPostJson;
    return [j.code, j.message].filter(Boolean).join(": ") || `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

export function createWordPressPublisherFromConfig(config: {
  wordpressMode: "mock" | "api";
  wordpressAllowExternalRequests: boolean;
  wordpressAllowDirectPublish: boolean;
  wordpressDefaultPublishMode: "draft" | "publish";
  wordpressBaseUrl?: string;
  wordpressUsername?: string;
  wordpressApplicationPassword?: string;
  wordpressApiNamespace: string;
  fetchImpl?: typeof fetch;
}): WordPressApiPublisher {
  return new WordPressApiPublisher({
    mode: config.wordpressMode,
    allowExternal: config.wordpressAllowExternalRequests,
    allowDirectPublish: config.wordpressAllowDirectPublish,
    defaultPublishMode: config.wordpressDefaultPublishMode,
    baseUrl: config.wordpressBaseUrl,
    username: config.wordpressUsername,
    applicationPassword: config.wordpressApplicationPassword,
    apiNamespace: config.wordpressApiNamespace,
    fetchImpl: config.fetchImpl,
  });
}

export function wordpressCredentialsPresent(config: {
  wordpressBaseUrl?: string;
  wordpressUsername?: string;
  wordpressApplicationPassword?: string;
}): boolean {
  return Boolean(
    config.wordpressBaseUrl?.trim() &&
      config.wordpressUsername?.trim() &&
      config.wordpressApplicationPassword?.trim(),
  );
}
