import { describe, expect, it } from "vitest";
import {
  LINK_REPLACE_PRIORITY,
  LinkResolver,
  PublicationPlanner,
  applyAffiliateReplacement,
  buildProductLinkCandidates,
  containsInternalLinkMarkers,
  resolvePrimaryLink,
  sanitizePublicBody,
} from "./index.js";

const policy = {
  preferredAffiliateProvider: "fanza",
  futureAspProviders: ["overseas-asp"],
};

describe("LinkResolver fallback priority", () => {
  it("uses FANZA product URL only when affiliate is absent", () => {
    const { primary, candidates } = new LinkResolver(policy).resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "fanza",
          productUrl: "https://example.invalid/fanza/item-1",
          productMatchKey: "prod-1",
        },
      ],
      officialUrls: [{ provider: "maker", url: "https://example.invalid/maker/item-1" }],
    });
    expect(primary.url).toBe("https://example.invalid/fanza/item-1");
    expect(primary.replacePriority).toBe(LINK_REPLACE_PRIORITY.PREFERRED_PRODUCT);
    expect(primary.replacement.replacementStatus).toBe("AWAITING_PROVIDER");
    expect(candidates.find((c) => c.currentLinkType === "OFFICIAL")?.replacePriority).toBe(
      LINK_REPLACE_PRIORITY.OFFICIAL,
    );
  });

  it("prefers FANZA affiliate URL over FANZA product URL", () => {
    const { primary } = new LinkResolver(policy).resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "fanza",
          productUrl: "https://example.invalid/fanza/item-1",
          affiliateUrl: "https://example.invalid/aff/fanza/item-1",
          productMatchKey: "prod-1",
        },
      ],
      officialUrls: [{ provider: "maker", url: "https://example.invalid/maker/item-1" }],
    });
    expect(primary.url).toBe("https://example.invalid/aff/fanza/item-1");
    expect(primary.replacePriority).toBe(LINK_REPLACE_PRIORITY.PREFERRED_AFFILIATE);
    expect(primary.currentLinkType).toBe("AFFILIATE");
  });

  it("falls back to future ASP when FANZA is absent", () => {
    const affiliateFirst = new LinkResolver(policy).resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "overseas-asp",
          productUrl: "https://example.invalid/asp/item-1",
          affiliateUrl: "https://example.invalid/aff/asp/item-1",
          productMatchKey: "prod-1",
        },
      ],
      officialUrls: [{ provider: "maker", url: "https://example.invalid/official" }],
    });
    expect(affiliateFirst.primary.replacePriority).toBe(LINK_REPLACE_PRIORITY.FUTURE_ASP_AFFILIATE);

    const productOnly = new LinkResolver(policy).resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "overseas-asp",
          productUrl: "https://example.invalid/asp/item-1",
          productMatchKey: "prod-1",
        },
      ],
      officialUrls: [{ provider: "maker", url: "https://example.invalid/official" }],
    });
    expect(productOnly.primary.replacePriority).toBe(LINK_REPLACE_PRIORITY.FUTURE_ASP_PRODUCT);
    expect(productOnly.primary.url).toBe("https://example.invalid/asp/item-1");
  });

  it("falls back to official then trusted then none when ASP missing", () => {
    const official = resolvePrimaryLink(
      buildProductLinkCandidates(
        {
          productMatchKey: "prod-1",
          offers: [],
          officialUrls: [{ provider: "maker", url: "https://example.invalid/official" }],
          trustedUrls: [{ provider: "shop", url: "https://example.invalid/trusted" }],
        },
        policy,
      ),
    );
    expect(official.url).toBe("https://example.invalid/official");
    expect(official.replacePriority).toBe(LINK_REPLACE_PRIORITY.OFFICIAL);

    const trusted = resolvePrimaryLink(
      buildProductLinkCandidates(
        {
          productMatchKey: "prod-1",
          offers: [],
          trustedUrls: [{ provider: "shop", url: "https://example.invalid/trusted" }],
        },
        policy,
      ),
    );
    expect(trusted.url).toBe("https://example.invalid/trusted");

    const none = resolvePrimaryLink([]);
    expect(none.url).toBeNull();
    expect(none.replacePriority).toBe(LINK_REPLACE_PRIORITY.NONE);
  });

  it("compares replacePriority across multiple candidates", () => {
    const candidates = buildProductLinkCandidates(
      {
        productMatchKey: "prod-1",
        offers: [
          {
            providerKey: "fanza",
            productUrl: "https://example.invalid/fanza/p",
            productMatchKey: "prod-1",
          },
          {
            providerKey: "overseas-asp",
            affiliateUrl: "https://example.invalid/aff/asp/p",
            productMatchKey: "prod-1",
          },
        ],
        officialUrls: [{ provider: "maker", url: "https://example.invalid/maker/p" }],
      },
      policy,
    );
    expect(candidates.map((c) => c.replacePriority)).toEqual([
      LINK_REPLACE_PRIORITY.PREFERRED_PRODUCT,
      LINK_REPLACE_PRIORITY.FUTURE_ASP_AFFILIATE,
      LINK_REPLACE_PRIORITY.OFFICIAL,
    ].sort((a, b) => a - b));
    expect(resolvePrimaryLink(candidates).url).toBe("https://example.invalid/fanza/p");
  });

  it("excludes invalid URLs", () => {
    const { primary, candidates } = new LinkResolver(policy).resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "fanza",
          productUrl: "not-a-url",
          affiliateUrl: "ftp://example.invalid/aff",
          productMatchKey: "prod-1",
        },
      ],
      officialUrls: [{ provider: "maker", url: "https://example.invalid/official" }],
    });
    expect(candidates.every((c) => c.url?.startsWith("http"))).toBe(true);
    expect(primary.url).toBe("https://example.invalid/official");
  });

  it("excludes discontinued links", () => {
    const { primary } = new LinkResolver(policy).resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "fanza",
          productUrl: "https://example.invalid/fanza/ended",
          availability: "DISCONTINUED",
          productMatchKey: "prod-1",
        },
      ],
      officialUrls: [{ provider: "maker", url: "https://example.invalid/official" }],
    });
    expect(primary.url).toBe("https://example.invalid/official");
  });

  it("excludes offers that do not match the same product", () => {
    const { primary, candidates } = new LinkResolver(policy).resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "fanza",
          productUrl: "https://example.invalid/fanza/other",
          productMatchKey: "prod-OTHER",
        },
        {
          providerKey: "overseas-asp",
          productUrl: "https://example.invalid/asp/item-1",
          productMatchKey: "prod-1",
        },
      ],
    });
    expect(candidates.some((c) => c.url?.includes("/other"))).toBe(false);
    expect(primary.url).toBe("https://example.invalid/asp/item-1");
  });

  it("proposes affiliate replacement without destroying normal URL ranking until applied", () => {
    const resolver = new LinkResolver(policy);
    const base = resolver.resolve({
      productMatchKey: "prod-1",
      offers: [
        {
          providerKey: "fanza",
          productUrl: "https://example.invalid/fanza/item-1",
          productMatchKey: "prod-1",
        },
      ],
    });
    const replaced = applyAffiliateReplacement(
      base.candidates,
      "https://example.invalid/aff/item-1",
      { providerKey: "fanza" },
    );
    expect(resolvePrimaryLink(replaced).currentLinkType).toBe("AFFILIATE");
  });
});

