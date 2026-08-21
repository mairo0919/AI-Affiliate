import type { AppConfig } from "@ai-affiliate/config";
import type { XPublicationStrategyType } from "@ai-affiliate/database";
import { XCharacterCounter } from "./character-counter.js";
import type { GeneratedXPostSpec, GeneratedXPublication } from "./types.js";
import { STRATEGY_VERSION } from "./types.js";

export class XPublicationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XPublicationValidationError";
  }
}

export interface XPublicationBuildContext {
  title: string;
  affiliateUrl: string;
  hashtags?: string[];
  summary?: string | null;
  callToAction?: string | null;
  facts?: string[];
  relatedPostUrl?: string | null;
  relatedPublicationId?: string | null;
  maxPosts?: number;
}

function takeHashtags(tags: string[] | undefined, max: number): string[] {
  return (tags ?? [])
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .filter((t) => t.length > 1)
    .slice(0, max);
}

function joinParts(parts: Array<string | null | undefined>, sep = " "): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(sep)
    .trim();
}

export class XPublicationBuilder {
  private readonly counter: XCharacterCounter;

  constructor(private readonly config: AppConfig) {
    this.counter = new XCharacterCounter(config.xUrlWeightedLength);
  }

  build(
    strategyType: XPublicationStrategyType,
    context: XPublicationBuildContext,
    experimentGroup?: string,
  ): GeneratedXPublication {
    const maxPosts = Math.min(
      context.maxPosts ?? this.config.xMaxPostsPerPublication,
      this.config.xMaxPostsPerPublication,
    );

    let posts: GeneratedXPostSpec[];
    switch (strategyType) {
      case "SINGLE_POST":
        posts = [this.buildSingle(context)];
        break;
      case "CONTROL":
        posts = [this.buildControl(context)];
        break;
      case "ROOT_WITH_REPLY":
        posts = this.buildRootWithReply(context);
        break;
      case "RELATED_POST_LINK":
        if (!context.relatedPostUrl || !context.relatedPublicationId) {
          throw new XPublicationValidationError(
            "RELATED_POST_LINK requires relatedPostUrl and relatedPublicationId",
          );
        }
        posts = this.buildRelated(context);
        break;
      case "THREAD":
        posts = this.buildThread(context, maxPosts);
        break;
      case "HUB_POST":
        posts = this.buildHub(context);
        break;
      default:
        throw new XPublicationValidationError(`unsupported strategy ${strategyType}`);
    }

    if (posts.length > maxPosts) {
      throw new XPublicationValidationError(
        `post count ${posts.length} exceeds max ${maxPosts}`,
      );
    }

    this.validateStructure(posts);
    for (const post of posts) {
      this.assertPostValid(post, strategyType);
    }

    return {
      strategyType,
      strategyVersion: STRATEGY_VERSION,
      experimentGroup,
      posts,
    };
  }

  validateStructure(posts: GeneratedXPostSpec[]): void {
    if (posts.length === 0) {
      throw new XPublicationValidationError("publication must have at least one post");
    }
    const first = posts.find((p) => p.sequence === 1);
    if (!first) {
      throw new XPublicationValidationError("sequence=1 post is required");
    }
    if (first.role !== "ROOT" && first.role !== "HUB") {
      throw new XPublicationValidationError("sequence=1 must be ROOT or HUB");
    }
    const sequences = new Set(posts.map((p) => p.sequence));
    if (sequences.size !== posts.length) {
      throw new XPublicationValidationError("duplicate sequences");
    }

    for (const post of posts) {
      if (post.replyToSequence != null) {
        if (post.replyToSequence >= post.sequence) {
          throw new XPublicationValidationError(
            `replyToSequence must reference earlier post (seq=${post.sequence})`,
          );
        }
        if (!sequences.has(post.replyToSequence)) {
          throw new XPublicationValidationError(
            `replyToSequence ${post.replyToSequence} not found`,
          );
        }
      }
    }

    // Cycle check via walk
    for (const post of posts) {
      const seen = new Set<number>();
      let current: number | undefined = post.replyToSequence ?? undefined;
      while (current != null) {
        if (seen.has(current)) {
          throw new XPublicationValidationError("circular reply reference");
        }
        seen.add(current);
        const next = posts.find((p) => p.sequence === current);
        current = next?.replyToSequence ?? undefined;
      }
    }
  }

  assertPostValid(post: GeneratedXPostSpec, strategyType: XPublicationStrategyType): void {
    const counted = this.counter.count(post.body);
    if (counted.weightedLength > this.config.xMaxWeightedLength) {
      throw new XPublicationValidationError(
        `weighted length ${counted.weightedLength} exceeds ${this.config.xMaxWeightedLength}`,
      );
    }
    const disclosure = this.config.xAffiliateDisclosure;
    const hashtagCountExcludingDisclosure =
      disclosure.startsWith("#") && post.body.includes(disclosure)
        ? Math.max(0, counted.hashtagCount - 1)
        : counted.hashtagCount;
    if (hashtagCountExcludingDisclosure > this.config.xMaxHashtags) {
      throw new XPublicationValidationError(
        `hashtag count ${hashtagCountExcludingDisclosure} exceeds ${this.config.xMaxHashtags}`,
      );
    }
    if (
      (post.role === "ROOT" || post.role === "HUB") &&
      !post.body.includes(this.config.xAffiliateDisclosure)
    ) {
      throw new XPublicationValidationError("ROOT missing affiliate disclosure");
    }
    if (
      post.body.includes("http") &&
      !post.body.includes(this.config.xAffiliateDisclosure) &&
      strategyType !== "HUB_POST"
    ) {
      // URL-bearing posts should keep disclosure when carrying affiliate URL
      if (post.body.includes("http://") || post.body.includes("https://")) {
        if (!post.body.includes(this.config.xAffiliateDisclosure)) {
          throw new XPublicationValidationError(
            "affiliate URL post missing disclosure",
          );
        }
      }
    }
  }

