import { X_POST_PROMPT_VERSION } from "./prompt-types.js";
import type { PromptDefinition } from "./prompt-types.js";

export const xPostPrompt: PromptDefinition = {
  version: X_POST_PROMPT_VERSION,
  build: (params) =>
    [
      "Generate an X_POST as JSON.",
      `Keep body+URL within ${String(params.maxLength ?? 140)} characters.`,
      "Include product name, 1-2 factual highlights, CTA, affiliateUrl, hashtags.",
      `Angle: ${String(params.contentAngle ?? "GENERIC")}`,
      `Input JSON: ${JSON.stringify(params.input ?? {})}`,
      params.instruction ? `Revision instruction: ${String(params.instruction)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
};
