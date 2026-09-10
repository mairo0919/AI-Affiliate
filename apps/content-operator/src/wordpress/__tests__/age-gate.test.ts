import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Mirrors theme/plugin crawler allowlist used to skip Age Gate for SEO bots. */
function isAgeGateCrawler(ua: string): boolean {
  return /Googlebot|Google-InspectionTool|Storebot-Google|AdsBot-Google|bingbot|BingPreview|Slurp|DuckDuckBot|Baiduspider|YandexBot|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|WhatsApp|Applebot|PetalBot|Bytespider/i.test(
    ua,
  );
}

describe("Age Gate crawler detection", () => {
  it("allows major search/social crawlers", () => {
    expect(isAgeGateCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(
      true,
    );
    expect(isAgeGateCrawler("facebookexternalhit/1.1")).toBe(true);
    expect(isAgeGateCrawler("Twitterbot/1.0")).toBe(true);
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
