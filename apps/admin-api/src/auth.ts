import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AdminRole, AdminUserDto } from "@ai-affiliate/admin-contracts";
import { roleHasPermission, type AdminPermission } from "@ai-affiliate/admin-contracts";
import type { AdminStack } from "@ai-affiliate/content-operator/admin";
import {
  generateSessionToken,
  hashSessionToken,
} from "@ai-affiliate/content-operator/admin";
import { AdminHttpError } from "./errors.js";

/** Auth adapter boundary — swap for Google Workspace OAuth later */
export interface AuthAdapter {
  verifyPassword(password: string, passwordHash: string): boolean;
  hashPassword(password: string): string;
}

/** scrypt-based password hasher (no plaintext storage) */
export class ScryptAuthAdapter implements AuthAdapter {
  hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${hash}`;
  }

  verifyPassword(password: string, passwordHash: string): boolean {
    const [algo, salt, hash] = passwordHash.split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  }
}

export function toUserDto(user: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
  createdAt: Date;
}): AdminUserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role as AdminRole,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function login(
  stack: AdminStack,
  auth: AuthAdapter,
  email: string,
  password: string,
): Promise<{ token: string; expiresAt: string; user: AdminUserDto }> {
  const user = await stack.adminRepo.findUserByEmail(email);
  if (!user || !user.active || !auth.verifyPassword(password, user.passwordHash)) {
    throw new AdminHttpError("authentication_required", "Invalid credentials", 401);
  }
  const token = generateSessionToken();
  const ttlHours = stack.config.adminSessionTtlHours;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await stack.adminRepo.createSession({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  await stack.adminRepo.touchLogin(user.id);
  await stack.p6.createAuditEvent({
    eventType: "admin.auth",
    actor: user.email,
    targetType: "AdminUser",
    targetId: user.id,
    action: "login",
    summary: "Admin session created",
  });
  return { token, expiresAt: expiresAt.toISOString(), user: toUserDto(user) };
}

export async function requireSession(
  stack: AdminStack,
  authorizationHeader: string | undefined,
): Promise<{ user: AdminUserDto; sessionId: string; role: AdminRole }> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AdminHttpError("authentication_required", "Authentication required", 401);
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AdminHttpError("authentication_required", "Authentication required", 401);
  }
  const session = await stack.adminRepo.findSessionByTokenHash(hashSessionToken(token));
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AdminHttpError("authentication_required", "Session expired or invalid", 401);
  }
  if (!session.user.active) {
    throw new AdminHttpError("authentication_required", "User inactive", 401);
  }
  return {
    user: toUserDto(session.user),
    sessionId: session.id,
    role: session.user.role as AdminRole,
  };
}

export function requirePermission(role: AdminRole, permission: AdminPermission): void {
  if (!roleHasPermission(role, permission)) {
    throw new AdminHttpError("permission_denied", `Missing permission: ${permission}`, 403);
  }
}

/** Bootstrap admin from env — hashes password, never stores plaintext */
export async function ensureBootstrapAdmin(
  stack: AdminStack,
  auth: AuthAdapter,
): Promise<void> {
  const email = stack.config.adminBootstrapEmail;
  const password = stack.config.adminBootstrapPassword;
  if (!email || !password) return;
  await stack.adminRepo.upsertUser({
    email,
    displayName: "Bootstrap Admin",
    passwordHash: auth.hashPassword(password),
    role: "ADMIN",
  });
}

export async function seedDefaultSettings(stack: AdminStack): Promise<void> {
  const defaults: Array<{ key: string; value: unknown; description: string }> = [
    {
      key: "publication.softLimitPerDay",
      value: stack.config.publicationTargetPerDay,
      description: "Soft daily publication target",
    },
    {
      key: "publication.queueIntervalMinutes",
      value: stack.config.publicationMinimumIntervalMinutes,
      description: "Minimum minutes between publications",
    },
    {
      key: "learning.defaultMinimumSampleCount",
      value: 3,
      description: "Default LearningRule sample threshold",
    },
    {
      key: "learning.defaultMinimumConfidence",
      value: 0.5,
      description: "Default LearningRule confidence threshold",
    },
    {
      key: "feature.bloggerDirectPublish",
      value: false,
      description: "Direct Blogger publish (must stay false unless explicitly enabled)",
    },
    {
      key: "blogger.defaultMode",
      value: stack.config.bloggerDefaultPublishMode,
      description: "Default Blogger publish mode",
    },
  ];
  for (const d of defaults) {
    const existing = await stack.adminRepo.getSetting(d.key);
    if (!existing) {
      await stack.adminRepo.upsertSetting(d);
    }
  }

  await stack.adminRepo.upsertMappingProfile({
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
    statusMapping: { approved: "APPROVED", pending: "PENDING", rejected: "REJECTED" },
    currencyMapping: { yen: "JPY", jpy: "JPY", usd: "USD" },
    dateFormat: "ISO8601",
    notes: "SAMPLE profile — not a production ASP specification",
  });
  await stack.adminRepo.upsertMappingProfile({
    profileKey: "fanza-manual-placeholder",
    provider: "fanza",
    label: "FANZA Manual Placeholder (sample)",
    isSample: true,
    columnMapping: {
      externalOrderId: "注文ID",
      productMatchKey: "品番",
      amount: "報酬額",
      currency: "currency",
      status: "確定区分",
      occurredAt: "発生日",
    },
    statusMapping: { 確定: "APPROVED", 未確定: "PENDING" },
    currencyMapping: { 円: "JPY" },
    dateFormat: "YYYY-MM-DD",
    notes:
      "SAMPLE placeholder only — real FANZA CSV columns are NOT finalized; do not treat as official spec",
  });
}

export function secretStatus(stack: AdminStack): Array<{ key: string; configured: boolean }> {
  return [
    { key: "LLM_API_KEY", configured: Boolean(stack.config.llmApiKey) },
    { key: "BLOGGER_CLIENT_ID", configured: Boolean(stack.config.bloggerClientId) },
    { key: "BLOGGER_CLIENT_SECRET", configured: Boolean(stack.config.bloggerClientSecret) },
    { key: "BLOGGER_REFRESH_TOKEN", configured: Boolean(stack.config.bloggerRefreshToken) },
    { key: "DMM_API_ID", configured: Boolean(process.env.DMM_API_ID) },
    { key: "DMM_AFFILIATE_ID", configured: Boolean(process.env.DMM_AFFILIATE_ID) },
  ];
}

export function hashReason(reason: string): string {
  return createHash("sha256").update(reason).digest("hex").slice(0, 16);
}
