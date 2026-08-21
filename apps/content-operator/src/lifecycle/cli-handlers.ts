import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  createDatabaseClient,
  type PublicationPlatform,
  type PublicationApprovalMode,
} from "@ai-affiliate/database";
import {
  MockAffiliateProvider,
  MockLLMProvider,
  MockPublisher,
  NoopNotificationAdapter,
} from "../adapters/index.js";
import { ContentLifecycleService } from "./lifecycle-service.js";

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

async function withLifecycle<T>(
  run: (service: ContentLifecycleService, repo: LifecycleRepository) => Promise<T>,
): Promise<T> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const repo = new LifecycleRepository(database.prisma);
    const service = new ContentLifecycleService({
      repo,
      affiliate: new MockAffiliateProvider(),
      llm: new MockLLMProvider(),
      publishers: {
        BLOGGER: new MockPublisher("BLOGGER"),
        X: new MockPublisher("X"),
      },
      notifications: new NoopNotificationAdapter(),
      linkPolicy: {
        preferredAffiliateProvider: config.preferredAffiliateProvider,
        futureAspProviders: config.linkFutureAspProviders,
      },
    });
    return await run(service, repo);
  } finally {
    await database.disconnect();
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function runLifecycleSeedProducts(): Promise<void> {
  await withLifecycle(async (service) => {
    const products = await service.seedMockProducts();
    printJson({ productCount: products.length, products });
  });
}

export async function runLifecycleCreateTopic(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["product-id"]) {
    console.error("Usage: lifecycle-create-topic -- --product-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withLifecycle(async (service) => {
    const topic = await service.createTopicFromProduct(flags["product-id"]!);
    printJson(topic);
  });
}

export async function runLifecycleCreateStrategy(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["topic-id"]) {
    console.error("Usage: lifecycle-create-strategy -- --topic-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withLifecycle(async (service) => {
    const strategy = await service.createRuleBasedStrategy(flags["topic-id"]!);
    printJson(strategy);
  });
}

export async function runLifecycleRegisterClaim(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.statement || !flags.summary) {
    console.error(
      "Usage: lifecycle-register-claim -- --statement=<TEXT> --summary=<TEXT> [--strategy-id=<ID>] [--source-key=mock-source]",
    );
    process.exitCode = 1;
    return;
  }
  await withLifecycle(async (service) => {
    const result = await service.registerFindingAndClaim({
      sourceKey: flags["source-key"] ?? "mock-source",
      findingSummary: flags.summary!,
      claimStatement: flags.statement!,
      strategyId: flags["strategy-id"],
      contentVersionId: flags["content-version-id"],
    });
    printJson(result);
  });
}

export async function runLifecycleCreateContent(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["topic-id"] || !flags["strategy-id"] || !flags.title || !flags.body) {
    console.error(
      "Usage: lifecycle-create-content -- --topic-id=<ID> --strategy-id=<ID> --title=<TEXT> --body=<TEXT> [--claim-id=<ID>]",
    );
    process.exitCode = 1;
    return;
  }
  await withLifecycle(async (service) => {
    const result = await service.createContentWithVersion({
      topicId: flags["topic-id"]!,
      strategyId: flags["strategy-id"]!,
      title: flags.title!,
      body: flags.body!,
      summary: flags.summary,
      claimId: flags["claim-id"],
      primaryLanguage: flags.language ?? "ja",
    });
    printJson(result);
  });
}

export async function runLifecycleEvaluatePolicy(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["target-type"] || !flags["target-id"]) {
    console.error(
      "Usage: lifecycle-evaluate-policy -- --target-type=ContentVersion --target-id=<ID>",
    );
    process.exitCode = 1;
    return;
  }
  await withLifecycle(async (service) => {
    const result = await service.evaluatePolicies(flags["target-type"]!, flags["target-id"]!);
    printJson(result);
  });
}

export async function runLifecycleReview(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-version-id"]) {
    console.error("Usage: lifecycle-review -- --content-version-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withLifecycle(async (service) => {
    const review = await service.runMockReview(flags["content-version-id"]!);
    printJson(review);
  });
}

export async function runLifecycleCreatePublicationTarget(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-id"] || !flags["content-version-id"] || !flags.platform) {
    console.error(
      "Usage: lifecycle-create-publication-target -- --content-id=<ID> --content-version-id=<ID> --platform=BLOGGER|X [--approval-mode=MANUAL]",
    );
    process.exitCode = 1;
    return;
  }
  const platform = flags.platform as PublicationPlatform;
  const approvalMode = (flags["approval-mode"] ?? "MANUAL") as PublicationApprovalMode;
  await withLifecycle(async (service) => {
    const target = await service.createPublicationTarget({
      contentId: flags["content-id"]!,
      contentVersionId: flags["content-version-id"]!,
      platform,
      destinationRef: flags["destination-ref"],
      targetFormat: flags["target-format"],
      approvalMode,
    });
    printJson(target);
  });
}

export async function runLifecycleApprovePublication(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.id && !flags["target-id"]) {
    console.error("Usage: lifecycle-approve-publication -- --target-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const id = flags["target-id"] ?? flags.id!;
  await withLifecycle(async (service) => {
    const target = await service.approvePublicationTarget(id);
    printJson(target);
  });
}

export async function runLifecycleMockPublish(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["target-id"] && !flags.id) {
    console.error("Usage: lifecycle-mock-publish -- --target-id=<ID>");
    process.exitCode = 1;
    return;
  }
  const id = flags["target-id"] ?? flags.id!;
  await withLifecycle(async (service) => {
    const target = await service.mockPublish(id);
    printJson(target);
  });
}

export async function runLifecycleInspect(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-id"]) {
    console.error("Usage: lifecycle-inspect -- --content-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withLifecycle(async (service) => {
    const snapshot = await service.inspectLifecycle(flags["content-id"]!);
    printJson(snapshot);
  });
}

export async function runLifecycleRunVertical(): Promise<void> {
  await withLifecycle(async (service) => {
    const summary = await service.runVerticalSlice();
    printJson({
      productIds: summary.products.map((p) => p.id),
      topicId: summary.topic.id,
      strategyId: summary.strategy.id,
      findingId: summary.finding.id,
      claimId: summary.claim.id,
      contentId: summary.content.id,
      contentVersionId: summary.version.id,
      policyOverall: summary.policy.overall,
      reviewId: summary.review.id,
      publicationTargetId: summary.publicationTarget.id,
      publicationStatus: summary.published.status,
      publishedExternalId: summary.published.publishedExternalId,
      publishedUrl: summary.published.publishedUrl,
    });
  });
}
