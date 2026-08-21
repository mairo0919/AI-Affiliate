/**
 * Editorial Brain runtime mode SSOT.
 * Production default remains SHADOW until an explicit ops switch.
 */

import type { BrainRunMode } from "./types.js";

export type EditorialBrainMode = BrainRunMode;

let overrideMode: EditorialBrainMode | null = null;

/**
 * Resolve EDITORIAL_BRAIN_MODE from production env.
 * Unset / invalid → SHADOW (fail safe — never accidental ACTIVE).
 * Production ACTIVE requires explicit EDITORIAL_BRAIN_MODE=ACTIVE in env.
 */
export function resolveEditorialBrainMode(
  envValue: string | undefined = process.env.EDITORIAL_BRAIN_MODE,
): EditorialBrainMode {
  if (overrideMode) return overrideMode;
  const v = (envValue ?? "SHADOW").trim().toUpperCase();
  if (v === "ACTIVE") return "ACTIVE";
  return "SHADOW";
}

/** Test/simulation only — never used to flip production default. */
export function withEditorialBrainModeOverride<T>(
  mode: EditorialBrainMode,
  fn: () => T,
): T {
  const prev = overrideMode;
  overrideMode = mode;
  try {
    return fn();
  } finally {
    overrideMode = prev;
  }
}

export async function withEditorialBrainModeOverrideAsync<T>(
  mode: EditorialBrainMode,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = overrideMode;
  overrideMode = mode;
  try {
    return await fn();
  } finally {
    overrideMode = prev;
  }
}

export function isEditorialBrainActive(
  envValue?: string,
): boolean {
  return resolveEditorialBrainMode(envValue) === "ACTIVE";
}
