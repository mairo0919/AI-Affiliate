import type { LifecycleRepository, PromptDefinition } from "@ai-affiliate/database";

export class PromptService {
  constructor(private readonly repo: LifecycleRepository) {}

  async getPrompt(identifier: string, version?: string): Promise<PromptDefinition> {
    const prompt = await this.repo.findPromptDefinition(identifier, version);
    if (!prompt || !prompt.enabled) {
      throw new Error(`PromptDefinition not found or disabled: ${identifier}@${version ?? "latest"}`);
    }
    return prompt;
  }

  render(prompt: PromptDefinition, vars: Record<string, unknown>): {
    systemInstruction: string;
    userPrompt: string;
    outputSchema: Record<string, unknown> | null;
  } {
    const systemInstruction =
      prompt.systemInstruction?.trim() ||
      "You are a careful Japanese adult-affiliate content operator. Prefer facts from claims. Avoid purple prose and unverified superlatives. Return JSON only.";
    const template = prompt.inputTemplate?.trim() || prompt.body;
    const userPrompt = renderTemplate(template, vars);
    const outputSchema =
      prompt.outputSchema && typeof prompt.outputSchema === "object"
        ? (prompt.outputSchema as Record<string, unknown>)
        : null;
    return { systemInstruction, userPrompt, outputSchema };
  }
}

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const value = key.split(".").reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, vars);
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  });
}
