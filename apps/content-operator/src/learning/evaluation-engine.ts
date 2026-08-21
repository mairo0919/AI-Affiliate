import type { AnalyticsAggregate, ContentVersion } from "@ai-affiliate/database";

export interface DeterministicEvaluationResult {
  overallScore: number;
  seoScore: number;
  ctrScore: number;
  contentScore: number;
  engagementScore: number;
  ctaQuality: number;
  headlineQuality: number;
  freshness: number;
  confidence: number;
  evaluationReason: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  findings: Array<{
    category: string;
    severity: string;
    code: string;
    message: string;
    evidence?: Record<string, unknown>;
  }>;
  payload: Record<string, unknown>;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function countCta(body: string): number {
  const patterns = [/https?:\/\//gi, /詳細は/, /商品ページ/, /続きを読む/, /こちら/];
  let count = 0;
  for (const p of patterns) {
    const m = body.match(p);
    if (m) count += m.length;
  }
  return count;
}

function headingCount(body: string): number {
  return (body.match(/^#{1,3}\s+/gm) ?? []).length + (body.match(/<h[1-3][\s>]/gi) ?? []).length;
}

function estimateDuplicationRate(body: string): number {
  const sentences = body
    .split(/[。．\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  if (sentences.length < 2) return 0;
  const seen = new Map<string, number>();
  for (const s of sentences) {
    const key = s.slice(0, 24);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let dup = 0;
  for (const c of seen.values()) if (c > 1) dup += c - 1;
  return dup / sentences.length;
}

/**
 * Deterministic evaluation first (P5). LLM may refine later but must not replace scores silently.
 */
export function evaluateDeterministically(input: {
  version: ContentVersion;
  aggregate: AnalyticsAggregate | null;
  platform: string;
}): DeterministicEvaluationResult {
  const body = input.version.body ?? "";
  const title = input.version.title ?? "";
  const length = [...body].length;
  const headings = headingCount(body);
  const ctas = countCta(body);
  const dupRate = estimateDuplicationRate(body);
  const hasDisclosure = /アフィリエイト/.test(body);
  const hasAdultNotice = /18歳未満/.test(body);

  const impressions = input.aggregate?.impressions ?? 0;
  const clicks = input.aggregate?.clicks ?? 0;
  const ctr = input.aggregate?.ctr ?? (impressions > 0 ? clicks / impressions : 0);
  const views = input.aggregate?.views ?? 0;
  const engagement = input.aggregate?.engagement ?? 0;
  const ageHours = input.aggregate?.publicationAgeHours ?? 0;

  // SEO: impressions volume + CTR quality
  const impressionScore = clamp01(Math.log10((impressions || 0) + 1) / 4);
  const ctrScore = clamp01(ctr / 0.05); // ~5% CTR = 1.0
  const clickQuality =
    views > 0 ? clamp01((input.aggregate?.externalClicks ?? clicks) / Math.max(views, 1)) : ctrScore;
  const seoScore = avg([impressionScore, ctrScore, clickQuality]);

  // Content quality
  const lengthScore =
    input.platform === "X"
      ? clamp01(1 - Math.abs(length - 80) / 80)
      : clamp01(length >= 400 && length <= 6000 ? 1 : length < 400 ? length / 400 : 6000 / length);
  const headingScore =
    input.platform === "X" ? 1 : clamp01(headings >= 2 && headings <= 8 ? 1 : headings / 4);
  const ctaScore =
    ctas === 0 ? 0.2 : ctas === 1 || ctas === 2 ? 1 : ctas <= 4 ? 0.7 : 0.35;
  const ctaPosition =
    /https?:\/\//.test(body.slice(Math.floor(body.length * 0.5))) || /商品ページ|詳細/.test(body)
      ? 0.9
      : 0.5;
  const dupScore = clamp01(1 - dupRate * 2);
  const readability = avg([
    hasDisclosure ? 1 : 0.6,
    input.platform === "BLOGGER" && hasAdultNotice ? 1 : input.platform === "BLOGGER" ? 0.5 : 0.8,
    dupScore,
  ]);
  const contentScore = avg([lengthScore, headingScore, ctaScore, ctaPosition, readability, dupScore]);

  // Engagement
  const engBase = impressions > 0 || views > 0 ? engagement / Math.max(impressions || views, 1) : 0;
  const engagementScore = clamp01(engBase / 0.1);

  const headlineQuality = clamp01(
    title.length >= 12 && title.length <= 40 ? 1 : title.length < 12 ? title.length / 12 : 40 / title.length,
  );
  const freshness = ageHours <= 0 ? 0.7 : clamp01(1 - ageHours / (24 * 30));

  const channelFitFindings: DeterministicEvaluationResult["findings"] = [];
  if (input.platform === "BLOGGER" && length < 300) {
    channelFitFindings.push({
      category: "channel-blogger",
      severity: "WARNING",
      code: "BLOGGER_TOO_SHORT",
      message: "Blogger article body is short for long-form channel",
    });
  }
  if (input.platform === "X" && length > 140) {
    channelFitFindings.push({
      category: "channel-x",
      severity: "WARNING",
      code: "X_LENGTH_HIGH",
      message: "X body may exceed weighted length expectations",
      evidence: { length },
    });
  }

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];

  if (ctrScore >= 0.6) strengths.push("CTR is relatively strong");
  else {
    weaknesses.push("CTR is weak");
    recommendations.push("Test shorter titles (≤40 chars) or clearer CTA");
  }
  if (headlineQuality >= 0.8) strengths.push("Headline length is in a strong band");
  else recommendations.push("Keep titles roughly 12–40 characters");
  if (ctaScore >= 0.8) strengths.push("CTA count looks balanced");
  else if (ctas === 0) {
    weaknesses.push("No clear CTA");
    recommendations.push("Add one primary CTA with product or article URL");
  } else if (ctas > 4) {
    weaknesses.push("Too many CTA-like signals");
    recommendations.push("Reduce CTA density to 1–2 primary actions");
  }
  if (dupRate > 0.25) {
    weaknesses.push("High phrase repetition");
    recommendations.push("Remove duplicated sentences");
  }
  if (input.platform === "BLOGGER" && headings >= 2) strengths.push("Heading structure present");
  if (recommendations.length === 0) {
    recommendations.push("Maintain current structure; collect more Analytics samples to raise confidence");
  }

  const overallScore = avg([
    seoScore,
    contentScore,
    engagementScore,
    ctrScore,
    headlineQuality,
    freshness,
  ]);
  const confidence = input.aggregate
    ? clamp01(0.4 + Math.min(input.aggregate.sampleSnapshotCount, 5) * 0.1)
    : 0.35;

  const findings: DeterministicEvaluationResult["findings"] = [
    ...channelFitFindings,
    {
      category: "seo",
      severity: seoScore < 0.4 ? "WARNING" : "INFO",
      code: "SEO_COMPOSITE",
      message: `SEO composite=${seoScore.toFixed(3)} (impressions/CTR/click quality)`,
      evidence: { impressions, ctr, clickQuality },
    },
    {
      category: "content",
      severity: contentScore < 0.45 ? "WARNING" : "INFO",
      code: "CONTENT_COMPOSITE",
      message: `Content composite=${contentScore.toFixed(3)}`,
      evidence: { length, headings, ctas, dupRate },
    },
  ];

  return {
    overallScore,
    seoScore,
    ctrScore,
    contentScore,
    engagementScore,
    ctaQuality: avg([ctaScore, ctaPosition]),
    headlineQuality,
    freshness,
    confidence,
    evaluationReason: `Deterministic ${input.platform} evaluation from AnalyticsAggregate + ContentVersion structural signals.`,
    strengths,
    weaknesses,
    recommendations,
    findings,
    payload: {
      length,
      headings,
      ctas,
      dupRate,
      impressions,
      clicks,
      ctr,
      views,
      engagement,
      ageHours,
      platform: input.platform,
    },
  };
}
