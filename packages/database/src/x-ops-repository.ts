import { createHash } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  XAuditActorType,
  XAuditResult,
  XOperationalAuditLog,
  XProductPublicationReservation,
  XProductPublicationState,
  XProductReservationStatus,
  XRuntimeControl,
} from "@prisma/client";

export class XOpsStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XOpsStateError";
  }
}

export function hashProductKey(productKey: string): string {
  return createHash("sha256").update(productKey).digest("hex").slice(0, 24);
}

export function normalizePostBody(body: string): string {
  return body
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/https?:\/\/\S+/gi, "{{URL}}")
    .toLowerCase();
}

export function hashNormalizedBody(body: string): string {
  return createHash("sha256").update(normalizePostBody(body)).digest("hex");
}

export class XOpsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  get client(): PrismaClient {
    return this.prisma;
  }

  async upsertProductState(input: {
    productKey: string;
    provider: string;
    researchItemId?: string | null;
    contentCandidateId?: string | null;
  }): Promise<XProductPublicationState> {
    return this.prisma.xProductPublicationState.upsert({
      where: { productKey: input.productKey },
      create: {
        productKey: input.productKey,
        provider: input.provider,
        researchItemId: input.researchItemId ?? null,
        contentCandidateId: input.contentCandidateId ?? null,
      },
      update: {
        provider: input.provider,
        researchItemId: input.researchItemId ?? undefined,
        contentCandidateId: input.contentCandidateId ?? undefined,
      },
    });
  }

  async findProductState(productKey: string): Promise<XProductPublicationState | null> {
    return this.prisma.xProductPublicationState.findUnique({ where: { productKey } });
  }

  async listProductStates(limit = 50): Promise<XProductPublicationState[]> {
    return this.prisma.xProductPublicationState.findMany({
      orderBy: { updatedAt: "desc" },
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  async reserveProduct(input: {
    productKey: string;
    publicationId: string;
    expiresAt: Date;
    reason?: string;
    nextEligibleAt?: Date | null;
    scheduledAt?: Date | null;
  }): Promise<XProductPublicationReservation> {
    return this.prisma.$transaction(async (tx) => {
      const state = await tx.xProductPublicationState.findUnique({
        where: { productKey: input.productKey },
      });
      if (!state) {
        throw new XOpsStateError(`product state missing for ${input.productKey}`);
      }

      const active = await tx.xProductPublicationReservation.findFirst({
        where: { productKey: input.productKey, status: "ACTIVE" },
      });
      if (active) {
        throw new XOpsStateError(
          `ACTIVE reservation already exists for productKey=${input.productKey}`,
        );
      }

      const reservation = await tx.xProductPublicationReservation.create({
        data: {
          productKey: input.productKey,
          publicationId: input.publicationId,
          status: "ACTIVE",
          expiresAt: input.expiresAt,
          reason: input.reason ?? null,
        },
      });

      await tx.xProductPublicationState.update({
        where: { productKey: input.productKey },
        data: {
          activeReservationCount: { increment: 1 },
          lockVersion: { increment: 1 },
          lastScheduledAt: input.scheduledAt ?? undefined,
          lastPublicationId: input.publicationId,
          nextEligibleAt: input.nextEligibleAt ?? undefined,
        },
      });

      return reservation;
    });
  }

  async findActiveReservation(
    productKey: string,
  ): Promise<XProductPublicationReservation | null> {
    return this.prisma.xProductPublicationReservation.findFirst({
      where: { productKey, status: "ACTIVE" },
      orderBy: { reservedAt: "desc" },
    });
  }

  async findReservationByPublication(
    publicationId: string,
  ): Promise<XProductPublicationReservation | null> {
    return this.prisma.xProductPublicationReservation.findUnique({
      where: { publicationId },
    });
  }

  async consumeReservation(publicationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.xProductPublicationReservation.findUnique({
        where: { publicationId },
      });
      if (!reservation || reservation.status !== "ACTIVE") return;
      await tx.xProductPublicationReservation.update({
        where: { id: reservation.id },
        data: { status: "CONSUMED", releasedAt: new Date() },
      });
      await tx.xProductPublicationState.update({
        where: { productKey: reservation.productKey },
        data: {
          activeReservationCount: { decrement: 1 },
          lastPublishedAt: new Date(),
          lastPublicationId: publicationId,
        },
      });
    });
  }

  async releaseReservation(
    publicationId: string,
    status: Extract<XProductReservationStatus, "RELEASED" | "CANCELLED" | "EXPIRED">,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.xProductPublicationReservation.findUnique({
        where: { publicationId },
      });
      if (!reservation || reservation.status !== "ACTIVE") return;
      await tx.xProductPublicationReservation.update({
        where: { id: reservation.id },
        data: { status, releasedAt: new Date() },
      });
      await tx.xProductPublicationState.update({
        where: { productKey: reservation.productKey },
        data: { activeReservationCount: { decrement: 1 } },
      });
    });
  }

  async expireDueReservations(now: Date): Promise<number> {
    const due = await this.prisma.xProductPublicationReservation.findMany({
      where: { status: "ACTIVE", expiresAt: { lt: now } },
      take: 100,
    });
    for (const row of due) {
      await this.releaseReservation(row.publicationId, "EXPIRED");
    }
    return due.length;
  }

  async countActiveReservations(): Promise<number> {
    return this.prisma.xProductPublicationReservation.count({
      where: { status: "ACTIVE" },
    });
  }

  async getRuntimeControl(key: string): Promise<XRuntimeControl | null> {
    return this.prisma.xRuntimeControl.findUnique({ where: { key } });
  }

  async listRuntimeControls(): Promise<XRuntimeControl[]> {
    return this.prisma.xRuntimeControl.findMany({ orderBy: { key: "asc" } });
  }

  async setRuntimeControl(input: {
    key: string;
    value: string;
    reason: string;
    changedBy: string;
    expiresAt?: Date | null;
  }): Promise<XRuntimeControl> {
    return this.prisma.xRuntimeControl.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        value: input.value,
        reason: input.reason,
        changedBy: input.changedBy,
        changedAt: new Date(),
        expiresAt: input.expiresAt ?? null,
      },
      update: {
        value: input.value,
        reason: input.reason,
        changedBy: input.changedBy,
        changedAt: new Date(),
        expiresAt: input.expiresAt ?? null,
      },
    });
  }

  async isControlActive(key: string, now: Date): Promise<boolean> {
    const row = await this.getRuntimeControl(key);
    if (!row) return false;
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
    return row.value === "true" || row.value === "1" || row.value === "paused";
  }

  async writeAudit(input: {
    action: string;
    actorType: XAuditActorType;
    actorId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    publicationId?: string | null;
    productKeyHash?: string | null;
    releaseMode?: string | null;
    result: XAuditResult;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<XOperationalAuditLog> {
    const metadata = sanitizeAuditMetadata(input.metadata);
    return this.prisma.xOperationalAuditLog.create({
      data: {
        action: input.action,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        publicationId: input.publicationId ?? null,
        productKeyHash: input.productKeyHash ?? null,
        releaseMode: input.releaseMode ?? null,
        result: input.result,
        reason: input.reason ?? null,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listAudit(options: { limit?: number; action?: string }): Promise<XOperationalAuditLog[]> {
    return this.prisma.xOperationalAuditLog.findMany({
      where: options.action ? { action: options.action } : {},
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(options.limit ?? 50, 200)),
    });
  }

  async countPublishedPostsInRange(options: {
    since: Date;
    until: Date;
    accountId?: string | null;
  }): Promise<number> {
    return this.prisma.xPublicationPost.count({
      where: {
        status: "PUBLISHED",
        publishedAt: { gte: options.since, lt: options.until },
        ...(options.accountId
          ? { publication: { accountId: options.accountId } }
          : {}),
      },
    });
  }

  async findBodyHashDuplicate(options: {
    bodyHash: string;
    since: Date;
    excludePublicationId?: string;
  }): Promise<{ id: string; publicationId: string } | null> {
    return this.prisma.xPublicationPost.findFirst({
      where: {
        bodyHash: options.bodyHash,
        createdAt: { gte: options.since },
        ...(options.excludePublicationId
          ? { publicationId: { not: options.excludePublicationId } }
          : {}),
        publication: { status: { notIn: ["CANCELLED", "DELETED"] } },
      },
      select: { id: true, publicationId: true },
    });
  }

  async findActivePublicationForContent(
    generatedContentId: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.xPublication.findFirst({
      where: {
        generatedContentId,
        status: { notIn: ["CANCELLED", "DELETED"] },
      },
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async markPublicationBlocked(
    id: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.xPublication.update({
      where: { id },
      data: {
        status: "BLOCKED",
        lastErrorType: "PrePublishGuard",
        lastErrorMessage: reason.slice(0, 500),
      },
    });
  }

  async countByStatus(status: string): Promise<number> {
    return this.prisma.xPublication.count({
      where: { status: status as never },
    });
  }

  async findNextScheduled(): Promise<{ id: string; scheduledAt: Date | null } | null> {
    return this.prisma.xPublication.findFirst({
      where: { status: "SCHEDULED", scheduledAt: { not: null } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, scheduledAt: true },
    });
  }
}

const FORBIDDEN_AUDIT_KEYS = [
  "accessToken",
  "refreshToken",
  "clientSecret",
  "rawData",
  "affiliateUrl",
  "description",
  "reviewBody",
  "password",
  "authorization",
];

function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_AUDIT_KEYS.some((f) => lower.includes(f.toLowerCase()))) {
      continue;
    }
    if (typeof value === "string" && /https?:\/\/\S+/i.test(value) && value.length > 80) {
      out[key] = "[redacted-url]";
      continue;
    }
    out[key] = value;
  }
  return out;
}
