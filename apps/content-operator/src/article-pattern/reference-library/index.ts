/**
 * Reference Library index — article-type filtered retrieval.
 */

import type { ReferenceArticleType } from "../reference-article-type.js";
import type { ReferenceLibraryEntry } from "../reference-library-types.js";
import { REF_OSUSUME_DMM_STAFF_2553 } from "./entries/osusume-dmm-staff-2553.ranking.js";

const ENTRIES: ReferenceLibraryEntry[] = [REF_OSUSUME_DMM_STAFF_2553];

export function listReferenceLibraryEntries(): ReferenceLibraryEntry[] {
  return [...ENTRIES];
}

export function getReferenceLibraryEntriesForType(
  articleType: ReferenceArticleType,
): ReferenceLibraryEntry[] {
  return ENTRIES.filter(
    (e) =>
      e.articleType === articleType && e.applicableGenerationTypes.includes(articleType),
  );
}

export function getReferenceLibraryEntryById(referenceId: string): ReferenceLibraryEntry | null {
  return ENTRIES.find((e) => e.referenceId === referenceId) ?? null;
}
