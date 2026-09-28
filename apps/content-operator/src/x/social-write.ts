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
  "You write one Japanese X post as a third party, not as the performer or the maker.",
  "RELATIONS are the only connections you may write. Do not join two facts unless a relation says so.",
  "A campaign is not something that 収録される. A person is not the work. A runtime is not the point of the post.",
  "Say the primary relation: a premise, a feature, or the project name. Runtime, disc count, BEST, and 配信限定 may only sit beside that primary.",
  "If the only true relation is performer plus a runtime, BEST, or 配信限定, return {\"body\":\"\"}.",
  "Do not write a post that is only 「の作品は、〜だ」, 「のシリーズ作品は、〜だ」, or 「AはBだ」. Do not end with 「がある」 after a number, a person, or する.",
  "Do not write 「出演作では」, 「が出演する作品では」, 「作品では」, 「という状況設定」, 「として制作されています」, 「が特徴」, or 「展開されます」.",
  "Do not add rankings or evaluations such as 魅力, 圧巻, 必見, 世界観, 話題, 楽しめる, 迫力, 濃密, 際立って, 没入, or 注目.",
  "Do not drop a word inside a phrase, and do not delete spaces to join title pieces.",
  "If only one fact exists, do not invent a second one, and still do not use 「の作品は、〜だ」.",
  "No URL. No hashtag. No navigation line.",
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
  opts?: { revisionHints?: string[]; previousBody?: string | null },
): {
  systemInstruction: string;
  userPrompt: string;
  outputSchema: Record<string, unknown>;
} {
  const writerPlan = {
    SUBJECT: plan.subject,
    RELATIONS: plan.semanticRelations ?? [],
    PRIMARY: (plan.semanticFacts ?? []).filter((fact) => fact.salience === "primary").map((fact) => fact.value),
    SUPPORTING: (plan.semanticFacts ?? []).filter((fact) => fact.salience === "supporting").map((fact) => fact.value),
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
            angle: plan.allowedClaims[0] ?? plan.subject ?? "作品の焦点",
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
