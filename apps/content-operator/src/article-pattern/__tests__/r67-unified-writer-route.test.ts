import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  claimStatementsFromPageEvidence,
  toOptionBWriterSourceMaterialFromPack,
} from "../evidence-pack.js";
import { isWriterSynopsisLike } from "../writer-evidence-filter.js";

const SYNOPSIS =
  "出版会社のしっかり者エリート人妻女上司・北野未奈。今日も終電過ぎまで残業に付き合うダメなZ世代部下のボク。でも目の前にあるのは、1日中履き倒してパンパンに張った【ムレムレ黒パンスト】のどデカ透け尻！";

describe("r67 unified Writer route", () => {
  it("blocks synopsis-like text", () => {
    expect(isWriterSynopsisLike(SYNOPSIS)).toBe(true);
    expect(isWriterSynopsisLike("10作品が収録規模として記載されている。")).toBe(false);
  });

  it("claimStatementsFromPageEvidence does not include raw description slice", () => {
    const statements = claimStatementsFromPageEvidence({
      pageEvidenceMeta: {
        description: { text: SYNOPSIS, originField: "jsonld.Product.description" },
        actors: ["北野未奈"],
      },
      productTitle: "halt title sample",
    });
    expect(statements.some((s) => s.includes("ボク"))).toBe(false);
    expect(statements.some((s) => s.includes("北野未奈"))).toBe(true);
  });

  it("toOptionBWriterSourceMaterialFromPack excludes scene synopsis dump from Writer", () => {
    const pack = buildEvidencePack({
      productTitle: "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
      claims: [
        {
          id: "c1",
          statement: "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト",
          kind: "product_title",
          status: "SUPPORTED",
        },
        {
          id: "c2",
          statement: "10作品が収録規模として記載されている。",
          kind: "trait_or_scene",
          status: "SUPPORTED",
        },
      ],
      pageEvidenceMeta: {
        description: { text: SYNOPSIS, originField: "jsonld.Product.description" },
      },
    });
    const writer = toOptionBWriterSourceMaterialFromPack(pack);
    const claims = writer.supportedClaims as Array<{ statement: string }>;
    const desc = String(writer.officialDescription ?? "");
    expect(claims.every((c) => !isWriterSynopsisLike(c.statement))).toBe(true);
    expect(desc.includes("ボク")).toBe(false);
    expect(desc.includes("即ハメ")).toBe(false);
    expect(claims.some((c) => c.statement.includes("10作品"))).toBe(true);
  });
});
