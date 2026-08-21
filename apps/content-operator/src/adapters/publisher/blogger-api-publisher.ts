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

export interface BloggerApiPublisherConfig {
  mode: "mock" | "api";
  allowExternal: boolean;
  allowDirectPublish: boolean;
  defaultPublishMode: "draft" | "publish";
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  blogId?: string;
  apiBaseUrl: string;
  tokenUrl: string;
  fetchImpl?: typeof fetch;
}

export class BloggerPublisherError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "BloggerPublisherError";
  }
}

/**
 * Real Google Blogger API publisher.
 * Defaults to refusing external calls unless mode=api and credentials + allow flags are set.
 * Direct publish is disabled unless BLOGGER_ALLOW_DIRECT_PUBLISH=true.
 */
export class BloggerApiPublisher implements PublisherAdapter {
  readonly platform: PublicationPlatform = "BLOGGER";
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

  private accessToken: string | null = null;
  private readonly drafts = new Map<string, PublisherStatusResult>();
  private seq = 0;

  constructor(private readonly config: BloggerApiPublisherConfig) {}

  assertCanCallApi(action: "createDraft" | "publish" | "update" | "delete" | "getStatus"): void {
    if (this.config.mode !== "api") {
      throw new BloggerPublisherError(
        "BLOGGER_MODE is not api (use mock publisher or set BLOGGER_MODE=api)",
        "MODE_NOT_API",
      );
    }
    if (!this.config.allowExternal) {
      throw new BloggerPublisherError(
        "BLOGGER_ALLOW_EXTERNAL_REQUESTS must be true",
        "EXTERNAL_DISABLED",
      );
    }
    if (action === "publish" && !this.config.allowDirectPublish) {
      throw new BloggerPublisherError(
        "Direct Blogger publish is disabled (BLOGGER_ALLOW_DIRECT_PUBLISH=false). Use createDraft.",
        "DIRECT_PUBLISH_DISABLED",
      );
    }
    const missing: string[] = [];
    if (!this.config.clientId) missing.push("BLOGGER_CLIENT_ID");
    if (!this.config.clientSecret) missing.push("BLOGGER_CLIENT_SECRET");
    if (!this.config.refreshToken) missing.push("BLOGGER_REFRESH_TOKEN");
    if (!this.config.blogId) missing.push("BLOGGER_BLOG_ID");
    if (missing.length > 0) {
      throw new BloggerPublisherError(
        `Missing Blogger credentials: ${missing.join(", ")}`,
        "MISSING_CREDENTIALS",
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
      throw new BloggerPublisherError(validation.errors.join(", "), "VALIDATION_FAILED");
    }
    return {
      payload: {
        platform: "BLOGGER",
        contentVersionId: input.contentVersionId,
        title: input.title,
        body: input.body,
        targetFormat: input.targetFormat ?? "article",
        destinationRef: input.destinationRef ?? this.config.blogId ?? null,
        metadata: input.metadata ?? {},
      },
      warnings: [],
    };
  }

  async createDraft(input: PublisherDraftInput): Promise<PublisherPublishResult> {
    this.assertCanCallApi("createDraft");
    return this.postOrDraft(input, true);
  }

  async publish(input: PublisherPublishInput): Promise<PublisherPublishResult> {
    const asDraft =
      this.config.defaultPublishMode === "draft" ||
      (input.prepared.payload.metadata as Record<string, unknown> | undefined)?.mode === "draft";
    if (asDraft) {
      return this.createDraft(input);
    }
    this.assertCanCallApi("publish");
    return this.postOrDraft(input, false);
  }

  async update(input: PublisherUpdateInput): Promise<PublisherPublishResult> {
    this.assertCanCallApi("update");
    const token = await this.getAccessToken();
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const blogId = this.config.blogId!;
    const response = await fetchImpl(
      `${this.config.apiBaseUrl}/blogs/${blogId}/posts/${input.externalId}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "blogger#post",
          id: input.externalId,
          title: input.prepared.payload.title,
          content: input.prepared.payload.body,
        }),
      },
    );
    if (!response.ok) {
      throw new BloggerPublisherError(`Blogger update failed (${response.status})`, "UPDATE_FAILED");
    }
    const json = (await response.json()) as { id?: string; url?: string; status?: string };
    return {
      externalId: json.id ?? input.externalId,
      url: json.url ?? "",
      status: json.status ?? "LIVE",
      responseSummary: { bloggerMode: "api", action: "update" },
    };
  }

  async delete(externalId: string): Promise<{ ok: boolean }> {
    this.assertCanCallApi("delete");
    const token = await this.getAccessToken();
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const response = await fetchImpl(
      `${this.config.apiBaseUrl}/blogs/${this.config.blogId}/posts/${externalId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok && response.status !== 204) {
      throw new BloggerPublisherError(`Blogger delete failed (${response.status})`, "DELETE_FAILED");
    }
    return { ok: true };
  }

  async getStatus(externalId: string): Promise<PublisherStatusResult> {
    if (this.config.mode !== "api") {
      return this.drafts.get(externalId) ?? { externalId, status: "UNKNOWN", url: null };
    }
    this.assertCanCallApi("getStatus");
    const token = await this.getAccessToken();
    const fetchImpl = this.config.fetchImpl ?? fetch;
    // Draft posts are invisible without view=AUTHOR (public GET returns 404).
    const response = await fetchImpl(
      `${this.config.apiBaseUrl}/blogs/${this.config.blogId}/posts/${externalId}?view=AUTHOR`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      return { externalId, status: "UNKNOWN", url: null };
    }
    const json = (await response.json()) as { id?: string; url?: string; status?: string };
    return {
      externalId: json.id ?? externalId,
      status: json.status ?? "UNKNOWN",
      url: json.url ?? null,
    };
  }

  private async postOrDraft(
    input: PublisherDraftInput | PublisherPublishInput,
    isDraft: boolean,
  ): Promise<PublisherPublishResult> {
    const token = await this.getAccessToken();
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const blogId = this.config.blogId!;
    const path = isDraft
      ? `${this.config.apiBaseUrl}/blogs/${blogId}/posts?isDraft=true`
      : `${this.config.apiBaseUrl}/blogs/${blogId}/posts`;
    const response = await fetchImpl(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "blogger#post",
        title: input.prepared.payload.title,
        content: input.prepared.payload.body,
      }),
    });
    if (!response.ok) {
      throw new BloggerPublisherError(
        `Blogger ${isDraft ? "draft" : "publish"} failed (${response.status})`,
        "CREATE_FAILED",
      );
    }
    const json = (await response.json()) as { id?: string; url?: string; status?: string };
    const result: PublisherPublishResult = {
      externalId: json.id ?? `blogger-${++this.seq}`,
      url: json.url ?? "",
      status: isDraft ? "DRAFT" : (json.status ?? "LIVE"),
      responseSummary: {
        bloggerMode: "api",
        action: isDraft ? "createDraft" : "publish",
        // never include tokens
      },
    };
    this.drafts.set(result.externalId, {
      externalId: result.externalId,
      status: result.status,
      url: result.url,
    });
    return result;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const body = new URLSearchParams({
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      refresh_token: this.config.refreshToken!,
      grant_type: "refresh_token",
    });
    const response = await fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      // Surface Google OAuth error codes only (never tokens / secrets).
      let detail = `http=${response.status}`;
      try {
        const errJson = (await response.json()) as {
          error?: string;
          error_description?: string;
        };
        const parts = [errJson.error, errJson.error_description].filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        if (parts.length > 0) detail = parts.join(": ");
      } catch {
        // ignore parse failures
      }
      throw new BloggerPublisherError(
        `Failed to refresh Blogger access token (${detail})`,
        "TOKEN_REFRESH_FAILED",
      );
    }
    const json = (await response.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new BloggerPublisherError("Token response missing access_token", "TOKEN_MISSING");
    }
    this.accessToken = json.access_token;
    return this.accessToken;
  }
}

export function createBloggerPublisherFromConfig(config: {
  bloggerMode: "mock" | "api";
  bloggerAllowExternalRequests: boolean;
  bloggerAllowDirectPublish: boolean;
  bloggerDefaultPublishMode: "draft" | "publish";
  bloggerClientId?: string;
  bloggerClientSecret?: string;
  bloggerRefreshToken?: string;
  bloggerBlogId?: string;
  bloggerApiBaseUrl: string;
  bloggerOAuthTokenUrl: string;
}): BloggerApiPublisher {
  return new BloggerApiPublisher({
    mode: config.bloggerMode,
    allowExternal: config.bloggerAllowExternalRequests,
    allowDirectPublish: config.bloggerAllowDirectPublish,
    defaultPublishMode: config.bloggerDefaultPublishMode,
    clientId: config.bloggerClientId,
    clientSecret: config.bloggerClientSecret,
    refreshToken: config.bloggerRefreshToken,
    blogId: config.bloggerBlogId,
    apiBaseUrl: config.bloggerApiBaseUrl,
    tokenUrl: config.bloggerOAuthTokenUrl,
  });
}
