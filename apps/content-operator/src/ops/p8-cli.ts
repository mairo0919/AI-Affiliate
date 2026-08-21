import { loadConfig, validateProductionConfig } from "@ai-affiliate/config";
import { createAdminStack } from "../admin/create-admin-stack.js";
import { buildProductionChecklist } from "./production-checklist.js";
import { runP8MockVertical } from "./p8-vertical.js";
import { runP9MockVertical } from "./p9-vertical.js";
import { researchPublicUrl } from "./public-url-research.js";
import { seedP45Prompts } from "../generation/p45-service.js";

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) {
      flags[body] = true;
      continue;
    }
    flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

export async function runProductionCheck(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const validation = validateProductionConfig(config);
  const stack = await createAdminStack({ config, forceMockAdapters: process.env.NODE_ENV === "test" });
  try {
    const checklist = await buildProductionChecklist({
      config,
      adminRepo: stack.adminRepo,
      lifecycleRepo: stack.lifecycleRepo,
      p6: stack.p6,
      dbConnected: true,
    });
    console.log(
      JSON.stringify(
        {
          validation,
          checklist,
          usingMockLlm: stack.usingMockLlm,
          usingMockBlogger: stack.usingMockBlogger,
        },
        null,
        2,
      ),
    );
    if (!validation.ok || checklist.blocked) process.exitCode = 1;
  } finally {
    await stack.disconnect();
  }
}

