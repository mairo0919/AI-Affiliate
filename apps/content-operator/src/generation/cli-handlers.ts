import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  P6Repository,
  createDatabaseClient,
  type DatabaseClient,
} from "@ai-affiliate/database";
import { createP45Stack, seedP45Prompts } from "./p45-service.js";
import { ContentGenerationService } from "./content-generation-service.js";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { ContentReviewService } from "../admin/content-review-service.js";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function withP45<T>(
  run: (
    ctx: ReturnType<typeof createP45Stack>,
    repo: LifecycleRepository,
    database: DatabaseClient,
  ) => Promise<T>,
): Promise<T> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const repo = new LifecycleRepository(database.prisma);
    await seedP45Prompts(repo);
    const ctx = createP45Stack({ repo, config });
    return await run(ctx, repo, database);
  } finally {
    await database.disconnect();
  }
}

export async function runP45GenerateBlogger(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["topic-id"] || !flags["strategy-id"] || !flags["product-title"]) {
    console.error(
      "Usage: p45-generate-blogger -- --topic-id= --strategy-id= --product-title= [--cta-url=] [--claim-ids=a,b]",
    );
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    const result = await p45.generation.generateBloggerArticle({
      topicId: flags["topic-id"]!,
      strategyId: flags["strategy-id"]!,
      productTitle: flags["product-title"]!,
      ctaUrl: flags["cta-url"],
      claimIds: flags["claim-ids"]?.split(",").filter(Boolean),
      articleFormat: flags.format,
    });
    printJson({
      contentId: result.content.id,
      contentVersionId: result.version.id,
      title: result.version.title,
      modelRunId: result.modelRunId,
    });
  });
}

export async function runP45ReviewContent(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-version-id"]) {
    console.error("Usage: p45-review-content -- --content-version-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    printJson(await p45.generation.runQualityReviews(flags["content-version-id"]!));
  });
}

export async function runP45ReviseContent(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-version-id"] || !flags.mode || !flags["product-title"]) {
    console.error(
      "Usage: p45-revise-content -- --content-version-id= --mode=partial_revision|full_regeneration --product-title= [--rationale=]",
    );
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    printJson(
      await p45.generation.reviseContentVersion({
        contentVersionId: flags["content-version-id"]!,
        mode: flags.mode === "full_regeneration" ? "full_regeneration" : "partial_revision",
        rationale: flags.rationale ?? "manual revision request",
        productTitle: flags["product-title"]!,
        ctaUrl: flags["cta-url"],
      }),
    );
  });
}

export async function runP45ApproveContent(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-version-id"]) {
    console.error("Usage: p45-approve-content -- --content-version-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withP45(async (_ctx, repo, database) => {
    const review = new ContentReviewService(repo, new P6Repository(database.prisma));
    printJson(
      await review.decide({
        contentVersionId: flags["content-version-id"]!,
        decision: "approve",
        actor: "p45-cli",
        approvalPolicy: "manual",
      }),
    );
  });
}

export async function runP45PrepareBloggerDraft(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-version-id"]) {
    console.error("Usage: p45-prepare-blogger-draft -- --content-version-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    printJson(await p45.prepareBloggerHtml(flags["content-version-id"]!));
  });
}

export async function runP45CreateBloggerDraft(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["target-id"]) {
    console.error("Usage: p45-create-blogger-draft -- --target-id=<PublicationTargetId>");
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    printJson(await p45.createBloggerDraft({ publicationTargetId: flags["target-id"]! }));
  });
}

export async function runP45UpdateBloggerDraft(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["external-id"] || !flags["content-version-id"]) {
    console.error(
      "Usage: p45-update-blogger-draft -- --external-id=<ID> --content-version-id=<ID>",
    );
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    printJson(
      await p45.updateBloggerDraft({
        externalId: flags["external-id"]!,
        contentVersionId: flags["content-version-id"]!,
      }),
    );
  });
}

export async function runP45DeleteBloggerDraft(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["external-id"]) {
    console.error("Usage: p45-delete-blogger-draft -- --external-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    printJson(await p45.deleteBloggerDraft(flags["external-id"]!));
  });
}

export async function runP45GetBloggerStatus(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["external-id"]) {
    console.error("Usage: p45-get-blogger-status -- --external-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    printJson(await p45.blogger.getStatus(flags["external-id"]!));
  });
}

export async function runP45GenerateX(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["topic-id"] || !flags["strategy-id"] || !flags["product-title"]) {
    console.error(
      "Usage: p45-generate-x -- --topic-id= --strategy-id= --product-title= [--product-url=] [--blogger-url=]",
    );
    process.exitCode = 1;
    return;
  }
  await withP45(async ({ p45 }) => {
    const result = await p45.generation.generateXPost({
      topicId: flags["topic-id"]!,
      strategyId: flags["strategy-id"]!,
      productTitle: flags["product-title"]!,
      productUrl: flags["product-url"],
      bloggerUrl: flags["blogger-url"],
      claimIds: flags["claim-ids"]?.split(",").filter(Boolean),
    });
    printJson({
      contentId: result.content.id,
      contentVersionId: result.version.id,
      body: result.body,
    });
  });
}

export async function runP45Vertical(): Promise<void> {
  await withP45(async ({ p45 }) => {
    printJson(await p45.runP45MockVertical());
  });
}

export async function runP45SeedPrompts(): Promise<void> {
  await withP45(async (_ctx, repo) => {
    await seedP45Prompts(repo);
    printJson({ ok: true });
  });
}

/** Local unit-style smoke without DB for mock LLM behaviors */
export async function runP45LlmSmoke(): Promise<void> {
  const llm = new MockLLMProvider();
  llm.behavior = "ok";
  const ok = await llm.executeTask({
    taskType: "GENERATION_BLOGGER",
    promptIdentifier: "blogger.generate",
    input: { productTitle: "Sample", supportedClaimIds: [] },
  });
  printJson({ provider: ok.provider, structuredOutputValid: ok.structuredOutputValid });
  void ContentGenerationService;
}
