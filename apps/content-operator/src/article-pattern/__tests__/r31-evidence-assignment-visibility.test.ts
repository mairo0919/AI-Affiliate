/**
 * r31 — Evidence assignment visibility (LLM=0).
 * r43: Writer atom projection removed; assert internal assignment / family dedupe only.
 */

import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  dedupeConcreteEvidenceByFamily,
} from "../evidence-pack.js";
import { buildResearchEvidence } from "../research-evidence.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { classifySemanticEvidence } from "../semantic-evidence.js";

const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

const PAGE_ATOMS = [
  "10作品",
  "22本番",
  "45射精",
  "480分",
  "メスガキ",
  "わからせ",
  "痴女誘惑",
  "激ピス",
  "ギャル妹",
  "小悪魔",
  "絶対空域",
  "デカ尻",
  "松本いちか",
];

describe("r31 evidence assignment visibility (LLM=0)", () => {
  function buildInternal() {
    const research = buildResearchEvidence({
      productTitle: MIZD,
      claims: PAGE_ATOMS.map((fact, i) => ({
        id: `c${i}`,
        statement: fact,
        kind: "trait_or_scene",
        status: "SUPPORTED" as const,
      })),
    });
    const pack = buildEvidencePack({
      productTitle: MIZD,
      claims: PAGE_ATOMS.map((fact, i) => ({
        id: `c${i}`,
        statement: fact,
        kind: "trait_or_scene",
        status: "SUPPORTED",
      })),
      researchEvidence: [
        ...research,
        ...PAGE_ATOMS.map((fact) => ({
          claimId: null as string | null,
          facetType: classifySemanticEvidence(fact, {
            sourceType: "product_description",
          }).blueprintType,
          observedFact: fact,
          sourceType: "product_description" as const,
          confidence: "high" as const,
        })),
      ],
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    expect(feasibility.ok).toBe(true);
    return { pack, profile, feasibility };
  }

  it("A–E: internal available >= preferred; no generationEligible drop via family dedupe", () => {
    const { pack, feasibility } = buildInternal();
    const eligible = pack.concreteEvidence.filter((e) => e.generationEligible);
    const available = dedupeConcreteEvidenceByFamily(eligible);
    const preferredItems = [
      feasibility.assignment.title.primary,
      ...feasibility.assignment.title.supporting,
      feasibility.assignment.opening.primary,
      ...feasibility.assignment.opening.supporting,
      ...feasibility.assignment.body.flatMap((b) => [b.primary, ...b.supporting]),
      feasibility.assignment.ending.primary,
    ].filter(Boolean);
    const preferred = dedupeConcreteEvidenceByFamily(
      preferredItems as typeof eligible,
    );

    expect(preferred.length).toBeGreaterThan(0);
    expect(available.length).toBeGreaterThanOrEqual(preferred.length);
    expect(feasibility.assignment.anyFallbackCount).toBe(0);
  });

  it("E: Skeleton body slot count does not cap internal concrete evidence", () => {
    const { pack, feasibility } = buildInternal();
    const bodySlots = feasibility.skeleton.body.length;
    const available = dedupeConcreteEvidenceByFamily(
      pack.concreteEvidence.filter((e) => e.generationEligible),
    );
    expect(bodySlots).toBeLessThanOrEqual(2);
    expect(available.length).toBeGreaterThan(bodySlots);
    expect(available.length).toBeGreaterThan(6);
  });

  it("mizd expected facts remain in internal pack after family dedupe", () => {
    const { pack } = buildInternal();
    const blob = JSON.stringify(
      dedupeConcreteEvidenceByFamily(
        pack.concreteEvidence.filter((e) => e.generationEligible),
      ),
    );
    const expected = [
      "松本いちか",
      "令和イチのメスガキ",
      "ベスト",
      "10作品",
      "8時間",
      "デカ尻",
      "絶対空域",
      "22本番",
      "ギャル妹",
    ];
    for (const f of expected) {
      expect(blob.includes(f), `missing internal: ${f}`).toBe(true);
    }
  });
});
