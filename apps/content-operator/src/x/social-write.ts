/**
 * X Writer — writes natural third-party media copy from an XSocialPlan.
 * Production path prefers LLM. synthesize is offline/test-only — not a publish fallback.
 */

import type { LLMProvider } from "../adapters/types.js";
import type { XSocialPlan } from "./social-plan.js";
import { detectXAdultExpressions, stripXAdultSpans } from "./x-social-content-policy.js";

/** Lower temperature for X social — reduces run-to-run PASS/FAIL oscillation. */
export const X_SOCIAL_LLM_TEMPERATURE = 0.2;

export const X_SOCIAL_WRITER_SYSTEM = [
  "You are a Japanese social-media Writer for an adult media recommendation account on X (Twitter).",
  "Write as a third-party media introducer — not the performer, not the maker, not a character in the work.",
  "EDITORIAL fields (whatIsInteresting / angle / readerHook / whyThisWork / supportingClaims) tell you WHAT to introduce — they are intent, not finished copy.",
  "EXPRESSION_SAFE_FACTS are the ONLY surfaces you may quote or closely paraphrase into the final body.",
  "WORK_UNDERSTANDING is meaning context only — never paste holey or adult-stripped debris from it.",
  "Do NOT invent performers, scenes, rankings, popularity, or evaluations absent from the plan.",
  "State concrete work facts (who / setting / series / runtime / catalog shape). Do not praise or evaluate.",
  "FORBIDDEN: soft puffery closers, empty evaluation (魅力 / 注目 / 引き込 / 際立 / 楽しめる一作 / 魅力の一作 / 話題です).",
  "FORBIDDEN templates: 「Nameが出演する作品で、…」「Nameを軸にした作品紹介」「〜という作品です」「〜という設定」「N時間収録のまとめ」.",
  "FORBIDDEN assemble shapes: 「Nameの近作では、{fact}」「見どころとして、{fact}」「{fact}がどう展開するか気になる」.",
  "FORBIDDEN: package fragment glue — do not concatenate source package slogans / stimulatory scraps into a sentence chain.",
  "FORBIDDEN: source slogan reuse (金ヅル / ナメ腐った / 生き物の本懐 / やっぱ…とは / P活女ども style package voice).",
  "FORBIDDEN: unsupported grand summaries that leap beyond EXPRESSION_SAFE_FACTS.",
  "Do NOT paste claim fragments. Do NOT concatenate package title scraps. Write 1–3 natural Japanese sentences from canonical understanding.",
  "Do not pad to fill character count. Prefer shorter natural intros over padded catalog voice.",
  "Vary openings without mechanical Name+出演する / 近作では repetition.",
  "Timeline-safe: no sexual acts, genitals/fluids, explicit body focus, adult hype, source voice, or brand slogans.",
  "If a fact is adult-adjacent (massage / taxi / therapist setting), describe the setting and cast only — never the sexual act.",
  "No stock CTA. Omit URLs. Do not write 「詳しくはこちら」「記事に書いています」 — publication owns navigation replies.",
  "If facts are thin (identity / runtime / series only), write a short factual third-party intro with those facts only — no invented plot.",
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
  /魅力を感じ|注目が集まり|注目されます|入り込みやすい|雰囲気を引き立て|が出演する作品|見どころとして、|の近作では、|におすすめ|興味がある方|KMPVRが変わる|制作・著作株式会社|という設定が|という設定も|魅力の一作|楽しめる一作|金ヅル|ナメ腐った|生き物の本懐|P活女ども|詳しくはこちら|記事に書いています/u;

function isAdultUnsafe(text: string): boolean {
  return detectXAdultExpressions(text).hit;
}

function isStyleReject(text: string): boolean {
  return WRITER_REJECT_RE.test(text);
}

function isPublishableWriterBody(text: string): boolean {
  if (!text || text.replace(/\s+/g, "").length < 28) return false;
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

function writerSafeUnderstanding(plan: XSocialPlan): string[] {
  return plan.workUnderstanding
    .filter((w) => {
      const t = w.trim();
      if (t.length < 8 || t.length > 64) return false;
      if (isAdultUnsafe(t) || isStyleReject(t)) return false;
      if (/[はがをにとの]$/u.test(t)) return false;
      if (/もそうな|」、|鬼オホ|散らす|塗りたく|起き上がり|のった|らせて|を吹き|直後の|ヤり|エッチ/u.test(t)) {
        return false;
      }
      return true;
    })
    .slice(0, 4);
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
  if (subject && premise && premise.length >= 8) {
    sentences.push(ensurePeriod(`${subject}の${contentType || "作品"}として、${premise}に焦点を当てて紹介する`));
  } else if (premise && premise.length >= 10) {
    sentences.push(ensurePeriod(`${premise}を軸に、公式情報から読み取れる焦点を伝える`));
  } else if (subject && primary) {
    sentences.push(ensurePeriod(`${subject}の作品では、${primary}が具体点になっている`));
  } else if (subject && contentType) {
    sentences.push(ensurePeriod(`${subject}の${contentType}を、確認できる収録焦点から紹介する`));
  } else if (primary) {
    sentences.push(ensurePeriod(`${primary}を作品の具体点として伝える`));
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
    sentences.push(ensurePeriod(`${featureClaim}も具体点として触れておく`));
  } else if (why && !used.includes(why) && sentences.length < 3) {
    sentences.push(ensurePeriod(why));
  } else if (primary && premise && primary !== premise && !used.includes(primary) && sentences.length < 3) {
    sentences.push(ensurePeriod(`${primary}も併せて押さえたい`));
  } else if (secondary && !used.includes(secondary) && sentences.length < 3) {
    sentences.push(ensurePeriod(secondary));
  }

  if (sentences.length === 0 && subject) {
    sentences.push(ensurePeriod(`${subject}の作品を、公式に確認できる焦点から紹介する`));
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
  opts?: { revisionHints?: string[]; previousBody?: string | null },
): {
  systemInstruction: string;
  userPrompt: string;
  outputSchema: Record<string, unknown>;
} {
  const writerPlan = {
    SUBJECT: plan.subject,
    CONTENT_TYPE: plan.contentType,
    WHAT_IS_INTERESTING: plan.whatIsInteresting,
    ANGLE: plan.angle,
    READER_HOOK: plan.readerHook,
    WHY_THIS_WORK: plan.whyThisWork,
    SUPPORTING_CLAIMS: plan.supportingClaims,
    WORK_UNDERSTANDING: writerSafeUnderstanding(plan),
    EXPRESSION_SAFE_FACTS: plan.allowedClaims,
    CORE_PREMISE: plan.corePremise,
    PRIMARY_APPEAL: plan.primaryAppeal,
    SECONDARY_APPEAL: plan.secondaryAppeal,
    CONCRETE_DETAILS: plan.concreteDetails,
    PRODUCT_TITLE: sanitizeProductTitleForWriter(plan),
    PERFORMERS: plan.canonicalContext.performers,
    SERIES: plan.canonicalContext.seriesName,
  };
  const hints = (opts?.revisionHints ?? []).filter(Boolean);
  const prev = (opts?.previousBody ?? "").trim();
  return {
    systemInstruction: X_SOCIAL_WRITER_SYSTEM,
    userPrompt: [
      "Write one X parent post body (Japanese) from this X_PLAN.",
      "Parent only — no URLs, no hashtags, no article/navigation CTA (publication owns replies).",
      "Compose from canonical understanding; do not glue package fragments or source slogans.",
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
        body: { type: "string", minLength: 24, maxLength: 280 },
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
    promptIdentifier: string;
  },
): Promise<string | null> {
  const prompts = buildXSocialWriterPrompts(plan, {
    revisionHints: opts.revisionHints,
    previousBody: opts.previousBody,
  });
  const result = await opts.llm.executeTask({
    taskType: "GENERATION_X_SOCIAL",
    promptIdentifier: opts.promptIdentifier,
    promptVersion: "v3",
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
            angle: plan.subject
              ? `${plan.subject}の作品を、確認できる設定から紹介する`
              : "確認できる設定から作品を紹介する",
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

/** Sync helper for tests that inject synthesize only. */
export function writeXSocialCopySync(plan: XSocialPlan): SocialWriteResult {
  return synthesizeXSocialFromPlan(plan);
}
