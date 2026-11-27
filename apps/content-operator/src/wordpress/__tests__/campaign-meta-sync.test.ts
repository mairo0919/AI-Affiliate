import { describe, expect, it } from "vitest";
import { campaignMetaValue, campaignsFromDmmItem, cidFromPostContent } from "../campaign-meta-sync.js";

describe("campaign meta sync", () => {
  it("reads the DMM campaign list with JST dates", () => {
    const campaigns = campaignsFromDmmItem({
      campaign: [{ title: "エスワンキャンペーン30％OFF", date_begin: "2026-11-24 10:00:00", date_end: "2026-11-27 09:59:59" }],
    });
    expect(campaigns).toEqual([
      { title: "エスワンキャンペーン30％OFF", begin: "2026-11-24T10:00:00+09:00", end: "2026-11-27T09:59:59+09:00" },
    ]);
    expect(campaignsFromDmmItem({})).toEqual([]);
    expect(campaignsFromDmmItem({ campaign: [{ title: "", date_end: "2026-11-27 09:59:59" }] })).toEqual([]);
  });

  it("stores only sales that have not ended, and clears the meta otherwise", () => {
    const campaigns = [{ title: "中出し50％OFF", begin: null, end: "2026-11-27T09:59:59+09:00" }];
    expect(campaignMetaValue(campaigns, new Date("2026-11-26T12:00:00+09:00"))).toContain("中出し50％OFF");
    expect(campaignMetaValue(campaigns, new Date("2026-11-27T10:00:00+09:00"))).toBe("");
  });

  it("finds the content id in the work-title link of older posts", () => {
    expect(
      cidFromPostContent('<a href="https://al.fanza.co.jp/?lurl=https%3A%2F%2Fvideo.dmm.co.jp%2Fav%2Fcontent%2F%3Fid%3Djuq00821&amp;af_id=x">'),
    ).toBe("juq00821");
    expect(cidFromPostContent("no link")).toBeNull();
  });
});
