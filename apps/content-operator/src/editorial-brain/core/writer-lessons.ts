/**
 * Writer lessons: what the Brain has learned about wording, kept in EditorialExperience and handed
 * back to the WP and X writers as advice. Rows come from rejected drafts (SYSTEM_VALIDATOR) and from
 * people fixing published text (HUMAN_FEEDBACK). Advice is guidance for the writer, not a reject list.
 */

export const WRITER_LESSON_KIND = "WRITER_LESSON";
export type WriterLessonChannel = "X" | "BLOG";

type LessonRow = { sourceType: string; lesson: unknown; createdAt: Date };

export type WriterLessonDb = {
  editorialExperience: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: Record<string, unknown>): Promise<LessonRow[]>;
  };
};

export type WriterLessonInput = {
  channel: WriterLessonChannel;
  sourceType: "SYSTEM_VALIDATOR" | "HUMAN_FEEDBACK";
  outcome: string;
  codes?: string[];
  /** Words or phrases the writer should not use again. */
  avoid?: string[];
  /** One sentence of advice in Japanese, from a person. */
  advice?: string | null;
  contentVersionId?: string | null;
};

type StoredLesson = { kind: string; avoid: string[]; advice: string | null; codes: string[] };

function readLesson(raw: unknown): StoredLesson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== WRITER_LESSON_KIND) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    kind: WRITER_LESSON_KIND,
    avoid: strings(r.avoid),
    advice: typeof r.advice === "string" && r.advice.trim() ? r.advice.trim() : null,
    codes: strings(r.codes),
  };
}

/** Best effort: a failed write never blocks generation. */
export async function recordWriterLesson(db: WriterLessonDb | null | undefined, input: WriterLessonInput): Promise<void> {
  const avoid = [...new Set((input.avoid ?? []).map((w) => w.trim()).filter((w) => w.length >= 2 && w.length <= 30))];
  const advice = input.advice?.trim() || null;
  if (!db || (avoid.length === 0 && !advice)) return;
  try {
    await db.editorialExperience.create({
      data: {
        scope: "CHANNEL",
        channel: input.channel,
        contentType: input.channel === "X" ? "x-post" : "blogger-article",
        failureCodes: input.codes ?? [],
        outcome: input.outcome,
        sourceType: input.sourceType,
        confidence: input.sourceType === "HUMAN_FEEDBACK" ? 0.9 : 0.4,
        contentVersionId: input.contentVersionId ?? null,
        lesson: { kind: WRITER_LESSON_KIND, avoid, advice, codes: input.codes ?? [] },
      },
    });
  } catch {
    // Experience write is best-effort
  }
}

/** The word a code review named in its finding (ungrounded word, promo phrase, ad line). */
export function avoidWordsFromFindings(findings: Array<{ message: string }>): string[] {
  const out: string[] = [];
  for (const f of findings) {
    const m = f.message.match(/^(?:ungrounded word|ai phrase|ad copy): (.+)$/u);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

/**
 * Advice lines for the writer from the last `days` of lessons. People's advice is always kept;
 * a word is listed once a person removed it, or once two rejected drafts used it.
 */
export function summarizeWriterLessons(rows: LessonRow[], opts?: { maxAdvice?: number; maxWords?: number }): string[] {
  const maxAdvice = opts?.maxAdvice ?? 6;
  const maxWords = opts?.maxWords ?? 12;
  const advice: string[] = [];
  const score = new Map<string, number>();
  for (const row of [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const lesson = readLesson(row.lesson);
    if (!lesson) continue;
    const human = row.sourceType === "HUMAN_FEEDBACK";
    if (human && lesson.advice && !advice.includes(lesson.advice)) advice.push(lesson.advice);
    for (const word of lesson.avoid) score.set(word, (score.get(word) ?? 0) + (human ? 2 : 1));
  }
  const words = [...score.entries()]
    .filter(([, s]) => s >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords)
    .map(([w]) => w);
  const lines = advice.slice(0, maxAdvice);
  if (words.length) lines.push(`次の語は使わない（過去の不合格や手直しで外したもの）: ${words.join("、")}`);
  return lines;
}

export async function loadWriterAdvice(
  db: WriterLessonDb | null | undefined,
  channel: WriterLessonChannel,
  now: Date = new Date(),
  days = 30,
): Promise<string[]> {
  if (!db) return [];
  try {
    const rows = await db.editorialExperience.findMany({
      where: {
        channel,
        createdAt: { gte: new Date(now.getTime() - days * 86_400_000) },
        lesson: { path: ["kind"], equals: WRITER_LESSON_KIND },
      },
      select: { sourceType: true, lesson: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    return summarizeWriterLessons(rows);
  } catch {
    return [];
  }
}
