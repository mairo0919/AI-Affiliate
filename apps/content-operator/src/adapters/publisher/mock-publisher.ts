import { createHash } from "node:crypto";
import type { PublicationPlatform } from "@ai-affiliate/database";
import type {
  PublisherAdapter,
  PublisherCapabilities,
  PublisherPrepareInput,
  PublisherPrepareResult,
  PublisherPublishInput,
  PublisherPublishResult,
  PublisherStatusResult,
  PublisherValidateInput,
} from "../types.js";

/**
 * Deterministic Mock publisher.
 * Same platform + draft flag + idempotency key → same externalId.
 * Different PublicationTarget / ContentVersion → different externalId.
 */
export class MockPublisher implements PublisherAdapter {
  readonly platform: PublicationPlatform;
  readonly capabilities: PublisherCapabilities;

  private readonly statuses = new Map<string, PublisherStatusResult>();

  constructor(platform: PublicationPlatform) {
    if (platform !== "BLOGGER" && platform !== "X") {
      throw new Error(`MockPublisher only supports BLOGGER and X, got ${platform}`);
    }
    this.platform = platform;
    this.capabilities = {
      longForm: platform === "BLOGGER",
      shortForm: platform === "X",
      thread: platform === "X",
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
      throw new Error(`prepare validation failed: ${validation.errors.join(", ")}`);
    }
    return {
      payload: {
        platform: this.platform,
        contentVersionId: input.contentVersionId,
        title: input.title,
        body: input.body,
        targetFormat: input.targetFormat ?? null,
        destinationRef: input.destinationRef ?? null,
        metadata: input.metadata ?? {},
      },
      warnings: [],
    };
  }

  async publish(input: PublisherPublishInput): Promise<PublisherPublishResult> {
    const meta =
      input.prepared.payload.metadata && typeof input.prepared.payload.metadata === "object"
        ? (input.prepared.payload.metadata as Record<string, unknown>)
        : {};
    const asDraft = meta.mode === "draft";
    const externalId = this.externalIdFor(input.prepared, asDraft);
    const path = this.platform === "BLOGGER" ? (asDraft ? "drafts" : "posts") : "status";
    const url = `https://example.invalid/${this.platform.toLowerCase()}/${path}/${externalId}`;
    const status = asDraft ? "DRAFT" : "PUBLISHED";
    const result: PublisherPublishResult = {
      externalId,
      url,
      status,
      responseSummary: {
        mock: true,
        mode: asDraft ? "draft" : "publish",
        destinationRef: input.destinationRef ?? null,
        title: input.prepared.payload.title,
        body: input.prepared.payload.body,
        seo: (input.prepared.payload.metadata as Record<string, unknown> | undefined)?.seo ?? null,
      },
    };
    this.statuses.set(externalId, {
      externalId,
      status,
      url,
    });
    return result;
  }

  async update(input: {
    externalId: string;
    prepared: PublisherPrepareResult;
  }): Promise<PublisherPublishResult> {
    const path = this.platform === "BLOGGER" ? "posts" : "status";
    const url = `https://example.invalid/${this.platform.toLowerCase()}/${path}/${input.externalId}`;
    const result: PublisherPublishResult = {
      externalId: input.externalId,
      url,
      status: "UPDATED",
      responseSummary: {
        mock: true,
        updated: true,
        title: input.prepared.payload.title,
        body: input.prepared.payload.body,
      },
    };
    this.statuses.set(input.externalId, {
      externalId: input.externalId,
      status: "UPDATED",
      url,
    });
    return result;
  }

  async createDraft(input: {
    prepared: PublisherPrepareResult;
    destinationRef?: string | null;
  }): Promise<PublisherPublishResult> {
    return this.publish({
      prepared: {
        ...input.prepared,
        payload: {
          ...input.prepared.payload,
          metadata: {
            ...((input.prepared.payload.metadata as Record<string, unknown> | undefined) ?? {}),
            mode: "draft",
          },
        },
      },
      destinationRef: input.destinationRef,
    });
  }

  async delete(externalId: string): Promise<{ ok: boolean }> {
    this.statuses.delete(externalId);
    return { ok: true };
  }

  async getStatus(externalId: string): Promise<PublisherStatusResult> {
    const existing = this.statuses.get(externalId);
    if (!existing) {
      return { externalId, status: "UNKNOWN", url: null };
    }
    return existing;
  }

  /** Exposed for tests */
  computeExternalId(idempotencyKey: string, asDraft = true): string {
    return hashId(this.platform, asDraft, idempotencyKey);
  }

  private externalIdFor(prepared: PublisherPrepareResult, asDraft: boolean): string {
    const meta = (prepared.payload.metadata as Record<string, unknown> | undefined) ?? {};
    let key: string;
    if (typeof meta.idempotencyKey === "string" && meta.idempotencyKey.length > 0) {
      key = meta.idempotencyKey;
    } else if (typeof meta.publicationTargetId === "string" && meta.publicationTargetId.length > 0) {
      key = meta.publicationTargetId;
    } else if (typeof prepared.payload.contentVersionId === "string") {
      key = prepared.payload.contentVersionId;
    } else {
      key = `${String(prepared.payload.title)}:${String(prepared.payload.body).slice(0, 64)}`;
    }
    return hashId(this.platform, asDraft, key);
  }
}

function hashId(platform: PublicationPlatform, asDraft: boolean, key: string): string {
  const digest = createHash("sha256")
    .update(`${platform}|${asDraft ? "draft" : "publish"}|${key}`)
    .digest("hex")
    .slice(0, 16);
  return `mock-${platform.toLowerCase()}-${asDraft ? "draft-" : ""}${digest}`;
}
