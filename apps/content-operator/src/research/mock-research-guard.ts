/**
 * Prevent accidental MockResearchProvider DB writes in production.
 * Diagnostic/import paths must set RESEARCH_ALLOW_MOCK_AGENT=true explicitly.
 */

import { pathToFileURL } from "node:url";

export function assertMockResearchAllowed(
  nodeEnv: string = process.env.NODE_ENV ?? "development",
  env: NodeJS.ProcessEnv = process.env,
): void {
  const allow = env.RESEARCH_ALLOW_MOCK_AGENT === "true";
  if (nodeEnv === "production" && !allow) {
    throw new Error(
      "Mock research agent is disabled in production. Set RESEARCH_ALLOW_MOCK_AGENT=true only for explicit diagnostics.",
    );
  }
}

/** True only when this module is the process entry (not a dynamic import). */
export function isDirectNodeEntry(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}
