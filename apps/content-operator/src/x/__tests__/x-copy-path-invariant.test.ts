/**
 * Architecture invariant: X copy production path must stay single-route.
 * Claims → X Planner → X Writer → X Review → compose → X Publication
 * Forbidden: legacy realize, strip-and-glue, WP body scrape.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { X_COPY_PRODUCTION_PATH } from "../social-pipeline.js";
import { adaptCanonicalToXSocial } from "../x-social-adaptation.js";

const X_DIR = path.resolve(__dirname, "..");

describe("X copy production path invariant", () => {
  it("documents the sole production copy route", () => {
    expect(X_COPY_PRODUCTION_PATH).toBe(
      "Claims→XPlanner→XWriter→XReview→compose→XPublication",
    );
  });

  it("adaptation wires through social-pipeline (not legacy realize)", () => {
    const adaptSrc = fs.readFileSync(path.join(X_DIR, "x-social-adaptation.ts"), "utf8");
    expect(adaptSrc).toMatch(/runXSocialPipeline/);
    expect(adaptSrc).not.toMatch(/realizeXSocialCopy|selectXSocialFacts|toXSocialSafePhrase/);
    expect(fs.existsSync(path.join(X_DIR, "x-social-realize.ts"))).toBe(false);
  });

  it("slot-live uses adaptLoadedCanonicalToX async with optional llm", () => {
    const slot = fs.readFileSync(
      path.resolve(X_DIR, "../daily-ops/x-slot-live.ts"),
      "utf8",
    );
    expect(slot).toMatch(/await adaptLoadedCanonicalToX/);
    expect(slot).toMatch(/llm:/);
    expect(slot).not.toMatch(/realizeXSocialCopy/);
  });

  it("rejects WP-body-summary style inputs structurally via thin/skip or grounded plan", async () => {
    const result = await adaptCanonicalToXSocial({
      canonicalTitle: "薄い",
      cid: "thin00001",
      performerNames: ["誰か"],
      claimStatements: [],
      articlePlanFacts: [],
      publishedBlogUrl: "https://otonaselect.net/example/",
      wpStatus: "publish",
      preferredLinkMode: "WP_TRAFFIC",
      preferWpTraffic: true,
    });
    expect(result.skip?.reason).toBe("SOCIAL_CONTENT_TOO_THIN");
    expect(result.posts).toHaveLength(0);
  });
});
