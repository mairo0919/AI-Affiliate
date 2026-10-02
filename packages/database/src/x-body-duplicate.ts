import { hashNormalizedBody } from "./x-ops-repository.js";

/**
 * Publication-unit duplicate identity.
 *
 * ROOT (and any non-navigation post) keeps a strict normalized-body match
 * against posts that were actually sent, plus an earlier reservation of the
 * same body. CTA navigation replies do not use that collapsed body hash:
 * the WordPress (or other) destination URL is the identity, so the same
 * "記事はこちら / #PR" template on a different article is not a duplicate.
 */

export type BodyDuplicateRole = "ROOT" | "REPLY" | "RELATED_LINK" | "CTA" | "HUB";

export type BodyDuplicateSubjectPost = {
  id: string;
  sequence: number;
  role: BodyDuplicateRole | string;
  body: string;
  bodyHash: string | null;
};

export type BodyDuplicateCandidate = {
  postId: string;
  publicationId: string;
  role: BodyDuplicateRole | string;
  body: string;
  bodyHash: string | null;
  postStatus: string;
  xPostId: string | null;
  postPublishedAt: Date | null;
  publicationStatus: string;
  publicationScheduledAt: Date | null;
  publicationCreatedAt: Date;
  publicationPublishedAt: Date | null;
};

export type BodyDuplicateMatch = {
  publicationId: string;
  postId: string;
  kind:
    | "ROOT_PUBLISHED"
    | "ROOT_EARLIER_RESERVATION"
    | "CTA_PUBLISHED_DESTINATION"
    | "CTA_EARLIER_RESERVATION";
};

const SENT_PUBLICATION_STATUSES = new Set(["PUBLISHED", "PUBLISHED_UNVERIFIED"]);
const ACTIVE_RESERVATION_STATUSES = new Set([
  "SCHEDULED",
  "PUBLISHING",
  "PARTIALLY_PUBLISHED",
]);

export function canonicalNavigationDestination(body: string): string | null {
  const match = body.match(/https?:\/\/[^\s<>]+/i);
  if (!match) return null;
  const raw = match[0].replace(/[),.;、。]+$/g, "");
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return raw.toLowerCase();
  }
}

export function postBodyFingerprint(post: {
  body: string;
  bodyHash: string | null;
}): string {
  return post.bodyHash ?? hashNormalizedBody(post.body);
}

function inLookback(candidate: BodyDuplicateCandidate, since: Date): boolean {
  const stamps = [
    candidate.postPublishedAt,
    candidate.publicationPublishedAt,
    candidate.publicationCreatedAt,
  ];
  return stamps.some((stamp) => stamp != null && stamp.getTime() >= since.getTime());
}

function wasActuallySent(candidate: BodyDuplicateCandidate): boolean {
  if (candidate.postStatus === "PUBLISHED" || candidate.xPostId) return true;
  return SENT_PUBLICATION_STATUSES.has(candidate.publicationStatus);
}

function subjectInstant(input: {
  scheduledAt: Date | null;
  now: Date;
}): Date {
  return input.scheduledAt ?? input.now;
}

function isEarlierActiveReservation(
  candidate: BodyDuplicateCandidate,
  subject: { publicationId: string; scheduledAt: Date | null; createdAt: Date; now: Date },
): boolean {
  if (!ACTIVE_RESERVATION_STATUSES.has(candidate.publicationStatus)) return false;
  if (!candidate.publicationScheduledAt) return false;
  const candidateAt = candidate.publicationScheduledAt.getTime();
  const subjectAt = subjectInstant(subject).getTime();
  if (candidateAt < subjectAt) return true;
  if (candidateAt > subjectAt) return false;
  if (candidate.publicationCreatedAt.getTime() !== subject.createdAt.getTime()) {
    return candidate.publicationCreatedAt.getTime() < subject.createdAt.getTime();
  }
  return candidate.publicationId < subject.publicationId;
}

function matchStrictBody(
  post: BodyDuplicateSubjectPost,
  input: {
    publicationId: string;
    scheduledAt: Date | null;
    createdAt: Date;
    now: Date;
    lookbackSince: Date;
    candidates: BodyDuplicateCandidate[];
  },
): BodyDuplicateMatch | null {
  const hash = postBodyFingerprint(post);
  for (const candidate of input.candidates) {
    if (candidate.publicationId === input.publicationId) continue;
    if (postBodyFingerprint(candidate) !== hash) continue;
    if (!inLookback(candidate, input.lookbackSince)) continue;
    if (wasActuallySent(candidate)) {
      return {
        publicationId: candidate.publicationId,
        postId: candidate.postId,
        kind: "ROOT_PUBLISHED",
      };
    }
    if (
      isEarlierActiveReservation(candidate, {
        publicationId: input.publicationId,
        scheduledAt: input.scheduledAt,
        createdAt: input.createdAt,
        now: input.now,
      })
    ) {
      return {
        publicationId: candidate.publicationId,
        postId: candidate.postId,
        kind: "ROOT_EARLIER_RESERVATION",
      };
    }
  }
  return null;
}

function matchNavigationCta(
  post: BodyDuplicateSubjectPost,
  destination: string,
  input: {
    publicationId: string;
    scheduledAt: Date | null;
    createdAt: Date;
    now: Date;
    lookbackSince: Date;
    candidates: BodyDuplicateCandidate[];
  },
): BodyDuplicateMatch | null {
  for (const candidate of input.candidates) {
    if (candidate.publicationId === input.publicationId) continue;
    if (candidate.role !== "CTA") continue;
    if (canonicalNavigationDestination(candidate.body) !== destination) continue;
    if (!inLookback(candidate, input.lookbackSince)) continue;
    if (wasActuallySent(candidate)) {
      return {
        publicationId: candidate.publicationId,
        postId: candidate.postId,
        kind: "CTA_PUBLISHED_DESTINATION",
      };
    }
    if (
      isEarlierActiveReservation(candidate, {
        publicationId: input.publicationId,
        scheduledAt: input.scheduledAt,
        createdAt: input.createdAt,
        now: input.now,
      })
    ) {
      return {
        publicationId: candidate.publicationId,
        postId: candidate.postId,
        kind: "CTA_EARLIER_RESERVATION",
      };
    }
  }
  return null;
}

export const FANZA_DIRECT_MIGRATION_MARKER = "fanza-direct-migration";

/** Only publications deleted for the FANZA direct migration may be reposted. */
export function isFanzaDirectMigrationDeleted(input: {
  status: string;
  strategyVersion?: string | null;
}): boolean {
  return (
    input.status === "DELETED" &&
    (input.strategyVersion ?? "").includes(FANZA_DIRECT_MIGRATION_MARKER)
  );
}

export function findPublicationBodyDuplicate(input: {
  publicationId: string;
  scheduledAt: Date | null;
  createdAt: Date;
  now: Date;
  lookbackSince: Date;
  posts: BodyDuplicateSubjectPost[];
  candidates: BodyDuplicateCandidate[];
}): BodyDuplicateMatch | null {
  for (const post of input.posts) {
    const destination =
      post.role === "CTA" ? canonicalNavigationDestination(post.body) : null;
    const match = destination
      ? matchNavigationCta(post, destination, input)
      : matchStrictBody(post, input);
    if (match) return match;
  }
  return null;
}
