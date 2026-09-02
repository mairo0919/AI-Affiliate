/**
 * r94/r95 — Writer-safe evidence projection (LLM=0).
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidencePack,
  collectWriterSafeFactsFromPack,
  projectWriterSafeFact,
  toOptionBWriterSourceMaterialFromPack,
} from "../evidence-pack.js";
import {
  stripReaderInvitationFromClause,
  writerSafeClauseFromPageFact,
} from "../official-page-evidence-atoms.js";

const SSIS_DESC =
  "性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを限界突破させる究極のピストン作品！膣奥をエグる猛烈ハードピストンでエビ反り絶頂！イッテも止めずの追撃ピストンで快感飽和状態になりビックンガックン大痙攣オーガズム！そのままトドメの追い込みピストンで脱水症状限界まで快感潮を大量失禁！小島みなみの華奢スレンダーボディがぶっ壊れるほど仰け反りまくる120分ノーカットぶっ通しFUCK！";

const OFJE_DESC =
  "AVデビューから8周年を迎え、映画や舞台でも絶賛活躍中！円熟した濃厚なセックスとエロポテンシャル、低身長なのにグラマラスボディが魅力の‘奥田咲’エスワンベスト第6弾。今回は彼女の最新12タイトル、なお且つ全コーナーを収録した豪華でスペシャルなベスト版です。超ボリューム55コーナー8時間。人妻、NTR、痴女、追撃ピストンなど今の咲が全部詰まった最高傑作がここに誕生です！！！";

const PARA_TITLE = "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館 優梨まいな";
const PARA_DESC =
  "★選りすぐりの「マン毛」を紹介するマン毛モロ出し写真館。パラダイステレビだからこそ収集できた「素晴らしいマン毛」を、学芸員の優梨まいなとましろ杏がスケベにご紹介◆パラダイステレビが収集したシ●ウト女性の「マン毛」を、当写真館の巨乳学芸員・優梨まいなとましろ杏、この2人と一緒に鑑賞しましょう◆コインランドリーでナンパした女子大生のマン毛、女性専門高級回春エステに通う女性のマン毛、催●術にかかった女性のマン毛、不倫中の団地妻など、我々を驚かせる驚異のマン毛写真に出会えるはず…？鑑賞後はマン毛の奥の秘部も一緒に愛でられたら幸いでございます。";

describe("r95 context-preserving Writer projection", () => {
  it("strips reader invitation only; keeps concrete clause after ◆", () => {
    expect(
      stripReaderInvitationFromClause(
        "この2人と一緒に鑑賞しましょう◆コインランドリーでナンパした女子大生のマン毛",
      ),
    ).toBe("コインランドリーでナンパした女子大生のマン毛");
  });

  it("does not compress promo/eval clause to stem token", () => {
    const promoClause =
      "性欲の化身と言っても過言ではないイキっぷりがダイナミックな小島みなみを限界突破させる究極のピストン作品";
    const clause = writerSafeClauseFromPageFact(promoClause);
    expect(clause).toContain("小島みなみ");
    expect(clause).toContain("究極");
    expect(clause).not.toBe("ピストン");
  });

  it("keeps sourceOfficialDescription raw; Writer gets clause facts not full prose dump", () => {
    const pack = buildEvidencePack({
      productTitle: "ssis00700",
      claims: [{ id: "c1", statement: "ssis00700", status: "SUPPORTED" }],
      pageEvidenceMeta: {
        description: { text: SSIS_DESC, originField: "jsonld.Product.description" },
        actors: ["小島みなみ"],
      },
    });
    expect(pack.sourceOfficialDescription).toBe(SSIS_DESC);
    const writer = toOptionBWriterSourceMaterialFromPack(pack);
    expect(Array.isArray(writer.officialDescription)).toBe(true);
    const facts = writer.officialDescription as string[];
    expect(facts.join(" ")).not.toBe(SSIS_DESC);
    expect(facts.some((f) => f.includes("小島みなみ") && f.includes("ピストン"))).toBe(true);
    expect(
      facts.some((f) => /120\s*分/.test(f)) ||
        pack.concreteEvidence.some((e) => /120\s*分/.test(e.fact)),
    ).toBe(true);
  });

  it("keeps ofje00230 work facets in Writer-safe pool (promo-only not required)", () => {
    const pack = buildEvidencePack({
      productTitle: "ofje00230",
      claims: [{ id: "c1", statement: "ofje00230", status: "SUPPORTED" }],
      pageEvidenceMeta: {
        description: { text: OFJE_DESC, originField: "jsonld.Product.description" },
        actors: ["奥田咲"],
      },
    });
    const facts = collectWriterSafeFactsFromPack(pack);
    // Context-bearing work clause remains projectable even when claim-cap omits it.
    expect(
      projectWriterSafeFact("円熟した濃厚なセックスとエロポテンシャル", "unknown_concrete"),
    ).toMatch(/円熟|濃厚/);
    expect(facts.some((f) => /8時間|痴女|ベスト第6弾|奥田咲|人妻|NTR|12タイトル|追撃/.test(f))).toBe(
      true,
    );
    const writer = toOptionBWriterSourceMaterialFromPack(pack);
    const supported = writer.supportedClaims as Array<{ id: string; statement: string }>;
    expect(supported.every((c) => c.id !== "title::full")).toBe(true);
  });

  it("strips invitation from parathd03128 but keeps setting/subject clauses", () => {
    const pack = buildEvidencePack({
      productTitle: PARA_TITLE,
      claims: [{ id: "c1", statement: PARA_TITLE, status: "SUPPORTED" }],
      pageEvidenceMeta: {
        description: { text: PARA_DESC, originField: "jsonld.Product.description" },
        actors: ["優梨まいな", "ましろ杏"],
      },
    });
    const writer = toOptionBWriterSourceMaterialFromPack(pack);
    const facts = (writer.officialDescription as string[]) ?? [];
    expect(facts.join(" ")).not.toMatch(/鑑賞しましょう|愛でられたら幸いでございます/);
    expect(facts.some((f) => /コインランドリーでナンパした女子大生のマン毛/.test(f))).toBe(
      true,
    );
    expect(facts.some((f) => /優梨まいな|マン毛|回春エステ|学芸員/.test(f))).toBe(true);
    expect(
      projectWriterSafeFact(
        "鑑賞後はマン毛の奥の秘部も一緒に愛でられたら幸いでございます",
        "unknown_concrete",
      ),
    ).toBeNull();
  });

  it("r98 — keeps short upstream-certified SCENE_ACTION token (激ピス)", () => {
    expect(writerSafeClauseFromPageFact("激ピス")).toBe("激ピス");
    expect(projectWriterSafeFact("激ピス", "scene_or_act")).toBe("激ピス");
  });

  it("r98 — keeps performer label quotation in concrete official clause", () => {
    const clause =
      "透明感溢れる19歳の美人お姉さん「初乃ふみか」の専属第二弾はSEX経験の少ない彼女が初体験するプレイでたーっぷり性感開発";
    expect(writerSafeClauseFromPageFact(clause)).toBe(clause);
    expect(projectWriterSafeFact(clause, "series_or_event")).toBe(clause);
  });

  it("r98 — still drops spoken dialogue in quotes", () => {
    expect(
      projectWriterSafeFact("「ちょっと、旦那いるし…ここ会社じゃないの」", "unknown_concrete"),
    ).toBeNull();
  });

  it("P0 packConcrete — complete unknown pack facts bypass fragment salvage", () => {
    const theme = "人妻・NTR・痴女・追撃ピストンなどを収録";
    const quality = "奥田咲の円熟した濃厚なセックスとエロポテンシャル";
    // Legacy unknown path may still null long/clause-like unknowns
    expect(projectWriterSafeFact(theme, "unknown_concrete")).toBeNull();
    // Pack-certified concrete: thin safety only
    expect(
      projectWriterSafeFact(theme, "unknown_concrete", "product_description", {
        packConcrete: true,
      }),
    ).toBe(theme);
    expect(
      projectWriterSafeFact(quality, "unknown_concrete", "product_description", {
        packConcrete: true,
      }),
    ).toBe(quality);
  });

  it("P0 packConcrete — hard safety still drops catalog / dialogue / invitation", () => {
    expect(
      projectWriterSafeFact(
        "公式ページ上で確認できる",
        "unknown_concrete",
        "product_description",
        { packConcrete: true },
      ),
    ).toBeNull();
    expect(
      projectWriterSafeFact(
        "「ちょっと、旦那いるし…ここ会社じゃないの」",
        "unknown_concrete",
        "product_description",
        { packConcrete: true },
      ),
    ).toBeNull();
  });
});
