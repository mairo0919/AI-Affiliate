/**
 * Generic AI / catalog prose detection as plan violation (structural).
 * Not a word blacklist alone — requires lack of new supported evidence.
 */

export type GenericProseFinding = {
  code:
    | "CATALOG_NARRATION"
    | "GENERIC_EVALUATIVE_PADDING"
    | "REFERENCE_TRANSFORM_MISSED"
    | "REFERENCE_PROGRESSION_MISSED";
  message: string;
  severity: "BLOCKING" | "WARNING";
  segment: "lead" | "development" | "article";
};

const GENERIC_SHELL_RE =
  /が特徴(?:です|的)|が展開され|が確認でき|として公開|となっています|内容となっています|見どころ|魅力を放|濃密な内容/;

const EVAL_PAD_RE = /魅力|おすすめ|興奮|話題|最高|必見|堪能|楽しめる/;

const GENERIC_KANJI_BLOCK =
  /特徴|展開|確認|公開|内容|作品|魅力|見どころ|濃密|描写|構成|設定|企画|特別|参加|目的|として/;

function concreteTokens(text: string): string[] {
  return [
    ...(text.match(/\d+\s*(?:名|人|時間|分|作品|泊|日)/g) ?? []),
    ...(text.match(
      /[\u4e00-\u9fffァ-ヶー]{2,12}(?:シーン|シチュ|キス|責め|乱交|ツアー|ベスト|洗脳|姉妹|巨乳|敏感|発掘|育成|出演)/g,
    ) ?? []),
    ...(text.match(/(?:ベロキス|生ハメ|潮吹[きき]?|ピストン|わからせ|痴女|メスガキ)/g) ?? []),
    ...(text.match(/[\u4e00-\u9fff]{2,8}/g) ?? []).filter((t) => !GENERIC_KANJI_BLOCK.test(t)),
  ];
}

function hasNovelEvidence(segmentText: string, priorTokens: Set<string>): boolean {
  const toks = concreteTokens(segmentText);
  return toks.some((t) => t.length >= 2 && !priorTokens.has(t) && ![...priorTokens].some((p) => p.includes(t) || t.includes(p)));
}

export function detectGenericProseViolations(input: {
  lead: string;
  sections: Array<{ paragraphs: string[] }>;
  /** Facts assigned to lead/body — used to judge restatement vs new */
  leadAssignedFacts?: string[];
  bodyAssignedFacts?: string[];
  transformationAvailable?: boolean;
}): { ok: boolean; findings: GenericProseFinding[] } {
  const findings: GenericProseFinding[] = [];
  const lead = input.lead ?? "";
  const bodyParas = input.sections.flatMap((s) => s.paragraphs);
  const body = bodyParas.join("\n");

  const prior = new Set(concreteTokens(lead));
  for (const fact of input.leadAssignedFacts ?? []) {
    for (const t of concreteTokens(fact)) prior.add(t);
  }

  // Body-assigned facts count as "expected novel" — if paragraph realizes them, allow
  const bodyFactTokens = new Set(
    (input.bodyAssignedFacts ?? []).flatMap((f) => concreteTokens(f)),
  );

  for (let i = 0; i < bodyParas.length; i++) {
    const p = bodyParas[i]!;
    const realizesBodyFact = [...bodyFactTokens].some(
      (t) => t.length >= 2 && (p.includes(t) || contributionContains(p, t)),
    );
    const novel = hasNovelEvidence(p, prior) || realizesBodyFact;
    const shell = GENERIC_SHELL_RE.test(p);
    if (shell && !novel) {
      findings.push({
        code: "CATALOG_NARRATION",
        message: `development paragraph ${i} uses generic shell without new supported evidence`,
        severity: "BLOCKING",
        segment: "development",
      });
    }
    if (EVAL_PAD_RE.test(p) && !novel && p.replace(/\s+/g, "").length < 80) {
      findings.push({
        code: "GENERIC_EVALUATIVE_PADDING",
        message: `development paragraph ${i} evaluative padding without new fact`,
        severity: "BLOCKING",
        segment: "development",
      });
    }
    for (const t of concreteTokens(p)) prior.add(t);
  }

  if (input.transformationAvailable) {
    const leadFacts = (input.leadAssignedFacts ?? []).join(" ");
    const restatesTitleOnly =
      body.replace(/\s+/g, "").length > 40 &&
      !hasNovelEvidence(body, new Set(concreteTokens(leadFacts))) &&
      ![...bodyFactTokens].some((t) => t.length >= 2 && body.includes(t)) &&
      GENERIC_SHELL_RE.test(body);
    if (restatesTitleOnly) {
      findings.push({
        code: "REFERENCE_TRANSFORM_MISSED",
        message: "transformation contract present but body fell back to generic claim/title restatement",
        severity: "BLOCKING",
        segment: "article",
      });
    }
    const bodyHasProgression =
      hasNovelEvidence(body, new Set(concreteTokens(lead))) ||
      [...bodyFactTokens].some((t) => t.length >= 2 && body.includes(t));
    if (
      (input.bodyAssignedFacts ?? []).length > 0 &&
      !bodyHasProgression &&
      concreteTokens(body).every((t) => concreteTokens(lead).includes(t))
    ) {
      findings.push({
        code: "REFERENCE_PROGRESSION_MISSED",
        message: "next-segment evidence available but body only re-explains lead evidence",
        severity: "BLOCKING",
        segment: "development",
      });
    }
  }

  // Lead-only generic shell with no concrete token at all
  if (GENERIC_SHELL_RE.test(lead) && concreteTokens(lead).length === 0) {
    findings.push({
      code: "CATALOG_NARRATION",
      message: "lead is generic shell without concrete evidence",
      severity: "BLOCKING",
      segment: "lead",
    });
  }

  return { ok: findings.length === 0, findings };
}

function contributionContains(text: string, token: string): boolean {
  return text.includes(token);
}
