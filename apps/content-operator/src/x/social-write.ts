/**
 * X Writer — one personal X post from an XSocialPlan.
 * Production path prefers LLM. synthesize is offline/test-only — not a publish fallback.
 */

import type { LLMProvider } from "../adapters/types.js";
import type { XSocialPlan } from "./social-plan.js";
import { detectXAdultExpressions, stripXAdultSpans } from "./x-social-content-policy.js";
import { chooseXCopyArchetype, xCopyArchetypeDirection } from "./x-copy-voice.js";

/** Lower temperature for X social — reduces run-to-run PASS/FAIL oscillation. */
export const X_SOCIAL_LLM_TEMPERATURE = 0.2;

/** Writer prompt id. Bumping this allows a new X copy generation for the same product. */
export const X_SOCIAL_WRITER_PROMPT_VERSION = "v3";

export const X_SOCIAL_WRITER_SYSTEM = [
  "あなたは成人向け作品を普段から見ている日本人男性の個人Xアカウントとして、投稿を1つ書く。",
  "宣伝文ではない。タイムラインに流れてくる普通の個人の投稿を書く。",
  "上手くまとめない。広告コピーにしない。レビュー記事にしない。インフルエンサー口調にしない。",
  "毎回、フック、説明、おすすめ、CTA、という構造にしない。",
  "短い投稿でよい。独り言でよい。少し雑でよい。個人的な好みや、見た・見ようと思った、という主観は作ってよい。",
  "作品の具体的な事実は、渡された公式情報だけを使う。",
  "公式説明文を切り取って貼らない。正式タイトルを毎回全文で入れなくてよい。出演者名、シリーズ名、これ、今回のやつ、でも作品が分かるなら足りる。",
  "存在しない出演者、プレイ内容、シーン、シリーズ関係、ランキング、売上、評価は作らない。",
  "刺さる、強すぎる、反則、破壊力、沼る、優勝、神作、圧倒的、没入感、クオリティ高い、見逃せない、要チェック、好きな人にはたまらない、必見、ヤバい、は使わない。似た広告口調も使わない。",
  "絵文字は0個が普通。使うときも2個まで。毎投稿で火や目や年齢制限の絵文字を付けない。",
  "ハッシュタグは付けない。URLは付けない。本文でURLへ誘導する営業文句は書かない。",
  "最大文字数まで埋めない。VERY_SHORT、SHORT、MEDIUMを投稿ごとに変える。",
  "Return JSON only: {\"body\":\"...\"}.",
].join(" ");

export type SocialWriteResult = {
  body: string;
  sentences: string[];
  mode: "llm" | "editorial_synthesize";
};

function ensurePeriod(s: string): string {
  const t = s.replace(/[。．]+$/u, "").trim();
  if (!t) return "";
  return /[。！？]$/u.test(t) ? t : `${t}。`;
}

function stripTrailing(s: string): string {
  return s.replace(/[。．！？]+$/u, "").trim();
}

function softNormalize(s: string): string {
  return stripTrailing(s)
    .replace(/ギブアップ\s*NG/giu, "ギブアップなし")
    .replace(/ギブアップNG/giu, "ギブアップなし");
}

const WRITER_REJECT_RE =
  /魅力を感じ|注目が集まり|注目されます|入り込みやすい|雰囲気を引き立て|が出演する作品|見どころとして、|の近作では、|出演作では|という状況設定|状況設定が特徴|として制作されて|登場して|振り返ることが|におすすめ|興味がある方|KMPVRが変わる|制作・著作株式会社|という設定が|という設定も|魅力の一作|楽しめる一作|金ヅル|ナメ腐った|生き物の本懐|P活女ども|詳しくはこちら|記事に書いています/u;

function isAdultUnsafe(text: string): boolean {
  return detectXAdultExpressions(text).hit;
}

function isStyleReject(text: string): boolean {
  return WRITER_REJECT_RE.test(text);
}

