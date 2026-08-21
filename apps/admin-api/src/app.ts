import { Hono } from "hono";
import { cors } from "hono/cors";
import { assistedModeAllows, validateProductionConfig } from "@ai-affiliate/config";
import type { AdminPermission, AdminRole } from "@ai-affiliate/admin-contracts";
import type { AdminStack } from "@ai-affiliate/content-operator/admin";
import {
  buildProductionChecklist,
  previewAnalyticsImport,
} from "@ai-affiliate/content-operator/admin";
import {
  ScryptAuthAdapter,
  ensureBootstrapAdmin,
  login,
  requirePermission,
  requireSession,
  secretStatus,
  seedDefaultSettings,
  toUserDto,
} from "./auth.js";
import { AdminHttpError, correlationMiddleware, mapError } from "./errors.js";
import {
  mapAttribution,
  mapAudit,
  mapConflict,
  mapContentVersionDetail,
  mapContentVersionListItem,
  mapExperiment,
  mapLearningRule,
  mapLinkReplacement,
  mapMappingProfile,
  mapOperationJob,
  mapPublicationTarget,
  mapResearchJob,
  mapSetting,
} from "./mappers.js";
import {
  LoginAttemptTracker,
  rateLimitMiddleware,
  securityHeadersMiddleware,
} from "./security.js";

type Variables = {
  correlationId: string;
  user: ReturnType<typeof toUserDto>;
  role: AdminRole;
  sessionId: string;
};

