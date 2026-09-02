/**
 * r81 — Writer projection salvages usable unknown_concrete (not all-pass).
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  projectWriterSafeFactFromPackItem,
  toOptionBWriterSourceMaterialFromPack,
} from "../evidence-pack.js";
import {
  isWriterEligibleEvidenceType,
  projectWriterEvidenceFact,
  salvageWriterFactFromUnknownConcrete,
} from "../writer-evidence-filter.js";

const HALT_TITLE =
  "一日中履いてムレた黒パンストでパンパンに張ったどデカ透け尻を見せつけてくる無防備エリート人妻女上司に残業中即ハメ！";
const HALT_DESC =
  "出版会社のしっかり者エリート人妻女上司・北野未奈。今日も終電過ぎまで残業に付き合うダメなZ世代部下のボク。でも目の前にあるのは、1日中履き倒してパンパンに張った【ムレムレ黒パンスト】のどデカ透け尻！Tバックが透けるその尻を組み替えるたび、デスクの下のチンポはギンギン。資料棚で背伸びした瞬間、無防備に突き出された肉尻が限界突破！「ちょっと、旦那いるし…ここ会社じゃないの」人妻ヅラして抵抗する上司のパンストとTバックをずらし、残業中のオフィスで【即ハメバック中出し】！一度ボクのデカチンを味わったら最後、エリートぶった理性は一瞬で蒸発。残業中の事務所で脚を組み替えながら【淫語マシンガン】を撃ちまくる発情人妻に豹変！▼理性崩壊！止まらない発情シチュエーション▼・給湯室の死角…蒸れた黒パンスト尻を擦りつける【摩擦音尻コキ】";

describe("r81 Writer unknown_concrete projection", () => {
  it("does not all-pass unknown_concrete type", () => {
    expect(isWriterEligibleEvidenceType("unknown_concrete")).toBe(false);
  });

  it("salvages bracket labels; rejects POV / play-by-play glue", () => {
    expect(
      salvageWriterFactFromUnknownConcrete("残業中のオフィスで【即ハメバック中出し】"),
    ).toBe("即ハメバック中出し");
    expect(
      salvageWriterFactFromUnknownConcrete(
        "1日中履き倒してパンパンに張った【ムレムレ黒パンスト】のどデカ透け尻",
      ),
    ).toBe("ムレムレ黒パンスト");
    expect(salvageWriterFactFromUnknownConcrete("給湯室の死角")).toBe("給湯室の死角");
    expect(salvageWriterFactFromUnknownConcrete("でも目の前にあるのは")).toBeNull();
    expect(
      salvageWriterFactFromUnknownConcrete("Tバックが透けるその尻を組み替えるたび"),
    ).toBeNull();
    expect(
      salvageWriterFactFromUnknownConcrete("一度ボクのデカチンを味わったら最後"),
    ).toBeNull();
    expect(
      salvageWriterFactFromUnknownConcrete(
        "まんぐり正常位→くい打ち騎乗位→お掃除フェラまで徹底奉仕",
      ),
    ).toBeNull();
  });

  it("projects salvaged unknown as setting_or_situation", () => {
    const p = projectWriterEvidenceFact(
      "unknown_concrete",
      "蒸れた黒パンスト尻を擦りつける【摩擦音尻コキ】",
    );
    expect(p?.statement).toBe("摩擦音尻コキ");
    expect(p?.resolvedType).toBe("setting_or_situation");
    expect(p?.fromUnknownSalvage).toBe(true);
  });

  it("Writer source includes signature crumbs without synopsis dump", () => {
    const pack = buildEvidencePack({
      productTitle: HALT_TITLE,
      claims: [
        {
          id: "c1",
          statement: HALT_TITLE,
          kind: "product_title",
          status: "SUPPORTED",
        },
      ],
      pageEvidenceMeta: {
        description: { text: HALT_DESC, originField: "jsonld.Product.description" },
        actors: ["北野未奈"],
      },
    });
    const projectedPool = pack.concreteEvidence
      .filter((e) => e.generationEligible)
      .map((e) => projectWriterSafeFactFromPackItem(e))
      .filter((s): s is string => !!s);
    // Pack-certified bracket labels unwrap without fragment salvage of long clauses.
    expect(projectedPool).toContain("ムレムレ黒パンスト");
    expect(projectedPool).toContain("即ハメバック中出し");
    expect(projectedPool.join("\n")).not.toContain("旦那いるし");
    expect(projectedPool.join("\n")).not.toContain("▼理性崩壊");
    expect(projectedPool.join("\n")).not.toContain("一度ボクのデカチン");

    const writer = toOptionBWriterSourceMaterialFromPack(pack);
    const claims = (writer.supportedClaims as Array<{ statement: string }>).map(
      (c) => c.statement,
    );
    // Cap may omit some labels when longer pack surfaces also project; still no POV dump.
    expect(claims.join("\n")).not.toContain("旦那いるし");
    expect(claims.join("\n")).not.toContain("▼理性崩壊");
    expect(claims.join("\n")).not.toContain("一度ボクのデカチン");
    expect(claims.join("\n")).not.toContain("組み替えるたび");
    expect(String(writer.officialDescription ?? "")).not.toContain("▼");
    expect(claims.length).toBeLessThanOrEqual(6);
  });
});
