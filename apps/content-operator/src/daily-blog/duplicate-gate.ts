/**
 * Prevent re-publishing the same FANZA product (cid / URL / Blogger post).
 */
import {
  identityKeys,
  normalizeCid,
  resolveCanonicalProductId,
  type ProductIdentityInput,
} from "./product-identity.js";

export type PublishLifecycleStatus = "PUBLISHED" | "DRAFT" | "FAILED" | "INTENT" | "UNKNOWN";

export interface KnownPublication {
  canonicalId: string | null;
  identityKeys: string[];
  bloggerPostId?: string | null;
  contentVersionId?: string | null;
  status: PublishLifecycleStatus;
  publishedAt?: string | null;
}

export interface DuplicateGateResult {
  duplicate: boolean;
  reason: string | null;
  matchedOn: string | null;
  prior: KnownPublication | null;
}

export function buildKnownPublication(
  input: ProductIdentityInput & {
    bloggerPostId?: string | null;
    contentVersionId?: string | null;
    status: PublishLifecycleStatus;
    publishedAt?: string | null;
  },
): KnownPublication {
  return {
    canonicalId: resolveCanonicalProductId(input),
    identityKeys: identityKeys(input),
    bloggerPostId: input.bloggerPostId ?? null,
    contentVersionId: input.contentVersionId ?? null,
    status: input.status,
    publishedAt: input.publishedAt ?? null,
  };
}

/**
 * True when candidate matches a prior LIVE/DRAFT/INTENT publication.
 * FAILED alone does not block forever unless same INTENT key still open (handled by idempotency).
 */
export function checkDuplicatePublication(
  candidate: ProductIdentityInput,
  known: KnownPublication[],
): DuplicateGateResult {
  const candKeys = new Set(identityKeys(candidate));
  const candCid = resolveCanonicalProductId(candidate);
  for (const prior of known) {
    if (prior.status === "FAILED") continue;
    if (candCid && prior.canonicalId && candCid === prior.canonicalId) {
      return {
        duplicate: true,
        reason: "same_canonical_cid",
        matchedOn: `cid:${candCid}`,
        prior,
      };
    }
    for (const k of prior.identityKeys) {
      if (candKeys.has(k)) {
        return {
          duplicate: true,
          reason: "identity_key_overlap",
          matchedOn: k,
          prior,
        };
      }
    }
    if (prior.bloggerPostId && candidate.url?.includes(prior.bloggerPostId)) {
      return {
        duplicate: true,
        reason: "blogger_post_id",
        matchedOn: prior.bloggerPostId,
        prior,
      };
    }
  }
  return { duplicate: false, reason: null, matchedOn: null, prior: null };
}

export function filterUnpublishedCandidates<T extends ProductIdentityInput>(
  candidates: T[],
  known: KnownPublication[],
): { eligible: T[]; skipped: Array<{ candidate: T; gate: DuplicateGateResult }> } {
  const eligible: T[] = [];
  const skipped: Array<{ candidate: T; gate: DuplicateGateResult }> = [];
  for (const c of candidates) {
    const gate = checkDuplicatePublication(c, known);
    if (gate.duplicate) skipped.push({ candidate: c, gate });
    else eligible.push(c);
  }
  return { eligible, skipped };
}

export { normalizeCid, resolveCanonicalProductId };
