import { PRODUCT_INTRODUCTION_PROMPT_VERSION } from "./prompt-types.js";
import type { PromptDefinition } from "./prompt-types.js";

export const productIntroductionPrompt: PromptDefinition = {
  version: PRODUCT_INTRODUCTION_PROMPT_VERSION,
  build: (params) =>
    [
      "Generate a PRODUCT_INTRODUCTION as plain-text JSON (no HTML).",
      "Length roughly 100-300 Japanese characters.",
      "Fact-focused with CTA.",
      `Input JSON: ${JSON.stringify(params.input ?? {})}`,
      params.instruction ? `Revision instruction: ${String(params.instruction)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
};
