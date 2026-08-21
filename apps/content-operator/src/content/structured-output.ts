import { z } from "zod";
import type { StructuredContentOutput } from "./types.js";

export const structuredContentOutputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  summary: z.string().optional(),
  hashtags: z.array(z.string()).default([]),
  callToAction: z.string().optional(),
  metadata: z
    .object({
      estimatedDurationSeconds: z.number().optional(),
      contentAngle: z.string().optional(),
      hook: z.string().optional(),
      narration: z.string().optional(),
      onScreenText: z.string().optional(),
      scenes: z
        .array(
          z.object({
            order: z.number(),
            narration: z.string().optional(),
            onScreenText: z.string().optional(),
            hook: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export function parseStructuredOutput(raw: unknown): StructuredContentOutput {
  return structuredContentOutputSchema.parse(raw);
}

export function tryParseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Single-shot repair: wrap incomplete JSON fragments into a minimal object if possible.
 * Never loops — caller must invoke at most once.
 */
export function repairStructuredJsonOnce(rawText: string): string | null {
  const parsed = tryParseJsonObject(rawText);
  if (parsed && typeof parsed === "object") {
    try {
      const validated = structuredContentOutputSchema.safeParse(parsed);
      if (validated.success) {
        return JSON.stringify(validated.data);
      }
      const record = parsed as Record<string, unknown>;
      const repaired = {
        title: typeof record.title === "string" ? record.title : "Untitled",
        body: typeof record.body === "string" ? record.body : String(record.body ?? ""),
        summary: typeof record.summary === "string" ? record.summary : undefined,
        hashtags: Array.isArray(record.hashtags)
          ? record.hashtags.filter((h): h is string => typeof h === "string")
          : [],
        callToAction:
          typeof record.callToAction === "string" ? record.callToAction : undefined,
        metadata:
          record.metadata && typeof record.metadata === "object"
            ? (record.metadata as StructuredContentOutput["metadata"])
            : undefined,
      };
      const again = structuredContentOutputSchema.safeParse(repaired);
      if (again.success) {
        return JSON.stringify(again.data);
      }
    } catch {
      return null;
    }
  }

  // Last-resort: treat entire text as body if non-empty
  if (rawText.trim().length > 0) {
    const fallback = {
      title: "Generated content",
      body: rawText.trim().slice(0, 2000),
      hashtags: [] as string[],
    };
    const ok = structuredContentOutputSchema.safeParse(fallback);
    return ok.success ? JSON.stringify(ok.data) : null;
  }
  return null;
}
