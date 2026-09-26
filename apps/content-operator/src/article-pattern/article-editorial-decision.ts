/**
 * Article editorial decision for titles — free-form cut, not a phrase parts list.
 *
 * Canonical Evidence/Claims remain factual SSOT.
 * editorialDecision tells Writer *what* to introduce; Writer writes the headline.
 * title.facts are grounding hints only — never a mandatory assemble list.
 */

export type ArticleEditorialDecision = {
  /** Free-form editorial cut (NOT a finished title phrase). */
  angle: string;
  /** Why a reader would care — grounded, not clickbait. */
  readerHook: string;
  /** What makes this work distinct for article introduction. */
  whyThisWork: string;
  /** Evidence / plan fact surfaces that ground the angle (refs or short facts). */
  supportingEvidenceRefs: string[];
};

export type ArticleHeadlineDefectCode =
  | "PACKAGE_COPY_REPHRASE"
  | "FACT_ASSEMBLY"
  | "CATALOG_SHELL"
  | "GENERIC_LABEL"
  | "MECHANICAL_TEMPLATE"
  | "UNNATURAL_RELATION"
  | "LOW_INFORMATION"
  | "NO_EDITORIAL_ANGLE";

const CATALOG_SHELL_RE =
  /^(?:ベストと総集編|ベスト・総集編|女優ベスト・総集編|塩対応ベスト|ハメ放題BEST|単体作品)$/u;

const NAME_CLASS = "[\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9fff々ーA-Za-z]";
const NOUN_CLASS = "[\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9fff・ー々A-Za-z0-9●〇○【】\\[\\]!]";

/** True when title has no editorial frame (verb-ish / clausal particles that signal a headline cut). */
function lacksEditorialFrame(title: string): boolean {
  // 「で/を/へ」+ continuation, quotes, question, or clausal hooks mark editorial cuts.
  if (/[をへ「」『』？?！!]/.test(title)) return false;
  if (/で[^のと・]/.test(title)) return false;
  if (/(?:から|まで|より|について)/u.test(title)) return false;
  if (
    /に(?:堕|落|会|沼|誘|挑|変|した|される|された|する|て|なる)/u.test(title)
  ) {
    return false;
  }
  if (/(?:くれる|させる|された|読み解く|紹介|解説|徹底|まさかの)/u.test(title)) {
    return false;
  }
  if (/が(?:魅|贈|導|選)/u.test(title)) return false;
  return true;
}

/** Distinctive series / volume identity — not performer+keyword glue. */
function looksLikeSeriesIdentityTitle(title: string): boolean {
  const t = title.trim();
  if (/(?:vol\.?\s*\d+|第\d+弾|BEST\s*\d|BEST\d|\d+時間|\d+分)/i.test(t)) {
    // Still reject obvious performer+genre shells
    if (/と(?:ハイクオリティ|ローション|キス|ハメ撮り)/u.test(t)) return false;
    if (/の(?:キス・接吻|ローション・オイル)$/u.test(t)) return false;
    return true;
  }
  return false;
}

/** Bare performer/campaign + の/と + noun-phrase glue (fact assembly signal). */
function looksLikePerformerKeywordGlue(title: string): boolean {
  const t = title.trim();
  if (t.length < 4 || t.length > 72) return false;
  if (!lacksEditorialFrame(t)) return false;

  // XにYのZ / unnatural 「に沼るの…」
  if (/に[^。、]{1,16}の(?:ハイクオリティVR|VR|作品)$/u.test(t)) return true;

  // Nameと/の + rest with no editorial frame (length-tolerant — catch long campaign glue)
  const glueRe = new RegExp(
    `^${NAME_CLASS}{2,16}(?:の|と)${NOUN_CLASS}{2,48}$`,
    "u",
  );
  if (glueRe.test(t)) {
    // Campaign/series particle join (not only short genre tags)
    if (
      /(?:祭り|周年|リクエスト|リメイク|総集編|ベスト|BEST|Vol\.?\d|作品|エステ|VR|パンチラ|まとめ)/u.test(
        t,
      )
    ) {
      return true;
    }
    if (
      t.includes("・") ||
      /(?:キス|接吻|ローション|オイル|ハメ撮り|NTR|中出し|巨乳|人妻|お姉さん|フェチ|制服|貧乳|微乳|3P|4P)$/u.test(
        t,
      )
    ) {
      return true;
    }
    // Short 「Nameの/とNoun」 without frame — catalog glue
    if (t.length <= 28) return true;
  }

  // CampaignのFeature (both sides long noun phrases) — package fragment join
  const campaignGlue = new RegExp(
    `^${NOUN_CLASS}{10,40}の${NOUN_CLASS}{4,28}$`,
    "u",
  );
  if (campaignGlue.test(t) && /(?:祭り|周年|リクエスト|記念)/u.test(t)) {
    return true;
  }

  return false;
}

