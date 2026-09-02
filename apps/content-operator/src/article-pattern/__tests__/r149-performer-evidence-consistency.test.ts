/**
 * R149 — performer evidence semantic consistency + catalog claim hygiene.
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  claimStatementsFromPageEvidence,
  dedupeConcreteEvidenceByFamily,
  enforcePerformerIdentityInvariant,
  evidenceSemanticAuthority,
  isCatalogConfirmationProse,
  normalizeEvidenceSurface,
  toOptionBWriterSourceMaterialFromPack,
} from "../evidence-pack.js";
import { buildProductMaterialProfileFromPack } from "../reference-type-profile.js";
import {
  ensureFeasibleWritingSkeleton,
  skeletonFromMaterialProfile,
} from "../skeleton-feasibility.js";
import { buildArticlePlan } from "../article-plan.js";
import { performerEntityKey } from "../performer-identity.js";
import type { EvidencePackItem } from "../evidence-pack.js";

const PARA_TITLE =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "学芸員の優梨まいなとましろ杏がスケベにご紹介◆優梨まいなとましろ杏、この2人と一緒に鑑賞しましょう";

function item(
  id: string,
  fact: string,
  type: EvidencePackItem["type"],
  sourceType: string,
): EvidencePackItem {
  return {
    id,
    type,
    fact,
    provenance: { sourceType, sourceRef: id },
    confidence: "high",
    generationEligible: true,
  };
}

function packWith(input: {
  productTitle: string;
  actors?: string[];
  description?: string;
  claims?: Array<{ id: string; statement: string; kind?: string; status?: string }>;
}) {
  return buildEvidencePack({
    productTitle: input.productTitle,
    claims: input.claims ?? [{ id: "c0", statement: input.productTitle, status: "SUPPORTED" }],
    pageEvidenceMeta: {
      description: input.description
        ? { text: input.description, originField: "jsonld.Product.description" }
        : undefined,
      actors: input.actors,
    },
  });
}

function feasibilityFor(pack: ReturnType<typeof buildEvidencePack>) {
  const profile = buildProductMaterialProfileFromPack(pack);
  return ensureFeasibleWritingSkeleton({
    skeleton: skeletonFromMaterialProfile(profile),
    pack,
    profile,
  });
}

describe("R149 performer evidence consistency", () => {
  it("CASE 1 — UNKNOWN first + PERFORMER_IDENTITY later → performer wins", () => {
    const keys = new Set([performerEntityKey("優梨まいな")]);
    const unknown = item("u1", "優梨まいな", "unknown_concrete", "supported_claim");
    const performer = item("p1", "優梨まいな", "performer_identity", "performer_metadata");
    const merged = dedupeConcreteEvidenceByFamily([unknown, performer], keys);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.type).toBe("performer_identity");
    expect(evidenceSemanticAuthority(performer, keys)).toBeGreaterThan(
      evidenceSemanticAuthority(unknown, keys),
    );
  });

  it("CASE 2 — PERFORMER_IDENTITY first + UNKNOWN later → performer maintained", () => {
    const keys = new Set([performerEntityKey("月乃ルナ")]);
    const performer = item("p1", "月乃ルナ", "performer_identity", "performer_metadata");
    const unknown = item("u1", "月乃ルナ", "unknown_concrete", "supported_claim");
    const merged = dedupeConcreteEvidenceByFamily([performer, unknown], keys);
    expect(merged[0]!.type).toBe("performer_identity");
  });

  it("CASE 3 — no actor metadata: name-like string is not promoted to performer", () => {
    const pack = packWith({
      productTitle: "素人ナンパベスト10",
      description: "街角で見つけた素人娘が登場",
      claims: [{ id: "c1", statement: "街角ナンパ", status: "SUPPORTED" }],
    });
    expect(pack.performerItems).toHaveLength(0);
    expect(
      pack.concreteEvidence.every((e) => e.type !== "performer_identity" || e.provenance.sourceType !== "performer_metadata"),
    ).toBe(true);
  });

  it("CASE 4 — catalog confirmation prose is not reader-facing Writer fuel", () => {
    const prose = "出演者として優梨まいなが公式ページで確認できる。";
    expect(isCatalogConfirmationProse(prose)).toBe(true);
    const pack = buildEvidencePack({
      productTitle: PARA_TITLE,
      claims: [{ id: "c1", statement: prose, status: "SUPPORTED" }],
      pageEvidenceMeta: { actors: ["優梨まいな"] },
    });
    const writer = toOptionBWriterSourceMaterialFromPack(pack);
    const claims = writer.supportedClaims as Array<{ statement: string }>;
    expect(claims.every((c) => !/公式ページで確認できる/.test(c.statement))).toBe(true);
    expect(claimStatementsFromPageEvidence({
      pageEvidenceMeta: { actors: ["優梨まいな"] },
      productTitle: PARA_TITLE,
    }).every((s) => !/公式ページで確認できる/.test(s))).toBe(true);
  });

  it("CASE 5 — catalog confirmation stripped but performer fact preserved", () => {
    const pack = buildEvidencePack({
      productTitle: PARA_TITLE,
      claims: [
        {
          id: "c1",
          statement: "出演者として優梨まいなが公式ページで確認できる。",
          status: "SUPPORTED",
        },
      ],
      pageEvidenceMeta: {
        actors: ["優梨まいな", "ましろ杏"],
        description: { text: PARA_DESC, originField: "jsonld.Product.description" },
      },
    });
    expect(pack.performerItems.map((p) => p.displayName)).toEqual(["優梨まいな", "ましろ杏"]);
    expect(
      pack.concreteEvidence.some(
        (e) => e.type === "performer_identity" && e.fact === "優梨まいな",
      ),
    ).toBe(true);
  });

  it("CASE 6 — single performer resolves opening evidence", () => {
    const pack = packWith({
      productTitle: "奥田咲 55コーナー 追撃ピストン",
      actors: ["奥田咲"],
      description: "人気女優・奥田咲が55コーナーに登場。追撃ピストンシーンも収録。",
    });
    const feas = feasibilityFor(pack);
    expect(feas.deferred).toBe(false);
    expect(feas.deferReason).not.toBe("no_compatible_opening_evidence");
    expect(feas.assignment.opening.primary?.type).toBe("performer_identity");
    expect(feas.assignment.opening.primary?.fact).toBe("奥田咲");
  });

  it("CASE 7 — dual_host lead representation maintained (parathd)", () => {
    const pack = packWith({
      productTitle: PARA_TITLE,
      actors: ["優梨まいな", "ましろ杏"],
      description: PARA_DESC,
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feas = feasibilityFor(pack);
    const plan = buildArticlePlan({
      productTitle: PARA_TITLE,
      pack,
      assignment: feas.assignment,
      materialDepth: profile.materialDepth,
      profile,
    });
    expect(profile.performerRepresentation.mode).toBe("dual_host");
    const bodyJoin = plan.body.flatMap((b) => b.facts).join(" ");
    expect(bodyJoin).toMatch(/優梨まいな/);
    expect(bodyJoin).toMatch(/ましろ杏/);
    expect(bodyJoin).not.toMatch(/公式ページで確認できる/);
    expect(plan.lead.facts).toEqual([]);
  });

  it("CASE 8 — ensemble abstraction maintained (mird00250 shape)", () => {
    const pack = packWith({
      productTitle: "長身脚長バレー女子たちのガニ股天空杭打ち騎乗位ハーレム",
      actors: ["木下ひまり（花沢ひまり）", "辻井ほのか", "滝ゆいな", "堤セリナ"],
      description: "全員170cmオーバーのデカ女子4人",
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    expect(profile.performerCount).toBe(4);
    expect(["ensemble", "unknown_multi"]).toContain(profile.performerRepresentation.mode);
  });

  it("CASE 9 — collection abstraction maintained", () => {
    const pack = packWith({
      productTitle: "【独占】10作品8時間ベスト",
      actors: ["松本いちか"],
      description: "10作品収録のベスト。松本いちか出演。",
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    expect(profile.kind).toMatch(/best|collection|identity/i);
    const feas = feasibilityFor(pack);
    expect(feas.ok).toBe(true);
  });

  it("CASE 10 — unknown_multi neutral representation", () => {
    const pack = packWith({
      productTitle: "素人ナンパベスト",
      actors: Array.from({ length: 8 }, (_, i) => `出演者${i + 1}`),
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    expect(profile.performerCount).toBe(8);
    expect(["unknown_multi", "ensemble", "collection"]).toContain(profile.performerRepresentation.mode);
  });

  it("CASE 11 — pred title-safe fact shape (no narrative title revival)", () => {
    const predTitle = "【長身美脚の一花先生に暴走中出し】";
    const pack = packWith({
      productTitle: predTitle,
      actors: ["一花"],
      description: "10本番収録。デカ尻と美脚が魅力。",
      claims: [
        { id: "c0", statement: predTitle, status: "SUPPORTED" },
        { id: "c1", statement: "10本番", kind: "trait_or_scene", status: "SUPPORTED" },
      ],
    });
    const profile = buildProductMaterialProfileFromPack(pack);
    const feas = feasibilityFor(pack);
    const plan = buildArticlePlan({
      productTitle: predTitle,
      pack,
      assignment: feas.assignment,
      materialDepth: profile.materialDepth,
      profile,
    });
    expect(feas.deferred).toBe(false);
    expect(plan.title.facts.some((f) => /暴走中出し/.test(f))).toBe(true);
    expect(plan.title.facts.some((f) => /男子生徒/.test(f))).toBe(false);
  });

  it("CASE 12 — idempotency: merge order does not change semantic result", () => {
    const keys = new Set([performerEntityKey("一花")]);
    const a = item("a", "一花", "unknown_concrete", "supported_claim");
    const b = item("b", "一花", "performer_identity", "performer_metadata");
    const forward = dedupeConcreteEvidenceByFamily([a, b], keys);
    const reverse = dedupeConcreteEvidenceByFamily([b, a], keys);
    expect(forward[0]!.type).toBe(reverse[0]!.type);
    expect(forward[0]!.provenance.sourceType).toBe(reverse[0]!.provenance.sourceType);
  });

  it("enforcePerformerIdentityInvariant upgrades SSOT metadata match only", () => {
    const performers = packWith({
      productTitle: "test",
      actors: ["奥田咲"],
    }).performerItems;
    const upgraded = enforcePerformerIdentityInvariant(
      [item("x", "奥田咲", "unknown_concrete", "supported_claim")],
      performers,
    );
    expect(upgraded[0]!.type).toBe("performer_identity");
    expect(upgraded[0]!.provenance.sourceType).toBe("performer_metadata");
    const typedClaim = enforcePerformerIdentityInvariant(
      [item("y", "奥田咲", "performer_identity", "supported_claim")],
      performers,
    );
    expect(typedClaim[0]!.provenance.sourceType).toBe("performer_metadata");
    const noMeta = enforcePerformerIdentityInvariant(
      [item("z", "推測名", "unknown_concrete", "supported_claim")],
      [],
    );
    expect(noMeta[0]!.type).toBe("unknown_concrete");
  });

  it("mizd rich facts preserved after semantic dedupe", () => {
    const title =
      "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";
    const desc =
      "松本いちかのMOODYZベスト第2弾！10作品！22本番！480分！45射精！デカ尻！追撃ピストン！";
    const pack = packWith({
      productTitle: title,
      actors: ["松本いちか"],
      description: desc,
    });
    const blob = JSON.stringify(pack.concreteEvidence);
    for (const token of ["松本いちか", "10作品", "22本番", "480分", "45射精", "デカ尻", "追撃ピストン"]) {
      expect(blob.includes(token), `missing ${token}`).toBe(true);
    }
    const feas = feasibilityFor(pack);
    expect(feas.deferred).toBe(false);
  });

  it("ofje shape — 55コーナー / 追撃ピストン pool maintained", () => {
    const pack = packWith({
      productTitle: "S1 GIRLS COLLECTION 奥田咲 55コーナー",
      actors: ["奥田咲"],
      description: "55コーナー収録。追撃ピストン、猛烈キスなど人気シーン満載。",
    });
    const blob = JSON.stringify(pack.concreteEvidence);
    expect(blob.includes("55コーナー") || blob.includes("55")).toBe(true);
    expect(blob.includes("追撃ピストン") || blob.includes("ピストン")).toBe(true);
    expect(
      pack.concreteEvidence.some((e) => e.type === "performer_identity" && e.fact === "奥田咲"),
    ).toBe(true);
  });

  it("surface normalization is order-independent", () => {
    expect(normalizeEvidenceSurface(" 優梨 まいな ")).toBe(
      normalizeEvidenceSurface("優梨まいな"),
    );
  });
});
