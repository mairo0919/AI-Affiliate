import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@ai-affiliate/config";
import { createAdminStack } from "@ai-affiliate/content-operator/admin";
import { createAdminApp } from "./app.js";
import { ScryptAuthAdapter, ensureBootstrapAdmin, seedDefaultSettings } from "./auth.js";
import { runP7Vertical } from "./p7-vertical.js";

loadConfig({ requireDatabaseUrl: false });

describe("Admin API authz + P7", () => {
  const auth = new ScryptAuthAdapter();
  let stack: Awaited<ReturnType<typeof createAdminStack>>;
  let app: Awaited<ReturnType<typeof createAdminApp>>;

  beforeAll(async () => {
    process.env.ADMIN_BOOTSTRAP_EMAIL = "admin@localhost";
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "change-me-admin";
    stack = await createAdminStack();
    await ensureBootstrapAdmin(stack, auth);
    await seedDefaultSettings(stack);
    await stack.adminRepo.upsertUser({
      email: "viewer@localhost",
      displayName: "Viewer",
      passwordHash: auth.hashPassword("viewer-pass"),
      role: "VIEWER",
    });
    await stack.adminRepo.upsertUser({
      email: "reviewer@localhost",
      displayName: "Reviewer",
      passwordHash: auth.hashPassword("reviewer-pass"),
      role: "REVIEWER",
    });
    app = await createAdminApp(stack);
  });

  afterAll(async () => {
    await stack.disconnect();
  });

  beforeEach(async () => {
    await stack.database.prisma.approvalDecision.deleteMany();
    await stack.database.prisma.adminSession.deleteMany();
  });

  it("rejects unauthenticated access", async () => {
    const res = await app.request("/dashboard");
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: { code: string; correlationId: string };
    };
    expect(body.error.code).toBe("authentication_required");
    expect(body.error.correlationId).toBeTruthy();
  });

  it("denies VIEWER write and allows REVIEWER approve path gates", async () => {
    const viewer = (await (
      await app.request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "viewer@localhost", password: "viewer-pass" }),
      })
    ).json()) as { token: string };
    const denied = await app.request("/settings/publication.softLimitPerDay", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${viewer.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ value: 9 }),
    });
    expect(denied.status).toBe(403);

    const reviewer = (await (
      await app.request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "reviewer@localhost", password: "reviewer-pass" }),
      })
    ).json()) as { token: string };
    const content = await stack.lifecycleRepo.createContent({ status: "DRAFT" });
    const old = await stack.lifecycleRepo.createContentVersion({
      contentId: content.id,
      versionNumber: 1,
      title: "old",
      body: "old body",
      status: "REVIEWING",
    });
    const latest = await stack.lifecycleRepo.createContentVersion({
      contentId: content.id,
      versionNumber: 2,
      title: "new",
      body: "new body",
      status: "REVIEWING",
      parentVersionId: old.id,
    });
    const stale = await app.request(`/content-versions/${old.id}/review`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${reviewer.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(stale.status).toBe(409);
    const ok = await app.request(`/content-versions/${latest.id}/review`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${reviewer.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(ok.status).toBe(200);
  });

  it("does not expose secrets in settings", async () => {
    const admin = (await (
      await app.request("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin@localhost",
          password: "change-me-admin",
        }),
      })
    ).json()) as { token: string };
    const res = await app.request("/settings", {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const body = (await res.json()) as {
      secrets: Array<{ configured: boolean }>;
    };
    expect(res.status).toBe(200);
    expect(body.secrets.every((s) => typeof s.configured === "boolean")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/BLOGGER_REFRESH_TOKEN":\s*"[^n]/);
  });

  it("runs P7 vertical slice", async () => {
    const summary = await runP7Vertical();
    expect(summary.loginRole).toBe("ADMIN");
    expect(summary.originalBodyUnchanged).toBe(true);
    expect(summary.viewerWriteDenied).toBe(true);
    expect(summary.newContentVersionId).toBeTruthy();
  }, 180_000);
});
