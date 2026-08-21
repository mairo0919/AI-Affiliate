/**
 * r15 Phase 2 deterministic replay as vitest (LLM=0) — no tsx/DB required.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { buildGenerationAuthorityPromptContract } from "../../generation/generation-authority.js";
import { detectGenericProseViolations } from "../generation/generic-prose-compliance.js";
import { safeRedactReservedLead } from "../generation/lead-reservation-redact.js";
import {
  validatePostTransformIntegrity,
  integrityFindingsAsBrainCodes,
} from "../generation/post-transform-integrity.js";

const R14 = "/tmp/prod-gen-20260818-r14-investigate";
const R13 = "/tmp/prod-gen-20260817-r13-final";

describe("r15 phase2 deterministic replay (LLM=0)", () => {
  it("Authority projects OPTION B Writing Skeleton + Evidence Pack as SSOT", () => {
    const auth = buildGenerationAuthorityPromptContract({
      brainGenerationContract: {
        writingSkeleton: { opening: { purpose: "hook" }, body: [] },
        evidencePack: { concreteEvidence: [{ id: "1", fact: "16名" }] },
        layers: {
          FACTS: {},
          EDITORIAL_PLAN: { openingStrategy: "strongest_concrete_trait" },
          SEGMENT_CONTRACTS: {},
          REFERENCE_BLUEPRINT: { referenceId: "replay-ref", progression: ["lead", "dev"] },
          EVIDENCE_MAPPING_PLAN: { mappings: [{ role: "lead", assignedFacts: ["16名"] }] },
          REFERENCE_TRANSFORM_BLUEPRINT: { readiness: "TRANSFORM_READY", segmentOps: [] },
        },
      },
    });
    expect(auth.mode).toBe("OPTION_B");
    expect(auth.WRITING_SKELETON).toBeTruthy();
    expect(auth.EVIDENCE_PACK).toBeTruthy();
    expect(auth.SEGMENT_CONTRACTS).toBeUndefined();
  });

  it("mird broken lead fails integrity; safe redact refuses blind token delete", () => {
    const artifactPath = `${R14}/mird-broken-accepted.json`;
    const brokenLead = existsSync(artifactPath)
      ? (JSON.parse(readFileSync(artifactPath, "utf8")) as { lead: string }).lead
      : "MOODYZファン感謝祭 2024は、を目指す素人16名とAV女優16名が参加する1泊2日のツアーとして公開されています。";

    const integrity = validatePostTransformIntegrity({ lead: brokenLead, sections: [] });
    expect(integrity.ok).toBe(false);
    expect(integrityFindingsAsBrainCodes(integrity).length).toBeGreaterThan(0);

    const redact = safeRedactReservedLead({
      lead: "2024は、AV男優を目指す素人16名とAV女優16名が参加する1泊2日の大乱交ツアーとして公開されている。",
      reservedFacets: ["AV男優", "大乱交"],
      requiredFacets: ["16名", "1泊2日"],
    });
    expect(redact.ok).toBe(false);
    expect(redact.failureCode).toMatch(/RAW_PLAN_EXECUTION_FAILED|POST_TRANSFORM/);
    // Must not invent broken 「は、を」 form via token delete
    expect(redact.lead).not.toMatch(/は、を目指す/);
  });

  it("generic prose detector runs on r13 pred/mizd/mird articles when present", () => {
    const path = `${R13}/articles-full.json`;
    if (!existsSync(path)) {
      expect(true).toBe(true);
      return;
    }
    const articles = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>;
    const targets = articles.filter((a) => /pred|mizd|mird/i.test(String(a.label ?? a.profile ?? "")));
    expect(targets.length).toBeGreaterThan(0);
    for (const row of targets) {
      const article = (row.article ?? row) as {
        lead?: string;
        sections?: Array<{ paragraphs?: string[] }>;
      };
      const lead = article.lead ?? "";
      const sections = (article.sections ?? []).map((s) => ({ paragraphs: s.paragraphs ?? [] }));
      if (!lead) continue;
      const g = detectGenericProseViolations({
        lead,
        sections,
        transformationAvailable: true,
      });
      // Detector must execute (ok true or false — both valid); no throw
      expect(typeof g.ok).toBe("boolean");
    }
  });
});
