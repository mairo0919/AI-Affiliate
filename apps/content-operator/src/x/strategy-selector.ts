import type { AppConfig } from "@ai-affiliate/config";
import type {
  XPublicationExperiment,
  XPublicationRepository,
  XPublicationStrategyType,
} from "@ai-affiliate/database";
import { strategyTypeToSlug } from "./types.js";

const AUTO_DEFAULT: XPublicationStrategyType[] = [
  "SINGLE_POST",
  "ROOT_WITH_REPLY",
  "RELATED_POST_LINK",
  "CONTROL",
];

function parseVariantList(raw: unknown): XPublicationStrategyType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        const upper = entry.trim().toUpperCase().replace(/-/g, "_");
        return upper as XPublicationStrategyType;
      }
      if (entry && typeof entry === "object" && "strategyType" in entry) {
        const value = String((entry as { strategyType: string }).strategyType)
          .trim()
          .toUpperCase()
          .replace(/-/g, "_");
        return value as XPublicationStrategyType;
      }
      return null;
    })
    .filter((v): v is XPublicationStrategyType => v != null);
}

function parseWeights(raw: unknown): Map<XPublicationStrategyType, number> {
  const map = new Map<XPublicationStrategyType, number>();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const row = entry as { strategyType?: string; weight?: number };
      if (row.strategyType) {
        const key = row.strategyType.trim().toUpperCase().replace(/-/g, "_") as XPublicationStrategyType;
        map.set(key, typeof row.weight === "number" ? row.weight : 1);
      }
    }
  }
  return map;
}

export interface StrategySelectionResult {
  strategyType: XPublicationStrategyType;
  experimentGroup?: string;
  reason: string;
  explored: boolean;
}

export class XStrategySelector {
  private roundRobinCursor = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly publications: XPublicationRepository,
    private readonly random: () => number = Math.random,
  ) {}

  resolveAutoEnabledTypes(): XPublicationStrategyType[] {
    const fromConfig = this.config.xStrategyAutoEnabledTypes
      .map((slug) => slug.trim().toUpperCase().replace(/-/g, "_") as XPublicationStrategyType)
      .filter((t) => AUTO_DEFAULT.includes(t) || ["SINGLE_POST", "ROOT_WITH_REPLY", "RELATED_POST_LINK", "CONTROL"].includes(t));
    // THREAD / HUB_POST excluded from auto by default
    return (fromConfig.length > 0 ? fromConfig : AUTO_DEFAULT).filter(
      (t) => t !== "THREAD" && t !== "HUB_POST",
    );
  }

  async select(options: {
    availableTypes?: XPublicationStrategyType[];
    hasRelated?: boolean;
    forceType?: XPublicationStrategyType;
  }): Promise<StrategySelectionResult> {
    if (options.forceType) {
      return {
        strategyType: options.forceType,
        reason: "manual",
        explored: false,
      };
    }

    let candidates = options.availableTypes ?? this.resolveAutoEnabledTypes();
    if (!options.hasRelated) {
      candidates = candidates.filter((t) => t !== "RELATED_POST_LINK");
    }
    if (candidates.length === 0) {
      candidates = ["SINGLE_POST", "CONTROL"];
    }

    const experiment = await this.publications.findRunningExperiment();
    if (experiment) {
      return this.selectFromExperiment(experiment, candidates);
    }

    // Exploration: pick uniform random among candidates with exploration rate
    const explorationRate = Math.max(0.05, this.config.xStrategyExplorationRate);
    const explore = this.random() < explorationRate;

    // Auto optimization disabled: never change allocation based on scores
    if (!this.config.xStrategyAutoOptimizationEnabled || explore) {
      if (this.config.xStrategySelectionMode === "random" || explore) {
        const picked = candidates[Math.floor(this.random() * candidates.length)]!;
        return {
          strategyType: picked,
          reason: explore ? "exploration" : "random",
          explored: explore,
        };
      }
      if (this.config.xStrategySelectionMode === "weighted") {
        return {
          strategyType: this.pickWeighted(candidates, new Map()),
          reason: "weighted-uniform",
          explored: false,
        };
      }
      // round-robin (default) and sample-insufficient path
      const index = this.roundRobinCursor % candidates.length;
      this.roundRobinCursor += 1;
      return {
        strategyType: candidates[index]!,
        reason: "round-robin",
        explored: false,
      };
    }

    // Auto optimization enabled but keep exploration above — already handled explore branch.
    // Fall back to round-robin among candidates (scores inform recommendation only).
    const index = this.roundRobinCursor % candidates.length;
    this.roundRobinCursor += 1;
    return {
      strategyType: candidates[index]!,
      reason: "round-robin-with-recommendation-only",
      explored: false,
    };
  }

  private async selectFromExperiment(
    experiment: XPublicationExperiment,
    fallback: XPublicationStrategyType[],
  ): Promise<StrategySelectionResult> {
    const variants = parseVariantList(experiment.strategyVariants);
    const pool = (variants.length > 0 ? variants : fallback).filter((t) =>
      fallback.includes(t) || variants.includes(t),
    );
    const effective = pool.length > 0 ? pool : fallback;
    const group = experiment.name;

    if (experiment.allocationMethod === "RANDOM") {
      const picked = effective[Math.floor(this.random() * effective.length)]!;
      return {
        strategyType: picked,
        experimentGroup: group,
        reason: "experiment-random",
        explored: false,
      };
    }

    if (experiment.allocationMethod === "WEIGHTED") {
      const weights = parseWeights(experiment.strategyVariants);
      return {
        strategyType: this.pickWeighted(effective, weights),
        experimentGroup: group,
        reason: "experiment-weighted",
        explored: false,
      };
    }

    if (experiment.allocationMethod === "MANUAL") {
      return {
        strategyType: effective[0]!,
        experimentGroup: group,
        reason: "experiment-manual",
        explored: false,
      };
    }

    // ROUND_ROBIN
    const cursor = await this.publications.incrementExperimentCursor(experiment.id);
    const picked = effective[(cursor - 1) % effective.length]!;
    return {
      strategyType: picked,
      experimentGroup: group,
      reason: "experiment-round-robin",
      explored: false,
    };
  }

  private pickWeighted(
    candidates: XPublicationStrategyType[],
    weights: Map<XPublicationStrategyType, number>,
  ): XPublicationStrategyType {
    const entries = candidates.map((c) => ({
      type: c,
      weight: Math.max(0.01, weights.get(c) ?? 1),
    }));
    const total = entries.reduce((s, e) => s + e.weight, 0);
    let r = this.random() * total;
    for (const entry of entries) {
      r -= entry.weight;
      if (r <= 0) return entry.type;
    }
    return entries[entries.length - 1]!.type;
  }

  describeTypes(types: XPublicationStrategyType[]): string {
    return types.map(strategyTypeToSlug).join(",");
  }
}
