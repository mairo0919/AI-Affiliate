import { SHORT_VIDEO_PROMPT_VERSION } from "./prompt-types.js";
import type { PromptDefinition } from "./prompt-types.js";

export const shortVideoPrompt: PromptDefinition = {
  version: SHORT_VIDEO_PROMPT_VERSION,
  build: (params) =>
    [
      "Generate a SHORT_VIDEO_SCRIPT as JSON.",
      "Duration 15-45 seconds.",
      "Include hook, scenes (narration/onScreenText), CTA, estimatedDurationSeconds.",
      "Do not assert that images/videos exist unless allowedImages is non-empty.",
      "If no confirmed media, write a script that does not require media assets.",
      `Input JSON: ${JSON.stringify(params.input ?? {})}`,
      params.instruction ? `Revision instruction: ${String(params.instruction)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
};
