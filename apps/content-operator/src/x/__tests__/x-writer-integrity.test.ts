import { describe, expect, it } from "vitest";
import type { LLMProvider, LLMTaskRequest, LLMTaskResult } from "../../adapters/types.js";
import { planXSocial, type XSocialPlan } from "../social-plan.js";
import { reviewXSocialCopy } from "../social-review.js";
import { runXSocialPipeline } from "../social-pipeline.js";
import { X_SOCIAL_BODY_MAX_WEIGHTED, writeXSocialCopy } from "../social-write.js";

const TITLE =
  "ROCKET18周年記念ユーザーリクエスト祭り 完全主観ホラー＆下品エロ 神出鬼没！僕の精液を狙う恐怖のド変態女";

function plan(): XSocialPlan {
  const planned = planXSocial({
    canonicalTitle: TITLE,
    productTitle: TITLE,
    performerNames: ["九井スナオ"],
    claimStatements: [],
  });
  if (!planned.ok || planned.plan.viability !== "X_POSTABLE") throw new Error("plan not postable");
  return planned.plan;
}

function result(body: string): LLMTaskResult {
  return {
    output: { body },
    inputTokens: 1,
    outputTokens: 1,
    estimatedCost: 0,
    currency: "USD",
    provider: "fake",
    model: "fake",
  };
}

function scripted(bodies: Array<string | Error>): LLMProvider & { prompts: LLMTaskRequest[] } {
  const prompts: LLMTaskRequest[] = [];
  return {
    providerKey: "fake",
    prompts,
    async executeTask(request: LLMTaskRequest) {
      prompts.push(request);
      const next = bodies.shift();
      if (next instanceof Error) throw next;
      return result(next ?? "");
    },
  } as LLMProvider & { prompts: LLMTaskRequest[] };
}

describe("X writer integrity", () => {
  it("surfaces a model failure instead of turning it into an empty draft", async () => {
    const llm = scripted([new Error("CIRCUIT_OPEN")]);
    await expect(writeXSocialCopy(plan(), { llm })).rejects.toThrow("CIRCUIT_OPEN");
  });

  it("keeps the writer's exclamation, question marks, and line breaks", async () => {
    const llm = scripted(["九井スナオの続編、出てたのか！\n仕事終わりの話ってまた見たくなる？"]);
    const draft = await writeXSocialCopy(plan(), { llm });
    expect(draft.body).toBe("九井スナオの続編、出てたのか！\n仕事終わりの話ってまた見たくなる？");
    expect(draft.sentences).toEqual(["九井スナオの続編、出てたのか！", "仕事終わりの話ってまた見たくなる？"]);
  });

  it("measures length the way X does (Japanese counts as 2)", () => {
    const longJapanese = "あ".repeat(Math.floor(X_SOCIAL_BODY_MAX_WEIGHTED / 2) + 1);
    const review = reviewXSocialCopy(longJapanese, plan());
    expect(review.findings.map((f) => f.code)).toContain("TOO_LONG");
  });

  it("revises the draft the findings were about, not an older one", async () => {
    // Both drafts fail on findings that keep the previous draft as the rewrite anchor.
    const first = "九井スナオとミサキの完全主観ホラー、気になってた。";
    const second = "九井スナオとアヤカの完全主観ホラー、気になってた。";
    const line = "九井スナオの完全主観ホラー、気になってた。";
    const llm = scripted([first, second, line]);
    await runXSocialPipeline({
      canonicalTitle: TITLE,
      productTitle: TITLE,
      performerNames: ["九井スナオ"],
      claimStatements: [],
      llm,
      maxRewrites: 2,
    });
    expect(llm.prompts).toHaveLength(3);
    expect(llm.prompts[2]!.userPrompt).toContain(second);
    expect(llm.prompts[2]!.userPrompt).not.toContain(first);
  });

  it("lets a personal reaction through, and still stops an invented name or number", () => {
    const pass = [
      "九井スナオの完全主観ホラー、気になってた。夜に見るのはやめておこう。",
      "九井スナオ、こういう役も合うんだな。完全主観ホラーは初めて見るかも。",
      "神出鬼没って書いてあって笑った。九井スナオの完全主観ホラー、あとで見る。",
      "九井スナオの新作、完全主観ホラーらしい。怖いの苦手だけど見たい！",
    ];
    for (const body of pass) {
      const blocking = reviewXSocialCopy(body, plan()).findings.filter((f) => f.severity === "BLOCKING");
      expect(blocking.map((f) => f.code), body).toEqual([]);
    }
    const invented = [
      "九井スナオとミサキの完全主観ホラー、気になってた。",
      "九井スナオの完全主観ホラー、120分もあるのか。",
      "怖いの苦手だけど見たい。夜に見るのはやめておこう。",
    ];
    for (const body of invented) {
      const codes = reviewXSocialCopy(body, plan()).findings.map((f) => f.code);
      expect(codes, body).toContain("UNGROUNDED");
    }
  });
});
