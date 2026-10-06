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
  it("ships theme 1.6.10 with rewrite flush version gate", () => {
    expect(read("style.css")).toMatch(/Version:\s*1\.6\.10/);
    const tax = read("inc/taxonomies.php");
    expect(tax).toContain("otonaselect-tax-rewrite-1.6.7");
    expect(tax).toContain("flush_rewrite_rules");
    expect(read("inc/site-pages.php")).toContain("/flush-rewrites");
    expect(read("inc/site-pages.php")).toContain("otonaselect-tax-rewrite-1.6.7");
  });

  it("ships taxonomy hub pages and header nav to dedicated listings", () => {
    expect(read("parts/header.html")).toContain("/performers/");
    expect(read("parts/header.html")).toContain("/categories/");
    expect(read("parts/header.html")).toContain("/series-list/");
    expect(read("inc/taxonomy-hubs.php")).toContain("otonaselect_render_performer_hub");
    expect(read("inc/reading.php")).toContain("otonaselect_reading_kana");
    expect(read("templates/page-performers.html")).toContain("otonaselect-performer-hub-slot");
    expect(read("templates/page-categories.html")).toContain("otonaselect-category-hub-slot");
    expect(read("templates/page-series-list.html")).toContain("otonaselect-series-hub-slot");
  });

  it("lists home latest posts by post_date DESC with 9/page and no home pagination", () => {
    const front = read("templates/front-page.html");
    expect(front).toMatch(/"perPage":9/);
    expect(front).toContain("otonaselect-home-nav");
    expect(front).not.toContain("otonaselect-home-sidebar");
    expect(front).not.toContain('"slug":"sponsor"');
    expect(front).toContain("/categories/");
    expect(front).toContain("otonaselect-home-performers-slot");
    expect(front).toMatch(/"order":"desc"/);
    expect(front).toMatch(/"orderBy":"date"/);
    expect(front).toMatch(/"inherit":true/);
    expect(front).toMatch(/"sticky":"exclude"/);
    expect(front).not.toContain("wp:query-pagination");
    expect(front).toContain('href="/latest/"');
    expect(front).toContain("新着記事をすべて見る");
    const latest = read("templates/page-latest.html");
    expect(latest).toMatch(/"perPage":12/);
    expect(latest).toMatch(/"order":"desc"/);
    expect(latest).toMatch(/"orderBy":"date"/);
    expect(latest).toContain("wp:query-pagination");
    expect(latest).toContain("otonaselect-archive");
    expect(latest).toContain("新着記事");
    expect(latest).not.toContain("otonaselect-home-nav");
    expect(read("templates/archive.html")).toContain("wp:query-pagination");
    expect(read("templates/taxonomy-performer.html")).toContain("wp:query-pagination");
    expect(read("templates/taxonomy-series.html")).toContain("wp:query-pagination");
    expect(read("templates/search.html")).toContain("wp:query-pagination");
    expect(read("templates/single.html")).toContain('contentSize":"40rem"');

    const homeQuery = read("inc/home-query.php");
    expect(homeQuery).toContain("pre_get_posts");
    expect(homeQuery).toContain("$is_blog_front ? 9 : 12");
    expect(read("inc/presentation.php")).toContain("otonaselect_render_popular_posts_section(6)");
    expect(read("inc/taxonomy-hubs.php")).toContain("otonaselect_render_home_performer_cloud(8)");
    expect(homeQuery).toContain("ignore_sticky_posts");
    expect(homeQuery).toContain("orderby', 'date'");
    expect(homeQuery).toContain("order', 'DESC'");
    expect(homeQuery).toContain("set_404");

    const seo = read("inc/seo-head.php");
    expect(seo).toContain("/page/");
    expect(seo).toContain("get_query_var('paged')");
  });

  it("discloses adult rating on HTML only — never on sitemap responses", () => {
    const seo = read("inc/seo-head.php");
    expect(seo).toContain('name="rating" content="adult"');
    expect(seo).toContain("RTA-ACCT-000041-RTA");
    expect(seo).toContain("otonaselect_is_technical_crawl_surface");
    expect(seo).toContain("wp-sitemap");
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
