import { loadConfig } from "@ai-affiliate/config";
import {
  createAdminStack,
  enrichProposedRule,
  previewAnalyticsImport,
} from "@ai-affiliate/content-operator/admin";
import { createAdminApp } from "./app.js";
import { ScryptAuthAdapter, ensureBootstrapAdmin, seedDefaultSettings } from "./auth.js";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export async function runP7Vertical(): Promise<Record<string, unknown>> {
  loadConfig({ requireDatabaseUrl: false });
  process.env.ADMIN_BOOTSTRAP_EMAIL ??= "admin@localhost";
  process.env.ADMIN_BOOTSTRAP_PASSWORD ??= "change-me-admin";

  const stack = await createAdminStack();
  const auth = new ScryptAuthAdapter();
  await ensureBootstrapAdmin(stack, auth);
  await seedDefaultSettings(stack);

  // Seed reviewer / operator / viewer for RBAC checks inside vertical
  await stack.adminRepo.upsertUser({
    email: "reviewer@localhost",
    displayName: "Reviewer",
    passwordHash: auth.hashPassword("reviewer-pass"),
    role: "REVIEWER",
  });
  await stack.adminRepo.upsertUser({
    email: "operator@localhost",
    displayName: "Operator",
    passwordHash: auth.hashPassword("operator-pass"),
    role: "OPERATOR",
  });
  await stack.adminRepo.upsertUser({
    email: "viewer@localhost",
    displayName: "Viewer",
    passwordHash: auth.hashPassword("viewer-pass"),
    role: "VIEWER",
  });

  const app = await createAdminApp(stack);

  // 1) Login
  const login = await json<{ token: string; user: { role: string } }>(
    await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@localhost",
        password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
      }),
    }),
  );
  const headers = {
    authorization: `Bearer ${login.token}`,
    "content-type": "application/json",
    "x-correlation-id": `p7-${Date.now()}`,
  };

  // Create content via repositories for review queue
  const topic = await stack.lifecycleRepo.createTopicCandidate({
    title: "P7 Admin Vertical Topic",
    summary: "ops console vertical",
    formatCategory: "ARTICLE",
    metadata: { source: "p7-vertical" },
  });
  const strategy = await stack.lifecycleRepo.createStrategy({
    topicCandidateId: topic.id,
    objective: "P7 vertical strategy",
    targetAudience: "ops",
    userIntent: "review",
    formatCategory: "ARTICLE",
    formatKey: "blogger-article",
    angle: "ops",
    primaryChannel: "BLOGGER",
    candidateChannels: ["BLOGGER", "X"],
    requiredClaims: [],
    requiredResearch: [],
    successMetrics: {},
    riskFlags: [],
  });
  const content = await stack.lifecycleRepo.createContent({
    topicCandidateId: topic.id,
    strategyId: strategy.id,
  });
  const claim = await stack.lifecycleRepo.createClaim({
    statement: "Supported claim for P7",
    claimType: "FACT",
    status: "SUPPORTED",
    strategyId: strategy.id,
  });
  const productUrl = "https://example.invalid/normal/product-p7";
  const version = await stack.lifecycleRepo.createContentVersion({
    contentId: content.id,
    versionNumber: 1,
    revisionType: "initial",
    title: "P7 Review Article",
    summary: "summary",
    body: `Body with ${productUrl} CTA`,
    status: "REVIEWING",
    createdBy: "p7-vertical",
  });
  await stack.lifecycleRepo.attachVersionClaim({
    contentVersionId: version.id,
    claimId: claim.id,
    usageType: "body",
  });
  await stack.lifecycleRepo.createReview({
    reviewType: "claim",
    reviewerType: "SYSTEM",
    targetType: "ContentVersion",
    targetId: version.id,
    contentVersionId: version.id,
    criteria: { canonical: true },
    result: "PASSED",
    findings: [],
    score: 1,
  });
  const originalBody = version.body;

  // 2-3) Review queue + detail
  const queue = await json<{ items: Array<{ id: string }> }>(
    await app.request("/content-versions?status=REVIEWING", { headers }),
  );
  if (!queue.items.some((i) => i.id === version.id)) {
    throw new Error("Content Review Queue missing version");
  }
  const detail = await json<{ id: string; isLatest: boolean; bodyPreview: string }>(
    await app.request(`/content-versions/${version.id}`, { headers }),
  );
  if (!detail.isLatest) throw new Error("Expected latest version");

  // 4) Human approve
  await json(
    await app.request(`/content-versions/${version.id}/review`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "approve", reason: "looks good" }),
    }),
  );

  // 5) Publication approve
  const pub = await stack.lifecycle.createPublicationTarget({
    contentId: content.id,
    contentVersionId: version.id,
    platform: "BLOGGER",
    approvalMode: "MANUAL",
  });
  await stack.lifecycleRepo.updatePublicationTarget(pub.id, { status: "AWAITING_APPROVAL" });
  await json(
    await app.request(`/publications/${pub.id}/approve`, { method: "POST", headers }),
  );

  // 6) Mock Blogger draft
  const drafted = await json<{ id: string; publishedExternalId: string | null }>(
    await app.request(`/publications/${pub.id}/blogger-draft`, {
      method: "POST",
      headers,
    }),
  );
  if (!drafted.publishedExternalId) throw new Error("Expected mock draft external id");

  // 7-8) Analytics preview + import (unique rows each run to avoid duplicate-file short-circuit)
  const unmatchedExternalId = `unknown-ext-${Date.now()}`;
  const csv = [
    "externalId,platform,measuredAt,impressions,views,clicks,likes",
    `${drafted.publishedExternalId},BLOGGER,2026-07-31T02:00:00.000Z,500,200,10,2`,
    `${unmatchedExternalId},BLOGGER,2026-07-31T02:00:00.000Z,10,5,1,0`,
  ].join("\n");
  const preview = previewAnalyticsImport({ format: "csv", content: csv, platform: "BLOGGER" });
  await json(
    await app.request("/analytics/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ format: "csv", content: csv, platform: "BLOGGER" }),
    }),
  );
  await json(
    await app.request("/analytics/import", {
      method: "POST",
      headers,
      body: JSON.stringify({
        format: "csv",
        content: csv,
        platform: "BLOGGER",
        confirmPreviewHash: preview.fileHash,
      }),
    }),
  );

  // 9-10) unmatched + manual match
  const attrs = await json<{ items: Array<{ id: string; status: string; importRowId: string | null }> }>(
    await app.request("/analytics-attributions", { headers }),
  );
  const unmatched = attrs.items.find((a) => a.status === "unmatched");
  if (!unmatched) throw new Error("Expected unmatched attribution");
  await json(
    await app.request(`/analytics-attributions/${unmatched.id}/match`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contentId: content.id,
        publicationTargetId: drafted.id,
        contentVersionId: version.id,
      }),
    }),
  );

  // 11) Evaluation
  const aggregate = await stack.learning.aggregateAnalytics({
    contentId: content.id,
    platform: "BLOGGER",
    contentVersionId: version.id,
    publicationTargetId: drafted.id,
  });
  const evaluation = await stack.learning.evaluateContent({
    contentId: content.id,
    contentVersionId: version.id,
    analyticsAggregateId: aggregate.id,
    platform: "BLOGGER",
    useLlm: false,
  });
  const evals = await json<{ items: Array<{ id: string }> }>(
    await app.request("/evaluations", { headers }),
  );
  if (!evals.items.some((e) => e.id === evaluation.id)) {
    throw new Error("Evaluation not listed");
  }

  // 12-14) LearningRule approve + conflict + activate
  const rules = await stack.learning.generateLearning({
    evaluationIds: [evaluation.id],
    activate: false,
  });
  const rule = rules[0]!;
  await enrichProposedRule(stack.p6, rule.id, {
    platform: "BLOGGER",
    contentType: "article",
    minimumSampleCount: 1,
    minimumConfidence: 0.3,
    minimumSuccessRate: 0.3,
  });
  await json(
    await app.request(`/learning-rules/${rule.id}/approve`, { method: "POST", headers }),
  );
  await json(await app.request("/learning-conflicts/detect", { method: "POST", headers }));
  const conflicts = await json<{ items: unknown[] }>(
    await app.request("/learning-conflicts", { headers }),
  );
  await json(
    await app.request(`/learning-rules/${rule.id}/activate`, { method: "POST", headers }),
  );

  // 15-16) Strategy with feedback + applications
  const generated = await stack.strategyFeedback.generate({
    topicCandidateId: topic.id,
    platform: "BLOGGER",
    contentType: "article",
    evaluationIds: [evaluation.id],
  });
  const ruleDetail = await json<{ applications: unknown[] }>(
    await app.request(`/learning-rules/${rule.id}`, { headers }),
  );

  // 17-20) Affiliate replacement approve → apply → new version + event
  const product = await stack.lifecycleRepo.upsertAffiliateProduct({
    providerKey: "fanza",
    externalProductId: `p7-${Date.now()}`,
    title: "P7 Product",
    url: productUrl,
    availability: "AVAILABLE",
    normalized: { title: "P7 Product" },
  });
  const [link] = await stack.lifecycleRepo.replaceProductLinksForProduct(product.id, [
    {
      affiliateProductId: product.id,
      productMatchKey: `fanza:${product.externalProductId}`,
      url: productUrl,
      preferredAffiliateProvider: "fanza",
      currentLinkProvider: "fanza",
      currentLinkType: "PROVIDER_PRODUCT",
      replacePriority: 2,
      availability: "AVAILABLE",
      isSelected: true,
      replacementStatus: "AWAITING_PROVIDER",
    },
  ]);
  const replacement = await stack.linkReplacement.propose({
    productLinkId: link!.id,
    contentId: content.id,
    sourceContentVersionId: version.id,
    sourcePublicationTargetId: drafted.id,
    previousUrl: productUrl,
    nextUrl: "https://example.invalid/affiliate/product-p7?aff=1",
    changeReason: "affiliate ready",
    matchConfidence: 0.9,
    matchedProvider: "fanza",
    candidateAffiliateProductId: product.id,
  });
  await json(
    await app.request(`/link-replacements/${replacement.id}/approve`, {
      method: "POST",
      headers,
    }),
  );
  const applied = await json<{ newContentVersionId: string | null; event: { id: string } }>(
    await app.request(`/link-replacements/${replacement.id}/apply`, {
      method: "POST",
      headers,
    }),
  );
  if (!applied.newContentVersionId) throw new Error("Expected new ContentVersion from apply");

  // 21) Job resume path — create MANUAL_REVIEW job then resume
  const partial = await stack.orchestration.runCycle({
    cycleType: "daily_ops",
    idempotencyKey: `p7-job-${Date.now()}`,
    payload: {
      humanApproved: false,
      productTitle: "P7 Job Product",
      productUrl: "https://example.invalid/fanza/p7-job",
      externalProductId: `p7-job-${Date.now()}`,
    },
  });
  if (partial.status === "MANUAL_REVIEW_REQUIRED") {
    await stack.database.prisma.operationJob.update({
      where: { id: partial.id },
      data: {
        status: "PENDING",
        payload: {
          ...((partial.payload as Record<string, unknown>) ?? {}),
          humanApproved: true,
          activateLearning: false,
        },
      },
    });
    await json(
      await app.request(`/operation-jobs/${partial.id}/resume`, { method: "POST", headers }),
    );
  }

  // 22) Audit
  const audits = await json<{ items: Array<{ action: string }> }>(
    await app.request("/audit-events?action=approve", { headers }),
  );
  if (audits.items.length < 1) throw new Error("Expected audit events");

  // 23) Original version immutable
  const still = await stack.lifecycleRepo.findContentVersion(version.id);
  if (still?.body !== originalBody) {
    throw new Error("Original ContentVersion body was mutated");
  }

  // Secrets not exposed
  const settings = await json<{ secrets: Array<{ key: string; configured: boolean }> }>(
    await app.request("/settings", { headers }),
  );
  const settingsRaw = JSON.stringify(settings);
  // Key names like BLOGGER_REFRESH_TOKEN may appear as status labels; ban value-shaped secrets only.
  if (
    /"sk-[A-Za-z0-9]{10,}"/i.test(settingsRaw) ||
    /"refresh_token"\s*:\s*"[^"]+"/i.test(settingsRaw) ||
    /BEGIN PRIVATE KEY/i.test(settingsRaw)
  ) {
    throw new Error("Secrets leaked in settings response");
  }

  // VIEWER write denied
  const viewerLogin = await json<{ token: string }>(
    await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "viewer@localhost", password: "viewer-pass" }),
    }),
  );
  const denied = await app.request(`/content-versions/${version.id}/review`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${viewerLogin.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ decision: "reject", reason: "nope" }),
  });
  if (denied.status !== 403) throw new Error(`Expected 403 for VIEWER, got ${denied.status}`);

  await stack.disconnect();

  return {
    loginRole: login.user.role,
    contentVersionId: version.id,
    publicationTargetId: drafted.id,
    evaluationId: evaluation.id,
    learningRuleId: rule.id,
    conflictsSeen: conflicts.items.length,
    nextStrategyId: generated.strategy.id,
    applications: ruleDetail.applications.length,
    newContentVersionId: applied.newContentVersionId,
    linkReplacementEventId: applied.event.id,
    originalBodyUnchanged: true,
    viewerWriteDenied: true,
    secretsConfiguredOnly: settings.secrets.every((s) => typeof s.configured === "boolean"),
  };
}

async function main(): Promise<void> {
  const result = await runP7Vertical();
  console.log(JSON.stringify(result, null, 2));
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("p7-vertical.js") || entry.endsWith("p7-vertical.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
