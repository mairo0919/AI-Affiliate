/**
 * R126/R127 — semantic fact matching + realization status regression.
 */
import { describe, expect, it } from "vitest";
import {
  assignedCoverageKeys,
  concreteCoverageKeys,
  evaluateFactRealization,
  isFactRealized,
  resolveFactRealization,
} from "../generation/plan-fact-matching.js";

const MIRD_SENTENCES = {
  thirteenExact:
    "木下ひまり（花沢ひまり）も参加し、13回もの射精を重ねる180分の濃密な時間だ。",
  thirteenAbstract: "何度も射精しても止まらず、引き締まった美尻での杭打ち騎乗位が繰り返される。",
  thirteenRepeat: "射精を繰り返す濃密な展開が続く。",
  thirtyContradiction: "30回もの射精を記録した。",
  onceContradiction: "一度だけの射精で終わる。",
  noEjac: "美尻での杭打ち騎乗位が繰り返される。",
  unrelated: "専属女優の第二弾として公開された。",
  lookDown:
    "見下ろされ囲まれながらの搾精は格別に気持ちよく、引き締まった美尻での杭打ち騎乗位スイッチ逆3Pが繰り返される。",
  athleteHold:
    "何度射精しても止まらず、頭からつま先まで野獣のような欲情を感じさせるすらっとしたアスリートボディでしっかりとホールドされる。",
};

describe("R127 quantity realization status", () => {
  const fact = "13射精";

  it("13回もの射精 → EXACT / realized", () => {
    const r = evaluateFactRealization(MIRD_SENTENCES.thirteenExact, fact);
    expect(r.status).toBe("EXACT");
    expect(r.realized).toBe(true);
    expect(isFactRealized(r.status)).toBe(true);
  });

  it("何度も射精 → SEMANTIC / realized", () => {
    const r = evaluateFactRealization(MIRD_SENTENCES.thirteenAbstract, fact);
    expect(r.status).toBe("SEMANTIC");
    expect(r.realized).toBe(true);
  });

  it("射精を繰り返す → SEMANTIC / realized", () => {
    const r = evaluateFactRealization(MIRD_SENTENCES.thirteenRepeat, fact);
    expect(r.status).toBe("SEMANTIC");
    expect(r.realized).toBe(true);
  });

  it("30回射精 → CONTRADICTION / not realized", () => {
    const r = evaluateFactRealization(MIRD_SENTENCES.thirtyContradiction, fact);
    expect(r.status).toBe("CONTRADICTION");
    expect(r.realized).toBe(false);
    expect(r.contradiction).toBe(true);
  });

  it("一度だけ射精 → CONTRADICTION / not realized", () => {
    const r = evaluateFactRealization(MIRD_SENTENCES.onceContradiction, fact);
    expect(r.status).toBe("CONTRADICTION");
    expect(r.realized).toBe(false);
  });

  it("無関係な文 → NONE / not realized", () => {
    const r = evaluateFactRealization(MIRD_SENTENCES.unrelated, fact);
    expect(r.status).toBe("NONE");
    expect(r.realized).toBe(false);
  });

  it("射精なし → NONE / not realized", () => {
    const r = evaluateFactRealization(MIRD_SENTENCES.noEjac, fact);
    expect(r.status).toBe("NONE");
    expect(r.realized).toBe(false);
  });
});

describe("R127 SEMANTIC counts toward coverage", () => {
  const fact = "13射精";

  it("assignedCoverageKeys includes SEMANTIC realization", () => {
    const keys = assignedCoverageKeys(MIRD_SENTENCES.thirteenAbstract, [fact]);
    expect(keys.has(fact)).toBe(true);
  });

  it("concreteCoverageKeys includes SEMANTIC realization", () => {
    const keys = concreteCoverageKeys(MIRD_SENTENCES.thirteenRepeat, [fact]);
    expect([...keys].some((k) => k.includes(fact))).toBe(true);
  });
});

describe("R126/R127 mird compound facts", () => {
  it("見下ろし…搾精が気持ちイイ → realized", () => {
    const fact = "見下ろし囲まれながらの搾精が気持ちイイ";
    const r = resolveFactRealization(MIRD_SENTENCES.lookDown, fact);
    expect(isFactRealized(r.status)).toBe(true);
  });

  it("頭からつま先…ホールド → realized", () => {
    const fact = "頭からつま先まで野獣欲情すらっとアスリートボディホールド";
    const r = resolveFactRealization(MIRD_SENTENCES.athleteHold, fact);
    expect(isFactRealized(r.status)).toBe(true);
  });
});

describe("R126 full mird body blob", () => {
  const body = [
    "全員が170cmを超える大柄な女子4人による身長差を活かした手コキが繰り広げられる。",
    MIRD_SENTENCES.thirteenExact,
    MIRD_SENTENCES.lookDown,
    MIRD_SENTENCES.athleteHold,
  ].join("\n");

  const planFacts = [
    "全員170cmオーバーのデカ女子4人身長差手コキ",
    "木下ひまり（花沢ひまり）",
    "13射精",
    "180分",
    "見下ろし囲まれながらの搾精が気持ちイイ",
    "引き締まった美尻杭打ち騎乗位スイッチ逆3P",
    "何度射精しても止まらない",
    "頭からつま先まで野獣欲情すらっとアスリートボディホールド",
  ];

  it("no false PLAN_FACT_OMISSION on R125 mird body", () => {
    const omitted = planFacts.filter(
      (f) => !isFactRealized(resolveFactRealization(body, f, { padBearing: false }).status),
    );
    expect(omitted).toEqual([]);
  });
});