export async function createAdminApp(stack: AdminStack): Promise<Hono<{ Variables: Variables }>> {
  const auth = new ScryptAuthAdapter();
  const loginTracker = new LoginAttemptTracker(
    stack.config.adminLoginMaxAttempts,
    stack.config.adminLoginWindowMinutes,
  );
  await ensureBootstrapAdmin(stack, auth);
  await seedDefaultSettings(stack);

  const app = new Hono<{ Variables: Variables }>();
  const corsOrigin = stack.config.adminCorsOrigin;
  if ((process.env.NODE_ENV ?? "").toLowerCase() === "production" && corsOrigin === "*") {
    throw new Error("ADMIN_CORS_ORIGIN=* forbidden in production");
  }
  app.use("*", cors({ origin: corsOrigin, credentials: true }));
  app.use("*", correlationMiddleware());
  app.use("*", securityHeadersMiddleware());
  app.use("*", rateLimitMiddleware(stack.config));

  app.onError((err, c) => {
    const correlationId = c.get("correlationId") ?? "unknown";
    const mapped = mapError(err, correlationId);
    return c.json(mapped.body, mapped.status as 400);
  });

  const authed = async (
    c: { req: { header: (n: string) => string | undefined }; set: (k: string, v: unknown) => void },
    permission?: AdminPermission,
  ) => {
    const session = await requireSession(stack, c.req.header("authorization"));
    if (permission) requirePermission(session.role, permission);
    c.set("user", session.user);
    c.set("role", session.role);
    c.set("sessionId", session.sessionId);
    return session;
  };

  app.get("/health", (c) => c.json({ ok: true, service: "admin-api" }));

  app.get("/production/checklist", async (c) => {
    await authed(c, "read");
    const checklist = await buildProductionChecklist({
      config: stack.config,
      adminRepo: stack.adminRepo,
      lifecycleRepo: stack.lifecycleRepo,
      p6: stack.p6,
      dbConnected: true,
    });
    return c.json(checklist);
  });

  app.get("/ready", async (c) => {
    try {
      await stack.database.prisma.$queryRaw`SELECT 1`;
      const validation = validateProductionConfig(stack.config);
      return c.json({
        ready: true,
        db: true,
        llmMode: stack.config.llmMode,
        usingMockLlm: stack.usingMockLlm,
        bloggerMode: stack.config.bloggerMode,
        usingMockBlogger: stack.usingMockBlogger,
        operationMode: stack.config.productionOperationMode,
        productionIssues: validation.issues,
      });
    } catch (error) {
      return c.json(
        {
          ready: false,
          db: false,
          message: error instanceof Error ? error.message : "not ready",
        },
        503,
      );
    }
  });

  app.post("/auth/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    if (!body.email || !body.password) {
      throw new AdminHttpError("validation_error", "email and password required", 400);
    }
    try {
      loginTracker.assertAllowed(body.email);
      const session = await login(stack, auth, body.email, body.password);
      loginTracker.clear(body.email);
      return c.json(session);
    } catch (error) {
      loginTracker.recordFailure(body.email);
      if (error instanceof Error && /Too many login/.test(error.message)) {
        throw new AdminHttpError("permission_denied", error.message, 429);
      }
      throw error;
    }
  });

  app.post("/auth/logout", async (c) => {
    const session = await authed(c, "read");
    await stack.adminRepo.revokeSession(session.sessionId);
    return c.json({ ok: true });
  });

  app.get("/auth/me", async (c) => {
    const session = await authed(c, "read");
    return c.json({ user: session.user });
  });

  app.get("/dashboard", async (c) => {
    await authed(c, "read");
    const counts = await stack.adminRepo.dashboardCounts();
    return c.json({
      ...counts,
      budget: {
        currency: counts.budget.currency,
        spentToday: counts.budget.spentToday,
        hardLimit: counts.budget.hardLimit,
      },
    });
  });

  app.get("/content-versions", async (c) => {
    await authed(c, "read");
    const status = c.req.query("status") ?? "REVIEWING";
    const items = await stack.database.prisma.contentVersion.findMany({
      where: { status: status as never },
      orderBy: { createdAt: "desc" },
      take: Number(c.req.query("pageSize") ?? 20),
    });
    return c.json({
      items: items.map(mapContentVersionListItem),
      page: 1,
      pageSize: items.length,
      total: items.length,
    });
  });

  app.get("/content-versions/:id", async (c) => {
    await authed(c, "read");
    const id = c.req.param("id");
    const version = await stack.lifecycleRepo.findContentVersion(id);
    if (!version) throw new AdminHttpError("not_found", "ContentVersion not found", 404);
    const latest = await stack.lifecycleRepo.findLatestContentVersion(version.contentId);
    const reviews = await stack.lifecycleRepo.listReviewsForContentVersion(id);
    const detail = await stack.lifecycleRepo.inspectContentLifecycle(version.contentId);
    const full = detail?.versions.find((v) => v.id === id);
    const claimIds = (full?.versionClaims ?? []).map((vc) => vc.claim.id);
    const sources =
      claimIds.length > 0
        ? await stack.database.prisma.claimSource.findMany({
            where: { claimId: { in: claimIds } },
            take: 50,
          })
        : [];
    const claims = (full?.versionClaims ?? []).map((vc) => ({
      id: vc.claim.id,
      statement: vc.claim.statement,
      status: vc.claim.status,
      sources: sources
        .filter((s) => s.claimId === vc.claim.id)
        .map((s) => ({
          url: s.sourceLocation ?? null,
          label: s.excerptOrSummary.slice(0, 120),
        })),
    }));
    const policies = await stack.database.prisma.policyEvaluation.findMany({
      where: { targetId: id },
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    let parentDiffSummary: string | null = null;
    if (version.parentVersionId) {
      const parent = await stack.lifecycleRepo.findContentVersion(version.parentVersionId);
      if (parent) {
        const delta = version.body.length - parent.body.length;
        parentDiffSummary = `v${parent.versionNumber}→v${version.versionNumber}: length ${parent.body.length}→${version.body.length} (Δ${delta}), titleChanged=${parent.title !== version.title}`;
      }
    }
    return c.json(
      mapContentVersionDetail({
        version,
        isLatest: latest?.id === version.id,
        claims,
        reviews: reviews.map((r) => ({
          id: r.id,
          reviewType: r.reviewType,
          result: r.result,
          score: r.score,
          findings: r.findings,
        })),
        policyResults: policies.map((p) => ({
          result: p.result,
          message: typeof p.message === "string" ? p.message : null,
        })),
        parentDiffSummary,
      }),
    );
  });

  app.post("/content-versions/:id/quality-gate", async (c) => {
    await authed(c, "content:approve");
    const result = await stack.qualityGate.evaluate(c.req.param("id"), {
      minScore: stack.config.publicationMinimumQualityScore,
    });
    return c.json(result);
  });

  app.post("/content-versions/:id/review", async (c) => {
    const session = await authed(c, "content:approve");
    const body = await c.req.json<{
      decision: string;
      reason?: string;
    }>();
    const allowed = [
      "approve",
      "reject",
      "request_changes",
      "partial_revision",
      "full_regeneration",
      "additional_research",
      "abandon",
    ] as const;
    if (!allowed.includes(body.decision as (typeof allowed)[number])) {
      throw new AdminHttpError("validation_error", "invalid decision", 400);
    }
    if (
      ["reject", "abandon"].includes(body.decision) &&
      (!body.reason || body.reason.trim() === "")
    ) {
      throw new AdminHttpError("validation_error", "reason required for dangerous decision", 400);
    }
    const updated = await stack.contentReview.decide({
      contentVersionId: c.req.param("id"),
      decision: body.decision as (typeof allowed)[number],
      actor: session.user.email,
      reason: body.reason,
      correlationId: c.get("correlationId"),
    });
    await stack.adminRepo.createApprovalDecision({
      targetType: "ContentVersion",
      targetId: updated.id,
      decision: body.decision,
      reason: body.reason ?? null,
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      correlationId: c.get("correlationId"),
    });
    return c.json(mapContentVersionListItem(updated));
  });

  app.get("/publications", async (c) => {
    await authed(c, "read");
    const status = c.req.query("status");
    const items = await stack.database.prisma.publicationTarget.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({ items: items.map(mapPublicationTarget) });
  });

  app.get("/publications/:id", async (c) => {
    await authed(c, "read");
    const target = await stack.lifecycleRepo.findPublicationTarget(c.req.param("id"));
    if (!target) throw new AdminHttpError("not_found", "PublicationTarget not found", 404);
    const records = await stack.database.prisma.publicationRecord.findMany({
      where: { publicationTargetId: target.id },
      orderBy: { createdAt: "desc" },
    });
    return c.json({
      target: mapPublicationTarget(target),
      records: records.map((r) => ({
        id: r.id,
        status: r.status,
        externalId: r.externalId,
        url: r.url,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  app.post("/publications/:id/approve", async (c) => {
    const session = await authed(c, "publication:approve");
    const updated = await stack.lifecycle.approvePublicationTarget(c.req.param("id"));
    await stack.adminRepo.createApprovalDecision({
      targetType: "PublicationTarget",
      targetId: updated.id,
      decision: "approve",
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      correlationId: c.get("correlationId"),
    });
    await stack.p6.createAuditEvent({
      eventType: "publication.review",
      actor: session.user.email,
      targetType: "PublicationTarget",
      targetId: updated.id,
      action: "approve",
      summary: "PublicationTarget approved via Admin API",
    });
    return c.json(mapPublicationTarget(updated));
  });

  app.post("/publications/:id/reject", async (c) => {
    const session = await authed(c, "publication:approve");
    const body = await c.req.json<{ reason?: string }>();
    if (!body.reason?.trim()) {
      throw new AdminHttpError("validation_error", "reason required", 400);
    }
    const updated = await stack.lifecycleRepo.updatePublicationTarget(c.req.param("id"), {
      status: "REJECTED",
    });
    await stack.p6.createAuditEvent({
      eventType: "publication.review",
      actor: session.user.email,
      targetType: "PublicationTarget",
      targetId: updated.id,
      action: "reject",
      summary: body.reason,
    });
    return c.json(mapPublicationTarget(updated));
  });

  app.post("/publications/:id/blogger-draft", async (c) => {
    const session = await authed(c, "blogger:draft");
    if (!assistedModeAllows("blogger_draft", stack.config.productionOperationMode)) {
      throw new AdminHttpError(
        "policy_blocked",
        `PRODUCTION_OPERATION_MODE=${stack.config.productionOperationMode} forbids Blogger draft`,
        409,
      );
    }
    const targetId = c.req.param("id");
    // Idempotency: reuse existing draft external id when present
    const existing = await stack.lifecycleRepo.findPublicationTarget(targetId);
    if (existing?.publishedExternalId) {
      return c.json(mapPublicationTarget(existing));
    }
    if (!existing) {
      throw new AdminHttpError("not_found", "PublicationTarget not found", 404);
    }
    if (existing.status !== "APPROVED") {
      throw new AdminHttpError(
        "approval_required",
        "PublicationTarget must be APPROVED before Blogger draft in ASSISTED mode",
        409,
      );
    }
    const result = await stack.p45.createBloggerDraft({ publicationTargetId: targetId });
    await stack.p6.createAuditEvent({
      eventType: "publication.blogger",
      actor: session.user.email,
      targetType: "PublicationTarget",
      targetId: result.target.id,
      action: "create_draft",
      summary: `Blogger draft created (${result.mode})`,
      details: {
        externalId: result.externalId,
        mode: result.mode,
        mock: stack.usingMockBlogger,
      },
    });
    return c.json({
      ...mapPublicationTarget(result.target),
      publishedExternalId: result.externalId,
      publishedUrl: result.url,
    });
  });

  app.post("/publications/:id/x-export", async (c) => {
    const session = await authed(c, "x:export");
    const target = await stack.lifecycleRepo.findPublicationTarget(c.req.param("id"));
    if (!target) throw new AdminHttpError("not_found", "PublicationTarget not found", 404);
    const bloggerSibling = await stack.database.prisma.publicationTarget.findFirst({
      where: {
        contentId: target.contentId,
        platform: "BLOGGER",
        publishedUrl: { not: null },
      },
      orderBy: { updatedAt: "desc" },
    });
    const version = await stack.lifecycleRepo.findContentVersion(target.contentVersionId);
    if (!version) throw new AdminHttpError("not_found", "ContentVersion not found", 404);
    const { buildXExport } = await import("@ai-affiliate/content-operator/admin");
    const exported = buildXExport({
      contentId: target.contentId,
      version,
      target,
      bloggerUrl: bloggerSibling?.publishedUrl ?? null,
    });
    await stack.p6.createAuditEvent({
      eventType: "publication.x",
      actor: session.user.email,
      targetType: "ContentVersion",
      targetId: target.contentVersionId,
      action: "export",
      summary: "X export via Admin API",
    });
    return c.json({ ok: true, export: exported });
  });

  app.post("/publications/:id/register-external", async (c) => {
    const session = await authed(c, "publication:approve");
    const body = await c.req.json<{ externalUrl?: string; externalId?: string; platform?: string }>();
    if (!body.externalUrl?.trim()) {
      throw new AdminHttpError("validation_error", "externalUrl required", 400);
    }
    const target = await stack.lifecycleRepo.findPublicationTarget(c.req.param("id"));
    if (!target) throw new AdminHttpError("not_found", "PublicationTarget not found", 404);
    const updated = await stack.lifecycleRepo.updatePublicationTarget(target.id, {
      publishedUrl: body.externalUrl,
      publishedExternalId: body.externalId ?? target.publishedExternalId,
      status: "PUBLISHED",
      publishedAt: new Date(),
    });
    await stack.database.prisma.publicationRecord.create({
      data: {
        publicationTargetId: target.id,
        platform: target.platform,
        status: "PUBLISHED",
        externalId: body.externalId ?? `manual-${Date.now()}`,
        url: body.externalUrl,
        responseSummary: { source: "manual_registration", actor: session.user.email },
      },
    });
    await stack.p6.createAuditEvent({
      eventType: "publication.manual",
      actor: session.user.email,
      targetType: "PublicationTarget",
      targetId: updated.id,
      action: "register_external",
      summary: `Registered external URL for ${body.platform ?? target.platform}`,
    });
    return c.json(mapPublicationTarget(updated));
  });

  app.post("/analytics/preview", async (c) => {
    await authed(c, "analytics:import");
    const body = await c.req.json<{
      format: "csv" | "json";
      content: string;
      platform?: string;
      fileName?: string;
    }>();
    if (!body.content || !body.format) {
      throw new AdminHttpError("validation_error", "format and content required", 400);
    }
    const preview = previewAnalyticsImport({
      format: body.format,
      content: body.content,
      platform: body.platform,
    });
    await stack.adminRepo.createFileUploadRef({
      purpose: "analytics-preview",
      fileName: body.fileName ?? null,
      byteLength: Buffer.byteLength(body.content),
      fileHash: preview.fileHash,
      retention: "ephemeral",
      previewMeta: {
        rowCount: preview.rowCount,
        validRows: preview.validRows,
        invalidRows: preview.invalidRows,
      },
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });
    return c.json(preview);
  });

  app.post("/analytics/import", async (c) => {
    const session = await authed(c, "analytics:import");
    const body = await c.req.json<{
      format: "csv" | "json";
      content: string;
      platform?: string;
      fileName?: string;
      confirmPreviewHash?: string;
    }>();
    if (!body.content || !body.format) {
      throw new AdminHttpError("validation_error", "format and content required", 400);
    }
    const preview = previewAnalyticsImport({
      format: body.format,
      content: body.content,
      platform: body.platform,
    });
    if (body.confirmPreviewHash && body.confirmPreviewHash !== preview.fileHash) {
      throw new AdminHttpError(
        "validation_error",
        "preview hash mismatch — re-run preview before import",
        400,
      );
    }
    const result = await stack.analytics.importContent({
      format: body.format,
      content: body.content,
      platform: body.platform,
      fileName: body.fileName,
    });
    await stack.p6.createAuditEvent({
      eventType: "analytics.import",
      actor: session.user.email,
      targetType: "AnalyticsImportBatch",
      targetId: result.batch.id,
      action: result.duplicateFile ? "duplicate_rejected" : "import",
      summary: result.duplicateFile
        ? "Duplicate import rejected"
        : `Imported batch ${result.batch.id}`,
      details: { fileHash: preview.fileHash, rows: result.rows.length },
    });
    return c.json({
      batchId: result.batch.id,
      duplicateFile: result.duplicateFile,
      status: result.batch.status,
      rowCount: result.batch.rowCount,
      unmatchedCount: result.batch.unmatchedCount,
      preview,
    });
  });

  app.get("/analytics-attributions", async (c) => {
    await authed(c, "read");
    const status = c.req.query("status");
    const items = await stack.database.prisma.analyticsAttribution.findMany({
      where: status
        ? { status }
        : { status: { in: ["unmatched", "awaiting_review", "partially_matched"] } },
      include: { importRow: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({
      items: items.map((a) =>
        mapAttribution({
          ...a,
          externalPublicationId: a.importRow?.externalPublicationId ?? null,
        }),
      ),
    });
  });

  app.post("/analytics-attributions/:id/match", async (c) => {
    const session = await authed(c, "analytics:match");
    const body = await c.req.json<{
      contentId: string;
      publicationTargetId?: string;
      contentVersionId?: string;
    }>();
    const attr = await stack.database.prisma.analyticsAttribution.findUnique({
      where: { id: c.req.param("id") },
    });
    if (!attr?.importRowId) {
      throw new AdminHttpError("not_found", "Attribution or import row not found", 404);
    }
    const updated = await stack.analytics.matchRow({
      importRowId: attr.importRowId,
      contentId: body.contentId,
      publicationTargetId: body.publicationTargetId,
      contentVersionId: body.contentVersionId,
      reviewedBy: session.user.email,
    });
    return c.json(mapAttribution({ ...updated, externalPublicationId: null }));
  });

  app.post("/analytics-attributions/:id/reject", async (c) => {
    const session = await authed(c, "analytics:match");
    const body = await c.req.json<{ reason?: string }>();
    if (!body.reason?.trim()) {
      throw new AdminHttpError("validation_error", "reason required", 400);
    }
    const attr = await stack.database.prisma.analyticsAttribution.findUnique({
      where: { id: c.req.param("id") },
    });
    if (!attr?.importRowId) {
      throw new AdminHttpError("not_found", "Attribution not found", 404);
    }
    const updated = await stack.analytics.rejectMatch(
      attr.importRowId,
      session.user.email,
      body.reason,
    );
    return c.json(mapAttribution({ ...updated, externalPublicationId: null }));
  });

  app.get("/learning-rules", async (c) => {
    await authed(c, "read");
    const status = c.req.query("status");
    const rules = await stack.governance.list(status);
    return c.json({ items: rules.map(mapLearningRule) });
  });

  app.get("/learning-rules/:id", async (c) => {
    await authed(c, "read");
    const rule = await stack.p6.findLearningRule(c.req.param("id"));
    if (!rule) throw new AdminHttpError("not_found", "LearningRule not found", 404);
    const apps = await stack.database.prisma.learningRuleApplication.findMany({
      where: { learningRuleId: rule.id },
      take: 20,
    });
    return c.json({ rule: mapLearningRule(rule), applications: apps });
  });

  app.post("/learning-rules/:id/approve", async (c) => {
    const session = await authed(c, "learning:approve");
    const updated = await stack.governance.approve(c.req.param("id"), session.user.email);
    await stack.adminRepo.createApprovalDecision({
      targetType: "LearningRule",
      targetId: updated.id,
      decision: "approve",
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      correlationId: c.get("correlationId"),
    });
    return c.json(mapLearningRule(updated));
  });

  app.post("/learning-rules/:id/activate", async (c) => {
    const session = await authed(c, "learning:approve");
    const updated = await stack.governance.activate(c.req.param("id"), session.user.email);
    return c.json(mapLearningRule(updated));
  });

  app.post("/learning-rules/:id/suspend", async (c) => {
    const session = await authed(c, "learning:approve");
    const body = await c.req.json<{ reason?: string }>();
    if (!body.reason?.trim()) {
      throw new AdminHttpError("validation_error", "reason required", 400);
    }
    const updated = await stack.governance.suspend(
      c.req.param("id"),
      session.user.email,
      body.reason,
    );
    return c.json(mapLearningRule(updated));
  });

  app.post("/learning-rules/:id/deactivate", async (c) => {
    const session = await authed(c, "learning:approve");
    const body = await c.req.json<{ reason?: string }>();
    if (!body.reason?.trim()) {
      throw new AdminHttpError("validation_error", "reason required", 400);
    }
    const updated = await stack.governance.deactivate(
      c.req.param("id"),
      session.user.email,
      body.reason,
    );
    return c.json(mapLearningRule(updated));
  });

  app.post("/learning-rules/expire-due", async (c) => {
    await authed(c, "jobs:run");
    const count = await stack.governance.expireDueRules();
    return c.json({ expired: count });
  });

  app.get("/learning-conflicts", async (c) => {
    await authed(c, "read");
    const items = await stack.governance.listConflicts();
    return c.json({ items: items.map(mapConflict) });
  });

  app.post("/learning-conflicts/detect", async (c) => {
    await authed(c, "learning:approve");
    const created = await stack.governance.detectConflicts();
    return c.json({ created: created.length, items: created });
  });

  app.post("/learning-conflicts/:id/resolve", async (c) => {
    const session = await authed(c, "learning:approve");
    const body = await c.req.json<{
      resolution:
        | "keep_existing"
        | "accept_new_supersede"
        | "narrow_scope"
        | "suspend_both"
        | "reject_new"
        | "manual_note";
      note?: string;
    }>();
    if (!body.resolution) {
      throw new AdminHttpError("validation_error", "resolution required", 400);
    }
    const updated = await stack.governance.resolveConflict(
      c.req.param("id"),
      session.user.email,
      body.resolution,
      body.note,
    );
    return c.json(updated);
  });

  app.get("/experiments", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.experiment.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({ items: items.map(mapExperiment) });
  });

  app.post("/experiments/:id/approve", async (c) => {
    const session = await authed(c, "experiment:approve");
    const updated = await stack.learning.approveExperiment(c.req.param("id"), session.user.email);
    await stack.adminRepo.createApprovalDecision({
      targetType: "Experiment",
      targetId: updated.id,
      decision: "approve",
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      correlationId: c.get("correlationId"),
    });
    return c.json(mapExperiment(updated));
  });

  app.get("/link-replacements", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.linkReplacementEvent.findMany({
      where: { status: { in: ["PROPOSED", "AWAITING_APPROVAL", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({ items: items.map(mapLinkReplacement) });
  });

  app.post("/link-replacements/:id/approve", async (c) => {
    const session = await authed(c, "link-replacement:approve");
    const updated = await stack.linkReplacement.approve(c.req.param("id"), session.user.email);
    await stack.adminRepo.createApprovalDecision({
      targetType: "LinkReplacementEvent",
      targetId: updated.id,
      decision: "approve",
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      correlationId: c.get("correlationId"),
    });
    return c.json(mapLinkReplacement(updated));
  });

  app.post("/link-replacements/:id/reject", async (c) => {
    const session = await authed(c, "link-replacement:approve");
    const body = await c.req.json<{ reason?: string }>();
    if (!body.reason?.trim()) {
      throw new AdminHttpError("validation_error", "reason required", 400);
    }
    const event = await stack.lifecycleRepo.findLinkReplacementEvent(c.req.param("id"));
    if (!event) throw new AdminHttpError("not_found", "LinkReplacementEvent not found", 404);
    const updated = await stack.lifecycleRepo.updateLinkReplacementEvent(event.id, {
      status: "REJECTED",
      metadata: { rejectionReason: body.reason },
    });
    await stack.p6.createAuditEvent({
      eventType: "link.replacement",
      actor: session.user.email,
      targetType: "LinkReplacementEvent",
      targetId: updated.id,
      action: "reject",
      summary: body.reason,
    });
    return c.json(mapLinkReplacement(updated));
  });

  app.post("/link-replacements/:id/apply", async (c) => {
    const session = await authed(c, "link-replacement:approve");
    const result = await stack.linkReplacement.apply({
      eventId: c.req.param("id"),
      approvedBy: session.user.email,
      publishers: stack.publishers,
    });
    await stack.p6.createAuditEvent({
      eventType: "link.replacement",
      actor: session.user.email,
      targetType: "LinkReplacementEvent",
      targetId: result.event.id,
      action: "apply",
      summary: "Affiliate link replacement applied (new ContentVersion)",
      details: {
        sourceVersionId: result.event.sourceContentVersionId,
        targetVersionId: result.event.targetContentVersionId,
      },
    });
    return c.json({
      event: mapLinkReplacement(result.event),
      newContentVersionId: result.event.targetContentVersionId,
    });
  });

  app.get("/operation-jobs", async (c) => {
    await authed(c, "read");
    const [ops, research] = await Promise.all([
      stack.p6.listOperationJobs({ take: 50 }),
      stack.database.prisma.researchJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    const items = [
      ...ops.map(mapOperationJob),
      ...research.map((j) =>
        mapResearchJob({
          id: j.id,
          type: j.jobType,
          status: j.status,
          startedAt: j.startedAt,
          completedAt: j.completedAt,
          errorMessage: j.errorMessage,
          attempts: j.errorCount,
        }),
      ),
    ].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    return c.json({ items });
  });

  app.get("/operation-jobs/:id", async (c) => {
    await authed(c, "read");
    const job = await stack.p6.findOperationJob(c.req.param("id"));
    if (!job) throw new AdminHttpError("not_found", "OperationJob not found", 404);
    const audits = await stack.p6.listAuditEvents({
      relatedJobId: job.id,
      take: 20,
    });
    return c.json({
      job: mapOperationJob(job),
      checkpoints: job.checkpoints.map((cp) => ({
        stepKey: cp.stepKey,
        status: cp.status,
        error: cp.error,
      })),
      audits: audits.map(mapAudit),
    });
  });

  app.post("/operation-jobs/:id/resume", async (c) => {
    const session = await authed(c, "jobs:run");
    const job = await stack.orchestration.resumeJob(c.req.param("id"));
    await stack.p6.createAuditEvent({
      eventType: "operation.job",
      actor: session.user.email,
      targetType: "OperationJob",
      targetId: job.id,
      action: "resume",
      summary: `Resumed job status=${job.status}`,
      relatedJobId: job.id,
    });
    return c.json(mapOperationJob(job));
  });

  app.post("/operation-jobs/:id/retry", async (c) => {
    const session = await authed(c, "jobs:run");
    const existing = await stack.p6.findOperationJob(c.req.param("id"));
    if (!existing) throw new AdminHttpError("not_found", "OperationJob not found", 404);
    if (existing.status !== "FAILED") {
      throw new AdminHttpError(
        "invalid_state_transition",
        "Only FAILED jobs can be retried",
        409,
      );
    }
    if (!existing.retryable) {
      throw new AdminHttpError(
        "invalid_state_transition",
        "Job is not marked retryable",
        409,
      );
    }
    const job = await stack.orchestration.resumeJob(existing.id);
    await stack.p6.createAuditEvent({
      eventType: "operation.job",
      actor: session.user.email,
      targetType: "OperationJob",
      targetId: job.id,
      action: "retry",
      summary: `Retried FAILED job → ${job.status}`,
      relatedJobId: job.id,
    });
    return c.json(mapOperationJob(job));
  });

  app.post("/operation-jobs/:id/cancel", async (c) => {
    const session = await authed(c, "jobs:cancel");
    const body = await c.req.json<{ reason?: string }>();
    if (!body.reason?.trim()) {
      throw new AdminHttpError("validation_error", "reason required", 400);
    }
    const updated = await stack.p6.updateOperationJob(c.req.param("id"), {
      status: "CANCELLED",
      error: body.reason,
      completedAt: new Date(),
    });
    await stack.p6.createAuditEvent({
      eventType: "operation.job",
      actor: session.user.email,
      targetType: "OperationJob",
      targetId: updated.id,
      action: "cancel",
      summary: body.reason,
      relatedJobId: updated.id,
    });
    return c.json(mapOperationJob(updated));
  });

  app.get("/audit-events", async (c) => {
    await authed(c, "read");
    const items = await stack.p6.listAuditEvents({
      actor: c.req.query("actor") ?? undefined,
      action: c.req.query("action") ?? undefined,
      targetType: c.req.query("targetType") ?? undefined,
      targetId: c.req.query("targetId") ?? undefined,
      relatedJobId: c.req.query("jobId") ?? undefined,
      take: Number(c.req.query("pageSize") ?? 50),
    });
    return c.json({ items: items.map(mapAudit) });
  });

  app.get("/settings", async (c) => {
    await authed(c, "read");
    const settings = await stack.adminRepo.listSettings();
    return c.json({
      settings: settings.map(mapSetting),
      secrets: secretStatus(stack),
    });
  });

  app.put("/settings/:key", async (c) => {
    const session = await authed(c, "settings:write");
    const key = c.req.param("key");
    if (/secret|password|token|api.?key|refresh/i.test(key)) {
      throw new AdminHttpError("permission_denied", "Secret keys cannot be set via Admin API", 403);
    }
    const body = await c.req.json<{ value: unknown; description?: string }>();
    const updated = await stack.adminRepo.upsertSetting({
      key,
      value: body.value,
      description: body.description,
      updatedBy: session.user.email,
    });
    await stack.p6.createAuditEvent({
      eventType: "admin.settings",
      actor: session.user.email,
      targetType: "SystemSetting",
      targetId: updated.id,
      action: "update",
      summary: `Updated setting ${key}`,
    });
    return c.json(mapSetting(updated));
  });

  app.get("/provider-mapping-profiles", async (c) => {
    await authed(c, "read");
    const items = await stack.adminRepo.listMappingProfiles();
    return c.json({ items: items.map(mapMappingProfile) });
  });

  app.get("/evaluations", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.evaluation.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({
      items: items.map((e) => ({
        id: e.id,
        contentId: e.contentId,
        contentVersionId: e.contentVersionId,
        platform: e.platform,
        score: e.overallScore,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

  app.get("/strategies", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.contentStrategy.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({
      items: items.map((s) => ({
        id: s.id,
        title: s.objective,
        status: s.status,
        platform: s.primaryChannel,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  });

  app.get("/model-runs", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.modelRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({
      items: items.map((m) => ({
        id: m.id,
        provider: m.provider,
        model: m.model,
        status: m.status,
        promptIdentifier: m.promptIdentifier,
        promptVersion: m.promptVersion,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  app.get("/costs", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.costRecord.findMany({
      orderBy: { recordedAt: "desc" },
      take: 50,
    });
    return c.json({
      items: items.map((r) => ({
        id: r.id,
        currency: r.currency,
        actualAmount: r.actualAmount,
        estimatedAmount: r.estimatedAmount,
        relatedType: r.relatedType,
        relatedId: r.relatedId,
        recordedAt: r.recordedAt.toISOString(),
      })),
    });
  });

  app.get("/product-links", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.productLink.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({
      items: items.map((p) => ({
        id: p.id,
        url: p.url,
        preferredAffiliateProvider: p.preferredAffiliateProvider,
        currentLinkProvider: p.currentLinkProvider,
        replacementStatus: p.replacementStatus,
        productMatchKey: p.productMatchKey,
      })),
    });
  });

  app.get("/affiliate-results", async (c) => {
    await authed(c, "read");
    const items = await stack.database.prisma.affiliateResult.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({
      items: items.map((r) => ({
        id: r.id,
        provider: r.provider,
        status: r.status,
        amount: r.commissionAmount,
        currency: r.currency,
        productMatchKey: r.productMatchKey,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  return app;
}