export async function runProductionDiagnose(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const stack = await createAdminStack({ config, forceMockAdapters: true });
  try {
    console.log(
      JSON.stringify(
        {
          operationMode: config.productionOperationMode,
          llm: {
            mode: config.llmMode,
            allowExternal: config.llmAllowExternalRequests,
            keyConfigured: Boolean(config.llmApiKey),
            usingMock: stack.usingMockLlm,
            models: {
              generation: config.llmModelGeneration,
              review: config.llmModelReview,
              revision: config.llmModelRevision,
              strategy: config.llmModelStrategy,
            },
          },
          blogger: {
            mode: config.bloggerMode,
            allowExternal: config.bloggerAllowExternalRequests,
            directPublish: config.bloggerAllowDirectPublish,
            defaultMode: config.bloggerDefaultPublishMode,
            usingMock: stack.usingMockBlogger,
            oauthConfigured: Boolean(
              config.bloggerClientId && config.bloggerClientSecret && config.bloggerRefreshToken,
            ),
            blogIdConfigured: Boolean(config.bloggerBlogId),
          },
          publication: {
            targetPerDay: config.publicationTargetPerDay,
            maximumPerDay: config.publicationMaximumPerDay,
            minInterval: config.publicationMinimumIntervalMinutes,
            activeHours: `${config.publicationActiveHoursStart}-${config.publicationActiveHoursEnd}`,
            timezone: config.publicationTimezone,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await stack.disconnect();
  }
}

export async function runLlmTest(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["confirm-external"] && process.env.LLM_MODE === "api") {
    console.error("Refusing real LLM call without --confirm-external");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig({ requireDatabaseUrl: false });
  const stack = await createAdminStack({
    config,
    forceMockAdapters: !flags["confirm-external"],
  });
  try {
    const result = await stack.llm.executeTask({
      taskType: "GENERATION",
      promptIdentifier: "ops.llm-test",
      promptVersion: "v1",
      input: { ping: true },
      userPrompt: "Reply with JSON {\"ok\":true}",
      model: config.llmModelGeneration,
    });
    console.log(
      JSON.stringify(
        {
          provider: result.provider,
          model: result.model,
          estimatedCost: result.estimatedCost,
          outputKeys: Object.keys(result.output ?? {}),
        },
        null,
        2,
      ),
    );
  } finally {
    await stack.disconnect();
  }
}

export async function runBloggerCreateTestDraft(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["confirm-external"]) {
    console.error(
      "Usage: blogger:create-test-draft -- --confirm-external --publication-target-id=<ID>",
    );
    process.exitCode = 1;
    return;
  }
  const targetId = String(flags["publication-target-id"] ?? "");
  if (!targetId) {
    console.error("publication-target-id required");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig({ requireDatabaseUrl: false });
  const stack = await createAdminStack({ config, forceMockAdapters: false });
  try {
    const result = await stack.p45.createBloggerDraft({
      publicationTargetId: targetId,
      forceApi: true,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await stack.disconnect();
  }
}

export async function runP8Vertical(): Promise<void> {
  const summary = await runP8MockVertical();
  console.log(JSON.stringify(summary, null, 2));
}

export async function runP9Vertical(): Promise<void> {
  const summary = await runP9MockVertical();
  console.log(JSON.stringify(summary, null, 2));
}

/**
 * Live/public URL research entry (Affiliate API not required).
 * Real network fetch requires RESEARCH_ALLOW_EXTERNAL_REQUESTS=true and --confirm-external.
 */
export async function runProductionResearchUrl(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const url = typeof flags.url === "string" ? flags.url : "";
  if (!url) {
    console.error(
      "Usage: production-research-url -- --url=<PUBLIC_URL> [--confirm-external] [--register-product] [--create-topic]",
    );
    process.exitCode = 1;
    return;
  }
  const confirmExternal = flags["confirm-external"] === true;
  const config = loadConfig({ requireDatabaseUrl: false });
  const stack = await createAdminStack({
    config,
    forceMockAdapters: process.env.NODE_ENV === "test",
  });
  try {
    await seedP45Prompts(stack.lifecycleRepo);
    const result = await researchPublicUrl({
      config,
      repo: stack.lifecycleRepo,
      lifecycle: stack.lifecycle,
      options: {
        url,
        confirmExternal,
        maxAdditionalSources: 3,
        researchBudget: 3,
      },
    });

    let productId: string | undefined;
    let topicId: string | undefined;
    let strategyId: string | undefined;
    if (flags["register-product"] === true && result.productHint) {
      const product = await stack.ops.registerManualProduct({
        providerKey: result.productHint.providerKey,
        externalProductId: `url-${Buffer.from(result.productHint.url).toString("base64url").slice(0, 24)}`,
        title: result.productHint.title,
        url: result.productHint.url,
        adultFlag: true,
        notes: "Registered from production:research-url",
      });
      productId = product.id;
      if (flags["create-topic"] === true) {
        const topic = await stack.lifecycle.createTopicFromProduct(product.id);
        const strategy = await stack.lifecycle.createRuleBasedStrategy(topic.id);
        topicId = topic.id;
        strategyId = strategy.id;
      }
    }

    console.log(
      JSON.stringify(
        {
          seed: {
            title: result.seed.title,
            productOrTopicName: result.seed.productOrTopicName,
            sourceUrl: result.seed.sourceUrl,
            pageType: result.seed.pageType,
            makerOrPublisher: result.seed.makerOrPublisher,
            series: result.seed.series,
            releaseInformation: result.seed.releaseInformation,
            publiclyConfirmedPrice: result.seed.publiclyConfirmedPrice,
            availability: result.seed.availability,
            observedAt: result.seed.observedAt,
            rawHtmlStored: false,
          },
          fetchedUrls: result.fetchedUrls,
          skippedUrls: result.skippedUrls,
          claimCount: result.claims.length,
          claims: result.claims.map((c) => ({
            id: c.id,
            status: c.status,
            statement: c.statement,
          })),
          productId,
          topicId,
          strategyId,
        },
        null,
        2,
      ),
    );
  } finally {
    await stack.disconnect();
  }
}

export async function runOpsDailyStatus(): Promise<void> {
  const stack = await createAdminStack({ forceMockAdapters: true });
  try {
    const jobs = await stack.p6.listOperationJobs({ take: 10 });
    console.log(
      JSON.stringify(
        {
          recentJobs: jobs.map((j) => ({
            id: j.id,
            cycleType: j.cycleType,
            status: j.status,
            createdAt: j.createdAt,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await stack.disconnect();
  }
}
