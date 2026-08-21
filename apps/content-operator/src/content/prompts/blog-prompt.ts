import { BLOG_PROMPT_VERSION } from "./prompt-types.js";
import type { PromptDefinition } from "./prompt-types.js";

export const blogPrompt: PromptDefinition = {
  version: BLOG_PROMPT_VERSION,
  build: (params) =>
    [
      "Generate a BLOG_ARTICLE as JSON.",
      "Target length roughly 800-1500 Japanese characters when facts allow; shorter is OK if facts are scarce.",
      "Include: title, introduction, basic facts, notable points from metrics/tags only,",
      "numeric facts, suitable audience (generic), notes, CTA, affiliate disclosure.",
      "Do not fabricate plot/感想.",
      `Input JSON: ${JSON.stringify(params.input ?? {})}`,
      params.instruction ? `Revision instruction: ${String(params.instruction)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
};