function isPublishableWriterBody(text: string): boolean {
  if (!text || text.replace(/\s+/g, "").length < 8) return false;
  if (isAdultUnsafe(text)) return false;
  if (isStyleReject(text)) return false;
  return true;
}

function sanitizeProductTitleForWriter(plan: XSocialPlan): string {
  if (plan.subject && plan.contentType && plan.contentType !== "作品紹介") {
    return `${plan.subject}の${plan.contentType}`;
  }
  if (plan.subject) return `${plan.subject}の作品`;
  if (plan.contentType && plan.contentType !== "作品紹介") return plan.contentType;
  return "作品紹介";
}

/** Keep non-adult sentences from an LLM draft — does not invent new facts. */
function salvageNonAdultBody(raw: string): string | null {
  const stripped = stripXAdultSpans(raw)
    .replace(/\s+/g, " ")
    .replace(/（\s*）|\(\s*\)/gu, "")
    .trim();
  if (!stripped) return null;
  const kept = stripped
    .split(/([。！？])/u)
    .reduce<string[]>((acc, part, i, arr) => {
      if (i % 2 === 1) return acc;
      const punct = arr[i + 1] ?? "。";
      const sent = `${part.trim()}${punct === "。" || punct === "！" || punct === "？" ? punct : "。"}`;
      const t = sent.replace(/[。！？]+$/u, "").trim();
      if (t.length < 10) return acc;
      if (isAdultUnsafe(sent)) return acc;
      if (/[はがをにとの]$/u.test(t)) return acc;
      acc.push(ensurePeriod(t));
      return acc;
    }, [])
    .slice(0, 4);
  const body = kept.join("");
  if (!body || body.replace(/\s+/g, "").length < 28) return null;
  if (isAdultUnsafe(body)) return null;
  return body;
}

/**
 * Offline / unit-test weave only. Not used as production publish fallback when LLM is available.
 */
export function synthesizeXSocialFromPlan(plan: XSocialPlan): SocialWriteResult {
  if (plan.viability === "X_POSTABLE") {
    const grounded = composeGroundedIntro(plan);
    if (grounded) {
      return { body: grounded, sentences: [grounded], mode: "editorial_synthesize" };
    }
  }
  if (plan.viability === "X_INSUFFICIENT_MATERIAL") {
    return { body: "", sentences: [], mode: "editorial_synthesize" };
  }
  const safe = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const t = softNormalize(raw);
    if (!t || detectXAdultExpressions(t).hit) return null;
    if (/が出演する作品|を軸にした作品紹介|時間収録のまとめ|の近作では|見どころとして|がどう展開するか気になる/u.test(t)) {
      return null;
    }
    return t;
  };
  const subject = plan.subject?.trim() || null;
  const premise = safe(plan.corePremise) || safe(plan.allowedClaims[0]);
  const primary = safe(plan.primaryAppeal) || safe(plan.allowedClaims[1]);
  const secondary = safe(plan.secondaryAppeal) || safe(plan.concreteDetails[0]);
  const why = safe(plan.whyThisWork);
  const contentType = plan.contentType && plan.contentType !== "作品紹介" ? plan.contentType : null;

  const sentences: string[] = [];
  if (subject && premise && premise.length >= 4) {
    sentences.push(ensurePeriod(`${subject}の${contentType || "作品"}として、${premise}に焦点を当てて紹介する`));
  } else if (premise && premise.length >= 10) {
    sentences.push(ensurePeriod(`${premise}が焦点だ`));
  } else if (subject && primary) {
    sentences.push(ensurePeriod(`${subject}は、${primary}が焦点だ`));
  } else if (subject && contentType) {
    sentences.push(ensurePeriod(`${subject}の${contentType}が焦点だ`));
  } else if (primary) {
    sentences.push(ensurePeriod(`${primary}が焦点だ`));
  }

  const used = sentences.join("");
  const featureClaim =
    plan.allowedClaims
      .map(safe)
      .find(
        (c) =>
          c &&
          !used.includes(c) &&
          /尻テク|業界トップ|\d+作品|\d+時間|ギブアップ|シリーズ|エステ|タクシー|ランナー|合宿|町内|収録/u.test(c),
      ) ?? null;
  if (featureClaim && sentences.length < 3) {
    sentences.push(ensurePeriod(`${featureClaim}も焦点だ`));
  } else if (why && !used.includes(why) && sentences.length < 3) {
    sentences.push(ensurePeriod(why));
  } else if (
    primary &&
    premise &&
    primary !== premise &&
    !used.includes(primary) &&
    sentences.length < 3 &&
    /[はがをにで]/u.test(primary)
  ) {
    sentences.push(ensurePeriod(`${primary}も焦点だ`));
  } else if (secondary && !used.includes(secondary) && sentences.length < 3 && /[はがをにで]/u.test(secondary)) {
    sentences.push(ensurePeriod(secondary));
  } else if (subject && sentences.length < 2) {
    const extra = plan.allowedClaims
      .map(safe)
      .find((claim) => claim && claim !== premise && !used.includes(claim) && claim.length <= 28);
    if (extra) sentences.push(ensurePeriod(`${subject}では、${extra}も焦点だ`));
  }

  if (sentences.length === 0 && subject) {
    sentences.push(ensurePeriod(`${subject}の作品が焦点だ`));
  }

  const flat: string[] = [];
  for (const sent of sentences) {
    for (const p of sent.split(/。/u).map((x) => x.trim()).filter(Boolean)) {
      flat.push(ensurePeriod(p));
    }
  }
  const capped = flat.slice(0, 4);
  return { body: capped.join(""), sentences: capped, mode: "editorial_synthesize" };
}

