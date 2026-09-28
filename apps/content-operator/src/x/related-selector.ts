import type {
  PublicationWithPosts,
  XPublicationRepository,
} from "@ai-affiliate/database";
import { isPublishedXPostUrl, isStrongRelatedRelation } from "./x-thread-publication.js";

export interface RelatedCandidateContext {
  researchItemId: string;
  actressTags: string[];
  genreTags: string[];
  makerTags: string[];
  seriesTags: string[];
  candidateType?: string;
}

export interface RelatedSelection {
  publication: PublicationWithPosts;
  score: number;
  reasons: string[];
}

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => set.has(x.toLowerCase()));
}

export class XRelatedPostSelector {
  constructor(
    private readonly publications: XPublicationRepository,
    private readonly lookbackDays: number,
  ) {}

  async selectBest(
    context: RelatedCandidateContext,
  ): Promise<RelatedSelection | null> {
    const candidates = await this.publications.findRelatedPublications({
      excludeResearchItemId: context.researchItemId,
      lookbackDays: this.lookbackDays,
      limit: 50,
    });

    if (candidates.length === 0) {
      return null;
    }

    const scored: RelatedSelection[] = [];
    for (const publication of candidates) {
      let score = 0;
      const reasons: string[] = [];

      if (publication.publishedAt) {
        const ageDays =
          (Date.now() - publication.publishedAt.getTime()) / (24 * 60 * 60 * 1000);
        const recency = Math.max(0, 20 - ageDays);
        score += recency;
        if (recency > 0) reasons.push("recent");
      }

      if (publication.rootPostUrl) {
        score += 5;
      }

      const jitter = (publication.id.charCodeAt(0) % 7) - 3;
      score += jitter;

      scored.push({ publication, score, reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0] ?? null;
  }

  scoreWithTags(
    publicationResearchTags: {
      actress: string[];
      genre: string[];
      maker: string[];
      series: string[];
      candidateType?: string;
    },
    context: RelatedCandidateContext,
    baseScore = 0,
  ): { score: number; reasons: string[] } {
    let score = baseScore;
    const reasons: string[] = [];
    if (overlap(context.actressTags, publicationResearchTags.actress).length > 0) {
      score += 40;
      reasons.push("sameActress");
    }
    if (overlap(context.seriesTags, publicationResearchTags.series).length > 0) {
      score += 30;
      reasons.push("sameSeries");
    }
    if (overlap(context.genreTags, publicationResearchTags.genre).length > 0) {
      score += 20;
      reasons.push("sameGenre");
    }
    if (overlap(context.makerTags, publicationResearchTags.maker).length > 0) {
      score += 10;
      reasons.push("sameMaker");
    }
    if (
      context.candidateType &&
      publicationResearchTags.candidateType === context.candidateType
    ) {
      score += 10;
      reasons.push("sameCandidateType");
    }
    return { score, reasons };
  }

  /** True when relation is strong enough to attach as a RELATED_REPLY. */
  isAttachable(reasons: string[], rootPostUrl?: string | null): boolean {
    return isStrongRelatedRelation(reasons) && isPublishedXPostUrl(rootPostUrl);
  }
}
