import type { LifecycleRepository } from "@ai-affiliate/database";
import type { LLMProvider } from "../adapters/types.js";
import { summarizeVersionMetrics } from "./quality-gate.js";

export interface CompetitorSnapshot {
  id: string;
  title: string;
  url?: string | null;
  excerpt: string;
  metrics: ReturnType<typeof summarizeVersionMetrics>;
}

export interface ContentComparisonResult {
  contentVersionId: string;
  competitorCount: number;
  systemDiff: {
    shorterThanMedian: boolean;
    fewerLinksThanMedian: boolean;
    missingFaqVsPeers: boolean;
    sectionGap: number;
  };
  aiAssessment: {
    informationGaps: string[];
    searchIntentFit: string;
    readability: string;
    differentiation: string;
    shallowExplanation: boolean;
    verbosity: string;
    ctaNaturalness: string;
    readerValue: string;
  };
  findings: Array<{ code: string; message: string; severity: "warning" | "info" }>;
}

/**
 * Compare generated content against research/reference snapshots.
 * Never copies competitor body — stores gaps as ReviewFindings only.
 */
export class ContentComparisonService {
  constructor(
    private readonly repo: LifecycleRepository,
    private readonly llm: LLMProvider,
  ) {}

  async compare(input: {
    contentVersionId: string;
    competitors: CompetitorSnapshot[];
  }): Promise<ContentComparisonResult> {
    const version = await this.repo.findContentVersion(input.contentVersionId);
    if (!version) throw new Error(`ContentVersion not found: ${input.contentVersionId}`);

    const ours = summarizeVersionMetrics(version);
    const peers = input.competitors.map((c) => c.metrics);
    const medianLen = median(peers.map((p) => p.articleLength)) || ours.articleLength;
    const medianLinks = median(peers.map((p) => p.linkCount)) || ours.linkCount;
    const medianSections = median(peers.map((p) => p.sectionCount)) || ours.sectionCount;
    const peerFaqRate =
      peers.length === 0 ? 0 : peers.filter((p) => p.hasFaq).length / peers.length;

    const systemDiff = {
      shorterThanMedian: ours.articleLength < medianLen * 0.7,
      fewerLinksThanMedian: ours.linkCount < Math.max(1, medianLinks - 1),
      missingFaqVsPeers: peerFaqRate >= 0.5 && !ours.hasFaq,
      sectionGap: Math.max(0, Math.round(medianSections - ours.sectionCount)),
    };

    const findings: ContentComparisonResult["findings"] = [];
    if (systemDiff.shorterThanMedian) {
      findings.push({
        code: "LENGTH_BELOW_PEERS",
        message: "Article length is substantially below peer median",
        severity: "warning",
      });
    }
    if (systemDiff.missingFaqVsPeers) {
      findings.push({
        code: "FAQ_GAP",
        message: "Peers often include FAQ; this draft does not",
        severity: "info",
      });
    }
    if (systemDiff.sectionGap > 0) {
      findings.push({
        code: "SECTION_GAP",
        message: `Fewer sections than peer median (gap=${systemDiff.sectionGap})`,
        severity: "info",
      });
    }

    let aiAssessment: ContentComparisonResult["aiAssessment"] = {
      informationGaps: systemDiff.shorterThanMedian ? ["depth"] : [],
      searchIntentFit: "unknown",
      readability: "unknown",
      differentiation: "unknown",
      shallowExplanation: systemDiff.shorterThanMedian,
      verbosity: "balanced",
      ctaNaturalness: ours.linkCount > 0 ? "present" : "weak",
      readerValue: "unknown",
    };

    try {
      const llm = await this.llm.executeTask({
        taskType: "REVIEW",
        promptIdentifier: "review.content-comparison",
        promptVersion: "v1",
        model: undefined,
        input: {
          ourTitle: ours.title,
          ourLength: ours.articleLength,
          peerCount: peers.length,
          peerMedianLength: medianLen,
          // Never send full competitor bodies — titles/excerpts only
          peerTitles: input.competitors.map((c) => c.title).slice(0, 8),
        },
        userPrompt: [
          "Compare our draft metrics to peer titles/excerpts.",
          "Do NOT rewrite or imitate competitor copy.",
          "Return JSON: informationGaps[], searchIntentFit, readability, differentiation, shallowExplanation, verbosity, ctaNaturalness, readerValue.",
          `Our title: ${ours.title}`,
          `Peer titles: ${input.competitors.map((c) => c.title).join(" | ")}`,
        ].join("\n"),
      });
      const out = llm.output as Record<string, unknown>;
      aiAssessment = {
        informationGaps: Array.isArray(out.informationGaps)
          ? out.informationGaps.map(String)
          : aiAssessment.informationGaps,
        searchIntentFit: String(out.searchIntentFit ?? aiAssessment.searchIntentFit),
        readability: String(out.readability ?? aiAssessment.readability),
        differentiation: String(out.differentiation ?? aiAssessment.differentiation),
        shallowExplanation: Boolean(out.shallowExplanation ?? aiAssessment.shallowExplanation),
        verbosity: String(out.verbosity ?? aiAssessment.verbosity),
        ctaNaturalness: String(out.ctaNaturalness ?? aiAssessment.ctaNaturalness),
        readerValue: String(out.readerValue ?? aiAssessment.readerValue),
      };
      if (aiAssessment.shallowExplanation) {
        findings.push({
          code: "SHALLOW_VS_PEERS",
          message: "AI assessment: explanation may be shallow vs peers",
          severity: "warning",
        });
      }
    } catch {
      findings.push({
        code: "COMPARISON_LLM_SKIPPED",
        message: "AI comparison skipped (provider error) — system metrics retained",
        severity: "info",
      });
    }

    await this.repo.createReview({
      reviewType: "content-comparison",
      reviewerType: "system",
      targetType: "ContentVersion",
      targetId: version.id,
      contentVersionId: version.id,
      criteria: { competitorCount: input.competitors.length },
      result: findings.some((f) => f.severity === "warning") ? "WARNING" : "PASSED",
      findings: findings.map((f) => ({
        code: f.code,
        message: f.message,
        // no competitor full text
      })),
      requiredActions: systemDiff.shorterThanMedian ? ["partial_revision"] : [],
    });

    return {
      contentVersionId: version.id,
      competitorCount: input.competitors.length,
      systemDiff,
      aiAssessment,
      findings,
    };
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}
