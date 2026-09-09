import type { AppConfig } from "@ai-affiliate/config";
import type {
  ContentVersion,
  LifecycleRepository,
  PublicationTarget,
} from "@ai-affiliate/database";
import type { LLMProvider, PublisherAdapter } from "../adapters/types.js";
import { MockPublisher } from "../adapters/publisher/mock-publisher.js";
import {
  BloggerApiPublisher,
  BloggerPublisherError,
  createBloggerPublisherFromConfig,
} from "../adapters/publisher/blogger-api-publisher.js";
import { createLLMProvider } from "../adapters/llm/create-llm-provider.js";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { OpsService } from "../ops/ops-service.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { createAffiliateProviderFromConfig } from "../adapters/affiliate/create-affiliate-provider.js";
import { NoopNotificationAdapter } from "../adapters/types.js";
import { buildXExport } from "../ops/x-export.js";
import { formatBloggerHtml } from "./blogger-formatter.js";
import { ContentGenerationService } from "./content-generation-service.js";
import { parseBloggerArticle } from "./structured-article.js";

export interface P45SafetyCheck {
  ok: boolean;
  errors: string[];
}

export class P45ContentService {
  readonly generation: ContentGenerationService;
  readonly blogger: PublisherAdapter;
  readonly llm: LLMProvider;
  readonly usingMockLlm: boolean;
  readonly usingMockBlogger: boolean;
  private readonly assertDraftAllowed?: () => Promise<string[]>;

  constructor(
    private readonly repo: LifecycleRepository,
    private readonly config: AppConfig,
    private readonly lifecycle: ContentLifecycleService,
    options?: {
      llm?: LLMProvider;
      blogger?: PublisherAdapter;
      /** Return blocking reasons; empty = allowed */
      assertDraftAllowed?: () => Promise<string[]>;
    },
  ) {
    this.usingMockLlm = config.llmMode !== "api" || !config.llmAllowExternalRequests || !config.llmApiKey;
    this.llm = options?.llm ?? (this.usingMockLlm ? new MockLLMProvider() : createLLMProvider(config));
    this.usingMockBlogger = config.bloggerMode !== "api";
    this.blogger =
      options?.blogger ??
      (this.usingMockBlogger
        ? new MockPublisher("BLOGGER")
        : createBloggerPublisherFromConfig(config));
    this.generation = new ContentGenerationService(repo, this.llm, {
      generation: config.llmModelGeneration,
      review: config.llmModelReview,
      revision: config.llmModelRevision,
    });
    this.assertDraftAllowed = options?.assertDraftAllowed;
  }

  checkBloggerDraftSafety(input: {
    contentVersionId: string;
    publicationTargetId: string;
    action: "createDraft" | "publish";
  }): Promise<P45SafetyCheck> {
    return this.evaluateSafety(input);
  }

  private async evaluateSafety(input: {
    contentVersionId: string;
    publicationTargetId: string;
    action: "createDraft" | "publish";
  }): Promise<P45SafetyCheck> {
    const errors: string[] = [];
    const version = await this.repo.findContentVersion(input.contentVersionId);
    const target = await this.repo.findPublicationTarget(input.publicationTargetId);
    if (!version) errors.push("ContentVersion not found");
    if (!target) errors.push("PublicationTarget not found");
    if (target && target.status !== "APPROVED" && target.status !== "SCHEDULED") {
      errors.push(`PublicationTarget must be approved (got ${target.status})`);
    }
    if (version && version.status !== "APPROVED") {
      errors.push(`ContentVersion must be approved (got ${version.status})`);
    }
    if (input.action === "publish" && !this.config.bloggerAllowDirectPublish) {
      errors.push("Direct publish disabled");
    }

    if (version) {
      const policy = await this.lifecycle.evaluatePolicies("ContentVersion", version.id);
      if (policy.overall === "BLOCKED") errors.push("Policy blocked");
      const content = await this.repo.findContent(version.contentId);
      const claims = content?.strategyId
        ? await this.repo.listClaimsForStrategy(content.strategyId)
        : [];
      const supported = claims.filter((c) => c.status === "SUPPORTED");
      if (claims.length > 0 && supported.length === 0) {
        errors.push("No supported claims available");
      }
      const reviews = await this.repo.listReviewsForContentVersion(version.id);
      if (reviews.some((r) => r.result === "FAILED")) {
        errors.push("Quality review failed");
      }
    }

    if (this.config.bloggerMode === "api" && !this.config.bloggerAllowExternalRequests) {
      errors.push("BLOGGER_ALLOW_EXTERNAL_REQUESTS must be true for api mode");
    }

    if (this.assertDraftAllowed) {
      const blocked = await this.assertDraftAllowed();
      for (const reason of blocked) errors.push(reason);
    }

    return { ok: errors.length === 0, errors };
  }

