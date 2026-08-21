/**
 * Minimal temporal claim gating for Blogger generation Prompt input.
 * Does not implement recheck/scheduler/stale updates.
 */

export const FRESHNESS_DISCLAIMER =
  "掲載情報は確認時点の情報です。価格・セール・配信状況・キャンペーンなどは変更される場合があります。最新情報は商品ページでご確認ください。";

export type ClaimLikeForPrompt = {
  id: string;
  statement: string;
  status: string;
  expiresAt?: Date | string | null;
};

/** SUPPORTED and not past expiresAt (null expiresAt = no time window → allowed). */
export function isClaimValidForGenerationPrompt(
  claim: ClaimLikeForPrompt,
  now: Date = new Date(),
): boolean {
  if (claim.status !== "SUPPORTED") return false;
  if (claim.expiresAt == null) return true;
  const expires =
    claim.expiresAt instanceof Date ? claim.expiresAt : new Date(claim.expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() > now.getTime();
}

export function selectClaimsForBloggerPrompt<T extends ClaimLikeForPrompt>(
  claims: T[],
  now: Date = new Date(),
): T[] {
  return claims.filter((c) => isClaimValidForGenerationPrompt(c, now));
}
