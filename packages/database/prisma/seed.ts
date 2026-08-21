import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, SourceType } from "@prisma/client";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(rootDir, ".env") });

const prisma = new PrismaClient();

const sources: Array<{
  name: string;
  type: SourceType;
  baseUrl: string;
}> = [
  {
    name: "FANZA",
    type: SourceType.FANZA,
    baseUrl: "https://www.dmm.co.jp",
  },
  {
    name: "TikTok",
    type: SourceType.TIKTOK,
    baseUrl: "https://www.tiktok.com",
  },
  {
    name: "X",
    type: SourceType.X,
    baseUrl: "https://x.com",
  },
];

async function seedAffiliateProvider(): Promise<void> {
  await prisma.affiliateProviderRegistry.upsert({
    where: { providerKey: "mock-affiliate" },
    create: {
      providerKey: "mock-affiliate",
      displayName: "Mock Affiliate Provider",
      capabilities: {
        apiSearch: true,
        apiProductFetch: true,
        productFeed: false,
        manualImport: true,
        htmlFetch: false,
        affiliateLinkGeneration: true,
        conversionReport: false,
      },
      isActive: true,
      metadata: { purpose: "lifecycle-tests", family: "mock" },
    },
    update: {
      displayName: "Mock Affiliate Provider",
      capabilities: {
        apiSearch: true,
        apiProductFetch: true,
        productFeed: false,
        manualImport: true,
        htmlFetch: false,
        affiliateLinkGeneration: true,
        conversionReport: false,
      },
      isActive: true,
    },
  });

  // Preferred affiliate provider key is `fanza` (FANZA adult under DMM family).
  // Distinct from dmm-general / DMM通販 — do not mix product domains.
  await prisma.affiliateProviderRegistry.upsert({
    where: { providerKey: "fanza" },
    create: {
      providerKey: "fanza",
      displayName: "FANZA (DMM Adult)",
      capabilities: {
        apiSearch: true,
        apiProductFetch: true,
        productFeed: false,
        manualImport: true,
        htmlFetch: false,
        affiliateLinkGeneration: true,
        conversionReport: false,
      },
      isActive: true,
      metadata: {
        family: "dmm",
        site: "fanza",
        brand: "FANZA",
        operator: "DMM.com",
        serviceDomains: ["digital", "mono", "monthly", "doujin", "videoc"],
        defaultService: "digital",
        defaultFloor: "videoa",
        locale: "ja-JP",
        adultCatalog: true,
        excludesSiteKeys: ["dmm-general", "dmm-tsuhan"],
        notes:
          "PREFERRED_AFFILIATE_PROVIDER=fanza means FANZA adult catalog pages, not DMM通販.",
      },
    },
    update: {
      displayName: "FANZA (DMM Adult)",
      isActive: true,
      metadata: {
        family: "dmm",
        site: "fanza",
        brand: "FANZA",
        operator: "DMM.com",
        serviceDomains: ["digital", "mono", "monthly", "doujin", "videoc"],
        defaultService: "digital",
        defaultFloor: "videoa",
        locale: "ja-JP",
        adultCatalog: true,
        excludesSiteKeys: ["dmm-general", "dmm-tsuhan"],
        notes:
          "PREFERRED_AFFILIATE_PROVIDER=fanza means FANZA adult catalog pages, not DMM通販.",
      },
    },
  });

  await prisma.affiliateProviderRegistry.upsert({
    where: { providerKey: "dmm-general" },
    create: {
      providerKey: "dmm-general",
      displayName: "DMM通販 / General (non-FANZA catalog)",
      capabilities: {
        apiSearch: false,
        apiProductFetch: false,
        productFeed: false,
        manualImport: true,
        htmlFetch: false,
        affiliateLinkGeneration: false,
        conversionReport: false,
      },
      isActive: false,
      metadata: {
        family: "dmm",
        site: "dmm-general",
        brand: "DMM",
        adultCatalog: false,
        relatedButDistinctFrom: ["fanza"],
        notes: "Sibling DMM family provider. Never share productMatchKey with fanza items.",
      },
    },
    update: {
      displayName: "DMM通販 / General (non-FANZA catalog)",
      isActive: false,
    },
  });
}

