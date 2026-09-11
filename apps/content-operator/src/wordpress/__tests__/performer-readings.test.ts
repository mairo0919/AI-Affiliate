import { describe, expect, it } from "vitest";
import { extractPerformerReadingsFromRawData } from "../performer-readings.js";

describe("extractPerformerReadingsFromRawData", () => {
  it("reads FANZA iteminfo.actress ruby", () => {
    const rows = extractPerformerReadingsFromRawData({
      iteminfo: {
        actress: [
          { name: "奥田咲", ruby: "おくださき" },
          { name: "三上悠亜", ruby: "みかみゆあ" },
        ],
      },
    });
    expect(rows).toEqual([
      { name: "奥田咲", reading: "おくださき" },
      { name: "三上悠亜", reading: "みかみゆあ" },
    ]);
  });

  it("skips entities without ruby (no AI invent)", () => {
    expect(
      extractPerformerReadingsFromRawData({
        iteminfo: { actress: [{ name: "不明", id: 1 }] },
      }),
    ).toEqual([]);
  });
});
