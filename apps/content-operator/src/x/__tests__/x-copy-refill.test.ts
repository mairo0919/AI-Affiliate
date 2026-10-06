import { describe, expect, it } from "vitest";
import { maxNewXCopyCandidatesForRefill, MAX_NEW_X_COPY_CANDIDATES_PER_REFILL } from "../x-copy-artifact.js";
import {
  orderCandidatesByPublicationPriority,
  runXCandidateRefill,
  type XRefillPrepare,
} from "../x-copy-refill.js";

function spend(willGenerate: boolean): XRefillPrepare {
  return { kind: "spend", willGenerate };
}

describe("x candidate refill", () => {
  it("fills three open slots from PASS artifacts with no new model call", async () => {
    let generated = 0;
    const result = await runXCandidateRefill({
      slotsNeeded: 3,
      maxNewGenerations: maxNewXCopyCandidatesForRefill(3),
      candidates: ["a", "b", "c", "d"],
      prepare: async () => spend(false),
      materialize: async (id) => {
        generated += id === "d" ? 1 : 0;
        return { probe: { canonicalId: id, pass: true }, generated: false, transient: false };
      },
    });
    expect(result.metrics.slotsFilled).toBe(3);
    expect(result.metrics.passArtifactReused).toBe(3);
    expect(result.metrics.newLlmGenerations).toBe(0);
    expect(generated).toBe(0);
    expect(result.probes.map((probe) => probe.canonicalId)).toEqual(["a", "b", "c"]);
  });

  it("uses one stored PASS and generates only for the remaining slot", async () => {
    const seen: string[] = [];
    const result = await runXCandidateRefill({
      slotsNeeded: 2,
      maxNewGenerations: maxNewXCopyCandidatesForRefill(2),
      candidates: ["pass", "reject", "pass2", "later"],
      prepare: async (id) => spend(id !== "pass"),
      materialize: async (id) => {
        seen.push(id);
        if (id === "later") throw new Error("later candidate called the model");
        if (id === "reject") {
          return { probe: { canonicalId: id, pass: false, skipReason: "SOFT_QUALITY" }, generated: true, transient: false };
        }
        return { probe: { canonicalId: id, pass: true }, generated: id !== "pass", transient: false };
      },
    });
    expect(seen).toEqual(["pass", "reject", "pass2"]);
    expect(result.metrics.passArtifactReused).toBe(1);
    expect(result.metrics.newLlmGenerations).toBe(2);
    expect(result.metrics.llmRejected).toBe(1);
    expect(result.metrics.slotsFilled).toBe(2);
  });

  it("does not call the model again for the same rejected candidate", async () => {
    let calls = 0;
    const once = await runXCandidateRefill({
      slotsNeeded: 1,
      maxNewGenerations: 5,
      candidates: ["b"],
      prepare: async () => spend(true),
      materialize: async () => {
        calls += 1;
        return { probe: { canonicalId: "b", pass: false, skipReason: "SOFT_QUALITY" }, generated: true, transient: false };
      },
    });
    const again = await runXCandidateRefill({
      slotsNeeded: 1,
      maxNewGenerations: 5,
      candidates: ["b", "c"],
      prepare: async (id) =>
        id === "b"
          ? { kind: "cached_reject", probe: { canonicalId: "b", pass: false, skipReason: "SOFT_QUALITY" } }
          : spend(true),
      materialize: async (id) => {
        calls += 1;
        return { probe: { canonicalId: id, pass: true }, generated: true, transient: false };
      },
    });
    expect(once.metrics.llmRejected).toBe(1);
    expect(again.metrics.passArtifactReused).toBe(0);
    expect(again.metrics.slotsFilled).toBe(1);
    expect(again.probes[0]?.canonicalId).toBe("b");
    expect(calls).toBe(2);
  });

  it("allows regeneration after the relevant fingerprint changes", async () => {
    let calls = 0;
    const result = await runXCandidateRefill({
      slotsNeeded: 1,
      maxNewGenerations: 5,
      candidates: ["changed"],
      prepare: async () => spend(true),
      materialize: async () => {
        calls += 1;
        return { probe: { canonicalId: "changed", pass: true }, generated: true, transient: false };
      },
    });
    expect(calls).toBe(1);
    expect(result.metrics.llmPass).toBe(1);
  });

  it("bounds model calls across a long candidate list", async () => {
    const cap = maxNewXCopyCandidatesForRefill(3);
    expect(cap).toBeLessThan(MAX_NEW_X_COPY_CANDIDATES_PER_REFILL);
    expect(cap).toBe(5);
    let calls = 0;
    const result = await runXCandidateRefill({
      slotsNeeded: 3,
      maxNewGenerations: cap,
      candidates: Array.from({ length: 80 }, (_, index) => `c${index}`),
      prepare: async () => spend(true),
      materialize: async (id) => {
        calls += 1;
        return { probe: { canonicalId: id, pass: false, skipReason: "SOFT_QUALITY" }, generated: true, transient: false };
      },
    });
    expect(calls).toBe(5);
    expect(result.metrics.newLlmGenerations).toBe(5);
    expect(result.metrics.slotsFilled).toBe(0);
  });

  it("keeps a full horizon at zero generations for eighteen ticks", async () => {
    let calls = 0;
    for (let tick = 0; tick < 18; tick += 1) {
      await runXCandidateRefill({
        slotsNeeded: 0,
        maxNewGenerations: maxNewXCopyCandidatesForRefill(0),
        candidates: Array.from({ length: 80 }, (_, index) => index),
        prepare: async () => {
          calls += 1;
          return spend(true);
        },
        materialize: async () => {
          calls += 1;
          return { probe: { canonicalId: "x", pass: true }, generated: true, transient: false };
        },
      });
    }
    expect(calls).toBe(0);
  });

  it("continues to the next candidate after a transient failure", async () => {
    const seen: string[] = [];
    const result = await runXCandidateRefill({
      slotsNeeded: 1,
      maxNewGenerations: 5,
      candidates: ["transient", "next"],
      prepare: async () => spend(true),
      materialize: async (id) => {
        seen.push(id);
        return {
          probe: { canonicalId: id, pass: id === "next" },
          generated: true,
          transient: id === "transient",
        };
      },
    });
    expect(seen).toEqual(["transient", "next"]);
    expect(result.metrics.transientFailed).toBe(1);
    expect(result.metrics.slotsFilled).toBe(1);
  });

  it("does not generate when recommended works exist but no future slot is open", async () => {
    let calls = 0;
    const result = await runXCandidateRefill({
      slotsNeeded: 0,
      maxNewGenerations: maxNewXCopyCandidatesForRefill(0),
      candidates: [
        { researchItemId: "rec", recommendedRank: 1 },
        { researchItemId: "normal" },
      ],
      prepare: async () => {
        calls += 1;
        return spend(true);
      },
      materialize: async () => {
        calls += 1;
        return { probe: { canonicalId: "rec", pass: true }, generated: true, transient: false };
      },
    });
    expect(calls).toBe(0);
    expect(result.metrics.newLlmGenerations).toBe(0);
  });

  it("reuses a recommended PASS artifact before generating for anyone else", async () => {
    const ordered = orderCandidatesByPublicationPriority(
      [
        { researchItemId: "normal-pass", recommendedRank: null, popularRank: null },
        { researchItemId: "rec-new", recommendedRank: 2, popularRank: null },
        { researchItemId: "rec-pass", recommendedRank: 4, popularRank: null },
      ],
      new Set(["normal-pass", "rec-pass"]),
    );
    expect(ordered.map((row) => row.researchItemId)).toEqual(["rec-pass", "rec-new", "normal-pass"]);
    let generated = 0;
    const result = await runXCandidateRefill({
      slotsNeeded: 1,
      maxNewGenerations: 5,
      candidates: ordered,
      prepare: async (row) => spend(row.researchItemId !== "rec-pass"),
      materialize: async (row) => {
        generated += row.researchItemId === "rec-pass" ? 0 : 1;
        return { probe: { canonicalId: row.researchItemId, pass: true }, generated: false, transient: false };
      },
    });
    expect(result.probes.map((probe) => probe.canonicalId)).toEqual(["rec-pass"]);
    expect(result.metrics.passArtifactReused).toBe(1);
    expect(result.metrics.newLlmGenerations).toBe(0);
    expect(generated).toBe(0);
  });

  it("considers an eligible recommended work before a normal PASS when one slot is open", async () => {
    const ordered = orderCandidatesByPublicationPriority(
      [
        { researchItemId: "normal-pass", recommendedRank: null, popularRank: null },
        { researchItemId: "rec-new", recommendedRank: 8, popularRank: null },
      ],
      new Set(["normal-pass"]),
    );
    expect(ordered[0]?.researchItemId).toBe("rec-new");
    const seen: string[] = [];
    const result = await runXCandidateRefill({
      slotsNeeded: 1,
      maxNewGenerations: 1,
      candidates: ordered,
      prepare: async () => spend(true),
      materialize: async (row) => {
        seen.push(row.researchItemId);
        return { probe: { canonicalId: row.researchItemId, pass: true }, generated: true, transient: false };
      },
    });
    expect(seen).toEqual(["rec-new"]);
    expect(result.metrics.newLlmGenerations).toBe(1);
    expect(result.metrics.slotsFilled).toBe(1);
  });

  it.each(["OFFICIAL_URL_INVALID", "MEDIA_MISMATCH", "WORDPRESS_URL", "AFFILIATE_URL"])(
    "rejects %s before any model call",
    async (skipReason) => {
      let calls = 0;
      const result = await runXCandidateRefill({
        slotsNeeded: 1,
        maxNewGenerations: 5,
        candidates: ["blocked"],
        prepare: async () => ({
          kind: "hard_block",
          probe: { canonicalId: "blocked", pass: false, skipReason },
        }),
        materialize: async () => {
          calls += 1;
          return { probe: { canonicalId: "blocked", pass: true }, generated: true, transient: false };
        },
      });
      expect(calls).toBe(0);
      expect(result.metrics.deterministicRejected).toBe(1);
      expect(result.metrics.newLlmGenerations).toBe(0);
    },
  );
});