  async prepareBloggerHtml(contentVersionId: string): Promise<{ html: string; title: string }> {
    const version = await this.repo.findContentVersion(contentVersionId);
    if (!version) throw new Error(`ContentVersion not found: ${contentVersionId}`);
    const structured = version.structuredContent as Record<string, unknown> | null;
    const articleRaw = structured?.article;
    if (articleRaw && typeof articleRaw === "object") {
      const article = parseBloggerArticle(articleRaw as Record<string, unknown>);
      return {
        title: article.title,
        html: formatBloggerHtml({
          title: article.title,
          lead: article.lead,
          sections: article.sections,
          cta: article.cta,
        }),
      };
    }
    return {
      title: version.title,
      html: formatBloggerHtml({
        title: version.title,
        lead: version.summary ?? version.title,
        sections: [{ heading: "本文", paragraphs: version.body.split("\n\n").filter(Boolean) }],
        cta: { label: "詳細", url: null },
      }),
    };
  }

  async createBloggerDraft(input: {
    publicationTargetId: string;
    forceApi?: boolean;
  }): Promise<{ target: PublicationTarget; externalId: string; url: string; mode: string }> {
    const target = await this.repo.findPublicationTarget(input.publicationTargetId);
    if (!target) throw new Error(`PublicationTarget not found: ${input.publicationTargetId}`);

    const safety = await this.evaluateSafety({
      contentVersionId: target.contentVersionId,
      publicationTargetId: target.id,
      action: "createDraft",
    });
    if (!safety.ok) {
      throw new Error(`Blogger draft safety check failed: ${safety.errors.join("; ")}`);
    }

    const preparedContent = await this.prepareBloggerHtml(target.contentVersionId);
    const publisher =
      input.forceApi && !this.usingMockBlogger
        ? this.blogger
        : this.usingMockBlogger
          ? this.blogger
          : this.blogger;

    if (!this.usingMockBlogger && publisher instanceof BloggerApiPublisher) {
      try {
        publisher.assertCanCallApi("createDraft");
      } catch (error) {
        if (error instanceof BloggerPublisherError) {
          throw new Error(`${error.message} [${error.code}]`);
        }
        throw error;
      }
    }

    const prepared = await publisher.prepare({
      contentVersionId: target.contentVersionId,
      title: preparedContent.title,
      body: preparedContent.html,
      targetFormat: "article",
      destinationRef: target.destinationRef,
      metadata: {
        mode: "draft",
        bloggerMode: this.usingMockBlogger ? "mock" : "api",
        publicationTargetId: target.id,
        idempotencyKey: `blogger-draft:${target.id}`,
      },
    });

    const result = publisher.createDraft
      ? await publisher.createDraft({ prepared, destinationRef: target.destinationRef })
      : await publisher.publish({ prepared, destinationRef: target.destinationRef });

    await this.repo.createPublicationRecord({
      publicationTargetId: target.id,
      platform: "BLOGGER",
      status: result.status,
      externalId: result.externalId,
      url: result.url,
      responseSummary: {
        ...(result.responseSummary ?? {}),
        bloggerMode: this.usingMockBlogger ? "mock" : "api",
        contentVersionId: target.contentVersionId,
        publicationTargetId: target.id,
        action: "createDraft",
      },
    });

    const updated = await this.repo.updatePublicationTarget(target.id, {
      status: "DRAFT",
      publishedExternalId: result.externalId,
      publishedUrl: result.url,
      publishedAt: new Date(),
      platformMetadata: {
        ...((target.platformMetadata as Record<string, unknown> | null) ?? {}),
        bloggerMode: this.usingMockBlogger ? "mock" : "api",
        draftExternalId: result.externalId,
      },
    });

    return {
      target: updated,
      externalId: result.externalId,
      url: result.url,
      mode: this.usingMockBlogger ? "mock" : "api",
    };
  }

  async updateBloggerDraft(input: {
    externalId: string;
    contentVersionId: string;
  }): Promise<{ externalId: string; url: string; status: string }> {
    const preparedContent = await this.prepareBloggerHtml(input.contentVersionId);
    const prepared = await this.blogger.prepare({
      contentVersionId: input.contentVersionId,
      title: preparedContent.title,
      body: preparedContent.html,
      targetFormat: "article",
      metadata: { mode: "draft", bloggerMode: this.usingMockBlogger ? "mock" : "api" },
    });
    if (!this.blogger.update) {
      throw new Error("Publisher does not support update");
    }
    if (!this.usingMockBlogger && this.blogger instanceof BloggerApiPublisher) {
      this.blogger.assertCanCallApi("update");
    }
    const result = await this.blogger.update({
      externalId: input.externalId,
      prepared,
    });
    return { externalId: result.externalId, url: result.url, status: result.status };
  }

