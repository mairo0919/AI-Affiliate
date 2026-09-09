/**
 * r76 — Writer officialDescription projection (LLM=0).
 * No atom/facet artificial join; no full scene-order synopsis dump.
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  toOptionBWriterSourceMaterialFromPack,
} from "../evidence-pack.js";
import {
  isLongSceneOrderSynopsis,
  normalizeOfficialDescriptionForWriter,
} from "../writer-evidence-filter.js";

const MIZD_TITLE =
  "【独占】令和イチのメスガキ 松本いちか わからせ痴女られ10作品8時間ベスト";
const MIZD_DESC =
  "キュートでエッチでちょっと生意気な令和イチのメスガキ！松本いちかのMOODYZベスト第2弾！メスガキわからせ、絶対空域、ギャル妹、小悪魔痴女etc.いっちゃんの魅力が詰まった10作品！痴女誘惑でもお仕置きレ●プでもエチえち可愛い厳選の22本番！超可愛いお顔と大人をバカにした表情のデカ尻にビタビタ激ピスSEX！480分の大ボリュームで45射精！最強の天使な小悪魔、松本いちかの本気をみさらせや！";

const HALT_DESC =
  "出版会社のしっかり者エリート人妻女上司・北野未奈。今日も終電過ぎまで残業に付き合うダメなZ世代部下のボク。でも目の前にあるのは、1日中履き倒してパンパンに張った【ムレムレ黒パンスト】のどデカ透け尻！Tバックが透けるその尻を組み替えるたび、デスクの下のチンポはギンギン。資料棚で背伸びした瞬間、無防備に突き出された肉尻が限界突破！「ちょっと、旦那いるし…ここ会社じゃないの」人妻ヅラして抵抗する上司のパンストとTバックをずらし、残業中のオフィスで【即ハメバック中出し】！一度ボクのデカチンを味わったら最後、エリートぶった理性は一瞬で蒸発。残業中の事務所で脚を組み替えながら【淫語マシンガン】を撃ちまくる発情人妻に豹変！▼理性崩壊！止まらない発情シチュエーション▼・給湯室の死角…蒸れた黒パンスト尻を擦りつける【摩擦音尻コキ】";

describe("r76 Writer source projection", () => {
  it("keeps natural promo blurb; does not atom-join", () => {
    expect(isLongSceneOrderSynopsis(MIZD_DESC)).toBe(false);
    const normalized = normalizeOfficialDescriptionForWriter(MIZD_DESC);
    expect(normalized).toContain("キュートでエッチ");
    expect(normalized).toContain("MOODYZベスト第2弾");
    expect(normalized).not.toMatch(/^10作品！8時間！ベスト！/);
  });

  it("compresses long scene-order synopsis to identity opener", () => {
    expect(isLongSceneOrderSynopsis(HALT_DESC)).toBe(true);
    const normalized = normalizeOfficialDescriptionForWriter(HALT_DESC);
    expect(normalized).toBeTruthy();
    expect(normalized!).toContain("北野未奈");
    expect(normalized!).not.toContain("即ハメバック中出し");
    expect(normalized!).not.toContain("▼");
    expect(normalized!.length).toBeLessThan(HALT_DESC.length / 2);
  });

  it("FromPack uses Writer-safe fact array, not raw prose or atom-join", () => {
    const pack = buildEvidencePack({
      productTitle: MIZD_TITLE,
      claims: [
        {
          id: "c1",
          statement: MIZD_TITLE,
          kind: "product_title",
          status: "SUPPORTED",
        },
      ],
      pageEvidenceMeta: {
        description: { text: MIZD_DESC, originField: "jsonld.Product.description" },
        actors: ["松本いちか"],
      },
    });
    expect(pack.sourceOfficialDescription).toBe(MIZD_DESC);
    const writer = toOptionBWriterSourceMaterialFromPack(pack);
    expect(Array.isArray(writer.officialDescription)).toBe(true);
    const facts = writer.officialDescription as string[];
    expect(facts.join(",")).not.toMatch(/魅力が詰まった|キュートでエッチ/);
    expect(facts.some((f) => /松本いちか|10作品|8時間|デカ尻|激ピス|痴女/.test(f))).toBe(true);
    expect(facts.join(" ")).not.toMatch(/^10作品！8時間！ベスト！/);
    const claims = writer.supportedClaims as Array<{ statement: string }>;
    expect(claims.every((c) => !/公式ページで確認できる/.test(c.statement))).toBe(true);
  });
});
