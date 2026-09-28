import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adaptCanonicalToXSocial } from "../x-social-adaptation.js";
import { extractArticlePlanSocialFacts, groundedPlanFactTexts } from "../x-social-facts.js";

const AUDIT = "/tmp/x-social-audit";

function loadCid(cid: string) {
  const sc = JSON.parse(fs.readFileSync(path.join(AUDIT, `${cid}.cv.json`), "utf8"));
  const snap = JSON.parse(fs.readFileSync(path.join(AUDIT, `${cid}.json`), "utf8"));
  const title = fs.existsSync(path.join(AUDIT, `${cid}.meta.txt`))
    ? fs.readFileSync(path.join(AUDIT, `${cid}.meta.txt`), "utf8").trim()
    : String(sc?.seo?.title ?? cid);
  const performers: string[] = [];
  const plan =
    sc?.brainGenerationContract?.layers?.ARTICLE_PLAN ??
    sc?.brainGenerationContract?.articlePlan ??
    {};
  for (const block of plan.body ?? []) {
    const facts = block.facts ?? [];
    const types = block.factSourceTypes ?? [];
    for (let i = 0; i < facts.length; i += 1) {
      if (types[i] === "IDENTITY" && typeof facts[i] === "string" && facts[i].length < 24) {
        if (!/BEST|専属|SEX|ハメ/i.test(facts[i]) && !performers.includes(facts[i])) {
          performers.push(facts[i]);
        }
      }
    }
  }
  return { sc, snap, title, performers };
}

describe("production social quality preview", () => {
  it("rebuilds bodies for exported production CVs via Social Planner/Writer/Review", async () => {
    if (!fs.existsSync(AUDIT)) {
      return;
    }
    const cids = fs
      .readdirSync(AUDIT)
      .filter((f) => f.endsWith(".cv.json"))
      .map((f) => f.replace(/\.cv\.json$/, ""));
    if (cids.length < 4) return;

    const rows = await Promise.all(
      cids.map(async (cid) => {
      const { sc, snap, title, performers } = loadCid(cid);
      const planFacts = extractArticlePlanSocialFacts(sc);
      const adapted = await adaptCanonicalToXSocial({
        canonicalTitle: title,
        productTitle: title,
        cid,
        articlePlanFacts: planFacts,
        performerNames: performers,
        publishedBlogUrl: snap?.destinationUrl ?? "https://otonaselect.net/example/",
        siteBaseUrl: "https://otonaselect.net",
        wpStatus: "publish",
        disclosure: "",
        preferredLinkMode: "WP_TRAFFIC",
        preferWpTraffic: true,
        allowDirectAffiliate: false,
      });
      const before = snap?.xSocialAdaptation?.posts?.[0]?.body ?? "";
      const after = adapted.posts?.[0]?.body ?? "";
      const pass = !adapted.skip && adapted.posts.length > 0;
      return {
        cid,
        productTitle: title,
        performer: performers.join(",") || "(none)",
        socialPlan: adapted.socialPlan,
        groundedFacts: groundedPlanFactTexts(planFacts),
        before,
        after,
        quality: pass ? "PASS" : "SKIP",
        reason: adapted.skip?.detail ?? adapted.skip?.reason ?? (pass ? "postable_body" : "empty"),
        reviewFindings: adapted.reviewFindings,
      };
    }),
    );

    fs.writeFileSync(
      path.join(AUDIT, "preview-summary.json"),
      JSON.stringify(rows, null, 2),
      "utf8",
    );

    const focus = ["midv00100", "mihd00010", "h_346rebd01065"];
    for (const cid of focus) {
      const row = rows.find((r) => r.cid === cid);
      expect(row, cid).toBeTruthy();
      console.log(`\n=== ${cid} ===`);
      console.log("BEFORE", row!.before.slice(0, 180));
      console.log("AFTER ", row!.after.slice(0, 180));
      console.log(row!.quality, row!.reason, row!.socialPlan);
      if (row!.quality === "PASS") {
        expect(row!.after).not.toMatch(/。の限界|^の限界/);
        expect(row!.after).not.toMatch(/見ていただけたら嬉しいです/);
        expect(row!.after).not.toMatch(/マンコ|チ[〇○]ポ|ハメまくり/);
        expect(row!.after).not.toMatch(/できるんだ|KMPVRが変わる/);
      }
    }

    const midv = rows.find((r) => r.cid === "midv00100");
    if (midv?.quality === "PASS") {
      expect(midv.after).toMatch(/八木奈々/);
    }

    console.log(
      "\nSUMMARY",
      Object.fromEntries(
        ["PASS", "SKIP"].map((k) => [k, rows.filter((r) => r.quality === k).length]),
      ),
      "total",
      rows.length,
    );
  });
});