async function seedPolicyRules(): Promise<void> {
  const rules = [
    {
      policyType: "adult",
      scope: "content",
      ruleIdentifier: "adult-flag-required",
      severity: "BLOCKING" as const,
      condition: { check: "adultFlag", requireAdultFlag: true },
      resultOnMatch: "BLOCKED" as const,
      message: "Adult catalog content requires adultFlag=true",
    },
    {
      policyType: "disclosure",
      scope: "content",
      ruleIdentifier: "affiliate-disclosure-required",
      severity: "WARNING" as const,
      condition: { check: "disclosure" },
      resultOnMatch: "WARNING" as const,
      message: "Affiliate disclosure should be present in body or structured content",
    },
    {
      policyType: "language",
      scope: "content",
      ruleIdentifier: "primary-language-ja",
      severity: "WARNING" as const,
      condition: { check: "language", expected: "ja" },
      resultOnMatch: "WARNING" as const,
      message: "Primary language should be Japanese (ja)",
    },
    {
      policyType: "adult",
      scope: "content",
      ruleIdentifier: "no-minor-keywords",
      severity: "BLOCKING" as const,
      condition: { check: "noMinorKeywords" },
      resultOnMatch: "BLOCKED" as const,
      message: "Title/body must not contain minor-related keywords",
    },
  ];

  for (const rule of rules) {
    await prisma.policyRule.upsert({
      where: {
        ruleIdentifier_ruleVersion: {
          ruleIdentifier: rule.ruleIdentifier,
          ruleVersion: "v1",
        },
      },
      create: {
        policyType: rule.policyType,
        scope: rule.scope,
        ruleIdentifier: rule.ruleIdentifier,
        ruleVersion: "v1",
        severity: rule.severity,
        enabled: true,
        condition: rule.condition,
        resultOnMatch: rule.resultOnMatch,
        message: rule.message,
      },
      update: {
        policyType: rule.policyType,
        scope: rule.scope,
        severity: rule.severity,
        enabled: true,
        condition: rule.condition,
        resultOnMatch: rule.resultOnMatch,
        message: rule.message,
      },
    });
  }
}

async function seedBudgetSettings(): Promise<void> {
  const budgets = [
    {
      scopeType: "DAILY" as const,
      softLimit: 100_000,
      hardLimit: 200_000,
      warningThreshold: 0.7,
      stopThreshold: 0.95,
    },
    {
      scopeType: "MONTHLY" as const,
      softLimit: 1_000_000,
      hardLimit: 2_000_000,
      warningThreshold: 0.7,
      stopThreshold: 0.95,
    },
  ];

  for (const budget of budgets) {
    await prisma.budgetSetting.upsert({
      where: {
        scopeType_currency: {
          scopeType: budget.scopeType,
          currency: "JPY",
        },
      },
      create: {
        ...budget,
        currency: "JPY",
        enabled: true,
      },
      update: {
        softLimit: budget.softLimit,
        hardLimit: budget.hardLimit,
        warningThreshold: budget.warningThreshold,
        stopThreshold: budget.stopThreshold,
        enabled: true,
      },
    });
  }
}

async function seedPromptDefinition(): Promise<void> {
  const prompts: Array<{
    identifier: string;
    taskType: string;
    body: string;
    systemInstruction: string;
  }> = [
    {
      identifier: "lifecycle.content.draft",
      taskType: "GENERATION",
      body: "Generate an abstract Japanese catalog overview with affiliate disclosure. Use only provided product fields.",
      systemInstruction: "Return abstract catalog copy only. No invented claims.",
    },
    {
      identifier: "strategy.assist",
      taskType: "STRATEGY",
      body: "Assist strategy for {{productTitle}}",
      systemInstruction: "Help draft strategy fields. Return JSON only.",
    },
    {
      identifier: "blogger.generate",
      taskType: "GENERATION_BLOGGER",
      body: "Generate structured blogger article for {{productTitle}} with CTA {{ctaUrl}}. Use only supported claims: {{supportedClaims}}. Format={{articleFormat}}. Avoid purple prose and unverified superlatives.",
      systemInstruction:
        "Write natural Japanese informational prose. Lead with useful facts. Distinguish facts vs opinions. Do not invent claims. Return JSON matching the blogger article schema.",
    },
    {
      identifier: "x.generate",
      taskType: "GENERATION_X",
      body: "Generate an X post for {{productTitle}}. Prefer bloggerUrl={{bloggerUrl}} else productUrl={{productUrl}}. Keep within Japanese weighted 140 chars. No low-value replies.",
      systemInstruction:
        "Return JSON {body, reply, usedClaimIds, ctaUrl}. body must fit X weighted length.",
    },
    {
      identifier: "review.claim",
      taskType: "REVIEW",
      body: "Validate claims in title={{title}} body={{body}}",
      systemInstruction: "Return JSON review result for claim consistency.",
    },
    {
      identifier: "review.factual",
      taskType: "REVIEW",
      body: "Factual review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for factual consistency.",
    },
    {
      identifier: "review.seo",
      taskType: "REVIEW",
      body: "SEO basic review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for basic SEO.",
    },
    {
      identifier: "review.channel-fit",
      taskType: "REVIEW",
      body: "Channel fit review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for Blogger readiness.",
    },
    {
      identifier: "review.adult-policy",
      taskType: "REVIEW",
      body: "Adult policy review for {{title}} / {{body}}",
      systemInstruction: "Return JSON review result for adult policy compliance.",
    },
    {
      identifier: "review.writing-quality",
      taskType: "REVIEW",
      body: "Writing quality review for {{title}} / {{body}}",
      systemInstruction: "Flag repetitive AI phrasing and empty intros. Return JSON review result.",
    },
    {
      identifier: "revision.partial",
      taskType: "REVISION",
      body: "Partially revise article title={{title}} body={{body}} rationale={{rationale}}",
      systemInstruction: "Return a revised blogger article JSON. Keep claim fidelity.",
    },
    {
      identifier: "revision.full",
      taskType: "REVISION",
      body: "Fully regenerate article for {{productTitle}}",
      systemInstruction: "Return a full blogger article JSON regeneration.",
    },
  ];

  for (const prompt of prompts) {
    await prisma.promptDefinition.upsert({
      where: {
        identifier_version: {
          identifier: prompt.identifier,
          version: "v1",
        },
      },
      create: {
        identifier: prompt.identifier,
        version: "v1",
        taskType: prompt.taskType,
        body: prompt.body,
        systemInstruction: prompt.systemInstruction,
        inputTemplate: prompt.body,
        enabled: true,
        metadata: { p45: true, sample: prompt.identifier === "lifecycle.content.draft" },
      },
      update: {
        taskType: prompt.taskType,
        body: prompt.body,
        systemInstruction: prompt.systemInstruction,
        inputTemplate: prompt.body,
        enabled: true,
        metadata: { p45: true, sample: prompt.identifier === "lifecycle.content.draft" },
      },
    });
  }
}

