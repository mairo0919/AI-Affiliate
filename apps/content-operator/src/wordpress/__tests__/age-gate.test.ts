import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The crawler allowlist the active age-gate plugin ships (read from the plugin, not a copy). */
function isAgeGateCrawler(ua: string): boolean {
  const php = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../wordpress-plugins/otonaselect-age-gate/otonaselect-age-gate.php"),
    "utf8",
  );
  const pattern = /preg_match\(\s*'\/([^']+)\/i'/.exec(php)![1]!;
  return new RegExp(pattern, "i").test(ua);
}

describe("Age Gate crawler detection", () => {
  it("allows major search/social crawlers", () => {
    expect(isAgeGateCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(
      true,
    );
    expect(isAgeGateCrawler("facebookexternalhit/1.1")).toBe(true);
    expect(isAgeGateCrawler("Twitterbot/1.0")).toBe(true);
  });

  it("allows AI search crawlers and AI answer fetchers, not training-only crawlers", () => {
    expect(isAgeGateCrawler("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)")).toBe(true);
    expect(isAgeGateCrawler("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0")).toBe(true);
    expect(isAgeGateCrawler("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0)")).toBe(true);
    expect(isAgeGateCrawler("Mozilla/5.0 (compatible; Claude-SearchBot/1.0)")).toBe(true);
    expect(isAgeGateCrawler("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1)")).toBe(false);
  });

  it("does not treat normal browsers as crawlers", () => {
    expect(
      isAgeGateCrawler(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe(false);
  });
});

describe("Age Gate SSOT: theme header must not ship JS/CSS gate", () => {
  it("header.html has no visibility-hidden age boot", () => {
    const header = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../../wordpress-theme/otonaselect/parts/header.html"),
      "utf8",
    );
    expect(header).not.toMatch(/otonaselect-age-boot/);
    expect(header).not.toMatch(/otonaselect-age-gate-root/);
    expect(header).not.toMatch(/html:not\(\.otonaselect-age-ok\)/);
  });
});
