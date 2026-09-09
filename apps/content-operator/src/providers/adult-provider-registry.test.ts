import { describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import {
  listAdultProviderRegistry,
  listEnabledAdultProviderKeys,
  NEW_ADULT_PROVIDER_CHECKLIST,
} from "../providers/adult-provider-registry.js";
import { classifyResearchProviderStatus } from "../adapters/affiliate/research-availability.js";

loadConfig({ requireDatabaseUrl: false });
const base = loadConfig({ requireDatabaseUrl: false });

describe("adult provider registry", () => {
  it("includes FANZA and planned FC2/MGS/APEX placeholders", () => {
    const keys = listAdultProviderRegistry().map((p) => p.key);
    expect(keys).toContain("fanza");
    expect(keys).toContain("fc2_video");
    expect(keys).toContain("fc2_contents");
    expect(keys).toContain("mgs");
    expect(keys).toContain("apex");
  });

  it("isolates unimplemented providers without crashing", () => {
    const fc2 = classifyResearchProviderStatus("fc2_video", {
      ...base,
      researchCollectionEnabled: true,
      researchEnabledProviders: ["fanza", "fc2_video"],
    });
    expect(fc2.status).toBe("NOT_IMPLEMENTED");
    const fanza = classifyResearchProviderStatus("fanza", {
      ...base,
      dmmApiId: "x",
      dmmAffiliateId: "y",
      dmmApiApprovalPending: false,
      researchCollectionEnabled: true,
      researchEnabledProviders: ["fanza", "fc2_video"],
    });
    expect(fanza.status).toBe("AVAILABLE");
  });

  it("lists enabled keys from config", () => {
    expect(
      listEnabledAdultProviderKeys({
        ...base,
        researchEnabledProviders: ["fanza", "mgs"],
      }),
    ).toEqual(["fanza", "mgs"]);
  });

  it("documents new provider checklist", () => {
    expect(NEW_ADULT_PROVIDER_CHECKLIST.length).toBeGreaterThanOrEqual(4);
  });
});
