import type { LearningRule, P5Repository, P6Repository } from "@ai-affiliate/database";

export class LearningGovernanceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "LearningGovernanceError";
  }
}

export class LearningGovernanceService {
  constructor(
    private readonly p5: P5Repository,
    private readonly p6: P6Repository,
  ) {}

  async list(status?: string) {
    return this.p6.listLearningRules(status ? { status } : undefined);
  }

  async approve(ruleId: string, approvedBy: string): Promise<LearningRule> {
    const rule = await this.requireRule(ruleId);
    if (!["PROPOSED", "AWAITING_APPROVAL"].includes(rule.status)) {
      throw new LearningGovernanceError(
        `Cannot approve rule in status ${rule.status}`,
        "INVALID_STATUS",
      );
    }
    const updated = await this.p6.updateLearningRule(ruleId, {
      status: "AWAITING_APPROVAL",
      approvedBy,
      approvedAt: new Date(),
    });
    await this.p6.createAuditEvent({
      eventType: "learning.rule",
      actor: approvedBy,
      targetType: "LearningRule",
      targetId: ruleId,
      action: "approve",
      summary: "Rule marked awaiting activation (thresholds still required)",
    });
    return updated;
  }

  async activate(ruleId: string, actor: string): Promise<LearningRule> {
    const rule = await this.requireRule(ruleId);
    this.assertActivationEligibility(rule);

    const conflicts = await this.detectConflictsForRule(rule);
    if (conflicts.length > 0) {
      throw new LearningGovernanceError(
        `Conflicts require manual review: ${conflicts.map((c) => c.conflictType).join(", ")}`,
        "CONFLICT",
      );
    }

    if (rule.supersedesRuleId) {
      await this.p6.updateLearningRule(rule.supersedesRuleId, {
        status: "SUPERSEDED",
        deactivatedAt: new Date(),
        deactivationReason: `Superseded by ${ruleId}`,
      });
      await this.p6.createAuditEvent({
        eventType: "learning.rule",
        actor,
        targetType: "LearningRule",
        targetId: rule.supersedesRuleId,
        action: "superseded",
        summary: `Superseded by ${ruleId}`,
      });
    }

    const updated = await this.p6.updateLearningRule(ruleId, {
      status: "ACTIVE",
      approvedBy: rule.approvedBy ?? actor,
      approvedAt: rule.approvedAt ?? new Date(),
    });
    await this.p6.createAuditEvent({
      eventType: "learning.rule",
      actor,
      targetType: "LearningRule",
      targetId: ruleId,
      action: "activate",
      summary: "LearningRule activated after thresholds + approval + conflict check",
    });
    return updated;
  }

  async suspend(ruleId: string, actor: string, reason: string): Promise<LearningRule> {
    const rule = await this.requireRule(ruleId);
    if (rule.status !== "ACTIVE") {
      throw new LearningGovernanceError(`Only ACTIVE rules can be suspended`, "INVALID_STATUS");
    }
    const updated = await this.p6.updateLearningRule(ruleId, {
      status: "SUSPENDED",
      suspendedAt: new Date(),
      deactivationReason: reason,
    });
    await this.p6.createAuditEvent({
      eventType: "learning.rule",
      actor,
      targetType: "LearningRule",
      targetId: ruleId,
      action: "suspend",
      summary: reason,
    });
    return updated;
  }

  async deactivate(ruleId: string, actor: string, reason: string): Promise<LearningRule> {
    const updated = await this.p6.updateLearningRule(ruleId, {
      status: "REJECTED",
      deactivatedAt: new Date(),
      deactivationReason: reason,
    });
    await this.p6.createAuditEvent({
      eventType: "learning.rule",
      actor,
      targetType: "LearningRule",
      targetId: ruleId,
      action: "deactivate",
      summary: reason,
    });
    return updated;
  }

  async expireDueRules(now = new Date()): Promise<number> {
    const active = await this.p6.listLearningRules({ status: "ACTIVE" });
    let count = 0;
    for (const rule of active) {
      if (rule.validUntil && rule.validUntil < now) {
        await this.p6.updateLearningRule(rule.id, {
          status: "EXPIRED",
          deactivatedAt: now,
          deactivationReason: "validUntil passed",
        });
        await this.p6.createAuditEvent({
          eventType: "learning.rule",
          actor: "system:expiry-job",
          targetType: "LearningRule",
          targetId: rule.id,
          action: "expire",
          summary: "ACTIVE rule expired by validUntil (not deleted; reinstate requires approval)",
          details: { validUntil: rule.validUntil.toISOString() },
        });
        count += 1;
      }
    }
    return count;
  }

