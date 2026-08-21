/**
 * Persist Brain lifecycle onto ContentVersion.structuredContent (no schema migration).
 */

import type { BrainLifecycleRecord } from "./active-lifecycle.js";
import { mergeBrainLifecycleIntoStructured } from "./acceptance.js";

export type StructuredContentWriter = {
  findContentVersion: (
    id: string,
  ) => Promise<{ id: string; structuredContent: unknown } | null>;
  updateContentVersionStructuredContent: (
    id: string,
    structured: Record<string, unknown>,
  ) => Promise<unknown>;
};

export async function persistBrainLifecycleOnVersion(
  repo: StructuredContentWriter,
  contentVersionId: string,
  lifecycle: BrainLifecycleRecord,
): Promise<void> {
  const version = await repo.findContentVersion(contentVersionId);
  if (!version) return;
  const next = mergeBrainLifecycleIntoStructured(version.structuredContent, lifecycle);
  await repo.updateContentVersionStructuredContent(contentVersionId, next);
}
