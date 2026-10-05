import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LLMProviderError } from "../../adapters/types.js";
import { OpenAiCompatibleLLMProvider } from "../../adapters/llm/openai-compatible-provider.js";
import {
  accountGenerationFailure,
  retainedFailureTokens,
  SCHEMA_VALIDATION_ERROR_TYPE,
} from "../../generation/generation-failure-accounting.js";
import { ledgeringXCopyProvider, type XCopyLedgerAttempt } from "../x-copy-ledger.js";
import {
  MAX_LOGICAL_X_COPY_GENERATIONS,
  readXCopyArtifact,
  X_COPY_QUALITY_RETRY_MS,
  X_COPY_TRANSIENT_RETRY_MS,
  type XCopyArtifactStore,
  type XCopyIdentity,
} from "../x-copy-artifact.js";
import { resolveXCopyArtifact, xScheduleGate } from "../x-copy-reuse.js";
import { X_SOCIAL_ADAPTATION_FORMAT, type XSocialAdaptationResult } from "../x-social-adaptation.js";

const NORMAL = "https://video.dmm.co.jp/av/content/?id=mida00805";
const BODY = "焦点だけを置いた紹介です。";

function memoryStore(seed: Record<string, unknown> = { stockAttempt: { keep: true } }): XCopyArtifactStore & {
  snapshot: () => unknown;
} {
  let raw: unknown = seed;
  let tail: Promise<void> = Promise.resolve();
  return {
    snapshot: () => raw,
    transact(fn) {
      const run = tail.then(async () => {
        const outcome = await fn(raw);
        if (outcome.rawData) raw = outcome.rawData;
        return outcome.value;
      });
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function identity(overrides: Partial<XCopyIdentity> = {}): XCopyIdentity {
  return {
    cid: "mida00805",
    contentVersionId: "cv1",
    destinationUrl: NORMAL,
    model: "gpt-4.1",
    promptVersion: "v3",
    policyVersion: "x-copy-reuse-v1:x-social-adaptation-v7",
    canonicalTitle: "作品",
    performerNames: ["出演者"],
    seriesName: null,
    claimStatements: [{ id: "c1", statement: "公式の事実" }],
    articlePlanFactTexts: ["公式の事実"],
    productTitle: "作品",
    officialDescription: "公式説明",
    mediaUrls: ["img1|https://pics.dmm.co.jp/digital/video/mida00805/sample.jpg"],
    ...overrides,
  };
}

function adaptation(input: {
  body?: string;
  url?: string | null;
  skip?: XSocialAdaptationResult["skip"];
  strategy?: XSocialAdaptationResult["publicationStrategy"];
}): XSocialAdaptationResult {
  const body = input.body ?? BODY;
  const posts = input.skip
    ? []
    : [{ sequence: 1, role: "ROOT" as const, body, linkKind: "fanza" as const }];
  return {
    threadShape: "SINGLE",
    threadReason: "test",
    linkMode: "DIRECT_AFFILIATE",
    publicationStrategy: input.strategy ?? "FANZA_NORMAL",
    publicationStrategyReason: "official",
    posts,
    parentBody: input.skip ? null : body,
    publicationIntent: null,
    canonicalTitleUsed: "作品",
    wpTitleUsedAsSoleInput: false,
    titleDivergence: false,
    hooks: ["焦点"],
    selectedFacts: [],
    discardedTaxonomy: [],
    realizedLines: [],
    productNameCopyRate: 0,
    skip: input.skip ?? null,
    socialPlan: null,
    reviewFindings: [],
    review: null,
    writerMode: "llm",
    wpUrl: null,
    fanzaUrl: input.url === undefined ? NORMAL : input.url,
    relatedXPost: null,
    mediaMode: "SAFE_IMAGE",
    mediaUrl: "https://pics.dmm.co.jp/digital/video/mida00805/sample.jpg",
    mediaReason: "hero",
    mediaRole: "hero",
    warnings: [],
    tracking: {
      format: X_SOCIAL_ADAPTATION_FORMAT,
      cid: "mida00805",
      linkMode: "DIRECT_AFFILIATE",
      threadShape: "SINGLE",
      publicationStrategy: input.strategy ?? "FANZA_NORMAL",
      replyOrder: null,
      hookCount: 1,
      factSources: [],
      skipped: Boolean(input.skip),
      mediaMode: "SAFE_IMAGE",
      writerMode: "llm",
    },
  };
}

describe("X copy artifact reuse", () => {
  it("persists the first probe and reuses it on the next tick and at execute", async () => {
    const store = memoryStore();
    let calls = 0;
    const generate = async () => {
      calls += 1;
      return adaptation({ body: BODY });
    };
    const now = new Date("2026-10-05T03:00:00Z");
    const first = await resolveXCopyArtifact({
      store,
      identity: identity(),
      now,
      trigger: "probe",
      generate,
    });
    expect(first.generated).toBe(true);
    expect(calls).toBe(1);
    const saved = readXCopyArtifact(store.snapshot());
    expect(saved?.state).toBe("PASS");
    expect(saved?.logicalGenerationCount).toBe(1);
    expect(saved?.adaptation?.posts[0]?.body).toBe(BODY);
    expect(saved?.destinationUrl).toBe(NORMAL);
    expect(saved?.model).toBe("gpt-4.1");
    expect((store.snapshot() as { stockAttempt?: { keep: boolean } }).stockAttempt?.keep).toBe(true);

    const next = await resolveXCopyArtifact({
      store,
      identity: identity(),
      now: new Date(now.getTime() + 60_000),
      trigger: "probe",
      generate,
    });
    const executed = await resolveXCopyArtifact({
      store,
      identity: identity(),
      now: new Date(now.getTime() + 120_000),
      trigger: "execute",
      generate,
    });
    expect(calls).toBe(1);
    expect(next.generated).toBe(false);
    expect(executed.generated).toBe(false);
    expect(executed.result.posts[0]?.body).toBe(BODY);
    expect(executed.result.fanzaUrl).toBe(NORMAL);
  });

  it("keeps one logical generation across ten ticks and execute", async () => {
    const store = memoryStore();
    let calls = 0;
    const generate = async () => {
      calls += 1;
      return adaptation({ body: BODY });
    };
    const start = new Date("2026-10-05T03:00:00Z");
    for (let tick = 0; tick < 10; tick += 1) {
      const probed = await resolveXCopyArtifact({
        store,
        identity: identity(),
        now: new Date(start.getTime() + tick * 60_000),
        trigger: "probe",
        generate,
      });
      expect(probed.result.posts[0]?.body).toBe(BODY);
    }
    const executed = await resolveXCopyArtifact({
      store,
      identity: identity(),
      now: new Date(start.getTime() + 10 * 60_000),
      trigger: "execute",
      generate,
    });
    expect(calls).toBe(1);
    expect(executed.generated).toBe(false);
    expect(readXCopyArtifact(store.snapshot())?.logicalGenerationCount).toBe(1);
  });

  it("generates again when the destination, version, policy, or media changes", async () => {
    const store = memoryStore();
    let calls = 0;
    const generate = async () => {
      calls += 1;
      return adaptation({ body: `copy-${calls}` });
    };
    const now = new Date("2026-10-05T03:00:00Z");
    await resolveXCopyArtifact({ store, identity: identity(), now, trigger: "probe", generate });
    await resolveXCopyArtifact({
      store,
      identity: identity({ destinationUrl: "https://video.dmm.co.jp/av/content/?id=mida00806" }),
      now,
      trigger: "probe",
      generate,
    });
    await resolveXCopyArtifact({
      store,
      identity: identity({ contentVersionId: "cv2" }),
      now,
      trigger: "probe",
      generate,
    });
    await resolveXCopyArtifact({
      store,
      identity: identity({ policyVersion: "x-copy-reuse-v2:x-social-adaptation-v7" }),
      now,
      trigger: "probe",
      generate,
    });
    await resolveXCopyArtifact({
      store,
      identity: identity({ promptVersion: "v4" }),
      now,
      trigger: "probe",
      generate,
    });
    await resolveXCopyArtifact({
      store,
      identity: identity({ mediaUrls: ["img2|https://pics.dmm.co.jp/other.jpg"] }),
      now,
      trigger: "probe",
      generate,
    });
    expect(calls).toBe(6);
  });

  it("does not regenerate a quality rejection on every 60 second tick", async () => {
    const store = memoryStore();
    let calls = 0;
    const generate = async () => {
      calls += 1;
      return adaptation({
        skip: { reason: "SOCIAL_REVIEW_FAILED", detail: "quality", failureClass: "QUALITY_FAILURE" },
      });
    };
    const start = new Date("2026-10-05T03:00:00Z");
    for (let tick = 0; tick < 10; tick += 1) {
      await resolveXCopyArtifact({
        store,
        identity: identity(),
        now: new Date(start.getTime() + tick * 60_000),
        trigger: "probe",
        generate,
      });
    }
    expect(calls).toBe(1);
    expect(readXCopyArtifact(store.snapshot())?.state).toBe("REJECTED_QUALITY");
    const later = await resolveXCopyArtifact({
      store,
      identity: identity(),
      now: new Date(start.getTime() + X_COPY_QUALITY_RETRY_MS + 1000),
      trigger: "probe",
      generate,
    });
    expect(later.generated).toBe(true);
    expect(calls).toBe(2);
  });

  it("retries a transient provider failure on a bounded backoff", async () => {
    const store = memoryStore();
    let calls = 0;
    const generate = async () => {
      calls += 1;
      return adaptation({
        skip: { reason: "SOCIAL_REVIEW_FAILED", detail: "provider", failureClass: "GENERATION_FAILURE" },
      });
    };
    let now = new Date("2026-10-05T03:00:00Z");
    await resolveXCopyArtifact({ store, identity: identity(), now, trigger: "probe", generate });
    now = new Date(now.getTime() + 60_000);
    await resolveXCopyArtifact({ store, identity: identity(), now, trigger: "probe", generate });
    expect(calls).toBe(1);
    for (let attempt = 2; attempt <= MAX_LOGICAL_X_COPY_GENERATIONS; attempt += 1) {
      now = new Date(now.getTime() + X_COPY_TRANSIENT_RETRY_MS + 1000);
      await resolveXCopyArtifact({ store, identity: identity(), now, trigger: "probe", generate });
      expect(calls).toBe(attempt);
    }
    now = new Date(now.getTime() + X_COPY_TRANSIENT_RETRY_MS + 1000);
    await resolveXCopyArtifact({ store, identity: identity(), now, trigger: "probe", generate });
    expect(calls).toBe(MAX_LOGICAL_X_COPY_GENERATIONS);
    expect(readXCopyArtifact(store.snapshot())?.state).toBe("FAILED_TRANSIENT");
  });

  it("starts at most one generation when probes overlap", async () => {
    const store = memoryStore();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = async () => {
      calls += 1;
      await gate;
      return adaptation({ body: BODY });
    };
    const now = new Date("2026-10-05T03:00:00Z");
    const both = Promise.all([
      resolveXCopyArtifact({ store, identity: identity(), now, trigger: "probe", generate }),
      resolveXCopyArtifact({ store, identity: identity(), now, trigger: "probe", generate }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(1);
    release();
    const [left, right] = await both;
    const generated = [left, right].filter((item) => item.generated);
    const waited = [left, right].filter((item) => !item.generated);
    expect(generated).toHaveLength(1);
    expect(waited).toHaveLength(1);
    expect(waited[0]?.result.skip?.detail).toBe("X_COPY_GENERATION_IN_PROGRESS");
  });

  it("keeps the official URL gate", () => {
    const pass = xScheduleGate(adaptation({ body: `${BODY} ${NORMAL}` }));
    expect(pass.pass).toBe(true);
    const wordpress = xScheduleGate(
      adaptation({ body: `${BODY} https://otonaselect.net/works/mida00805/` }),
    );
    expect(wordpress.pass).toBe(false);
    if (!wordpress.pass) expect(wordpress.skipReason).toBe("BLOCKED_INVALID_X_DESTINATION");
    const affiliate = xScheduleGate(
      adaptation({
        body: `${BODY} https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2F&af_id=example-id`,
      }),
    );
    expect(affiliate.pass).toBe(false);
    if (!affiliate.pass) expect(affiliate.skipReason).toBe("BLOCKED_INVALID_X_DESTINATION");
  });
});

describe("X copy and editorial observability", () => {
  it("records each X copy HTTP attempt without the prompt", async () => {
    const attempts: XCopyLedgerAttempt[] = [];
    const ledger = {
      async recordAttempt(input: XCopyLedgerAttempt) {
        attempts.push(input);
        return `run-${attempts.length}`;
      },
    };
    const wrapped = ledgeringXCopyProvider(
      {
        providerKey: "openai-compatible",
        async executeTask() {
          return {
            output: { body: BODY },
            inputTokens: 120,
            outputTokens: 40,
            estimatedCost: 1.2,
            actualCost: null,
            currency: "JPY",
            provider: "openai-compatible",
            model: "gpt-4.1",
          };
        },
      },
      ledger,
      {
        logicalGenerationId: "logical-1",
        fingerprint: "fp-1",
        trigger: "probe",
        cid: "mida00805",
      },
    );
    await wrapped.executeTask({
      taskType: "GENERATION_X_SOCIAL",
      promptIdentifier: "x.social.generate",
      promptVersion: "v3",
      userPrompt: "SECRET PROMPT TEXT",
    });
    await wrapped.executeTask({
      taskType: "GENERATION_X_SOCIAL",
      promptIdentifier: "x.social.generate.retry_safe",
      promptVersion: "v3",
      userPrompt: "SECRET REWRITE",
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      trigger: "probe",
      cid: "mida00805",
      fingerprint: "fp-1",
      logicalGenerationId: "logical-1",
      httpAttempt: 1,
      inputTokens: 120,
      outputTokens: 40,
      model: "gpt-4.1",
      success: true,
      retryOfId: null,
    });
    expect(attempts[1]?.httpAttempt).toBe(2);
    expect(attempts[1]?.retryOfId).toBe("run-1");
    expect(JSON.stringify(attempts)).not.toContain("SECRET");
  });

  it("keeps provider errors distinct from schema validation and retains billed usage", () => {
    const rateLimit = accountGenerationFailure(
      new LLMProviderError("LLM rate limited", "rate_limit", true),
    );
    expect(rateLimit.providerPreserved).toBe(true);
    expect(rateLimit.errorType).toBe("rate_limit");
    expect(rateLimit.errorType).not.toBe(SCHEMA_VALIDATION_ERROR_TYPE);

    const billed = retainedFailureTokens({
      providerUsage: null,
      response: { inputTokens: 900, outputTokens: 80, estimatedCost: 2 },
    });
    expect(billed).toEqual({ inputTokens: 900, outputTokens: 80, estimatedCost: 2 });

    const malformed = accountGenerationFailure(
      new LLMProviderError("LLM returned malformed JSON", "malformed_output", false, {
        inputTokens: 50,
        outputTokens: 10,
        estimatedCost: 0.4,
        actualCost: null,
        currency: "JPY",
        provider: "openai-compatible",
        model: "gpt-4.1",
      }),
    );
    expect(malformed.errorType).toBe("malformed_output");
    expect(malformed.usage?.inputTokens).toBe(50);
    expect(accountGenerationFailure(new Error("zod")).errorType).toBe(SCHEMA_VALIDATION_ERROR_TYPE);
  });

  it("attaches usage from a billed malformed JSON response", async () => {
    const provider = new OpenAiCompatibleLLMProvider({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4.1",
      timeoutMs: 1000,
      maxAttempts: 1,
      currency: "JPY",
      yenPer1kInput: 0.15,
      yenPer1kOutput: 0.6,
      allowExternal: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not-json" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 33, completion_tokens: 7 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(
      provider.executeTask({ taskType: "GENERATION_X_SOCIAL", userPrompt: "{}" }),
    ).rejects.toMatchObject({
      errorClass: "malformed_output",
      usage: { inputTokens: 33, outputTokens: 7, model: "gpt-4.1" },
    });
  });

  it("does not call the model from the X publish path", () => {
    const root = path.resolve(__dirname, "../..");
    const publication = fs.readFileSync(path.join(root, "x/publication-service.ts"), "utf8");
    const scheduler = fs.readFileSync(path.join(root, "schedules/scheduler-pipeline.ts"), "utf8");
    expect(publication).not.toMatch(/executeTask|writeXSocialCopy/);
    expect(scheduler).not.toMatch(/writeXSocialCopy/);
    const writer = fs.readFileSync(path.join(root, "x/social-write.ts"), "utf8");
    const slot = fs.readFileSync(path.join(root, "daily-ops/x-slot-live.ts"), "utf8");
    const adapt = fs.readFileSync(path.join(root, "x/x-social-adaptation.ts"), "utf8");
    expect(writer).toContain('export const X_SOCIAL_WRITER_PROMPT_VERSION = "v3"');
    expect(slot).toContain("await adaptLoadedCanonicalToX");
    expect(slot).toContain("llmModel: input.model");
    expect(slot).not.toContain("gpt-4.1-mini");
    expect(adapt).toContain("runXSocialPipeline");
  });
});
