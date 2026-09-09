import { describe, expect, it } from "vitest";
import type { AppConfig } from "@ai-affiliate/config";
import { loadConfig } from "@ai-affiliate/config";
import {
  classifyResearchProviderStatus,
  listResearchProviderCatalog,
  systemResearchScheduleName,
} from "./provider-readiness.js";

loadConfig({ requireDatabaseUrl: false });
const base = loadConfig({ requireDatabaseUrl: false });

function cfg(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...base, ...overrides };
}

describe("research provider readiness", () => {
  it("lists multi-ASP catalog without inventing adapters", () => {
    const keys = listResearchProviderCatalog().map((p) => p.key);
    expect(keys).toContain("fanza");
    expect(keys).toContain("mock");
    expect(keys).toContain("tiktok");
  });

  it("marks FANZA CREDENTIAL_MISSING without DMM credentials", () => {
    const result = classifyResearchProviderStatus(
      "fanza",
      cfg({
        dmmApiId: undefined,
        dmmAffiliateId: undefined,
        dmmApiApprovalPending: false,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza"],
      }),
    );
    expect(result.status).toBe("CREDENTIAL_MISSING");
    expect(result.skipReason).toMatch(/CREDENTIAL_MISSING/);
  });

  it("marks FANZA API_APPROVAL_PENDING when flagged", () => {
    const result = classifyResearchProviderStatus(
      "fanza",
      cfg({
        dmmApiId: "api-id",
        dmmAffiliateId: "affiliate-990",
        dmmApiApprovalPending: true,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza"],
      }),
    );
    expect(result.status).toBe("API_APPROVAL_PENDING");
  });

  it("marks FANZA AVAILABLE when credentials present and approved", () => {
    const result = classifyResearchProviderStatus(
      "fanza",
      cfg({
        dmmApiId: "api-id",
        dmmAffiliateId: "affiliate-990",
        dmmApiApprovalPending: false,
        researchCollectionEnabled: true,
        researchEnabledProviders: ["fanza"],
      }),
    );
    expect(result.status).toBe("AVAILABLE");
    expect(result.skipReason).toBeNull();
  });

  it("keeps mock AVAILABLE for isolated success path", () => {
    expect(classifyResearchProviderStatus("mock", cfg()).status).toBe("AVAILABLE");
  });

  it("marks unimplemented ASPs as NOT_IMPLEMENTED", () => {
    expect(classifyResearchProviderStatus("tiktok", cfg()).status).toBe("NOT_IMPLEMENTED");
  });

  it("uses stable system schedule names per provider", () => {
    expect(systemResearchScheduleName("fanza")).toBe("system:auto-research:fanza");
  });
});
