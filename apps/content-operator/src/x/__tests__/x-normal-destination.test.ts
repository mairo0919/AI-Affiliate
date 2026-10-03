import { describe, expect, it } from "vitest";
import { outgoingXPostText } from "../ops/pre-publish-guard.js";
import { officialMediaMatchesCanonicalCid } from "../publication-media-plan.js";
import { composeXThreadPublication } from "../x-thread-publication.js";
import {
  appendNormalLinkMarker,
  assertNormalXDestination,
  blockedDestinationDetail,
  classifyXDestination,
  composeNormalLinkPosts,
  nextFutureJstSlots,
  publishingPauseActive,
  resolveNormalXProductUrl,
  verifyCanaryPosts,
} from "../x-normal-destination.js";

const CID = "mida00805";
const NORMAL = "https://video.dmm.co.jp/av/content/?id=mida00805";
const ROOT = "レビュー本文です。作品の見どころを短く書く。";

describe("normal FANZA/DMM destination", () => {
  it("accepts an official product URL for the same canonical cid", () => {
    expect(classifyXDestination(NORMAL)).toBe("DMM_NORMAL");
    expect(assertNormalXDestination(NORMAL, CID)).toEqual({ ok: true, url: NORMAL });
    expect(
      resolveNormalXProductUrl({
        canonicalCid: CID,
        officialContentId: CID,
        officialProductUrl: NORMAL,
      }),
    ).toEqual({ ok: true, url: NORMAL, source: "OFFICIAL_METADATA_URL" });
  });

  it("builds the official content URL from a matching content id", () => {
    const resolved = resolveNormalXProductUrl({
      canonicalCid: CID,
      officialContentId: CID,
      officialProductUrl: null,
    });
    expect(resolved).toEqual({ ok: true, url: NORMAL, source: "OFFICIAL_CONTENT_ID" });
  });

  it("rejects affiliate URLs, parameters, and ids", () => {
    const affiliate = "https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2F&af_id=example-id";
    expect(classifyXDestination(affiliate)).toBe("FANZA_AFFILIATE");
    expect(assertNormalXDestination(affiliate, CID).ok).toBe(false);
    expect(assertNormalXDestination(`${NORMAL}&af_id=example-id`, CID).ok).toBe(false);
    expect(blockedDestinationDetail(`作品 ${affiliate}`)).toBe("affiliate");
    const stripped = resolveNormalXProductUrl({
      canonicalCid: CID,
      officialContentId: CID,
      officialProductUrl: affiliate,
    });
    expect(stripped).toEqual({ ok: true, url: NORMAL, source: "OFFICIAL_CONTENT_ID" });
  });

  it("rejects otonaselect, WordPress, and redirect wrappers", () => {
    expect(classifyXDestination("https://otonaselect.net/works/mida00805/")).toBe("WORDPRESS");
    expect(assertNormalXDestination("https://otonaselect.net/works/mida00805/", CID).ok).toBe(false);
    expect(classifyXDestination("https://example.wordpress.com/post")).toBe("WORDPRESS");
    expect(assertNormalXDestination("https://t.co/abc", CID).ok).toBe(false);
    expect(blockedDestinationDetail("https://bit.ly/abc")).toBe("redirect");
  });

  it("rejects a URL for a different canonical cid", () => {
    expect(assertNormalXDestination(NORMAL, "other0001").ok).toBe(false);
    expect(
      resolveNormalXProductUrl({
        canonicalCid: CID,
        officialContentId: "other0001",
        officialProductUrl: "https://video.dmm.co.jp/av/content/?id=other0001",
      }),
    ).toEqual({ ok: false, reason: "NORMAL_URL_NOT_VERIFIED" });
  });

  it("keeps the existing review text and does not add PR", () => {
    const posts = composeXThreadPublication({
      strategy: "FANZA_NORMAL",
      parentBody: ROOT,
      wpUrl: null,
      fanzaUrl: NORMAL,
      canonicalCid: CID,
      disclosure: "PR",
    });
    expect(posts[0]?.body).toBe(ROOT);
    expect(posts[1]?.body).toBe(`作品ページはこちら\n${NORMAL}`);
    expect(posts[1]?.body.startsWith("PR")).toBe(false);
    const sent = outgoingXPostText({
      body: posts[1]!.body,
      role: "CTA",
      disclosure: "PR",
    });
    expect(sent).toBe(posts[1]?.body);
    const rebuilt = composeNormalLinkPosts({ rootBody: `${ROOT}\nhttps://otonaselect.net/a`, url: NORMAL, canonicalCid: CID });
    expect(rebuilt).toEqual({
      ok: true,
      rootBody: ROOT,
      ctaBody: `作品ページはこちら\n${NORMAL}`,
    });
  });

  it("keeps official media on the canonical cid and rejects other images", () => {
    const official = "https://pics.dmm.co.jp/digital/video/mida00805/mida00805pl.jpg";
    expect(officialMediaMatchesCanonicalCid(official, CID)).toBe(true);
    expect(officialMediaMatchesCanonicalCid("https://example.com/generated.png", CID)).toBe(false);
    expect(officialMediaMatchesCanonicalCid("https://cdn.erogal.example/other.jpg", CID)).toBe(false);
    expect(
      officialMediaMatchesCanonicalCid(
        "https://pics.dmm.co.jp/digital/video/other0001/other0001pl.jpg",
        CID,
      ),
    ).toBe(false);
  });

  it("blocks a legacy WordPress or affiliate payload", () => {
    expect(blockedDestinationDetail("記事はこちら\nhttps://otonaselect.net/?p=1")).toBe("wordpress");
    expect(blockedDestinationDetail("https://al.dmm.co.jp/?af_id=example")).toBe("affiliate");
  });

  it("preserves audit history and scopes the repost exception to the migration marker", () => {
    const marked = appendNormalLinkMarker("x-strategy-v1|slotHour=12");
    expect(marked).toContain("x-strategy-v1|slotHour=12");
    expect(marked).toContain("normal-link-migration");
    expect(appendNormalLinkMarker(marked)).toBe(marked);
  });

  it("does not schedule a slot in the past", () => {
    const now = new Date("2026-10-03T06:00:00.000Z");
    const slots = nextFutureJstSlots(2, now);
    expect(slots.length).toBe(2);
    expect(slots.every((slot) => slot.getTime() > now.getTime())).toBe(true);
  });

  it("recognizes the publishing pause values", () => {
    expect(publishingPauseActive("true")).toBe(true);
    expect(publishingPauseActive("paused")).toBe(true);
    expect(publishingPauseActive("false")).toBe(false);
  });

  it("accepts a canary only when the live post matches the official page", () => {
    const pass = verifyCanaryPosts({
      canonicalCid: CID,
      expectedRoot: ROOT,
      expectedUrl: NORMAL,
      rootText: ROOT,
      ctaText: `作品ページはこちら\nhttps://t.co/abc`,
      rootExpandedUrls: ["https://x.com/osusume_media/status/1/photo/1"],
      ctaExpandedUrls: [NORMAL],
      rootMediaCount: 1,
      ctaMediaCount: 0,
      sentMediaMatchesCid: true,
    });
    expect(pass.pass).toBe(true);
    expect(pass.wpAbsent).toBe(true);
    expect(pass.affiliateAbsent).toBe(true);
    expect(pass.wrongProduct).toBe(false);

    const wp = verifyCanaryPosts({
      canonicalCid: CID,
      expectedRoot: ROOT,
      expectedUrl: NORMAL,
      rootText: ROOT,
      ctaText: "作品ページはこちら\nhttps://otonaselect.net/works/mida00805/",
      rootExpandedUrls: [],
      ctaExpandedUrls: ["https://otonaselect.net/works/mida00805/"],
      rootMediaCount: 1,
      ctaMediaCount: 0,
      sentMediaMatchesCid: true,
    });
    expect(wp.pass).toBe(false);
    expect(wp.wpAbsent).toBe(false);

    const other = verifyCanaryPosts({
      canonicalCid: CID,
      expectedRoot: ROOT,
      expectedUrl: NORMAL,
      rootText: ROOT,
      ctaText: "作品ページはこちら",
      rootExpandedUrls: [],
      ctaExpandedUrls: ["https://video.dmm.co.jp/av/content/?id=other0001"],
      rootMediaCount: 1,
      ctaMediaCount: 0,
      sentMediaMatchesCid: true,
    });
    expect(other.pass).toBe(false);
    expect(other.wrongProduct).toBe(true);
  });
});