describe("PublicationPlanner", () => {
  it("stores replacement status metadata (not boolean-only)", () => {
    const plan = new PublicationPlanner(policy).plan({
      contentId: "c1",
      contentVersionId: "v1",
      platform: "BLOGGER",
      linkInput: {
        productMatchKey: "prod-1",
        offers: [
          {
            providerKey: "fanza",
            productUrl: "https://example.invalid/fanza/p",
            productMatchKey: "prod-1",
          },
        ],
        officialUrls: [{ provider: "maker", url: "https://example.invalid/maker/p" }],
      },
    });
    expect(plan.platformMetadata.selectedLink).toMatchObject({
      currentLinkType: "PROVIDER_PRODUCT",
      replacePriority: LINK_REPLACE_PRIORITY.PREFERRED_PRODUCT,
      replacementStatus: "AWAITING_PROVIDER",
      preferredAffiliateProvider: "fanza",
    });
  });
});

describe("public body sanitizer", () => {
  it("detects and strips internal markers from publishable body", () => {
    const dirty = [
      "紹介文です。",
      "https://example.invalid/fanza/item-1",
      "productLinkId: pl_abc123xyz",
      "affiliateReplacementCandidate=true",
      "replacementStatus: AWAITING_PROVIDER",
      "{{ctaUrl}}",
      "pending://affiliate/item-1",
    ].join("\n");

    expect(containsInternalLinkMarkers(dirty)).toBe(true);
    const cleaned = sanitizePublicBody(dirty);
    expect(containsInternalLinkMarkers(cleaned.body)).toBe(false);
    expect(cleaned.body).toContain("https://example.invalid/fanza/item-1");
    expect(cleaned.body).not.toContain("affiliateReplacementCandidate");
    expect(cleaned.body).not.toContain("{{ctaUrl}}");
    expect(cleaned.body).not.toContain("pending://");
    expect(cleaned.body).not.toContain("AWAITING_PROVIDER");
  });
});