  async resolveConflict(
    conflictId: string,
    actor: string,
    resolution:
      | "keep_existing"
      | "accept_new_supersede"
      | "narrow_scope"
      | "suspend_both"
      | "reject_new"
      | "manual_note",
    note?: string,
  ) {
    const conflicts = await this.p6.listOpenConflicts();
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      throw new LearningGovernanceError(`Conflict not found: ${conflictId}`, "NOT_FOUND");
    }

    if (resolution === "accept_new_supersede") {
      await this.p6.updateLearningRule(conflict.ruleAId, {
        status: "SUPERSEDED",
        deactivatedAt: new Date(),
        deactivationReason: `Superseded via conflict ${conflictId}`,
      });
    } else if (resolution === "suspend_both") {
      for (const id of [conflict.ruleAId, conflict.ruleBId]) {
        const rule = await this.p6.findLearningRule(id);
        if (rule?.status === "ACTIVE") {
          await this.suspend(id, actor, note ?? `Conflict ${conflictId}`);
        }
      }
    } else if (resolution === "reject_new") {
      await this.deactivate(conflict.ruleBId, actor, note ?? `Rejected via conflict ${conflictId}`);
    }

    const updated = await this.p6.resolveConflict(conflictId, {
      status: "resolved",
      resolution,
      resolvedBy: actor,
      resolvedAt: new Date(),
      metadata: { note: note ?? null },
    });
    await this.p6.createAuditEvent({
      eventType: "learning.conflict",
      actor,
      targetType: "LearningRuleConflict",
      targetId: conflictId,
      action: resolution,
      summary: note ?? `Conflict resolved: ${resolution}`,
    });
    return updated;
  }

  async detectConflicts(): Promise<unknown[]> {
    const active = await this.p6.listLearningRules({
      status: ["ACTIVE", "AWAITING_APPROVAL", "PROPOSED"],
    });
    const created = [];
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i]!;
        const b = active[j]!;
        const conflict = this.compareRules(a, b);
        if (conflict) {
          created.push(
            await this.p6.createLearningRuleConflict({
              ruleAId: a.id,
              ruleBId: b.id,
              conflictType: conflict.type,
              reason: conflict.reason,
              metadata: { sampleA: a.sampleCount, sampleB: b.sampleCount },
            }),
          );
        }
      }
    }
    return created;
  }

  async listConflicts() {
    return this.p6.listOpenConflicts();
  }

  /** ACTIVE + in-scope + not expired rules for Strategy injection */
  async listInjectableRules(scope: {
    platform?: string;
    contentType?: string;
    genre?: string;
    provider?: string;
  }): Promise<LearningRule[]> {
    await this.expireDueRules();
    const active = await this.p6.listLearningRules({ status: "ACTIVE" });
    return active.filter((rule) => this.matchesScope(rule, scope));
  }

  assertActivationEligibility(rule: LearningRule): void {
    if (!rule.approvedBy || !rule.approvedAt) {
      throw new LearningGovernanceError("Human approval required before ACTIVE", "MISSING_APPROVAL");
    }
    if (rule.sampleCount < rule.minimumSampleCount) {
      throw new LearningGovernanceError(
        `sampleCount ${rule.sampleCount} < minimum ${rule.minimumSampleCount}`,
        "SAMPLE_THRESHOLD",
      );
    }
    if (rule.confidence < rule.minimumConfidence) {
      throw new LearningGovernanceError(
        `confidence ${rule.confidence} < minimum ${rule.minimumConfidence}`,
        "CONFIDENCE_THRESHOLD",
      );
    }
    const success = rule.successRate ?? 0;
    if (success < rule.minimumSuccessRate) {
      throw new LearningGovernanceError(
        `successRate ${success} < minimum ${rule.minimumSuccessRate}`,
        "SUCCESS_THRESHOLD",
      );
    }
    if (!rule.applicablePlatform && !rule.applicableContentType) {
      throw new LearningGovernanceError(
        "applicablePlatform or applicableContentType must be set",
        "MISSING_SCOPE",
      );
    }
    if (rule.validUntil && rule.validUntil <= (rule.validFrom ?? new Date(0))) {
      throw new LearningGovernanceError("validUntil must be after validFrom", "INVALID_WINDOW");
    }
    if (!["AWAITING_APPROVAL", "PROPOSED", "SUSPENDED"].includes(rule.status)) {
      throw new LearningGovernanceError(
        `Cannot activate from status ${rule.status}`,
        "INVALID_STATUS",
      );
    }
  }

  private async detectConflictsForRule(rule: LearningRule) {
    const others = await this.p6.listLearningRules({ status: "ACTIVE" });
    const out = [];
    for (const other of others) {
      if (other.id === rule.id) continue;
      const c = this.compareRules(rule, other);
      if (c) {
        out.push(
          await this.p6.createLearningRuleConflict({
            ruleAId: rule.id,
            ruleBId: other.id,
            conflictType: c.type,
            reason: c.reason,
          }),
        );
      }
    }
    return out;
  }

  private compareRules(
    a: LearningRule,
    b: LearningRule,
  ): { type: string; reason: string } | null {
    const sameScope =
      (a.applicablePlatform ?? null) === (b.applicablePlatform ?? null) &&
      (a.applicableContentType ?? null) === (b.applicableContentType ?? null) &&
      (a.applicableGenre ?? null) === (b.applicableGenre ?? null);

    if (!sameScope && a.applicablePlatform && b.applicablePlatform) return null;

    if (a.ruleType === "headline" && b.ruleType === "headline") {
      const aShort = /40|短い|短く/.test(a.statement);
      const bLong = /長く|60|長め/.test(b.statement);
      const bShort = /40|短い|短く/.test(b.statement);
      const aLong = /長く|60|長め/.test(a.statement);
      if ((aShort && bLong) || (aLong && bShort)) {
        return { type: "title_length", reason: "Conflicting title length guidance" };
      }
    }
    if (a.ruleType === "cta" && b.ruleType === "cta") {
      const aSingle = /単一|1つ|一つのCTA/.test(a.statement);
      const bMulti = /複数|多く/.test(b.statement);
      if ((aSingle && bMulti) || (/複数/.test(a.statement) && /単一|1つ/.test(b.statement))) {
        return { type: "cta", reason: "Conflicting CTA density guidance" };
      }
    }
    if (a.ruleType === "timing" && b.ruleType === "timing") {
      if (/土曜|週末/.test(a.statement) && /平日|月曜/.test(b.statement)) {
        return { type: "timing", reason: "Conflicting publication timing guidance" };
      }
    }
    if (
      sameScope &&
      a.status === "AWAITING_APPROVAL" &&
      b.status === "ACTIVE" &&
      a.sampleCount < b.sampleCount / 2
    ) {
      return {
        type: "sample_override",
        reason: "Low-sample rule would override higher-sample ACTIVE rule",
      };
    }
    if (sameScope && a.ruleType === b.ruleType && /反対|しない|禁止/.test(a.statement) && !/反対|しない|禁止/.test(b.statement)) {
      return { type: "opposite_directive", reason: "Opposite directives in same scope" };
    }
    return null;
  }

  private matchesScope(
    rule: LearningRule,
    scope: {
      platform?: string;
      contentType?: string;
      genre?: string;
      provider?: string;
    },
  ): boolean {
    if (rule.validUntil && rule.validUntil < new Date()) return false;
    if (rule.applicablePlatform && scope.platform && rule.applicablePlatform !== scope.platform) {
      return false;
    }
    if (
      rule.applicableContentType &&
      scope.contentType &&
      rule.applicableContentType !== scope.contentType
    ) {
      return false;
    }
    if (rule.applicableGenre && scope.genre && rule.applicableGenre !== scope.genre) {
      return false;
    }
    if (rule.applicableProvider && scope.provider && rule.applicableProvider !== scope.provider) {
      return false;
    }
    return true;
  }

  private async requireRule(id: string): Promise<LearningRule> {
    const rule = await this.p6.findLearningRule(id);
    if (!rule) throw new LearningGovernanceError(`LearningRule not found: ${id}`, "NOT_FOUND");
    return rule;
  }
}

/** Prepare PROPOSED rules with default governance fields for P6 activation path */
export async function enrichProposedRule(
  p6: P6Repository,
  ruleId: string,
  scope: {
    platform?: string;
    contentType?: string;
    minimumSampleCount?: number;
    minimumConfidence?: number;
    minimumSuccessRate?: number;
    supersedesRuleId?: string;
  },
): Promise<LearningRule> {
  return p6.updateLearningRule(ruleId, {
    applicablePlatform: scope.platform ?? "BLOGGER",
    applicableContentType: scope.contentType ?? "article",
    minimumSampleCount: scope.minimumSampleCount ?? 1,
    minimumConfidence: scope.minimumConfidence ?? 0.4,
    minimumSuccessRate: scope.minimumSuccessRate ?? 0.4,
    supersedesRuleId: scope.supersedesRuleId ?? null,
    status: "PROPOSED",
  });
}
