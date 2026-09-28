/**
 * X product reservation lifecycle for scheduled publications.
 *
 * Formal invariant:
 *   When a reservation backs a scheduled publication, it must remain ACTIVE
 *   at least until the scheduled publish attempt (plus publish grace for
 *   scheduler delay / retry). Therefore:
 *
 *     expiresAt > scheduledAt
 *
 *   Operationally:
 *
 *     expiresAt = max(now + configuredTTL, scheduledAt + publishGrace)
 *
 * Do NOT "repair" with a flat NOW()+N window that can land before scheduledAt.
 */

/** Default grace after scheduledAt for delay/retry before an unused reservation may expire. */
export const DEFAULT_X_PRODUCT_RESERVATION_PUBLISH_GRACE_MINUTES = 180;

/** Floor for create-time TTL so short configured TTL cannot undercut grace. */
export const DEFAULT_X_PRODUCT_RESERVATION_TTL_FLOOR_MINUTES =
  DEFAULT_X_PRODUCT_RESERVATION_PUBLISH_GRACE_MINUTES;

/** Publication statuses that no longer need an ACTIVE reservation. */
export const X_RESERVATION_TERMINAL_PUBLICATION_STATUSES = [
  "PUBLISHED",
  "PUBLISHED_UNVERIFIED",
  "CANCELLED",
  "DELETED",
] as const;

export type XReservationTerminalPublicationStatus =
  (typeof X_RESERVATION_TERMINAL_PUBLICATION_STATUSES)[number];

export function isXReservationTerminalPublicationStatus(
  status: string,
): status is XReservationTerminalPublicationStatus {
  return (X_RESERVATION_TERMINAL_PUBLICATION_STATUSES as readonly string[]).includes(
    status,
  );
}

export function computeXProductReservationExpiresAt(input: {
  now: Date;
  scheduledAt: Date | null | undefined;
  /** Configured TTL minutes (e.g. X_PRODUCT_RESERVATION_TTL_MINUTES). */
  ttlMinutes: number;
  /** Grace after scheduledAt; also used as TTL floor. */
  publishGraceMinutes?: number;
}): Date {
  const graceMinutes = Math.max(
    1,
    input.publishGraceMinutes ?? DEFAULT_X_PRODUCT_RESERVATION_PUBLISH_GRACE_MINUTES,
  );
  const ttlMinutes = Math.max(1, input.ttlMinutes);
  const fromCreated = input.now.getTime() + ttlMinutes * 60_000;
  if (!input.scheduledAt) {
    // No schedule: still apply TTL floor so short TTL cannot vanish instantly.
    const floor = input.now.getTime() + graceMinutes * 60_000;
    return new Date(Math.max(fromCreated, floor));
  }
  const fromSchedule = input.scheduledAt.getTime() + graceMinutes * 60_000;
  // Invariant: expiresAt > scheduledAt (graceMinutes >= 1).
  return new Date(Math.max(fromCreated, fromSchedule));
}

/**
 * Safe repair / extend: never set expiresAt at or before scheduledAt.
 * Rejects flat NOW()+window repairs that would violate the invariant.
 */
export function assertReservationExpiresAtInvariant(input: {
  expiresAt: Date;
  scheduledAt: Date | null | undefined;
}): void {
  if (!input.scheduledAt) return;
  if (input.expiresAt.getTime() <= input.scheduledAt.getTime()) {
    throw new Error(
      `reservation expiresAt invariant violated: expiresAt=${input.expiresAt.toISOString()} must be > scheduledAt=${input.scheduledAt.toISOString()}`,
    );
  }
}

/**
 * Decide whether an ACTIVE reservation whose expiresAt has passed may be expired.
 * Future scheduled publications are kept alive (and should be extended).
 */
export function shouldExpireReservationForPublication(input: {
  now: Date;
  expiresAt: Date;
  publication: {
    status: string;
    scheduledAt: Date | null;
  } | null;
  publishGraceMinutes?: number;
}): { expire: boolean; extendExpiresAt: Date | null; reason: string } {
  const graceMinutes =
    input.publishGraceMinutes ?? DEFAULT_X_PRODUCT_RESERVATION_PUBLISH_GRACE_MINUTES;
  const graceMs = Math.max(1, graceMinutes) * 60_000;

  if (input.expiresAt.getTime() >= input.now.getTime()) {
    return { expire: false, extendExpiresAt: null, reason: "not-due" };
  }

  if (!input.publication) {
    return { expire: true, extendExpiresAt: null, reason: "orphan-publication" };
  }

  if (isXReservationTerminalPublicationStatus(input.publication.status)) {
    return { expire: true, extendExpiresAt: null, reason: "terminal-publication" };
  }

  if (input.publication.scheduledAt) {
    const keepUntil = input.publication.scheduledAt.getTime() + graceMs;
    if (input.now.getTime() < keepUntil) {
      const extendExpiresAt = new Date(
        Math.max(keepUntil, input.expiresAt.getTime()),
      );
      return {
        expire: false,
        extendExpiresAt:
          extendExpiresAt.getTime() > input.expiresAt.getTime()
            ? extendExpiresAt
            : null,
        reason: "future-scheduled-keep-alive",
      };
    }
    return {
      expire: true,
      extendExpiresAt: null,
      reason: "scheduled-grace-exceeded",
    };
  }

  // Non-scheduled active work (PUBLISHING / PARTIALLY_PUBLISHED / BLOCKED without schedule):
  // only expire when expiresAt already passed (caller already filtered).
  if (
    input.publication.status === "PUBLISHING" ||
    input.publication.status === "PARTIALLY_PUBLISHED"
  ) {
    // Still in-flight — extend a short grace from now rather than killing mid-publish.
    const extendExpiresAt = new Date(input.now.getTime() + graceMs);
    return {
      expire: false,
      extendExpiresAt,
      reason: "in-flight-keep-alive",
    };
  }

  return { expire: true, extendExpiresAt: null, reason: "expires-at-passed" };
}
