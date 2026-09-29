import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DmmItemListResponse } from "../../providers/fanza/dmm-api-types.js";
import {
  harvestArticleIds,
  itemListToDemandRows,
  pickSegmentTargets,
} from "../demand-collector.js";
import { FANZA_API_POPULAR } from "../demand-signal.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../providers/fanza/fixtures/item-list-success.json", import.meta.url), "utf8"),
) as DmmItemListResponse;

describe("FANZA API demand mapping", () => {
  it("keeps official titles and unique ranks without copying them into extra columns", () => {
    const mapped = itemListToDemandRows({
      source: FANZA_API_POPULAR,
      items: fixture.result?.items ?? [],
      observedAt: new Date("2026-09-30T00:00:00.000Z"),
      provenance: "DMM ItemList site=FANZA service=digital floor=videoa sort=rank hits=100",
    });
    expect(mapped.rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(mapped.rows.every((row) => row.contentId && row.keyword == null)).toBe(true);
    expect(mapped.titles.every((title) => title.length > 0)).toBe(true);
    expect(JSON.stringify(mapped.rows)).not.toMatch(/affiliateURL|api_id|affiliate_id/);
  });

  it("harvests article ids and limits segment targets to pool evidence", () => {
    const harvested = harvestArticleIds(fixture.result?.items ?? []);
    expect(harvested.performers.map((row) => row.name)).toContain("松本いちか");
    expect(harvested.genres.map((row) => row.name)).toContain("痴女");
    const targets = pickSegmentTargets([
      { type: "genre", name: "ハイビジョン" },
      { type: "genre", name: "ハイビジョン" },
      { type: "genre", name: "熟女" },
      { type: "actress", name: "松本いちか" },
      { type: "maker", name: "ムーディーズ" },
      { type: "series", name: "GETシリーズ" },
    ]);
    expect(targets.genres).toEqual(["熟女"]);
    expect(targets.performers).toEqual(["松本いちか"]);
    expect(targets.makers).toEqual(["ムーディーズ"]);
    expect(targets.series).toEqual(["GETシリーズ"]);
  });
});
