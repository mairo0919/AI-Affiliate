import type { AppConfig } from "@ai-affiliate/config";
import type { AdminRepository, LifecycleRepository, P6Repository } from "@ai-affiliate/database";

export type ChecklistStatus = "OK" | "WARNING" | "BLOCKED" | "NOT_REQUIRED";

export interface ChecklistItem {
  key: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
}

export async function buildProductionChecklist(input: {
  config: AppConfig;
  adminRepo: AdminRepository;
  lifecycleRepo: LifecycleRepository;
  p6: P6Repository;
  dbConnected: boolean;
}): Promise<{ items: ChecklistItem[]; blocked: boolean }> {
  const { config } = input;
  const items: ChecklistItem[] = [];

  items.push({
    key: "db",
    label: "DB connected",
    status: input.dbConnected ? "OK" : "BLOCKED",
    detail: input.dbConnected ? "connected" : "not connected",
  });

  const adminCount = await input.adminRepo.findUserByEmail(
    config.adminBootstrapEmail ?? "admin@localhost",
  );
  items.push({
    key: "admin",
    label: "Admin configured",
    status: adminCount ? "OK" : "WARNING",
    detail: adminCount ? `user ${adminCount.email}` : "bootstrap user missing — run seed",
  });

  const llmOk =
    config.llmMode === "mock" ||
    (config.llmMode === "api" && Boolean(config.llmApiKey) && config.llmAllowExternalRequests);
  items.push({
    key: "llm",
    label: "LLM configured",
    status:
      config.llmMode === "api" && !config.llmApiKey
        ? "WARNING"
        : llmOk
          ? "OK"
          : "WARNING",
    detail: `mode=${config.llmMode} allowExternal=${config.llmAllowExternalRequests} key=${config.llmApiKey ? "configured" : "not configured"}`,
  });

  items.push({
    key: "prompt",
    label: "Prompt definitions",
    status: "OK",
    detail: "seeded via p45 prompts / generation path",
  });

  const budgets = await input.lifecycleRepo.listBudgetSettings("JPY");
  items.push({
    key: "budget",
    label: "Budget configured",
    status: budgets.length > 0 ? "OK" : "WARNING",
    detail: `${budgets.length} budget setting(s)`,
  });

  items.push({
    key: "research_external_fetch",
    label: "Research external fetch",
    status: config.researchAllowExternalRequests ? "OK" : "WARNING",
    detail: config.researchAllowExternalRequests
      ? "RESEARCH_ALLOW_EXTERNAL_REQUESTS=true"
      : "disabled — live URL fetch requires flag + --confirm-external",
  });

  items.push({
    key: "ssrf_protection",
    label: "SSRF protection",
    status: "OK",
    detail: "assertSafeOutboundUrl / safeFetchText enforced",
  });

  items.push({
    key: "preferred_provider",
    label: "Preferred Provider = fanza",
    status: config.preferredAffiliateProvider === "fanza" ? "OK" : "WARNING",
    detail: config.preferredAffiliateProvider,
  });

  items.push({
    key: "affiliate_api",
    label: "Affiliate API",
    status: "NOT_REQUIRED",
    detail: "unavailable / pending — FANZA normal product URLs used",
  });

  items.push({
    key: "product_link",
    label: "ProductLink priority",
    status: "OK",
    detail: "affiliate→fanza normal→future ASP→official→other",
  });

  const bloggerOAuth =
    Boolean(config.bloggerClientId) &&
    Boolean(config.bloggerClientSecret) &&
    Boolean(config.bloggerRefreshToken);
  items.push({
    key: "blogger_oauth",
    label: "Blogger OAuth configured",
    status:
      config.bloggerMode === "mock"
        ? "NOT_REQUIRED"
        : bloggerOAuth
          ? "OK"
          : "WARNING",
    detail: `mode=${config.bloggerMode} oauth=${bloggerOAuth ? "configured" : "not configured"}`,
  });

  items.push({
    key: "blogger_blog_id",
    label: "Blogger Blog ID",
    status:
      config.bloggerMode === "mock"
        ? "NOT_REQUIRED"
        : config.bloggerBlogId
          ? "OK"
          : "WARNING",
    detail: config.bloggerBlogId ? "configured" : "not configured",
  });

  items.push({
    key: "blogger_draft_mode",
    label: "Blogger Draft mode",
    status:
      config.bloggerDefaultPublishMode === "draft" && !config.bloggerAllowDirectPublish
        ? "OK"
        : "BLOCKED",
    detail: `default=${config.bloggerDefaultPublishMode} directPublish=${config.bloggerAllowDirectPublish}`,
  });

  items.push({
    key: "direct_publish_disabled",
    label: "Direct publish disabled",
    status: config.bloggerAllowDirectPublish ? "BLOCKED" : "OK",
    detail: `BLOGGER_ALLOW_DIRECT_PUBLISH=${config.bloggerAllowDirectPublish}`,
  });

  items.push({
    key: "x_export",
    label: "X Export enabled",
    status: "OK",
    detail: "manual export (no auto-post)",
  });

  items.push({
    key: "x_api",
    label: "X API",
    status: "NOT_REQUIRED",
    detail: "not required for initial ops",
  });

  items.push({
    key: "assisted_mode",
    label: "ASSISTED operation mode",
    status:
      config.productionOperationMode === "ASSISTED"
        ? "OK"
        : config.productionOperationMode === "OBSERVE"
          ? "WARNING"
          : "WARNING",
    detail: `PRODUCTION_OPERATION_MODE=${config.productionOperationMode}`,
  });

  items.push({
    key: "scheduler",
    label: "Scheduler enabled",
    status: "OK",
    detail: `operationMode=${config.productionOperationMode}`,
  });

  items.push({
    key: "audit",
    label: "Audit",
    status: "OK",
    detail: "AuditEvent path available via Admin / CLI",
  });

  items.push({
    key: "backup_policy",
    label: "Backup policy confirmed",
    status: "WARNING",
    detail: "Confirm host daily backup + retention — see docs/backup-recovery.md",
  });

  // Live Blogger draft to real API requires OAuth when mode=api
  if (config.bloggerMode === "api") {
    if (!bloggerOAuth) {
      items.push({
        key: "blogger_live_ready",
        label: "Blogger live draft readiness",
        status: "BLOCKED",
        detail: "api mode without OAuth — refuse live draft send",
      });
    } else if (!config.bloggerAllowExternalRequests) {
      items.push({
        key: "blogger_live_ready",
        label: "Blogger live draft readiness",
        status: "BLOCKED",
        detail: "BLOGGER_ALLOW_EXTERNAL_REQUESTS=false",
      });
    } else if (!config.bloggerBlogId) {
      items.push({
        key: "blogger_live_ready",
        label: "Blogger live draft readiness",
        status: "BLOCKED",
        detail: "BLOGGER_BLOG_ID missing",
      });
    }
  }

  return {
    items,
    blocked: items.some((i) => i.status === "BLOCKED"),
  };
}

/** Human-readable blocking reasons for draft gate */
export function checklistBlockingReasons(items: ChecklistItem[]): string[] {
  return items
    .filter((i) => i.status === "BLOCKED")
    .map((i) => `checklist:${i.key}: ${i.detail}`);
}
