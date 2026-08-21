import { describe, expect, it } from "vitest";
import { loadConfig, validateProductionConfig } from "@ai-affiliate/config";
import { assertSafeOutboundUrl, sanitizeCsvCell, SsrfBlockedError } from "@ai-affiliate/shared";
import { runP8MockVertical } from "./p8-vertical.js";
import { QualityGateService } from "../generation/quality-gate.js";
import { LifecycleRepository, createDatabaseClient } from "@ai-affiliate/database";
import { MockLLMProvider } from "../adapters/llm/mock-llm-provider.js";
import { ContentGenerationService } from "../generation/content-generation-service.js";

loadConfig({ requireDatabaseUrl: false });

describe("P8 SSRF / CSV / production config", () => {
  it("blocks private and metadata URLs", () => {
    expect(() => assertSafeOutboundUrl("http://127.0.0.1/x")).toThrow(SsrfBlockedError);
    expect(() => assertSafeOutboundUrl("http://169.254.169.254/latest")).toThrow(SsrfBlockedError);
    expect(() => assertSafeOutboundUrl("http://10.0.0.5/a")).toThrow(SsrfBlockedError);
    expect(() => assertSafeOutboundUrl("ftp://example.com")).toThrow(SsrfBlockedError);
    expect(assertSafeOutboundUrl("https://example.com/path").hostname).toBe("example.com");
  });

  it("neutralizes CSV formula injection", () => {
    expect(sanitizeCsvCell("=CMD()")).toBe("'=CMD()");
    expect(sanitizeCsvCell("normal")).toBe("normal");
  });

  it("rejects default bootstrap password in production", () => {
    const config = loadConfig({ requireDatabaseUrl: false });
    const result = validateProductionConfig(
      { ...config, adminBootstrapPassword: "change-me-admin" },
      { env: { NODE_ENV: "production" } },
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "DEFAULT_BOOTSTRAP_PASSWORD")).toBe(true);
  });
});

describe("P8 quality gate + vertical", () => {
  const database = createDatabaseClient();

  it("marks LLM fallback as manual_review recommended", async () => {
    await database.connect();
    try {
      const repo = new LifecycleRepository(database.prisma);
      const content = await repo.createContent({ status: "DRAFT" });
      const version = await repo.createContentVersion({
        contentId: content.id,
        versionNumber: 1,
        title: "Gate fixture",
        body: "十分な長さの本文です。https://example.invalid/p アフィリエイト広告を含む場合があります。",
        status: "REVIEWING",
      });
      const generation = new ContentGenerationService(repo, new MockLLMProvider(), {
        generation: "mock",
        review: "mock",
        revision: "mock",
      });
      const gate = new QualityGateService(repo, generation);
      const result = await gate.evaluate(version.id, { usedLlmFallback: true, minScore: 0.2 });
      expect(result.recommendedAction).toBe("manual_review");
      expect(result.usedFallback).toBe(true);
    } finally {
      await database.disconnect();
    }
  }, 60_000);

  it("runs P8 mock vertical", async () => {
    const summary = await runP8MockVertical();
    expect(summary.originalBodyUnchanged).toBe(true);
    expect(summary.draftIdempotent).toBe(true);
    expect(summary.bloggerDraftId).toBeTruthy();
    expect(summary.usingMockLlm).toBe(true);
  }, 180_000);
});
