/**
 * Detect empty / AI-boilerplate intros in Blogger drafts.
 * Used by Quality Gate (deterministic) — does not invent style rules beyond banned openers.
 */

const BANNED_OPENERS = [
  /今回は.{0,40}ご紹介します/,
  /この記事では/,
  /結論から言うと/,
  /すぐに結論です/,
  /まずは結論/,
  /さて、今回/,
  /みなさんこんにちは/,
  /こんにちは[。．!]?\s*今回/,
];

export interface IntroQualityResult {
  ok: boolean;
  findings: Array<{ code: string; message: string }>;
}

export function evaluateIntroQuality(input: {
  title: string;
  body: string;
  lead?: string | null;
}): IntroQualityResult {
  const findings: Array<{ code: string; message: string }> = [];
  const head = [input.lead ?? "", input.body].join("\n").trim();
  const firstLines = head
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");

  for (const pattern of BANNED_OPENERS) {
    if (pattern.test(firstLines) || pattern.test(input.title)) {
      findings.push({
        code: "AI_BOILERPLATE_INTRO",
        message: `Banned AI opener pattern: ${String(pattern)}`,
      });
    }
  }

  // Long general preamble before any concrete noun/URL/number
  const firstPara = firstLines.split(/\n/)[0] ?? "";
  if (firstPara.length > 180 && !/https?:\/\/|\d{4}|円|メーカー|シリーズ|配信/.test(firstPara)) {
    findings.push({
      code: "LONG_GENERIC_PREAMBLE",
      message: "Opening paragraph is long and lacks concrete topic signals",
    });
  }

  return { ok: findings.length === 0, findings };
}

export function listBannedIntroPatterns(): RegExp[] {
  return [...BANNED_OPENERS];
}
