import { loadConfig } from "@ai-affiliate/config";
import {
  LifecycleRepository,
  createDatabaseClient,
  type MonetizationStatus,
  type PublicationApprovalMode,
} from "@ai-affiliate/database";
import {
  MockAffiliateProvider,
  MockLLMProvider,
  MockPublisher,
  NoopNotificationAdapter,
} from "../adapters/index.js";
import { ContentLifecycleService } from "../lifecycle/lifecycle-service.js";
import { OpsService } from "./ops-service.js";

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

async function withOps<T>(run: (ops: OpsService, repo: LifecycleRepository) => Promise<T>): Promise<T> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const repo = new LifecycleRepository(database.prisma);
    const publishers = {
      BLOGGER: new MockPublisher("BLOGGER"),
      X: new MockPublisher("X"),
    };
    const lifecycle = new ContentLifecycleService({
      repo,
      affiliate: new MockAffiliateProvider(),
      llm: new MockLLMProvider(),
      publishers,
      notifications: new NoopNotificationAdapter(),
      linkPolicy: {
        preferredAffiliateProvider: config.preferredAffiliateProvider,
        futureAspProviders: config.linkFutureAspProviders,
      },
    });
    const ops = new OpsService({
      repo,
      lifecycle,
      publishers,
      queueConfig: {
        targetPerDay: config.publicationTargetPerDay,
        maximumPerDay: config.publicationMaximumPerDay,
        minimumIntervalMinutes: config.publicationMinimumIntervalMinutes,
        pauseWhenNoQualifiedContent: config.publicationPauseWhenNoQualified,
      },
      linkPolicy: {
        preferredAffiliateProvider: config.preferredAffiliateProvider,
        futureAspProviders: config.linkFutureAspProviders,
      },
    });
    return await run(ops, repo);
  } finally {
    await database.disconnect();
  }
}

export async function runOpsRegisterProduct(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["external-id"] || !flags.title) {
    console.error(
      "Usage: ops-register-product -- --external-id=<ID> --title=<TEXT> [--url=<URL>] [--provider=fanza|manual-import] [--official-url=<URL>] [--affiliate-url=<URL>]",
    );
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) => {
    const product = await ops.registerManualProduct({
      providerKey: flags.provider ?? "manual-import",
      externalProductId: flags["external-id"]!,
      title: flags.title!,
      url: flags.url,
      affiliateUrl: flags["affiliate-url"],
      officialUrl: flags["official-url"],
      notes: flags.notes,
    });
    printJson(product);
  });
}

export async function runOpsRegisterResearch(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.url || !flags.summary || !flags.statement) {
    console.error(
      "Usage: ops-register-research -- --url=<URL> --summary=<TEXT> --statement=<TEXT> [--strategy-id=<ID>]",
    );
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) => {
    const result = await ops.registerPublicUrlResearch({
      url: flags.url!,
      title: flags.title,
      summary: flags.summary!,
      claimStatement: flags.statement!,
      strategyId: flags["strategy-id"],
      contentVersionId: flags["content-version-id"],
    });
    printJson(result);
  });
}

export async function runOpsGenerateContent(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["topic-id"] || !flags["strategy-id"] || !flags.channel || !flags["product-title"]) {
    console.error(
      "Usage: ops-generate-content -- --topic-id=<ID> --strategy-id=<ID> --channel=BLOGGER|X --product-title=<TEXT> [--product-url=<URL>] [--claim-id=<ID>]",
    );
    process.exitCode = 1;
    return;
  }
  const channel = flags.channel === "X" ? "X" : "BLOGGER";
  await withOps(async (ops) => {
    const result = await ops.generateChannelContent({
      topicId: flags["topic-id"]!,
      strategyId: flags["strategy-id"]!,
      channel,
      productTitle: flags["product-title"]!,
      productUrl: flags["product-url"],
      bloggerUrl: flags["blogger-url"],
      claimId: flags["claim-id"],
      unmonetized: flags.unmonetized === "true",
      claimStatements: flags.claims ? flags.claims.split("|") : undefined,
    });
    printJson(result);
  });
}

export async function runOpsCreateTargets(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (
    !flags["blogger-content-id"] ||
    !flags["blogger-version-id"] ||
    !flags["x-content-id"] ||
    !flags["x-version-id"]
  ) {
    console.error(
      "Usage: ops-create-targets -- --blogger-content-id= --blogger-version-id= --x-content-id= --x-version-id= [--blogger-mode=DRAFT_ONLY] [--x-mode=MANUAL]",
    );
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) => {
    const plan = await ops.createDualPublicationPlan({
      bloggerContentId: flags["blogger-content-id"]!,
      bloggerVersionId: flags["blogger-version-id"]!,
      xContentId: flags["x-content-id"]!,
      xVersionId: flags["x-version-id"]!,
      bloggerApprovalMode: (flags["blogger-mode"] ?? "DRAFT_ONLY") as PublicationApprovalMode,
      xApprovalMode: (flags["x-mode"] ?? "MANUAL") as PublicationApprovalMode,
    });
    printJson(plan);
  });
}

