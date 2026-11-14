import { describe, expect, it } from "vitest";
import { withWordPressAffiliateId } from "./affiliate-url.js";

describe("withWordPressAffiliateId", () => {
  const plain = "https://video.dmm.co.jp/av/content/?id=55fays00016";

  it("wraps a plain product URL with the affiliate ID the way the DMM API does", () => {
    const url = new URL(withWordPressAffiliateId(plain, "test-990"));
    expect(url.origin).toBe("https://al.fanza.co.jp");
    expect(url.searchParams.get("lurl")).toBe(plain);
    expect(url.searchParams.get("af_id")).toBe("test-990");
    expect(url.searchParams.get("ch")).toBe("api");
  });

  it("leaves an affiliate URL, an unknown host, or a missing ID alone", () => {
    const api = "https://al.fanza.co.jp/?lurl=x&af_id=other-990&ch=api";
    expect(withWordPressAffiliateId(api, "test-990")).toBe(api);
    expect(withWordPressAffiliateId("https://example.com/a", "test-990")).toBe("https://example.com/a");
    expect(withWordPressAffiliateId(plain, undefined)).toBe(plain);
  });
});
