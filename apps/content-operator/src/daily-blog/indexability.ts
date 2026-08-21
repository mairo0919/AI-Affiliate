/**
 * Indexability checklist — adult SafeSearch limits are not treated as system faults.
 */

export interface IndexabilityCheck {
  ok: boolean;
  findings: string[];
  notes: string[];
}

export function evaluateIndexability(input: {
  robotsTxtBlocksAll?: boolean;
  postUrlCrawlable?: boolean;
  canonicalPresent?: boolean;
  noindexPresent?: boolean;
  sitemapReachable?: boolean | null;
  blogSearchVisibleSetting?: boolean | null;
}): IndexabilityCheck {
  const findings: string[] = [];
  const notes: string[] = [
    "Adult content may be limited by SafeSearch — not classified as a system fault.",
  ];
  if (input.robotsTxtBlocksAll) findings.push("robots_blocks_all");
  if (input.postUrlCrawlable === false) findings.push("post_url_not_crawlable");
  if (input.canonicalPresent === false) findings.push("canonical_missing");
  if (input.noindexPresent) findings.push("noindex_present");
  if (input.sitemapReachable === false) findings.push("sitemap_unreachable");
  if (input.blogSearchVisibleSetting === false) {
    findings.push("blog_search_visibility_off");
  }
  return { ok: findings.length === 0, findings, notes };
}
