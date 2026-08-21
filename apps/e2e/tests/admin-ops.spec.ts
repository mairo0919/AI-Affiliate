import { expect, test } from "@playwright/test";

const API = process.env.E2E_ADMIN_API_URL ?? "http://127.0.0.1:8788";

test.describe("Admin Ops E2E (Mock)", () => {
  test("login → dashboard → review queue → checklist", async ({ page, request }) => {
    const health = await request.get(`${API}/health`);
    expect(health.ok()).toBeTruthy();
    const ready = await request.get(`${API}/ready`);
    expect(ready.ok()).toBeTruthy();
    const readyBody = await ready.json();
    expect(readyBody.ready).toBe(true);

    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@localhost");
    await page.getByLabel("Password").fill("change-me-admin");
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page.getByRole("heading", { name: "Operations Dashboard" })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/content-review");
    await expect(page.getByRole("heading", { name: "Content Review Queue" })).toBeVisible();

    await page.goto("/publications");
    await expect(page.getByRole("heading", { name: "Publication Queue" })).toBeVisible();

    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: "Audit" })).toBeVisible();

    await page.goto("/learning-rules");
    await expect(page.getByRole("heading", { name: "Learning Rules" })).toBeVisible();

    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Analytics Import" })).toBeVisible();

    await page.goto("/checklist");
    await expect(page.getByRole("heading", { name: "Production Checklist" })).toBeVisible();

    // API-level ops smoke with session
    const login = await request.post(`${API}/auth/login`, {
      data: { email: "admin@localhost", password: "change-me-admin" },
    });
    expect(login.ok()).toBeTruthy();
    const session = await login.json();
    const headers = { authorization: `Bearer ${session.token}` };

    const checklist = await request.get(`${API}/production/checklist`, { headers });
    expect(checklist.ok()).toBeTruthy();
    const body = await checklist.json();
    expect(Array.isArray(body.items)).toBeTruthy();

    const jobs = await request.get(`${API}/operation-jobs`, { headers });
    expect(jobs.ok()).toBeTruthy();

    const audit = await request.get(`${API}/audit-events`, { headers });
    expect(audit.ok()).toBeTruthy();

    // Content review / publication / learning via API (Mock adapters)
    const reviewQueue = await request.get(`${API}/content-versions?status=REVIEWING`, { headers });
    expect(reviewQueue.ok()).toBeTruthy();

    const publications = await request.get(`${API}/publications`, { headers });
    expect(publications.ok()).toBeTruthy();

    const rules = await request.get(`${API}/learning-rules`, { headers });
    expect(rules.ok()).toBeTruthy();
  });
});
