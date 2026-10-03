import { describe, expect, it } from "vitest";
import { hashNormalizedBody } from "./x-ops-repository.js";
import {
  type BodyDuplicateCandidate,
  type BodyDuplicateSubjectPost,
  findPublicationBodyDuplicate,
  isFanzaDirectMigrationDeleted,
  isNormalLinkMigrationDeleted,
} from "./x-body-duplicate.js";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const LOOKBACK = new Date("2026-08-29T12:00:00.000Z");

describe("FANZA direct migration repost scope", () => {
  it("allows repost only when the old publication was deleted for this migration", () => {
    expect(
      isFanzaDirectMigrationDeleted({
        status: "DELETED",
        strategyVersion: "x-strategy-v1|fanza-direct-migration",
      }),
    ).toBe(true);
    expect(
      isFanzaDirectMigrationDeleted({
        status: "DELETED",
        strategyVersion: "x-strategy-v1",
      }),
    ).toBe(false);
    expect(
      isFanzaDirectMigrationDeleted({
        status: "PUBLISHED",
        strategyVersion: "x-strategy-v1|fanza-direct-migration",
      }),
    ).toBe(false);
    expect(
      isFanzaDirectMigrationDeleted({ status: "CANCELLED", strategyVersion: null }),
    ).toBe(false);
    expect(
      isNormalLinkMigrationDeleted({
        status: "DELETED",
        strategyVersion: "x-strategy-v1|normal-link-migration",
      }),
    ).toBe(true);
    expect(
      isNormalLinkMigrationDeleted({
        status: "DELETED",
        strategyVersion: "x-strategy-v1",
      }),
    ).toBe(false);
    expect(
      isNormalLinkMigrationDeleted({
        status: "PUBLISHED",
        strategyVersion: "x-strategy-v1|normal-link-migration",
      }),
    ).toBe(false);
  });

  it("still flags a live publication with the same root body", () => {
    const body = "同じ本文です。";
    const match = findPublicationBodyDuplicate({
      publicationId: "new",
      scheduledAt: NOW,
      createdAt: NOW,
      now: NOW,
      lookbackSince: LOOKBACK,
      posts: [rootPost("new-root", body)],
      candidates: [
        candidate({
          postId: "old-root",
          publicationId: "old",
          role: "ROOT",
          body,
          publicationStatus: "PUBLISHED",
        }),
      ],
    });
    expect(match?.publicationId).toBe("old");
  });
});

const URL_A = "https://otonaselect.net/works/aaa111/";
const URL_B = "https://otonaselect.net/works/bbb222/";

function cta(url: string): string {
  return `記事はこちら\n${url}\n#PR`;
}

function rootPost(id: string, body: string): BodyDuplicateSubjectPost {
  return { id, sequence: 1, role: "ROOT", body, bodyHash: hashNormalizedBody(body) };
}

function ctaPost(id: string, url: string): BodyDuplicateSubjectPost {
  const body = cta(url);
  return {
    id,
    sequence: 2,
    role: "CTA",
    body,
    bodyHash: hashNormalizedBody(body),
  };
}

function candidate(
  overrides: Partial<BodyDuplicateCandidate> &
    Pick<BodyDuplicateCandidate, "postId" | "publicationId" | "role" | "body">,
): BodyDuplicateCandidate {
  const bodyHash = overrides.bodyHash ?? hashNormalizedBody(overrides.body);
  return {
    postStatus: "PENDING",
    xPostId: null,
    postPublishedAt: null,
    publicationStatus: "SCHEDULED",
    publicationScheduledAt: new Date("2026-09-30T06:00:00.000Z"),
    publicationCreatedAt: new Date("2026-09-27T06:00:00.000Z"),
    publicationPublishedAt: null,
    ...overrides,
    bodyHash,
  };
}

function judge(
  posts: BodyDuplicateSubjectPost[],
  candidates: BodyDuplicateCandidate[],
  overrides?: { scheduledAt?: Date; createdAt?: Date; lookbackSince?: Date },
) {
  return findPublicationBodyDuplicate({
    publicationId: "pub-subject",
    scheduledAt: overrides?.scheduledAt ?? new Date("2026-09-28T12:00:00.000Z"),
    createdAt: overrides?.createdAt ?? new Date("2026-09-27T05:00:00.000Z"),
    now: NOW,
    lookbackSince: overrides?.lookbackSince ?? LOOKBACK,
    posts,
    candidates,
  });
}

