import type { AppConfig } from "@ai-affiliate/config";
import type { XOpsRepository } from "@ai-affiliate/database";
import type { Logger } from "@ai-affiliate/shared";

export interface XRuntimeControlServiceDeps {
  logger: Logger;
  config: AppConfig;
  ops: XOpsRepository;
  now?: () => Date;
  notifications?: {
    emitXEvent?: (
      eventType: "X_KILL_SWITCH_ENABLED" | "X_RELEASE_MODE_CHANGED",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  };
}

export class XRuntimeControlService {
  private readonly now: () => Date;

  constructor(private readonly deps: XRuntimeControlServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async status(): Promise<{
    envKillSwitch: boolean;
    dbKillSwitch: boolean;
    publishingPaused: boolean;
    metricsPaused: boolean;
    optimizationPaused: boolean;
    effectivePublishingBlocked: boolean;
    releaseMode: AppConfig["xReleaseMode"];
    controls: Array<{ key: string; value: string; reason: string | null; changedBy: string | null }>;
  }> {
    const dbKill = await this.deps.ops.isControlActive("GLOBAL_KILL_SWITCH", this.now());
    const publishingPaused = await this.deps.ops.isControlActive(
      "PUBLISHING_PAUSED",
      this.now(),
    );
    const metricsPaused = await this.deps.ops.isControlActive("METRICS_PAUSED", this.now());
    const optimizationPaused = await this.deps.ops.isControlActive(
      "OPTIMIZATION_PAUSED",
      this.now(),
    );
    const controls = await this.deps.ops.listRuntimeControls();
    return {
      envKillSwitch: this.deps.config.xGlobalKillSwitch,
      dbKillSwitch: dbKill,
      publishingPaused,
      metricsPaused,
      optimizationPaused,
      effectivePublishingBlocked:
        this.deps.config.xGlobalKillSwitch || dbKill || publishingPaused,
      releaseMode: this.deps.config.xReleaseMode,
      controls: controls.map((c) => ({
        key: c.key,
        value: c.value,
        reason: c.reason,
        changedBy: c.changedBy,
      })),
    };
  }

  async pause(options: {
    key?: string;
    changedBy: string;
    reason: string;
  }): Promise<void> {
    if (!options.changedBy?.trim() || !options.reason?.trim()) {
      throw new Error("pause requires changedBy and reason");
    }
    const key = options.key ?? "GLOBAL_KILL_SWITCH";
    await this.deps.ops.setRuntimeControl({
      key,
      value: "true",
      reason: options.reason,
      changedBy: options.changedBy,
    });
    await this.deps.ops.writeAudit({
      action: "RUNTIME_PAUSE",
      actorType: "ADMIN",
      actorId: options.changedBy,
      entityType: "XRuntimeControl",
      entityId: key,
      result: "SUCCESS",
      reason: options.reason,
      releaseMode: this.deps.config.xReleaseMode,
      metadata: { key, value: "true" },
    });
    if (key === "GLOBAL_KILL_SWITCH" || key === "PUBLISHING_PAUSED") {
      await this.deps.notifications?.emitXEvent?.("X_KILL_SWITCH_ENABLED", {
        key,
        reason: options.reason,
      });
    }
  }

  async resume(options: {
    key?: string;
    changedBy: string;
    reason: string;
  }): Promise<void> {
    if (!options.changedBy?.trim() || !options.reason?.trim()) {
      throw new Error("resume requires administrator name and reason");
    }
    const key = options.key ?? "GLOBAL_KILL_SWITCH";
    await this.deps.ops.setRuntimeControl({
      key,
      value: "false",
      reason: options.reason,
      changedBy: options.changedBy,
    });
    await this.deps.ops.writeAudit({
      action: "RUNTIME_RESUME",
      actorType: "ADMIN",
      actorId: options.changedBy,
      entityType: "XRuntimeControl",
      entityId: key,
      result: "SUCCESS",
      reason: options.reason,
      releaseMode: this.deps.config.xReleaseMode,
      metadata: { key, value: "false" },
    });
  }
}