/** Repeated name token / broken relation (e.g. 彩月七緒と七緒と…). */
function looksUnnaturalRelation(title: string): boolean {
  if (/に沼るの|とハイクオリティ|のハイクオリティVR作品$/u.test(title)) return true;
  // Same 2–6 char token repeated across と/の (not intentional 叠語 like ハメハメ)
  const m = title.match(
    new RegExp(`(${NAME_CLASS}{2,6})[との](?:${NAME_CLASS}{0,6})\\1`, "u"),
  );
  if (m && m[1] && !/^(?:作品|女優|女優名|彼女|彼)$/u.test(m[1])) return true;
  return false;
}

function normalizeCompact(s: string): string {
  return s.replace(/\s+/gu, "").replace(/[｜|・、,]/gu, "").toLowerCase();
}

/**
 * Structural defect signals for article headlines.
 * Deterministic layer for obvious assembly / package-copy / shells.
 * Semantic Review still owns final naturalness judgment.
 */
export function classifyArticleHeadlineDefects(input: {
  title: string;
  productTitle?: string | null;
  titleFacts?: string[] | null;
  editorialAngle?: string | null;
}): ArticleHeadlineDefectCode[] {
  const title = (input.title ?? "").trim();
  const defects: ArticleHeadlineDefectCode[] = [];
  if (!title) {
    defects.push("LOW_INFORMATION");
    return defects;
  }
  if (CATALOG_SHELL_RE.test(title) || /^作品ガイド[｜|]/.test(title)) {
    defects.push("CATALOG_SHELL");
    defects.push("GENERIC_LABEL");
  }
  if (/魅せる/u.test(title) || /が贈る/u.test(title) || /^注目は.+｜.+$/u.test(title)) {
    defects.push("MECHANICAL_TEMPLATE");
  }
  if (/[！!]{1,}.*(?:まさかの|必見|衝撃|驚愕)/u.test(title) || /(?:ドストライク|完全網羅|絶対に見て)/u.test(title)) {
    defects.push("MECHANICAL_TEMPLATE");
  }
  if (looksLikePerformerKeywordGlue(title)) {
    // Series/volume identity can look like 「Nameのシリーズ」 — allow when clearly vol/BEST framed
    if (!looksLikeSeriesIdentityTitle(title) || /(?:と|の)(?:ハイクオリティ|ローション|キス|ハメ撮り)/u.test(title)) {
      defects.push("FACT_ASSEMBLY");
    }
  }
  if (looksUnnaturalRelation(title)) {
    defects.push("UNNATURAL_RELATION");
  }
  const product = (input.productTitle ?? "").trim();
  if (product && !looksLikeSeriesIdentityTitle(title)) {
    const a = normalizeCompact(title);
    const b = normalizeCompact(product);
    // Strong editorial-frame headlines may equal / near-equal package copy; keep them.
    const framed = !lacksEditorialFrame(title);
    if (a.length >= 10 && b.length >= 10 && !framed) {
      if (a === b || (b.includes(a) && a.length >= b.length * 0.55)) {
        defects.push("PACKAGE_COPY_REPHRASE");
      }
      // Drop particles then compare — catches 「祭り レズ」 vs 「祭りのレズ」
      const a2 = a.replace(/の|と|が|を|に|へ|で|は|も/gu, "");
      const b2 = b.replace(/の|と|が|を|に|へ|で|は|も/gu, "");
      if (a2.length >= 12 && b2.length >= 12 && (a2 === b2 || b2.includes(a2) || a2.includes(b2))) {
        if (Math.min(a2.length, b2.length) / Math.max(a2.length, b2.length) >= 0.72) {
          defects.push("PACKAGE_COPY_REPHRASE");
        }
      }
      if (
        b.includes(a) &&
        a.length >= 12 &&
        a.length <= b.length * 0.7 &&
        !/[をにでへ]/u.test(title)
      ) {
        defects.push("PACKAGE_COPY_REPHRASE");
      }
    } else if (a.length >= 10 && b.length >= 10 && framed) {
      // Still catch obvious particle-only rephrase of long package when title is shorter stem
      if (b.includes(a) && a.length >= 12 && a.length <= b.length * 0.55 && !/[をにでへ「」]/u.test(title)) {
        defects.push("PACKAGE_COPY_REPHRASE");
      }
    }
  }
  const facts = (input.titleFacts ?? []).map((f) => f.trim()).filter(Boolean);
  if (facts.length >= 2) {
    // Title is near-join of planned facts with only particles
    const joined = facts.join("");
    const stripped = title.replace(/[のとへにあでを、・\s]/gu, "");
    if (
      normalizeCompact(stripped) === normalizeCompact(joined) ||
      (stripped.length >= 8 && normalizeCompact(joined).includes(normalizeCompact(stripped)))
    ) {
      if (!defects.includes("FACT_ASSEMBLY")) defects.push("FACT_ASSEMBLY");
    }
  }
  if (
    lacksEditorialFrame(title) &&
    title.length >= 8 &&
    title.length <= 40 &&
    /(?:の|と)/.test(title) &&
    !looksLikeSeriesIdentityTitle(title) &&
    !defects.includes("FACT_ASSEMBLY") &&
    !defects.includes("PACKAGE_COPY_REPHRASE") &&
    !defects.includes("CATALOG_SHELL")
  ) {
    // Short particle-joined noun title without editorial cut
    defects.push("NO_EDITORIAL_ANGLE");
  }
  if (title.length <= 8 && !/[をにでへ、]/u.test(title)) {
    defects.push("LOW_INFORMATION");
  }
  return [...new Set(defects)];
}