async function seedAdminBootstrap(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    console.log("Skipped AdminUser bootstrap (ADMIN_BOOTSTRAP_EMAIL/PASSWORD not set).");
    return;
  }
  const { randomBytes, scryptSync } = await import("node:crypto");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const passwordHash = `scrypt$${salt}$${hash}`;
  await prisma.adminUser.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      displayName: "Bootstrap Admin",
      passwordHash,
      role: "ADMIN",
      active: true,
    },
    update: {
      passwordHash,
      role: "ADMIN",
      active: true,
    },
  });

  await prisma.providerMappingProfile.upsert({
    where: { profileKey: "generic" },
    create: {
      profileKey: "generic",
      provider: "generic",
      label: "Generic Affiliate Result CSV",
      isSample: true,
      columnMapping: {
        externalOrderId: "order_id",
        productMatchKey: "product_id",
        amount: "amount",
        currency: "currency",
        status: "status",
        occurredAt: "occurred_at",
      },
      statusMapping: { approved: "APPROVED", pending: "PENDING" },
      currencyMapping: { jpy: "JPY", yen: "JPY" },
      dateFormat: "ISO8601",
      notes: "SAMPLE profile — not a production ASP specification",
    },
    update: {
      isSample: true,
      notes: "SAMPLE profile — not a production ASP specification",
    },
  });

  await prisma.providerMappingProfile.upsert({
    where: { profileKey: "fanza-manual-placeholder" },
    create: {
      profileKey: "fanza-manual-placeholder",
      provider: "fanza",
      label: "FANZA Manual Placeholder (sample)",
      isSample: true,
      columnMapping: {
        externalOrderId: "注文ID",
        productMatchKey: "品番",
        amount: "報酬額",
        status: "確定区分",
        occurredAt: "発生日",
      },
      statusMapping: { 確定: "APPROVED", 未確定: "PENDING" },
      currencyMapping: { 円: "JPY" },
      dateFormat: "YYYY-MM-DD",
      notes:
        "SAMPLE placeholder only — real FANZA CSV columns are NOT finalized; do not treat as official spec",
    },
    update: {
      isSample: true,
      notes:
        "SAMPLE placeholder only — real FANZA CSV columns are NOT finalized; do not treat as official spec",
    },
  });

  console.log(`Seeded AdminUser ${email} (password hashed; plaintext never stored).`);
}

async function main(): Promise<void> {
  for (const source of sources) {
    await prisma.researchSource.upsert({
      where: { name: source.name },
      create: {
        name: source.name,
        type: source.type,
        baseUrl: source.baseUrl,
        isActive: true,
      },
      update: {
        type: source.type,
        baseUrl: source.baseUrl,
        isActive: true,
      },
    });
  }

  await seedAffiliateProvider();
  await seedPolicyRules();
  await seedBudgetSettings();
  await seedPromptDefinition();
  await seedAdminBootstrap();

  console.log(`Seeded ${sources.length} research sources.`);
  console.log(
    "Seeded mock-affiliate + fanza + dmm-general providers, policy rules, budget settings, P4.5 PromptDefinitions, and P7 admin bootstrap.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