  async deleteBloggerDraft(externalId: string): Promise<{ ok: boolean }> {
    if (!this.blogger.delete) {
      throw new Error("Publisher does not support delete");
    }
    if (!this.usingMockBlogger && this.blogger instanceof BloggerApiPublisher) {
      this.blogger.assertCanCallApi("delete");
    }
    return this.blogger.delete(externalId);
  }

  async runP45MockVertical(): Promise<{
    productId: string;
    strategyId: string;
    claimIds: string[];
    bloggerVersionId: string;
    bloggerContentId: string;
    reviewOverall: string;
    bloggerDraftId: string;
    bloggerDraftUrl: string;
    xExportBody: string;
    modelRunCount: number;
  }> {
    // Ensure prompts exist for this DB
    await seedP45Prompts(this.repo);

    const ops = new OpsService({
      repo: this.repo,
      lifecycle: this.lifecycle,
      publishers: {
        BLOGGER: new MockPublisher("BLOGGER"),
        X: new MockPublisher("X"),
      },
      queueConfig: {
        targetPerDay: this.config.publicationTargetPerDay,
        maximumPerDay: this.config.publicationMaximumPerDay,
        minimumIntervalMinutes: 0,
        pauseWhenNoQualifiedContent: true,
      },
      linkPolicy: {
        preferredAffiliateProvider: this.config.preferredAffiliateProvider,
        futureAspProviders: this.config.linkFutureAspProviders,
      },
    });

    const product = await ops.registerManualProduct({
      providerKey: "fanza",
      externalProductId: "p45-manual-1",
      title: "Sample Catalog Item P45",
      url: "https://example.invalid/fanza/p45-manual-1",
      officialUrl: "https://example.invalid/maker/p45-manual-1",
    });
    const topic = await this.lifecycle.createTopicFromProduct(product.id);
    const strategy = await this.lifecycle.createRuleBasedStrategy(topic.id);
    const research1 = await ops.registerPublicUrlResearch({
      url: "https://example.invalid/notes/p45-1",
      summary: "Sample Catalog Item P45 is listed as available.",
      claimStatement: "松本いちか",
      strategyId: strategy.id,
    });
    const research2 = await ops.registerPublicUrlResearch({
      url: "https://example.invalid/notes/p45-2",
      summary: "The catalog page shows a standard product URL.",
      claimStatement: "激ピストン騎乗位で連続絶頂するシーン",
      strategyId: strategy.id,
    });
    const research3 = await ops.registerPublicUrlResearch({
      url: "https://example.invalid/notes/p45-3",
      summary: "Runtime scale is published on the catalog page.",
      claimStatement: "8時間ベスト",
      strategyId: strategy.id,
    });

    // Mark claims supported (registerFindingAndClaim already sets SUPPORTED)
    const generated = await this.generation.generateBloggerArticle({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: product.title,
      ctaUrl: product.url,
      articleFormat: "new-release",
      claimIds: [research1.claim.id, research2.claim.id, research3.claim.id],
    });

    const review = await this.generation.runQualityReviews(generated.version.id);
    if (review.overall === "failed") {
      throw new Error("P4.5 mock vertical review failed");
    }

    await this.repo.updateContentVersionStatus(generated.version.id, "APPROVED");

    const target = await this.lifecycle.createPublicationTarget({
      contentId: generated.content.id,
      contentVersionId: generated.version.id,
      platform: "BLOGGER",
      approvalMode: "DRAFT_ONLY",
      targetFormat: "article",
    });
    await this.lifecycle.approvePublicationTarget(target.id);
    const draft = await this.createBloggerDraft({ publicationTargetId: target.id });

    const x = await this.generation.generateXPost({
      topicId: topic.id,
      strategyId: strategy.id,
      productTitle: product.title,
      productUrl: product.url,
      bloggerUrl: draft.url ?? null,
      claimIds: [research1.claim.id, research2.claim.id, research3.claim.id],
      fanzaXSiteApproved: this.config.fanzaXSiteApproved === true,
      fanzaService: this.config.fanzaDefaultService,
      fanzaFloor: this.config.fanzaDefaultFloor,
    });
    const xExport = buildXExport({
      contentId: x.content.id,
      version: x.version,
    });

    return {
      productId: product.id,
      strategyId: strategy.id,
      claimIds: [research1.claim.id, research2.claim.id, research3.claim.id],
      bloggerVersionId: generated.version.id,
      bloggerContentId: generated.content.id,
      reviewOverall: review.overall,
      bloggerDraftId: draft.externalId,
      bloggerDraftUrl: draft.url,
      xExportBody: xExport.body,
      modelRunCount: review.reviews.length + 2,
    };
  }
}