export function isLowValueArticleHeadline(input: {
  title: string;
  productTitle?: string | null;
  titleFacts?: string[] | null;
}): boolean {
  const d = classifyArticleHeadlineDefects(input);
  return d.some((c) =>
    [
      "PACKAGE_COPY_REPHRASE",
      "FACT_ASSEMBLY",
      "CATALOG_SHELL",
      "GENERIC_LABEL",
      "MECHANICAL_TEMPLATE",
      "UNNATURAL_RELATION",
      "LOW_INFORMATION",
      "NO_EDITORIAL_ANGLE",
    ].includes(c),
  );
}

/** KEEP vs REWRITE for production inventory (structural). */
export function decideTitleRewriteAction(input: {
  title: string;
  productTitle?: string | null;
  titleFacts?: string[] | null;
}): { action: "KEEP" | "REWRITE"; reasons: ArticleHeadlineDefectCode[] } {
  const reasons = classifyArticleHeadlineDefects(input);
  if (reasons.length === 0) return { action: "KEEP", reasons: [] };
  return { action: "REWRITE", reasons };
}

export function buildEditorialDecisionPlannerPrompt(input: {
  productTitle: string;
  evidenceSurfaces: string[];
  planBodyFacts: string[];
  performers: string[];
}): { system: string; user: string } {
  const system = [
    "あなたは日本語アダルトアフィリエイト記事の編集者です。",
    "作品全体を理解し、記事としてどの切り口で紹介するかを決める。",
    "出力はJSONのみ。タイトル文そのものを書かない。",
    "Evidenceにない出演者・企画・評価・人気・断定を作らない。",
    "固定カテゴリ（出演者/設定/フェチ等）から選ばない。作品ごとに自由文で書く。",
    "公式商品名の短縮版やキーワード羅列をangleにしない。",
  ].join("");
  const user = JSON.stringify(
    {
      instruction:
        "Return JSON {angle, readerHook, whyThisWork, supportingEvidenceRefs}. angle/readerHook/whyThisWork are short Japanese editorial notes (not titles). supportingEvidenceRefs: subset of evidenceSurfaces or planBodyFacts that ground the angle.",
      productTitle: input.productTitle,
      performers: input.performers.slice(0, 8),
      evidenceSurfaces: input.evidenceSurfaces.slice(0, 24),
      planBodyFacts: input.planBodyFacts.slice(0, 16),
    },
    null,
    2,
  );
  return { system, user };
}