describe("publication body duplicate", () => {
  it("collapses different article URLs to the same CTA template hash", () => {
    expect(hashNormalizedBody(cta(URL_A))).toBe(hashNormalizedBody(cta(URL_B)));
  });

  it("CASE A: same CTA template with different destinations both pass", () => {
    const collapsed = hashNormalizedBody(cta(URL_A));
    const other = [
      candidate({
        postId: "root-b",
        publicationId: "pub-b",
        role: "ROOT",
        body: "ROOT B の本文",
        publicationScheduledAt: new Date("2026-09-28T14:00:00.000Z"),
      }),
      candidate({
        postId: "cta-b",
        publicationId: "pub-b",
        role: "CTA",
        body: cta(URL_B),
        bodyHash: collapsed,
        publicationScheduledAt: new Date("2026-09-28T14:00:00.000Z"),
      }),
    ];
    expect(
      judge([rootPost("root-a", "ROOT A の本文"), ctaPost("cta-a", URL_A)], other),
    ).toBeNull();
    expect(
      judge(
        [rootPost("root-b", "ROOT B の本文"), ctaPost("cta-b", URL_B)],
        [
          candidate({
            postId: "root-a",
            publicationId: "pub-a",
            role: "ROOT",
            body: "ROOT A の本文",
            publicationScheduledAt: new Date("2026-09-28T12:00:00.000Z"),
          }),
          candidate({
            postId: "cta-a",
            publicationId: "pub-a",
            role: "CTA",
            body: cta(URL_A),
            bodyHash: collapsed,
            publicationScheduledAt: new Date("2026-09-28T12:00:00.000Z"),
          }),
        ],
        { scheduledAt: new Date("2026-09-28T14:00:00.000Z") },
      ),
    ).toBeNull();
  });

  it("CASE B: identical ROOT and destination is a duplicate", () => {
    const root = "ROOT A の本文";
    const earlier = [
      candidate({
        postId: "root-a",
        publicationId: "pub-a",
        role: "ROOT",
        body: root,
        publicationStatus: "PUBLISHED",
        postStatus: "PUBLISHED",
        publicationPublishedAt: new Date("2026-09-26T06:00:00.000Z"),
        postPublishedAt: new Date("2026-09-26T06:00:00.000Z"),
      }),
      candidate({
        postId: "cta-a",
        publicationId: "pub-a",
        role: "CTA",
        body: cta(URL_A),
        publicationStatus: "PUBLISHED",
        postStatus: "PUBLISHED",
        publicationPublishedAt: new Date("2026-09-26T06:00:00.000Z"),
        postPublishedAt: new Date("2026-09-26T06:00:00.000Z"),
      }),
    ];
    const match = judge([rootPost("root-subject", root), ctaPost("cta-subject", URL_A)], earlier);
    expect(match?.kind).toBe("ROOT_PUBLISHED");
    expect(match?.publicationId).toBe("pub-a");
  });

  it("CASE C: a later scheduled different article does not block the due publication", () => {
    const future = [
      candidate({
        postId: "root-b",
        publicationId: "pub-b",
        role: "ROOT",
        body: "ROOT B の本文",
        publicationScheduledAt: new Date("2026-09-29T06:00:00.000Z"),
      }),
      candidate({
        postId: "cta-b",
        publicationId: "pub-b",
        role: "CTA",
        body: cta(URL_B),
        publicationScheduledAt: new Date("2026-09-29T06:00:00.000Z"),
      }),
    ];
    expect(
      judge([rootPost("root-a", "ROOT A の本文"), ctaPost("cta-a", URL_A)], future),
    ).toBeNull();
  });

  it("CASE D: a published identical ROOT inside lookback blocks, and outside lookback does not", () => {
    const root = "ROOT A の本文";
    const published = candidate({
      postId: "root-old",
      publicationId: "pub-old",
      role: "ROOT",
      body: root,
      publicationStatus: "PUBLISHED",
      postStatus: "PUBLISHED",
      publicationCreatedAt: new Date("2026-09-20T00:00:00.000Z"),
      publicationPublishedAt: new Date("2026-09-20T00:00:00.000Z"),
      postPublishedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    expect(judge([rootPost("root-subject", root)], [published])?.kind).toBe("ROOT_PUBLISHED");
    expect(
      judge([rootPost("root-subject", root)], [published], {
        lookbackSince: new Date("2026-09-25T00:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("CASE E: the same WordPress destination CTA is a duplicate", () => {
    const earlierCta = candidate({
      postId: "cta-a",
      publicationId: "pub-a",
      role: "CTA",
      body: cta(URL_A),
      publicationStatus: "SCHEDULED",
      publicationScheduledAt: new Date("2026-09-28T03:00:00.000Z"),
      publicationCreatedAt: new Date("2026-09-27T01:00:00.000Z"),
    });
    const match = judge(
      [rootPost("root-subject", "ROOT B の本文"), ctaPost("cta-subject", URL_A)],
      [
        candidate({
          postId: "root-a",
          publicationId: "pub-a",
          role: "ROOT",
          body: "ROOT A の本文",
          publicationScheduledAt: new Date("2026-09-28T03:00:00.000Z"),
        }),
        earlierCta,
      ],
    );
    expect(match?.kind).toBe("CTA_EARLIER_RESERVATION");
    expect(match?.publicationId).toBe("pub-a");
  });

  it("does not let a later reservation of the same ROOT block the earlier due slot", () => {
    const root = "ROOT A の本文";
    const later = candidate({
      postId: "root-later",
      publicationId: "pub-later",
      role: "ROOT",
      body: root,
      publicationScheduledAt: new Date("2026-09-29T12:00:00.000Z"),
    });
    expect(judge([rootPost("root-subject", root)], [later])).toBeNull();
    const earlier = candidate({
      postId: "root-earlier",
      publicationId: "pub-earlier",
      role: "ROOT",
      body: root,
      publicationScheduledAt: new Date("2026-09-28T03:00:00.000Z"),
    });
    expect(
      judge([rootPost("root-subject", root)], [earlier], {
        scheduledAt: new Date("2026-09-28T14:00:00.000Z"),
      })?.kind,
    ).toBe("ROOT_EARLIER_RESERVATION");
  });

  it("ignores a BLOCKED unpublished reservation", () => {
    const root = "ROOT A の本文";
    const blocked = candidate({
      postId: "root-blocked",
      publicationId: "pub-blocked",
      role: "ROOT",
      body: root,
      publicationStatus: "BLOCKED",
      publicationScheduledAt: new Date("2026-09-28T03:00:00.000Z"),
    });
    expect(judge([rootPost("root-subject", root)], [blocked])).toBeNull();
  });
});
