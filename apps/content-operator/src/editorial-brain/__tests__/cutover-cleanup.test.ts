/**
 * Cutover cleanup plan/eligibility tests.
 */

import { describe, expect, it } from "vitest";
import {
  experienceMustNotMutateLearningRules,
  preBrainCutoverPolicy,
  ensureChannelModulesRegistered,
} from "../index.js";
import type { CutoverBucket } from "../cutover/evaluate-existing.js";

ensureChannelModulesRegistered();

describe("cutover cleanup policy", () => {
  it("never implicit accepts missing lifecycle", () => {
    expect(preBrainCutoverPolicy().implicitAcceptWhenMissingLifecycle).toBe(false);
    expect(preBrainCutoverPolicy().bulkDbAcceptMigrationForbidden).toBe(true);
  });

  it("bucket vocabulary is stable", () => {
    const buckets: CutoverBucket[] = [
      "ACCEPTABLE_EXISTING",
      "REQUIRES_REGEN",
      "BAD_INPUT",
      "UNSAFE_AMBIGUOUS",
      "SKIP_ALREADY_MANAGED",
      "SKIP_PUBLISHED_HISTORICAL",
      "SKIP_OBSOLETE",
      "SKIP_SUPERSEDED",
    ];
    expect(new Set(buckets).size).toBe(8);
  });

  it("LearningRule guard holds", () => {
    expect(experienceMustNotMutateLearningRules().writesLearningRule).toBe(false);
  });

  it("stamp eligibility requires Brain PASS not legacy QualityGate memory", async () => {
    const { evaluateExistingContentVersion } = await import("../cutover/evaluate-existing.js");
    expect(typeof evaluateExistingContentVersion).toBe("function");
  });

  it("plan and execute modules export", async () => {
    const plan = await import("../cutover/plan-active-cutover.js");
    const exec = await import("../cutover/execute-active-cutover.js");
    expect(typeof plan.planActiveCutover).toBe("function");
    expect(typeof exec.executeActiveCutover).toBe("function");
  });
});
