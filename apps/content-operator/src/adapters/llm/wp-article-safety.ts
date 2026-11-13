import { createHash } from "node:crypto";
import { getLlmExecutionStore } from "./llm-execution-binding.js";
import { settleLlmDisposition, type LlmDisposition, type LlmRunStore } from "./llm-execution-gate.js";

export type WpLlmOperation = "WP_BRAIN" | "WP_WRITER" | "WP_REVIEW" | "WP_REWRITE";

export type WpSafetyRun = {
  id: string;
  operation: WpLlmOperation;
  logicalAttempt: number;
};

/** Identity known before the model writes the body. The body is not an input. */
export function wpContentIdentity(input: {
  contentId?: string | null;
  productCanonicalId?: string | null;
  topicId?: string | null;
  parentVersionId?: string | null;
}): string {
  return (
    input.productCanonicalId?.trim() ||
    input.contentId?.trim() ||
    input.parentVersionId?.trim() ||
    input.topicId?.trim() ||
    "unknown-article"
  );
}

/**
 * Bump when the article route's code-built instructions change, so works blocked under the
 * old instructions may be written once more. Prompt rows alone do not cover code-built text.
 * 2: headlines in the Writer's own words instead of plan-word scraps (2026-10-25).
 * 3: headline shape 「search words｜hook」 (2026-10-25).
 * 4: short hook without product-label endings; body may not paste the official description (2026-11-10).
 * 5: 「｜」 hooks may end on a noun; short planned facts are not counted as pastes (2026-11-10).
 * 6: no catalog labels or vague hooks in headlines; bodies introduce the work instead of reading data aloud (2026-11-10).
 * 7: genre tags are no longer handed to the Writer as facts to cover (2026-11-10).
 * 8: a body sentence counts as a paste from 30 shared characters, not 20 (2026-11-11).
 * 9: the writing review fails data-line, scene-walk and label-ending output (2026-11-13).
 * 10: the Writer covers only the body facts the editorial decision rests on; the rest is optional (2026-11-13).
 * 11: a runtime the decision does not rest on is not offered to the Writer at all (2026-11-13).
 */
export const WP_ARTICLE_ROUTE_VERSION = "11";

export function wpArticleFingerprint(input: {
  cid: string;
  contentIdentity: string;
  promptVersion: string;
}): string {
  const material = [
    "WORDPRESS",
    input.cid.trim().toLowerCase(),
    input.contentIdentity.trim(),
    input.promptVersion.trim(),
    WP_ARTICLE_ROUTE_VERSION,
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

export function wpLlmSafety(input: {
  cid?: string | null;
  operation: WpLlmOperation;
  promptVersion: string;
  contentIdentity: string;
  logicalAttempt?: number;
  contentVersionId?: string | null;
  regenerateReason?: string | null;
}) {
  const cid = input.cid?.trim() || input.contentIdentity;
  return {
    channel: "WORDPRESS" as const,
    operation: input.operation,
    cid,
    artifactFingerprint: wpArticleFingerprint({
      cid,
      contentIdentity: input.contentIdentity,
      promptVersion: input.promptVersion,
    }),
    attemptKind: input.operation === "WP_REVIEW" ? ("review" as const) : ("creative" as const),
    logicalAttempt: input.logicalAttempt ?? 1,
    contentVersionId: input.contentVersionId ?? null,
    trigger: "scheduler",
    regenerateReason: input.regenerateReason ?? null,
  };
}

export function executionRunId(result: { metadata?: Record<string, unknown> | null }): string | null {
  const id = result.metadata?.executionRunId;
  return typeof id === "string" ? id : null;
}

export function readLlmSafety(structured: unknown): {
  cid: string | null;
  contentIdentity: string;
  runs: WpSafetyRun[];
} {
  const record =
    structured && typeof structured === "object" && !Array.isArray(structured)
      ? (structured as Record<string, unknown>).llmSafety
      : null;
  const safety = record && typeof record === "object" && !Array.isArray(record) ? (record as Record<string, unknown>) : {};
  const runs = Array.isArray(safety.runs)
    ? safety.runs.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const item = row as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.operation !== "string") return [];
        return [
          {
            id: item.id,
            operation: item.operation as WpLlmOperation,
            logicalAttempt: typeof item.logicalAttempt === "number" ? item.logicalAttempt : 1,
          },
        ];
      })
    : [];
  return {
    cid: typeof safety.cid === "string" ? safety.cid : null,
    contentIdentity: typeof safety.contentIdentity === "string" ? safety.contentIdentity : "",
    runs,
  };
}

export async function linkSafetyRuns(
  runs: WpSafetyRun[],
  links: {
    contentVersionId?: string | null;
    publicationTargetId?: string | null;
    publishedExternalId?: string | null;
    xPublicationId?: string | null;
  },
): Promise<void> {
  const store = getLlmExecutionStore();
  if (!store) return;
  for (const run of runs) {
    const row = await store.findById(run.id);
    if (!row?.disposition) continue;
    await settleLlmDisposition(store, run.id, row.disposition, links);
  }
}

export async function linkXPublicationByCid(cid: string, xPublicationId: string, store: LlmRunStore | null = getLlmExecutionStore()): Promise<void> {
  if (!store || !cid) return;
  const runs = await store.list();
  for (const run of runs) {
    if (run.channel !== "X" || run.canonicalCid !== cid || run.disposition !== "ADOPTED" || run.xPublicationId) continue;
    await settleLlmDisposition(store, run.id, "ADOPTED", { xPublicationId });
  }
}

export async function settleWpRuns(
  runs: WpSafetyRun[],
  dispositionFor: (run: WpSafetyRun) => LlmDisposition | null,
  links?: {
    contentVersionId?: string | null;
    publicationTargetId?: string | null;
    publishedExternalId?: string | null;
  },
): Promise<void> {
  const store = getLlmExecutionStore();
  if (!store) return;
  for (const run of runs) {
    const disposition = dispositionFor(run);
    if (!disposition) continue;
    await settleLlmDisposition(store, run.id, disposition, links);
  }
}