function extractBody(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (typeof o.body === "string" && o.body.trim()) return o.body.trim();
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  return null;
}

function finalizeBody(cleaned: string): SocialWriteResult {
  const sentences = cleaned
    .split(/[。！？]/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ensurePeriod(s));
  return {
    body: sentences.join("") || ensurePeriod(cleaned),
    sentences: sentences.length ? sentences : [ensurePeriod(cleaned)],
    mode: "llm",
  };
}

export function buildXSocialWriterPrompts(
  plan: XSocialPlan,
  opts?: { revisionHints?: string[]; previousBody?: string | null; recentArchetypes?: string[] },
): {
  systemInstruction: string;
  userPrompt: string;
  outputSchema: Record<string, unknown>;
} {
  const writerPlan = {
    FOCUS: plan.angle,
    SUBJECT: plan.subject,
    RELATIONS: plan.semanticRelations ?? [],
    SUPPORTING: (plan.semanticFacts ?? []).filter((fact) => fact.salience === "supporting").map((fact) => fact.value),
  };
  const hints = (opts?.revisionHints ?? []).filter(Boolean);
  const prev = (opts?.previousBody ?? "").trim();
  const archetype = chooseXCopyArchetype(
    [plan.productTitle, plan.subject ?? "", ...(plan.canonicalContext.performers ?? [])].join("\n"),
    opts?.recentArchetypes ?? [],
  );
  return {
    systemInstruction: X_SOCIAL_WRITER_SYSTEM,
    userPrompt: [
      "個人のX投稿を1つ。公式説明の要約にしない。",
      "URLもハッシュタグも営業CTAも書かない。URLは投稿側が付ける。",
      xCopyArchetypeDirection(archetype),
      "この型の例文をそのまま使わない。書き出しを毎回同じにしない。",
      hints.length ? `Revision requirements:\n- ${hints.join("\n- ")}` : "",
      prev
        ? `Previous draft (do not copy flaws; rewrite from grounded plan):\n${prev.slice(0, 280)}`
        : "",
      "X_PLAN:",
      JSON.stringify(writerPlan, null, 2),
    ]
      .filter(Boolean)
      .join("\n"),
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["body"],
      properties: {
        body: { type: "string", minLength: 8, maxLength: 280 },
      },
    },
  };
}

