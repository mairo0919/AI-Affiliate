import { describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  hashNormalizedBody,
  type BodyDuplicateCandidate,
  type PublicationWithPosts,
} from "@ai-affiliate/database";
import { XPrePublishGuard } from "../ops/pre-publish-guard.js";

const URL_A = "https://otonaselect.net/works/aaa111/";
const URL_B = "https://otonaselect.net/works/bbb222/";
const NOW = new Date("2026-09-28T12:00:00.000Z");

function cta(url: string): string {
  return `記事はこちら\n${url}\n#PR`;
}

function publication(): PublicationWithPosts {
  const root = "ROOT A の本文";
  const reply = cta(URL_A);
  return {
    id: "pub-subject",
    generatedContentId: "content-1",
    contentCandidateId: "candidate-1",
    researchItemId: "research-1",
    strategyType: "THREAD",
    status: "SCHEDULED",
    scheduledAt: NOW,
    createdAt: new Date("2026-09-27T05:00:00.000Z"),
    publishingStartedAt: null,
    publishedAt: null,
    failedAt: null,
    rootPostId: null,
    conversationId: null,
    rootPostUrl: null,
    accountId: null,
    attemptCount: 0,
    lastErrorType: null,
    lastErrorMessage: null,
    idempotencyKey: "idem-1",
    experimentGroup: null,
    strategyVersion: "x-strategy-v1",
    nextRetryAt: null,
    updatedAt: NOW,
    posts: [
      {
        id: "post-root",
        publicationId: "pub-subject",
        sequence: 1,
        role: "ROOT",
        status: "PENDING",
        body: root,
        bodyHash: hashNormalizedBody(root),
        weightedLength: 10,
        replyToSequence: null,
        relatedPublicationId: null,
        xPostId: null,
        xPostUrl: null,
        publishedAt: null,
        failedAt: null,
        attemptCount: 0,
        lastErrorType: null,
        lastErrorMessage: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "post-cta",
        publicationId: "pub-subject",
        sequence: 2,
        role: "CTA",
        status: "PENDING",
        body: reply,
        bodyHash: hashNormalizedBody(reply),
        weightedLength: 20,
        replyToSequence: 1,
        relatedPublicationId: null,
        xPostId: null,
        xPostUrl: null,
        publishedAt: null,
        failedAt: null,
        attemptCount: 0,
        lastErrorType: null,
        lastErrorMessage: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}

function futureCta(url: string): BodyDuplicateCandidate[] {
  const when = new Date("2026-09-29T06:00:00.000Z");
  return [
    {
      postId: "other-root",
      publicationId: "pub-future",
      role: "ROOT",
      body: "ROOT B の本文",
      bodyHash: hashNormalizedBody("ROOT B の本文"),
      postStatus: "PENDING",
      xPostId: null,
      postPublishedAt: null,
      publicationStatus: "SCHEDULED",
      publicationScheduledAt: when,
      publicationCreatedAt: new Date("2026-09-27T06:00:00.000Z"),
      publicationPublishedAt: null,
    },
    {
      postId: "other-cta",
      publicationId: "pub-future",
      role: "CTA",
      body: cta(url),
      bodyHash: hashNormalizedBody(cta(url)),
      postStatus: "PENDING",
      xPostId: null,
      postPublishedAt: null,
      publicationStatus: "SCHEDULED",
      publicationScheduledAt: when,
      publicationCreatedAt: new Date("2026-09-27T06:00:00.000Z"),
      publicationPublishedAt: null,
    },
  ];
}

function guardFor(candidates: BodyDuplicateCandidate[]) {
  const config = {
    ...loadConfig({ requireDatabaseUrl: false }),
    xGlobalKillSwitch: false,
    xReleaseMode: "FULL" as const,
    xReleaseDailyPostLimit: 100,
    xReleaseHourlyPostLimit: 100,
    xReleaseAllowedStartHourJst: 0,
    xReleaseAllowedEndHourJst: 23,
    xReleaseAllowedStrategies: [] as string[],
    xReleaseAllowedCandidateTypes: [] as string[],
    xAffiliateDisclosure: "#PR",
    xPostBodyDuplicateLookbackDays: 30,
  };
  return new XPrePublishGuard({
    config,
    now: () => NOW,
    contents: {
      findGeneratedContentById: async () => ({
        status: "READY_TO_PUBLISH",
        validationIssues: [],
        affiliateUrl: null,
      }),
    } as never,
    publications: {} as never,
    ops: {
      isControlActive: async () => false,
      findProductState: async () => null,
      findReservationByPublication: async () => ({
        status: "ACTIVE",
        expiresAt: new Date("2026-09-28T15:00:00.000Z"),
      }),
      countPublishedPostsInRange: async () => 0,
      listBodyDuplicateCandidates: async () => candidates,
    } as never,
  });
}

describe("pre-publish guard duplicate wiring", () => {
  it("does not block a due unit when a future CTA only shares the template", async () => {
    const result = await guardFor(futureCta(URL_B)).evaluate({
      publication: publication(),
      productKey: "product-a",
      phase: "publish",
      actorType: "SCHEDULER",
    });
    expect(result.issues.map((issue) => issue.code)).not.toContain("DUPLICATE_BODY");
    expect(result.ok).toBe(true);
  });

  it("does not block the earlier due CTA when only a later reservation shares the destination", async () => {
    const result = await guardFor(futureCta(URL_A)).evaluate({
      publication: publication(),
      productKey: "product-a",
      phase: "publish",
      actorType: "SCHEDULER",
    });
    expect(result.issues.map((issue) => issue.code)).not.toContain("DUPLICATE_BODY");
    expect(result.ok).toBe(true);
  });

  it("CASE E: blocks a later reservation that repeats the same destination CTA", async () => {
    const pub = publication();
    pub.scheduledAt = new Date("2026-09-29T12:00:00.000Z");
    const earlier = futureCta(URL_A).map((row) => ({
      ...row,
      publicationScheduledAt: new Date("2026-09-28T03:00:00.000Z"),
    }));
    const result = await guardFor(earlier).evaluate({
      publication: pub,
      productKey: "product-a",
      phase: "publish",
      actorType: "SCHEDULER",
    });
    expect(result.issues.some((issue) => issue.code === "DUPLICATE_BODY")).toBe(true);
    expect(result.ok).toBe(false);
  });
});
