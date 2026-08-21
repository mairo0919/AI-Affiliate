import { loadConfig } from "@ai-affiliate/config";
import { LifecycleRepository, P5Repository, createDatabaseClient } from "@ai-affiliate/database";
import { createP5Stack, runP5MockVertical } from "./p5-vertical.js";

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

async function withP5<T>(
  run: (ctx: ReturnType<typeof createP5Stack>, repos: {
    lifecycleRepo: LifecycleRepository;
    p5Repo: P5Repository;
  }) => Promise<T>,
): Promise<T> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycleRepo = new LifecycleRepository(database.prisma);
    const p5Repo = new P5Repository(database.prisma);
    const ctx = createP5Stack({ lifecycleRepo, p5Repo, config });
    return await run(ctx, { lifecycleRepo, p5Repo });
  } finally {
    await database.disconnect();
  }
}

export async function runEvaluateContent(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-id"]) {
    console.error(
      "Usage: evaluate-content -- --content-id= [--version-id=] [--aggregate-id=] [--platform=] [--llm=true]",
    );
    process.exitCode = 1;
    return;
  }
  await withP5(async ({ learning }) => {
    printJson(
      await learning.evaluateContent({
        contentId: flags["content-id"]!,
        contentVersionId: flags["version-id"],
        analyticsAggregateId: flags["aggregate-id"],
        platform: flags.platform,
        useLlm: flags.llm === "true",
      }),
    );
  });
}

export async function runAggregateAnalytics(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-id"] || !flags.platform) {
    console.error(
      "Usage: aggregate-analytics -- --content-id= --platform= [--version-id=] [--target-id=]",
    );
    process.exitCode = 1;
    return;
  }
  await withP5(async ({ learning }) => {
    printJson(
      await learning.aggregateAnalytics({
        contentId: flags["content-id"]!,
        platform: flags.platform!,
        contentVersionId: flags["version-id"],
        publicationTargetId: flags["target-id"],
      }),
    );
  });
}

export async function runExperimentCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["content-id"] || !flags.name || !flags.hypothesis) {
    console.error(
      "Usage: run-experiment -- --content-id= --name= --hypothesis= [--version-id=] [--platform=]",
    );
    process.exitCode = 1;
    return;
  }
  await withP5(async ({ learning }) => {
    printJson(
      await learning.runExperiment({
        contentId: flags["content-id"]!,
        contentVersionId: flags["version-id"],
        name: flags.name!,
        hypothesis: flags.hypothesis!,
        platform: flags.platform,
        variants: [
          {
            label: "A",
            variantType: "title",
            payload: { title: flags["title-a"] ?? "Title A" },
          },
          {
            label: "B",
            variantType: "title",
            payload: { title: flags["title-b"] ?? "Title B" },
          },
        ],
      }),
    );
  });
}

export async function runApproveExperiment(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["experiment-id"]) {
    console.error("Usage: approve-experiment -- --experiment-id= [--by=operator]");
    process.exitCode = 1;
    return;
  }
  await withP5(async ({ learning }) => {
    printJson(await learning.approveExperiment(flags["experiment-id"]!, flags.by ?? "operator"));
  });
}

export async function runCompleteExperiment(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["experiment-id"]) {
    console.error(
      "Usage: complete-experiment -- --experiment-id= [--winner=B] [--score-a=0.5] [--score-b=0.7]",
    );
    process.exitCode = 1;
    return;
  }
  const winner = flags.winner ?? "B";
  await withP5(async ({ learning }) => {
    printJson(
      await learning.completeExperiment({
        experimentId: flags["experiment-id"]!,
        results: [
          {
            variantLabel: "A",
            metrics: { ctr: Number(flags["ctr-a"] ?? 0.03) },
            score: Number(flags["score-a"] ?? 0.5),
            winner: winner === "A",
          },
          {
            variantLabel: "B",
            metrics: { ctr: Number(flags["ctr-b"] ?? 0.05) },
            score: Number(flags["score-b"] ?? 0.7),
            winner: winner === "B",
          },
        ],
      }),
    );
  });
}

export async function runGenerateLearning(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["evaluation-ids"]) {
    console.error(
      "Usage: generate-learning -- --evaluation-ids=id1,id2 [--experiment-ids=] [--activate=true]",
    );
    process.exitCode = 1;
    return;
  }
  await withP5(async ({ learning }) => {
    printJson(
      await learning.generateLearning({
        evaluationIds: flags["evaluation-ids"]!.split(",").filter(Boolean),
        experimentIds: flags["experiment-ids"]?.split(",").filter(Boolean),
        activate: flags.activate === "true",
      }),
    );
  });
}

export async function runStrategyFeedbackCli(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (!flags["topic-id"]) {
    console.error(
      "Usage: strategy-feedback -- --topic-id= [--learning-rule-ids=] [--evaluation-ids=] [--experiment-ids=] [--create-strategy=true]",
    );
    process.exitCode = 1;
    return;
  }
  await withP5(async ({ learning, lifecycle }) => {
    printJson(
      await learning.strategyFeedback({
        topicCandidateId: flags["topic-id"]!,
        learningRuleIds: flags["learning-rule-ids"]?.split(",").filter(Boolean),
        evaluationIds: flags["evaluation-ids"]?.split(",").filter(Boolean),
        experimentIds: flags["experiment-ids"]?.split(",").filter(Boolean),
        createStrategy: flags["create-strategy"] === "true",
        createStrategyFn: (topicId, fb) =>
          lifecycle.createRuleBasedStrategy(topicId, { learningFeedback: fb }),
      }),
    );
  });
}

export async function runP5VerticalCli(): Promise<void> {
  const config = loadConfig({ requireDatabaseUrl: false });
  const database = createDatabaseClient();
  await database.connect();
  try {
    const lifecycleRepo = new LifecycleRepository(database.prisma);
    const p5Repo = new P5Repository(database.prisma);
    printJson(await runP5MockVertical({ lifecycleRepo, p5Repo, config }));
  } finally {
    await database.disconnect();
  }
}
