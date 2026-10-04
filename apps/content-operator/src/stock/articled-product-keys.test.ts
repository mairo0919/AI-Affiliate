import { describe, expect, it } from "vitest";
import { productKeysBlockedByExistingVersions } from "./approved-stock.js";

const version = (status: string, cid: string) => ({
  status,
  structuredContent: { productCanonicalId: cid },
});

describe("productKeysBlockedByExistingVersions", () => {
  it("blocks an approved cid and allows a single review rejection to be retried", () => {
    const keys = productKeysBlockedByExistingVersions([
      version("APPROVED", "aaa00001"),
      version("REVISION_REQUIRED", "bbb00002"),
    ]);
    expect(keys.has("aaa00001")).toBe(true);
    expect(keys.has("bbb00002")).toBe(false);
  });

  it("blocks a cid after two rejected full generations", () => {
    const keys = productKeysBlockedByExistingVersions([
      version("REVISION_REQUIRED", "ccc00003"),
      version("REVISION_REQUIRED", "ccc00003"),
    ]);
    expect(keys.has("ccc00003")).toBe(true);
  });

  it("does not treat a different cid as the same generation", () => {
    const keys = productKeysBlockedByExistingVersions([
      version("REVISION_REQUIRED", "ddd00004"),
      version("REVISION_REQUIRED", "eee00005"),
    ]);
    expect(keys.has("ddd00004")).toBe(false);
    expect(keys.has("eee00005")).toBe(false);
  });
});
