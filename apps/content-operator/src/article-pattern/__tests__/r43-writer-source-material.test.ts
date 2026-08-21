/**
 * r43 — Writer atom bypass (LLM=0).
 * Writer sees title / Claims / official description / CTA — not atoms.
 */

import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  evidenceAllowlistIdsFromPack,
  toOptionBWriterSourceMaterial,
} from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { toWritingSkeletonPromptContract } from "../writing-skeleton.js";
import { buildOptionBGenerationAuthority } from "../../generation/generation-authority.js";
import { buildOptionBBloggerGeneratorPrompt } from "../../editorial-brain/generation/option-b-blogger-prompt.js";

const MIZD =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";

const DESC =
  "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！";

const CLAIMS = [
  {
    id: "cms-title",
    statement: MIZD,
    kind: "product_title",
  },
  {
    id: "cms-10",
    statement: "10作品が収録規模として記載されている。",
    kind: "trait_or_scene",
  },
  {
    id: "cms-time",
    statement: "時間ベストが公開情報として記載されている。",
    kind: "trait_or_scene",
  },
];

const FORBIDDEN_IN_WRITER = [
  "concreteEvidence",
  "availableConcreteEvidence",
  "preferredEvidence",
  "assignedFacts",
  "page_atom::",
  "title_facet::",
  "body_trait",
  "unknown_concrete",
  "performer_identity",
  "primaryEvidenceRole",
  "supportingEvidenceRoles",
  "slotAssignment",
];

describe("r43 Writer source material (LLM=0)", () => {
  function build() {
    const pack = buildEvidencePack({
      productTitle: MIZD,
      claims: CLAIMS.map((c) => ({
        id: c.id,
        statement: c.statement,
        kind: c.kind,
        status: "SUPPORTED" as const,
      })),
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feasibility = ensureFeasibleWritingSkeleton({
      skeleton: skeletonFromMaterialProfile(profile),
      pack,
      profile,
    });
    expect(feasibility.ok).toBe(true);
    const skeletonPrompt = toWritingSkeletonPromptContract(feasibility.skeleton)!;
    const evidencePrompt = toOptionBWriterSourceMaterial({
      productTitle: MIZD,
      claims: CLAIMS,
      officialDescription: DESC,
    });
    const auth = buildOptionBGenerationAuthority({
      writingSkeleton: skeletonPrompt,
      evidencePack: evidencePrompt,
    });
    const prompt = buildOptionBBloggerGeneratorPrompt({
      productTitle: MIZD,
      ctaUrl: "https://video.dmm.co.jp/av/content/?id=mizd00320",
      articleFormat: "NEW_RELEASE_SINGLE",
      generationAuthority: auth,
    });
    const full = prompt.systemInstruction + "\n" + prompt.userPrompt;
    return { pack, feasibility, skeletonPrompt, evidencePrompt, auth, prompt, full };
  }

  it("Writer atom exposure = 0; taxonomy / assignedFacts absent", () => {
    const { full, evidencePrompt, skeletonPrompt } = build();
    for (const token of FORBIDDEN_IN_WRITER) {
      expect(full.includes(token), `leaked: ${token}`).toBe(false);
    }
    expect(evidencePrompt).not.toHaveProperty("concreteEvidence");
    expect(JSON.stringify(skeletonPrompt)).not.toMatch(/assignedFacts/);
  });

  it("official description + Claims + title + CTA are Writer visible", () => {
    const { full, evidencePrompt } = build();
    expect(evidencePrompt.productTitle).toBe(MIZD);
    expect(evidencePrompt.officialDescription).toBe(DESC);
    const claims = evidencePrompt.supportedClaims as Array<{ id: string; statement: string }>;
    expect(claims).toHaveLength(3);
    expect(claims.map((c) => c.id)).toEqual(CLAIMS.map((c) => c.id));
    expect(full).toContain(DESC);
    expect(full).toContain("10作品が収録規模として記載されている。");
    expect(full).toContain("https://video.dmm.co.jp/av/content/?id=mizd00320");
    expect(full).toContain(MIZD);
  });

  it("planning atoms / assignment still work internally", () => {
    const { pack, feasibility } = build();
    expect(pack.concreteEvidence.some((e) => e.generationEligible)).toBe(true);
    expect(feasibility.assignment.opening.primary).toBeTruthy();
    expect(feasibility.assignment.anyFallbackCount).toBe(0);
    expect(evidenceAllowlistIdsFromPack(pack).length).toBeGreaterThan(0);
  });

  it("skeleton Writer projection is purpose-only HOW", () => {
    const { skeletonPrompt } = build();
    expect((skeletonPrompt.opening as { purpose?: string }).purpose).toBeTruthy();
    expect(skeletonPrompt.opening).not.toHaveProperty("assignedFacts");
  });
});