export async function seedP45Prompts(repo: LifecycleRepository): Promise<void> {
  const prompts: Array<{
    identifier: string;
    taskType: string;
    body: string;
    systemInstruction: string;
  }> = [
    {
      identifier: "strategy.assist",
      taskType: "STRATEGY",
      body: "Assist strategy for {{productTitle}}",
      systemInstruction: "Help draft strategy fields. Return JSON only.",
    },
    {
      identifier: "blogger.generate",
      taskType: "GENERATION_BLOGGER",
      body: "Generate structured blogger article for {{productTitle}} with CTA {{ctaUrl}}. Use only supported claims: {{supportedClaims}}. Format={{articleFormat}}. Avoid purple prose and unverified superlatives.",
      systemInstruction:
        "Write natural Japanese informational prose for Blogger. Start with the topic in the title or first lines — no long preamble. Forbidden openers: 「今回は〜をご紹介します」「この記事では」「結論から言うと」「すぐに結論です」. Do not invent price/release/cast/ranking/sale facts. Use only supported claims. Distinguish facts vs opinions. Place a natural CTA using the provided product URL (normal store URL is OK; do not imply affiliate commission). Return JSON matching the blogger article schema.",
    },
    {
      identifier: "x.generate",
      taskType: "GENERATION_X",
      body: "Generate an X post for {{productTitle}} using the same research/claims — do NOT summarize a Blogger article. Prefer bloggerUrl={{bloggerUrl}} else productUrl={{productUrl}}. Keep within Japanese weighted 140 chars. Reply only when extra verified fact adds value. No empty「詳しくはこちら」-only posts.",
      systemInstruction:
        "Return JSON {body, reply, usedClaimIds, ctaUrl}. body must fit X weighted 140. reply null unless needed. Never invent unverified claims.",
    },
    {
      identifier: "review.claim",
      taskType: "REVIEW",
      body: "Validate claims in title={{title}} body={{body}}",
      systemInstruction: "Return JSON review result for claim consistency.",
    },
    {
      identifier: "review.factual",
      taskType: "REVIEW",
      body: "Factual review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for factual consistency.",
    },
    {
      identifier: "review.seo",
      taskType: "REVIEW",
      body: "SEO basic review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for basic SEO.",
    },
    {
      identifier: "review.channel-fit",
      taskType: "REVIEW",
      body: "Channel fit review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for Blogger readiness.",
    },
    {
      identifier: "review.adult-policy",
      taskType: "REVIEW",
      body: "Adult policy review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for adult policy compliance.",
    },
    {
      identifier: "review.writing-quality",
      taskType: "REVIEW",
      body: "Writing quality review for {{title}} / {{body}}",
      systemInstruction: "Flag repetitive AI phrasing and empty intros. Return JSON review result.",
    },
    {
      identifier: "revision.partial",
      taskType: "REVISION",
      body: "Partially revise article title={{title}} body={{body}} rationale={{rationale}}",
      systemInstruction: "Return a revised blogger article JSON. Keep claim fidelity.",
    },
    {
      identifier: "revision.full",
      taskType: "REVISION",
      body: "Fully regenerate article for {{productTitle}}",
      systemInstruction: "Return a full blogger article JSON regeneration.",
    },
  ];

  for (const prompt of prompts) {
    await repo.upsertPromptDefinition({
      identifier: prompt.identifier,
      version: "v1",
      taskType: prompt.taskType,
      body: prompt.body,
      systemInstruction: prompt.systemInstruction,
      inputTemplate: prompt.body,
      enabled: true,
      metadata: { p45: true },
    });
  }
}

export function createP45Stack(input: {
  repo: LifecycleRepository;
  config: AppConfig;
}): { p45: P45ContentService; lifecycle: ContentLifecycleService } {
  const publishers = {
    BLOGGER:
      input.config.bloggerMode === "api"
        ? createBloggerPublisherFromConfig(input.config)
        : new MockPublisher("BLOGGER"),
    X: new MockPublisher("X"),
  };
  const llm =
    input.config.llmMode === "api" &&
    input.config.llmAllowExternalRequests &&
    input.config.llmApiKey
      ? createLLMProvider(input.config)
      : new MockLLMProvider();

  const lifecycle = new ContentLifecycleService({
    repo: input.repo,
    affiliate: createAffiliateProviderFromConfig(input.config),
    llm,
    publishers,
    notifications: new NoopNotificationAdapter(),
    linkPolicy: {
      preferredAffiliateProvider: input.config.preferredAffiliateProvider,
      futureAspProviders: input.config.linkFutureAspProviders,
    },
  });

  const p45 = new P45ContentService(input.repo, input.config, lifecycle, { llm, blogger: publishers.BLOGGER });
  return { p45, lifecycle };
}

export type { ContentVersion };
