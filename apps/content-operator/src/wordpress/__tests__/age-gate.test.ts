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