export async function runOpsApprove(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const id = flags["target-id"] ?? flags.id;
  if (!id) {
    console.error("Usage: ops-approve -- --target-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) => printJson(await ops.humanApprove(id)));
}

export async function runOpsBloggerDraft(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const id = flags["target-id"] ?? flags.id;
  if (!id) {
    console.error("Usage: ops-blogger-draft -- --target-id=<ID>");
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) => printJson(await ops.mockDraft(id)));
}

export async function runOpsXExport(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-version-id"]) {
    console.error("Usage: ops-x-export -- --content-version-id=<ID> [--target-id=<ID>]");
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) =>
    printJson(await ops.exportX(flags["content-version-id"]!, flags["target-id"])),
  );
}

export async function runOpsQueueRun(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : undefined;
  await withOps(async (ops) => printJson(await ops.runPublicationQueue(limit)));
}

export async function runOpsAnalyticsIngest(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags.platform || !flags.metrics) {
    console.error(
      'Usage: ops-analytics-ingest -- --platform=BLOGGER|X --metrics={"pageViews":1} [--content-id=<ID>] [--notes=<TEXT>]',
    );
    process.exitCode = 1;
    return;
  }
  let metrics: Record<string, number>;
  try {
    metrics = JSON.parse(flags.metrics) as Record<string, number>;
  } catch {
    console.error("metrics must be JSON object of numbers");
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) =>
    printJson(
      await ops.ingestManualAnalytics({
        platform: flags.platform!,
        contentId: flags["content-id"],
        publicationTargetId: flags["target-id"],
        metrics,
        notes: flags.notes,
      }),
    ),
  );
}

export async function runOpsListUnmonetized(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : 50;
  await withOps(async (ops) => printJson(await ops.listUnmonetizedContent(limit)));
}

export async function runOpsSetMonetization(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-id"] || !flags.status) {
    console.error(
      "Usage: ops-set-monetization -- --content-id=<ID> --status=UNMONETIZED|PENDING_AFFILIATE|MONETIZED|NOT_APPLICABLE",
    );
    process.exitCode = 1;
    return;
  }
  await withOps(async (_ops, repo) =>
    printJson(
      await repo.updateContentMonetization(
        flags["content-id"]!,
        flags.status as MonetizationStatus,
      ),
    ),
  );
}

export async function runOpsLinkReplacePropose(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (
    !flags["product-link-id"] ||
    !flags["content-id"] ||
    !flags["content-version-id"] ||
    !flags["previous-url"] ||
    !flags["next-url"]
  ) {
    console.error(
      "Usage: ops-link-replace-propose -- --product-link-id= --content-id= --content-version-id= --previous-url= --next-url= [--target-id=]",
    );
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) =>
    printJson(
      await ops.proposeAffiliateReplacement({
        productLinkId: flags["product-link-id"]!,
        contentId: flags["content-id"]!,
        sourceContentVersionId: flags["content-version-id"]!,
        sourcePublicationTargetId: flags["target-id"],
        previousUrl: flags["previous-url"]!,
        nextUrl: flags["next-url"]!,
        changeReason: flags.reason,
      }),
    ),
  );
}

export async function runOpsLinkReplaceApprove(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["event-id"] || !flags["approved-by"]) {
    console.error("Usage: ops-link-replace-approve -- --event-id=<ID> --approved-by=<NAME>");
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) =>
    printJson(await ops.approveAffiliateReplacement(flags["event-id"]!, flags["approved-by"]!)),
  );
}

export async function runOpsLinkReplaceApply(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["event-id"] || !flags["approved-by"]) {
    console.error("Usage: ops-link-replace-apply -- --event-id=<ID> --approved-by=<NAME>");
    process.exitCode = 1;
    return;
  }
  await withOps(async (ops) =>
    printJson(await ops.applyAffiliateReplacement(flags["event-id"]!, flags["approved-by"]!)),
  );
}

export async function runOpsP3P4Vertical(): Promise<void> {
  await withOps(async (ops) => {
    const summary = await ops.runP3P4VerticalSlice();
    printJson({
      productId: summary.product.id,
      topicId: summary.topicId,
      strategyId: summary.strategyId,
      claimIds: summary.claimIds,
      bloggerContentId: summary.bloggerContentId,
      bloggerVersionId: summary.bloggerVersionId,
      bloggerTargetId: summary.bloggerTargetId,
      bloggerStatus: summary.bloggerStatus,
      xContentId: summary.xContentId,
      xVersionId: summary.xVersionId,
      xTargetId: summary.xTargetId,
      xExportChars: summary.xExport.characterCount,
      analyticsId: summary.analyticsId,
      queueProcessed: summary.queueProcessed,
      monetizationStatus: summary.monetizationStatus,
    });
  });
}
