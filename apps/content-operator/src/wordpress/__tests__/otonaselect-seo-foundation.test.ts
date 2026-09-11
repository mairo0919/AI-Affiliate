import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, "../../../../wordpress-theme/otonaselect");

function read(rel: string): string {
  return readFileSync(resolve(THEME, rel), "utf8");
}

describe("otonaselect SEO foundation contracts", () => {
  it("ships theme 1.6.4 with rewrite flush version gate", () => {
    expect(read("style.css")).toMatch(/Version:\s*1\.6\.4/);
    const tax = read("inc/taxonomies.php");
    expect(tax).toContain("otonaselect-tax-rewrite-1.6.4");
    expect(tax).toContain("flush_rewrite_rules");
    expect(read("inc/site-pages.php")).toContain("/flush-rewrites");
  });

  it("discloses adult rating without inventing rich result claims", () => {
    const seo = read("inc/seo-head.php");
    expect(seo).toContain('name="rating" content="adult"');
    expect(seo).toContain("RTA-ACCT-000041-RTA");
    expect(seo).toContain("www.otonaselect.net");
    expect(seo).toContain("hide_empty");
    expect(seo).toContain("is_author()");
    expect(seo).toContain("robots_txt");
    const ld = read("inc/json-ld.php");
    expect(ld).toContain("Never invent rating");
    expect(ld).not.toMatch(/aggregateRating|priceCurrency|"offers"/);
  });

  it("does not breadcrumb to non-existent taxonomy roots", () => {
    const ld = read("inc/json-ld.php");
    expect(ld).not.toMatch(/'name'\s*=>\s*'出演者'[\s\S]{0,80}'\/performer\/'/);
    expect(ld).not.toMatch(/'name'\s*=>\s*'シリーズ'[\s\S]{0,80}'\/series\/'/);
  });

  it("keeps related priority performer → series → category → tag", () => {
    const related = read("inc/related.php");
    expect(related).toMatch(/performer[\s\S]*series[\s\S]*category[\s\S]*tag/i);
  });
});
