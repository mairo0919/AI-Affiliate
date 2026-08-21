/**
 * claimProfile fingerprint — normalized kinds only (no product names).
 */

export type ClaimKindLike = { kind: string };

export function buildClaimProfileFingerprint(
  claims: ClaimKindLike[],
  opts?: { formatKey?: string | null; contentType?: string | null },
): string {
  const counts = new Map<string, number>();
  for (const c of claims) {
    const k = (c.kind || "other").toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}:${n}`);
  const fmt = opts?.formatKey ?? "nofmt";
  const ct = opts?.contentType ?? "nocontent";
  return `v1|${fmt}|${ct}|${parts.join(",") || "empty"}`;
}
