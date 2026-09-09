/**
 * Multi-ASP research acquisition readiness (shared by Affiliate runtime + Research scheduler).
 * Status isolates a single provider — never halt the whole Research scheduler.
 */

import type { AppConfig } from "@ai-affiliate/config";

function dmmCredentialsPresent(config: Pick<AppConfig, "dmmApiId" | "dmmAffiliateId">): boolean {
  return Boolean(config.dmmApiId?.trim() && config.dmmAffiliateId?.trim());
}

export type ResearchAcquisitionStatus =
  | "AVAILABLE"
  | "API_APPROVAL_PENDING"
  | "CREDENTIAL_MISSING"
  | "SOURCE_BLOCKED_FROM_RAILWAY"
  | "NOT_IMPLEMENTED"
  | "DISABLED";

export interface ResearchProviderDescriptor {
  /** Stable key used as ResearchSchedule.providerName */
  key: string;
  displayName: string;
  /** Can be auto-scheduled for ItemList / feed style collection */
  scheduleable: boolean;
  /** Implementation exists for CollectionJobRunner */
  implemented: boolean;
}

/** Known research acquisition adapters (expand here when adding ASPs). */
export const RESEARCH_PROVIDER_CATALOG: readonly ResearchProviderDescriptor[] = [
  {
    key: "fanza",
    displayName: "FANZA (DMM ItemList API)",
    scheduleable: true,
    implemented: true,
  },
  {
    key: "mock",
    displayName: "Mock research provider",
    scheduleable: true,
    implemented: true,
  },
  {
    key: "tiktok",
    displayName: "TikTok research",
    scheduleable: false,
    implemented: false,
  },
  {
    key: "x",
    displayName: "X research",
    scheduleable: false,
    implemented: false,
  },
  {
    key: "fanza-page",
    displayName: "FANZA official HTML page evidence",
    scheduleable: false,
    implemented: true,
  },
] as const;

export function listResearchProviderCatalog(): ResearchProviderDescriptor[] {
  return [...RESEARCH_PROVIDER_CATALOG];
}

export function findResearchProviderDescriptor(
  key: string,
): ResearchProviderDescriptor | undefined {
  const normalized = key.trim().toLowerCase();
  return RESEARCH_PROVIDER_CATALOG.find((p) => p.key === normalized);
}

export function classifyResearchProviderStatus(
  providerName: string,
  config: Pick<
    AppConfig,
    | "dmmApiId"
    | "dmmAffiliateId"
    | "dmmApiApprovalPending"
    | "researchEnabledProviders"
    | "researchCollectionEnabled"
  >,
): { status: ResearchAcquisitionStatus; skipReason: string | null } {
  const key = providerName.trim().toLowerCase();
  const descriptor = findResearchProviderDescriptor(key);

  if (!descriptor) {
    return {
      status: "NOT_IMPLEMENTED",
      skipReason: `NOT_IMPLEMENTED: unknown research provider:${key}`,
    };
  }

  if (!descriptor.implemented) {
    return {
      status: "NOT_IMPLEMENTED",
      skipReason: `NOT_IMPLEMENTED: provider ${key} has no acquisition adapter yet`,
    };
  }

  if (key === "fanza-page") {
    return {
      status: "SOURCE_BLOCKED_FROM_RAILWAY",
      skipReason:
        "SOURCE_BLOCKED_FROM_RAILWAY: FANZA official HTML is age-gated from Railway egress; not used for auto ResearchItem collection",
    };
  }

  if (key === "mock") {
    return { status: "AVAILABLE", skipReason: null };
  }

  if (key === "fanza") {
    if (!config.researchCollectionEnabled) {
      return {
        status: "DISABLED",
        skipReason: "DISABLED: RESEARCH_COLLECTION_ENABLED=false",
      };
    }
    const enabled = (config.researchEnabledProviders ?? []).map((p) => p.toLowerCase());
    if (enabled.length > 0 && !enabled.includes("fanza")) {
      return {
        status: "DISABLED",
        skipReason: "DISABLED: fanza not listed in RESEARCH_ENABLED_PROVIDERS",
      };
    }
    if (!dmmCredentialsPresent(config)) {
      return {
        status: "CREDENTIAL_MISSING",
        skipReason:
          "CREDENTIAL_MISSING: DMM_API_ID / DMM_AFFILIATE_ID not configured — skip FANZA only",
      };
    }
    if (config.dmmApiApprovalPending) {
      return {
        status: "API_APPROVAL_PENDING",
        skipReason:
          "API_APPROVAL_PENDING: DMM_API_APPROVAL_PENDING=true — skip FANZA ItemList until approved",
      };
    }
    return { status: "AVAILABLE", skipReason: null };
  }

  return {
    status: "NOT_IMPLEMENTED",
    skipReason: `NOT_IMPLEMENTED: provider ${key}`,
  };
}

/** Stable system schedule name — do not collide with operator-created names. */
export function systemResearchScheduleName(providerKey: string): string {
  return `system:auto-research:${providerKey.trim().toLowerCase()}`;
}
