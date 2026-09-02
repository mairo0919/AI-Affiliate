/**
 * ModelRun lifecycle — plan_execution_failed must finalize FAILED (LLM=0).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const servicePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../generation/content-generation-service.ts",
);

describe("ModelRun failure status finalization (LLM=0)", () => {
  it("K. plan_execution_failed catch completes ModelRun as FAILED", () => {
    const src = readFileSync(servicePath, "utf8");
    expect(src).toMatch(
      /error\.code === "plan_execution_failed"[\s\S]*?completeModelRun\([\s\S]*?status:\s*"FAILED"/,
    );
    expect(src).toMatch(/plan_execution_failed must not leave RUNNING forever/);
  });

  it("K2. BLOG DEFER is preflight (no ModelRun/LLM); provider errors finalize FAILED", () => {
    const src = readFileSync(servicePath, "utf8");
    const generateStart = src.indexOf("async generateBloggerArticle(");
    expect(generateStart).toBeGreaterThan(0);
    const generateSlice = src.slice(generateStart);
    const deferIdx = generateSlice.indexOf('throw new GenerationPreflightError(\n        "insufficient_editorial_material"');
    const modelRunIdx = generateSlice.indexOf("const modelRun = await this.repo.createModelRun({");
    const llmIdx = generateSlice.indexOf("this.llm.executeTask({");
    expect(deferIdx).toBeGreaterThan(0);
    expect(modelRunIdx).toBeGreaterThan(deferIdx);
    expect(llmIdx).toBeGreaterThan(modelRunIdx);
    expect(generateSlice).toContain("DEFER_INSUFFICIENT_MATERIAL");
    expect(generateSlice).toContain("insufficient_editorial_material");
    // BLOG DEFER must not require a ModelRun errorType literal — throw is before createModelRun.
    const blogGenerate = generateSlice.slice(0, generateSlice.indexOf("async generateXPost("));
    expect(blogGenerate).not.toContain('errorType: "DEFER_INSUFFICIENT_MATERIAL"');
    expect(src).toContain("error instanceof LLMProviderError ? error.errorClass");
    expect(src).toMatch(/completeModelRun\(modelRun\.id,\s*\{\s*status:\s*"FAILED"/);
    expect(src).toContain('status: "COMPLETED"');
  });

  it("K3. R117: Brain repair path removed from production generation", () => {
    const src = readFileSync(servicePath, "utf8");
    expect(src).not.toContain("runBoundedBrainRepairOnVersion");
    expect(src).not.toContain("observeEditorialBrainShadowSafe");
    expect(src).toContain("Do not clobber a COMPLETED Generator ModelRun");
    expect(src).toContain('existing?.status === "COMPLETED"');
  });
});