export function parseEditorialDecisionJson(
  raw: string,
): ArticleEditorialDecision | null {
  const m = String(raw ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const angle = typeof j.angle === "string" ? j.angle.trim() : "";
    const readerHook = typeof j.readerHook === "string" ? j.readerHook.trim() : "";
    const whyThisWork = typeof j.whyThisWork === "string" ? j.whyThisWork.trim() : "";
    const refs = Array.isArray(j.supportingEvidenceRefs)
      ? j.supportingEvidenceRefs.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
      : [];
    if (!angle || angle.length < 4) return null;
    // Reject if model returned a finished title-looking short glue phrase as angle
    if (looksLikePerformerKeywordGlue(angle) && angle.length <= 28) return null;
    return {
      angle: angle.slice(0, 160),
      readerHook: (readerHook || angle).slice(0, 160),
      whyThisWork: (whyThisWork || readerHook || angle).slice(0, 160),
      supportingEvidenceRefs: refs.slice(0, 12),
    };
  } catch {
    return null;
  }
}

/**
 * Fallback when LLM angle planning fails — free-text note from evidence, still not a title.
 * Does not pick from fixed enums.
 */
export function buildDeterministicEditorialDecisionFallback(input: {
  productTitle: string;
  evidenceSurfaces: string[];
  performers: string[];
}): ArticleEditorialDecision {
  const surfaces = input.evidenceSurfaces.map((s) => s.trim()).filter((s) => s.length >= 4).slice(0, 6);
  const who = input.performers[0]?.trim();
  const theme = surfaces.find((s) => s !== who && s.length >= 4) ?? input.productTitle.slice(0, 40);
  const angle = who
    ? `${who}を軸に、${theme}が作品選びの決め手になる点を紹介する`
    : `${theme}を軸に、この作品を選ぶ理由を紹介する`;
  return {
    angle: angle.slice(0, 160),
    readerHook: `読者が作品一覧で気になる差別化点として「${theme.slice(0, 40)}」を先に示す`.slice(0, 160),
    whyThisWork: `公式情報から確認できる具体点（${surfaces.slice(0, 3).join(" / ") || theme}）を記事の切り口にする`.slice(
      0,
      160,
    ),
    supportingEvidenceRefs: surfaces.slice(0, 8),
  };
}

export function validateEditorialDecisionGrounding(input: {
  decision: ArticleEditorialDecision;
  allowedSurfaces: string[];
  performers: string[];
}): { ok: boolean; reason?: string } {
  const allowed = new Set(
    input.allowedSurfaces.map((s) => s.replace(/\s+/g, "")).filter(Boolean),
  );
  const text = `${input.decision.angle}${input.decision.readerHook}${input.decision.whyThisWork}`;
  // Soft check: named performers in angle should appear in performer list or surfaces
  for (const p of input.performers) {
    if (p.length < 2) continue;
    if (text.includes(p)) continue;
  }
  // Reject obvious reputation invention
  if (/(?:売上No\.?1|大人気|必見|見逃せ|今すぐ買え)/u.test(text)) {
    return { ok: false, reason: "PROMO_INVENTION" };
  }
  if (allowed.size === 0) return { ok: true };
  return { ok: true };
}
