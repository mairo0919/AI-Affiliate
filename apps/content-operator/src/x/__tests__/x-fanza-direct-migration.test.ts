import { describe, expect, it } from "vitest";
import {
  buildXFanzaDirectAffiliateUrl,
  officialFanzaMediaHost,
  xBodyBlocksFanzaDirect,
} from "../../adapters/affiliate/fanza-affiliate-provider.js";
import { composeXThreadPublication } from "../x-thread-publication.js";

const CID = "mida00805";
const X_ID = "xsite-affiliate-001";
const WP_ID = "blog-affiliate-002";
const REVIEW = "公開情報にある出演者と収録時間だけを書く。";

describe("X FANZA direct migration", () => {
  it("builds an X affiliate URL and keeps the canonical cid", () => {
    const built = buildXFanzaDirectAffiliateUrl({
      contentId: CID,
      xAffiliateId: X_ID,
      wordpressAffiliateId: WP_ID,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const url = new URL(built.url);
    expect(url.hostname).toBe("al.fanza.co.jp");
    expect(url.searchParams.get("af_id")).toBe(X_ID);
    const destination = new URL(url.searchParams.get("lurl") ?? "");
    expect(destination.hostname).toBe("video.dmm.co.jp");
    expect(destination.searchParams.get("id")).toBe(CID);
    expect(built.url).not.toContain(WP_ID);
    expect(built.url).not.toContain("otonaselect.net");
  });

  it("does not fall back to the WordPress affiliate id", () => {
    const missing = buildXFanzaDirectAffiliateUrl({
      contentId: CID,
      xAffiliateId: null,
      wordpressAffiliateId: WP_ID,
    });
    expect(missing).toEqual({ ok: false, reason: "X_AFFILIATE_ID_UNSET" });
    const same = buildXFanzaDirectAffiliateUrl({
      contentId: CID,
      xAffiliateId: WP_ID,
      wordpressAffiliateId: WP_ID,
    });
    expect(same).toEqual({ ok: false, reason: "X_AFFILIATE_ID_NOT_DISTINCT" });
  });

  it("keeps the review text on ROOT and puts PR plus the direct URL on the CTA", () => {
    const built = buildXFanzaDirectAffiliateUrl({
      contentId: CID,
      xAffiliateId: X_ID,
      wordpressAffiliateId: WP_ID,
    });
    if (!built.ok) throw new Error("url");
    const posts = composeXThreadPublication({
      strategy: "FANZA_DIRECT",
      parentBody: REVIEW,
      wpUrl: "https://otonaselect.net/?p=211",
      fanzaUrl: built.url,
      disclosure: "#PR",
    });
    expect(posts[0]?.body).toBe(REVIEW);
    expect(posts[0]?.body).not.toMatch(/#PR|記事はこちら|otonaselect\.net/);
    expect(posts[1]?.body.startsWith("PR\n")).toBe(true);
    expect(posts[1]?.body).toContain(built.url);
    expect(posts[1]?.body).not.toContain("記事はこちら");
    expect(posts.map((post) => post.body).join("\n")).not.toMatch(/otonaselect\.net/);
  });

  it("refuses a legacy WordPress CTA", () => {
    expect(xBodyBlocksFanzaDirect("PR\n記事はこちら\nhttps://otonaselect.net/?p=211")).toBe(true);
    expect(xBodyBlocksFanzaDirect("PR\nhttps://al.fanza.co.jp/?af_id=xsite-affiliate-001")).toBe(
      false,
    );
  });

  it("accepts official DMM media and rejects other image hosts", () => {
    expect(
      officialFanzaMediaHost("https://awsimgsrc.dmm.co.jp/digital/video/mida00805/mida00805pl.jpg"),
    ).toBe(true);
    expect(officialFanzaMediaHost("https://example.com/generated.png")).toBe(false);
    expect(officialFanzaMediaHost("https://cdn.erogal.example/other.jpg")).toBe(false);
  });

  it("does not treat WordPress approval as the product identity", () => {
    const approved = buildXFanzaDirectAffiliateUrl({
      contentId: CID,
      xAffiliateId: X_ID,
      wordpressAffiliateId: WP_ID,
    });
    const unpublished = buildXFanzaDirectAffiliateUrl({
      contentId: CID,
      xAffiliateId: X_ID,
      wordpressAffiliateId: WP_ID,
    });
    expect(approved).toEqual(unpublished);
  });
});
