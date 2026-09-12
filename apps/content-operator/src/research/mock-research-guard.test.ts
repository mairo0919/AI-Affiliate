import { describe, expect, it, vi } from "vitest";

describe("mock research agent production guard", () => {
  it("refuses MockResearchProvider writes in production without explicit allow", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    delete process.env.RESEARCH_ALLOW_MOCK_AGENT;
    const { assertMockResearchAllowed } = await import("./mock-research-guard.js");
    expect(() => assertMockResearchAllowed("production")).toThrow(/RESEARCH_ALLOW_MOCK_AGENT/);
  });

  it("allows mock research when explicit flag is set", async () => {
    vi.resetModules();
    process.env.RESEARCH_ALLOW_MOCK_AGENT = "true";
    const { assertMockResearchAllowed } = await import("./mock-research-guard.js");
    expect(() => assertMockResearchAllowed("production")).not.toThrow();
    delete process.env.RESEARCH_ALLOW_MOCK_AGENT;
  });
});

describe("mock provider multi-source gate", () => {
  it("returns FANZA-only items by default", async () => {
    delete process.env.RESEARCH_MOCK_MULTI_SOURCE;
    const { MockResearchProvider } = await import("../providers/mock/index.js");
    const result = await new MockResearchProvider().collect();
    expect(result.items.every((i) => i.sourceType === "FANZA")).toBe(true);
    expect(result.items.some((i) => i.sourceType === "TIKTOK" || i.sourceType === "X")).toBe(false);
  });

  it("includes TikTok/X only when RESEARCH_MOCK_MULTI_SOURCE=true", async () => {
    process.env.RESEARCH_MOCK_MULTI_SOURCE = "true";
    vi.resetModules();
    const { MockResearchProvider } = await import("../providers/mock/index.js");
    const result = await new MockResearchProvider().collect();
    expect(result.items.some((i) => i.sourceType === "TIKTOK")).toBe(true);
    expect(result.items.some((i) => i.sourceType === "X")).toBe(true);
    delete process.env.RESEARCH_MOCK_MULTI_SOURCE;
  });
});
