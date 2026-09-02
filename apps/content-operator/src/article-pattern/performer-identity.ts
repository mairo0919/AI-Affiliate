/**
 * R143 — Performer entity SSOT (internal identity, not Writer prose).
 *
 * fact dedupe (EvidencePack concrete) ≠ performer entity dedupe.
 * Entity count comes from official page actor metadata when present.
 */

import type { PageEvidenceMetaShape } from "./official-page-evidence-atoms.js";

export type PerformerEntitySource =
  | "page_actors_metadata"
  | "page_video_actor_metadata";

/** Internal identity record — not injected into Writer / ArticlePlan. */
export type PerformerEntity = {
  normalizedName: string;
  displayName: string;
  source: PerformerEntitySource;
  sourceIndex: number;
  sourceId: string;
  fromOfficialMetadata: boolean;
  inProductTitle: boolean;
  inDescription: boolean;
};

export function normalizePerformerDisplayName(name: string): string {
  return (name ?? "").trim().replace(/\s+/g, " ");
}

/** Dedupe key — keeps alias-in-parentheses as one entity (metadata row SSOT). */
export function performerEntityKey(name: string): string {
  return normalizePerformerDisplayName(name).replace(/\s+/g, "");
}

function nameInText(name: string, text: string): boolean {
  const n = normalizePerformerDisplayName(name);
  if (!n || !text) return false;
  if (text.includes(n)) return true;
  const base = n.replace(/（[^）]*）|\([^)]*\)/g, "").trim();
  return base.length >= 2 && text.includes(base);
}

/**
 * Official actor metadata is SSOT for performer entities.
 * Does not infer performers from description/title alone (avoids character false positives).
 */
export function extractPerformerEntitiesFromPageMeta(input: {
  pageEvidenceMeta?: PageEvidenceMetaShape | null;
  productTitle?: string | null;
}): PerformerEntity[] {
  const meta = input.pageEvidenceMeta;
  const fromActors = meta?.actors?.length ? meta.actors : null;
  const fromVideo = meta?.video?.actor?.length ? meta.video.actor : null;
  const actorList = fromActors ?? fromVideo ?? [];
  const source: PerformerEntitySource = fromActors
    ? "page_actors_metadata"
    : "page_video_actor_metadata";

  const productTitle = (input.productTitle ?? "").trim();
  const descriptionText = meta?.description?.text ?? "";

  const entities: PerformerEntity[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < actorList.length; i++) {
    const raw = actorList[i];
    const displayName = normalizePerformerDisplayName(raw ?? "");
    if (!displayName) continue;
    const key = performerEntityKey(displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({
      normalizedName: displayName,
      displayName,
      source,
      sourceIndex: i,
      sourceId: `page_atom::actor::${i}`,
      fromOfficialMetadata: true,
      inProductTitle: nameInText(displayName, productTitle),
      inDescription: nameInText(displayName, descriptionText),
    });
  }

  return entities;
}
