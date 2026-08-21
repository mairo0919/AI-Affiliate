/**
 * Reference Library entry — abstract learning record (no verbatim article body).
 */

import type { ReferenceArticleType } from "./reference-article-type.js";
import type { ArticleTypeWritingSkeleton } from "./article-type-writing-skeleton.js";

export type ReferenceLibraryEntry = {
  schemaVersion: 1;
  referenceId: string;
  sourceUrl: string;
  articleType: ReferenceArticleType;
  titleObserved: string | null;
  /** Structure observations only — never full prose */
  learnedAbstract: {
    overallStructure: string[];
    introPattern: string[];
    rankingEntryPattern?: string[];
    headingHierarchy: string[];
    tempoNotes: string[];
    productNamePresentation: string[];
    featureToHighlightFlow: string[];
    ctaPlacement: string[];
    imagePlacement: string[];
    rankTransition: string[];
    closingRole: string[];
    readerPullMechanisms: string[];
    catalogNarrationAvoidance: string[];
  };
  writingSkeleton: ArticleTypeWritingSkeleton;
  /** Isolation */
  applicableGenerationTypes: ReferenceArticleType[];
  ingestedAt: string;
  notes: string[];
};