  private buildSingle(ctx: XPublicationBuildContext): GeneratedXPostSpec {
    const disclosureIsTag = this.config.xAffiliateDisclosure.startsWith("#");
    const tags = takeHashtags(
      ctx.hashtags,
      Math.max(0, this.config.xMaxHashtags - (disclosureIsTag ? 1 : 0)),
    );
    const body = joinParts([
      ctx.title,
      ctx.summary ?? ctx.facts?.[0] ?? ctx.callToAction ?? "注目ポイントをチェック",
      this.config.xAffiliateDisclosure,
      ctx.affiliateUrl,
      ...tags,
    ]);
    return { sequence: 1, role: "ROOT", body: this.fit(body) };
  }

  private buildControl(ctx: XPublicationBuildContext): GeneratedXPostSpec {
    const body = joinParts([
      ctx.title,
      this.config.xAffiliateDisclosure,
      ctx.affiliateUrl,
    ]);
    return { sequence: 1, role: "ROOT", body: this.fit(body) };
  }

  private buildRootWithReply(ctx: XPublicationBuildContext): GeneratedXPostSpec[] {
    const root = this.fit(
      joinParts([
        ctx.title,
        ctx.summary ?? "詳細は返信へ",
        "続きは返信で",
        this.config.xAffiliateDisclosure,
      ]),
    );
    const reply = this.fit(
      joinParts([
        ...(ctx.facts ?? []).slice(0, 3),
        ctx.callToAction ?? "詳細はこちら",
        this.config.xAffiliateDisclosure,
        ctx.affiliateUrl,
      ]),
    );
    return [
      { sequence: 1, role: "ROOT", body: root },
      { sequence: 2, role: "REPLY", body: reply, replyToSequence: 1 },
    ];
  }

  private buildRelated(ctx: XPublicationBuildContext): GeneratedXPostSpec[] {
    const root = this.fit(
      joinParts([
        ctx.title,
        "関連投稿もどうぞ",
        this.config.xAffiliateDisclosure,
        ctx.relatedPostUrl!,
      ]),
    );
    const reply = this.fit(
      joinParts([
        "本編はこちら",
        this.config.xAffiliateDisclosure,
        ctx.affiliateUrl,
      ]),
    );
    return [
      {
        sequence: 1,
        role: "ROOT",
        body: root,
        relatedPublicationId: ctx.relatedPublicationId!,
      },
      { sequence: 2, role: "REPLY", body: reply, replyToSequence: 1 },
    ];
  }

  private buildThread(ctx: XPublicationBuildContext, maxPosts: number): GeneratedXPostSpec[] {
    const posts: GeneratedXPostSpec[] = [
      {
        sequence: 1,
        role: "ROOT",
        body: this.fit(
          joinParts([ctx.title, "スレッドで紹介", this.config.xAffiliateDisclosure]),
        ),
      },
    ];
    const facts = ctx.facts ?? ["補足情報"];
    const limit = Math.min(maxPosts, 3);
    for (let i = 1; i < limit; i += 1) {
      const isLast = i === limit - 1;
      posts.push({
        sequence: i + 1,
        role: isLast ? "CTA" : "REPLY",
        replyToSequence: i,
        body: this.fit(
          joinParts([
            facts[i - 1] ?? `ポイント${i}`,
            isLast ? this.config.xAffiliateDisclosure : null,
            isLast ? ctx.affiliateUrl : null,
          ]),
        ),
      });
    }
    return posts;
  }

  private buildHub(ctx: XPublicationBuildContext): GeneratedXPostSpec[] {
    return [
      {
        sequence: 1,
        role: "HUB",
        body: this.fit(
          joinParts([
            "注目まとめ",
            ctx.title,
            this.config.xAffiliateDisclosure,
            ctx.affiliateUrl,
          ]),
        ),
      },
    ];
  }

  /** Truncate body carefully without removing disclosure or URL. */
  private fit(body: string): string {
    const disclosure = this.config.xAffiliateDisclosure;
    const max = this.config.xMaxWeightedLength;
    let current = body;
    let counted = this.counter.count(current);
    if (counted.weightedLength <= max) {
      return current;
    }
    // Never strip disclosure to fit — fail instead if cannot fit with disclosure
    if (!current.includes(disclosure)) {
      throw new XPublicationValidationError("cannot fit body without disclosure");
    }
    // Trim middle prose while keeping disclosure + trailing URL
    const urlMatch = current.match(/https?:\/\/[^\s<>"']+/);
    const url = urlMatch?.[0] ?? "";
    const suffix = joinParts([disclosure, url], " ");
    const prefixBudget = max - this.counter.count(suffix).weightedLength - 2;
    let prefix = current.replace(url, "").replace(disclosure, "").trim();
    while (this.counter.count(prefix).weightedLength > prefixBudget && prefix.length > 0) {
      prefix = prefix.slice(0, Math.max(0, prefix.length - 8)).trim();
    }
    current = joinParts([prefix, suffix], " ");
    counted = this.counter.count(current);
    if (counted.weightedLength > max) {
      throw new XPublicationValidationError(
        `unable to fit post within ${max} weighted chars without removing disclosure`,
      );
    }
    return current;
  }
}
