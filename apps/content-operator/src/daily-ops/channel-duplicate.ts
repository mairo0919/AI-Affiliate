/**
 * Channel-local duplicate rules.
 * Blog published ≠ ban on X (and vice versa).
 */

export interface ChannelPublicationRecord {
  channel: "BLOG" | "X";
  canonicalId: string;
  publishedAt: string;
  bodyFingerprint?: string | null;
}

export interface ChannelDuplicateConfig {
  /** Same product cooldown within one channel (days). */
  sameProductCooldownDays: number;
  /** Same X body fingerprint cooldown (days). */
  sameBodyCooldownDays: number;
}

export function isBlockedOnChannel(input: {
  channel: "BLOG" | "X";
  canonicalId: string;
  bodyFingerprint?: string | null;
  history: ChannelPublicationRecord[];
  config: ChannelDuplicateConfig;
  now?: Date;
}): { blocked: boolean; reason: string | null } {
  const now = input.now ?? new Date();
  const msDay = 86400000;
  for (const h of input.history) {
    if (h.channel !== input.channel) continue; // other channel never blocks
    const ageDays = (now.getTime() - new Date(h.publishedAt).getTime()) / msDay;
    if (
      h.canonicalId === input.canonicalId &&
      ageDays < input.config.sameProductCooldownDays
    ) {
      return { blocked: true, reason: `${input.channel}_same_product_cooldown` };
    }
    if (
      input.channel === "X" &&
      input.bodyFingerprint &&
      h.bodyFingerprint &&
      h.bodyFingerprint === input.bodyFingerprint &&
      ageDays < input.config.sameBodyCooldownDays
    ) {
      return { blocked: true, reason: "X_same_body_cooldown" };
    }
  }
  return { blocked: false, reason: null };
}