async function executeWriterOnce(
  plan: XSocialPlan,
  opts: {
    llm: LLMProvider;
    model?: string;
    revisionHints?: string[];
    previousBody?: string | null;
    recentArchetypes?: string[];
    promptIdentifier: string;
  },
): Promise<string | null> {
  const prompts = buildXSocialWriterPrompts(plan, {
    revisionHints: opts.revisionHints,
    previousBody: opts.previousBody,
    recentArchetypes: opts.recentArchetypes,
  });
  const result = await opts.llm.executeTask({
    taskType: "GENERATION_X_SOCIAL",
    promptIdentifier: opts.promptIdentifier,
    promptVersion: X_SOCIAL_WRITER_PROMPT_VERSION,
    systemInstruction: prompts.systemInstruction,
    userPrompt: prompts.userPrompt,
    outputSchema: prompts.outputSchema,
    model: opts.model,
    temperature: X_SOCIAL_LLM_TEMPERATURE,
    input: {
      xPlan: plan,
      productTitle: sanitizeProductTitleForWriter(plan),
      allowedClaims: plan.allowedClaims,
      revisionHints: opts.revisionHints ?? [],
    },
  });
  const body = extractBody(result.output);
  if (!body) return null;
  return body
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Write X copy. Uses LLM when provided; otherwise offline synthesize (tests only).
 * When LLM is configured, never synthesize a publish body.
 *
 * Stability rule: adult-unsafe drafts are salvaged (strip) then retried with safe facts only.
 * Style/puffery rejects are returned to Review (not emptied) so Rewrite keeps failure context.
 */
export async function writeXSocialCopy(
  plan: XSocialPlan,
  opts?: {
    llm?: LLMProvider | null;
    model?: string;
    revisionHints?: string[];
    previousBody?: string | null;
    recentArchetypes?: string[];
  },
): Promise<SocialWriteResult> {
  const llm = opts?.llm ?? null;
  if (llm) {
    try {
      const cleaned = await executeWriterOnce(plan, {
        llm,
        model: opts?.model,
        revisionHints: opts?.revisionHints,
        previousBody: opts?.previousBody,
        recentArchetypes: opts?.recentArchetypes,
        promptIdentifier: "x.social.generate",
      });
      if (cleaned) {
        if (isPublishableWriterBody(cleaned)) {
          return finalizeBody(cleaned);
        }
        // Adult leak → strip non-adult sentences first (no invention).
        if (isAdultUnsafe(cleaned)) {
          const salvaged = salvageNonAdultBody(cleaned);
          if (salvaged && isPublishableWriterBody(salvaged)) {
            return finalizeBody(salvaged);
          }
          if (salvaged && !isAdultUnsafe(salvaged)) {
            return finalizeBody(salvaged);
          }
          const safeOnlyPlan: XSocialPlan = {
            ...plan,
            productTitle: sanitizeProductTitleForWriter(plan),
            corePremise: plan.allowedClaims[0] ?? plan.corePremise,
            primaryAppeal: plan.allowedClaims[1] ?? plan.primaryAppeal,
            secondaryAppeal: null,
            concreteDetails: [],
            workUnderstanding: [],
            angle: plan.angle || plan.allowedClaims[0] || plan.subject || "",
            readerHook: plan.allowedClaims[0] ?? plan.readerHook,
            whyThisWork: plan.allowedClaims[1] ?? plan.whyThisWork,
          };
          const retryHints = [
            ...(opts?.revisionHints ?? []),
            "Use ONLY EXPRESSION_SAFE_FACTS / SUBJECT / CONTENT_TYPE.",
            "Ignore WORK_UNDERSTANDING entirely.",
            "Describe cast and setting only — never sexual acts or body focus.",
            "No CTA, no mechanical templates, no empty praise.",
          ];
          const retryClean = await executeWriterOnce(safeOnlyPlan, {
            llm,
            model: opts?.model,
            revisionHints: retryHints,
            previousBody: salvaged || cleaned,
            recentArchetypes: opts?.recentArchetypes,
            promptIdentifier: "x.social.generate.retry_safe",
          });
          if (retryClean && isPublishableWriterBody(retryClean)) {
            return finalizeBody(retryClean);
          }
          if (retryClean && isAdultUnsafe(retryClean)) {
            const retrySalvage = salvageNonAdultBody(retryClean);
            if (retrySalvage && !isAdultUnsafe(retrySalvage)) {
              return finalizeBody(retrySalvage);
            }
          }
          if (retryClean && !isAdultUnsafe(retryClean)) {
            // Style-only issues → let Review + Rewrite handle with exact codes.
            return finalizeBody(retryClean);
          }
          // Keep empty so Review/Rewrite see EMPTY_BODY with exact codes (no synthesize publish).
          return { body: "", sentences: [], mode: "llm" };
        }
        // Style/puffery only — keep body for Review so Rewrite receives real failure codes.
        return finalizeBody(cleaned);
      }
    } catch (err) {
      // Surface LLM/network/quota failures as empty body (Review → GENERATION_FAILURE).
      // Do not synthesize a publish body.
      if (process.env.X_SOCIAL_WRITER_DEBUG === "1") {
        console.error(
          JSON.stringify({
            phase: "x_writer_llm_error",
            message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
          }),
        );
      }
      return { body: "", sentences: [], mode: "llm" };
    }
    return { body: "", sentences: [], mode: "llm" };
  }
  return synthesizeXSocialFromPlan(plan);
}

/** Relation sentence. Returns null when the only possible sentence is a spec readout. */
export function composeGroundedIntro(plan: XSocialPlan): string | null {
  if (plan.viability === "X_INSUFFICIENT_MATERIAL") return null;
  const relations = plan.semanticRelations ?? [];
  const primary = (plan.semanticFacts ?? []).filter((fact) => fact.salience === "primary");
  if (primary.length === 0 || relations.length === 0) return null;
  const who = plan.subject?.trim() || "";
  const rel = (type: string) => relations.filter((item) => item.type === type);
  const described = rel("described_as")[0];
  const premise = rel("has_premise")[0];
  const feature = rel("has_feature")[0];
  const belongs = rel("belongs_to")[0];
  const appears = rel("appears_in")[0];
  const formats = rel("has_format").map((item) => item.to);
  const runtimes = rel("has_runtime").map((item) => item.to);
  const volumes = rel("has_volume").map((item) => item.to);

  if (described && appears) {
    const format = formats.includes("配信限定") ? "配信限定の" : "";
    return `${described.from}は、${described.to}として、${format}${appears.to}に出演している。`;
  }
  if (premise) {
    const work = who && appears ? `${who}の${premise.from}` : premise.from;
    const extra = [...runtimes, ...volumes].slice(0, 2);
    if (/[うくぐすつぬぶむる]$/u.test(premise.to)) {
      return `${work}は、${premise.to}。`;
    }
    if (/参加$/u.test(premise.to)) {
      const label = extra.length ? `${extra.join("、")}で、` : "";
      return `${work}は、${label}${premise.to}する。`;
    }
    const runtime = runtimes[0] ? `${runtimes[0]}で` : "";
    return `${work}は、${premise.to}を${runtime}収録している。`;
  }
  if (feature) {
    const campaign = belongs?.to || feature.from;
    const person = who || appears?.from || "";
    if (!person) return null;
    return `${person}は、${feature.to}の${campaign}に出演している。`;
  }
  const project = primary.find((fact) => fact.role === "what" && !/完全主観|周年|祭り/u.test(fact.value));
  if (project && (who || appears)) {
    const person = who || appears?.from || "";
    const campaign = belongs?.to;
    const name = campaign ? `${campaign}の${project.value}` : project.value;
    return `${person}は、${name}に出演している。`;
  }
  return null;
}

export function writeXSocialCopySync(plan: XSocialPlan): SocialWriteResult {
  return synthesizeXSocialFromPlan(plan);
}
