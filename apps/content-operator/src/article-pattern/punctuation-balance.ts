/**
 * R151 — Reader-facing punctuation balance for ArticlePlan facts.
 *
 * Planner-only: Writer must not be asked to close orphan brackets.
 */

const PAIR_OPEN: Record<string, string> = {
  "【": "】",
  "「": "」",
  "『": "』",
  "（": "）",
  "(": ")",
  "[": "]",
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collect SOURCE strings that may attest balanced punctuation. */
export function sourcePunctuationHints(input: {
  productTitle: string;
  extraTexts?: string[];
}): string[] {
  const out: string[] = [];
  const push = (s: string | undefined | null) => {
    const t = (s ?? "").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(input.productTitle);
  for (const t of input.extraTexts ?? []) push(t);
  return out;
}

/**
 * Balance paired punctuation using SOURCE attestation.
 * - If SOURCE has full balanced form → use it
 * - If SOURCE has adjacent closing shard (】…) → close only
 * - If unconfirmed → strip orphan opener (no content invention)
 */
export function balanceReaderFacingPunctuation(
  fact: string,
  sourceTexts: string[],
): string {
  let f = (fact ?? "").trim();
  if (!f) return f;

  for (const [open, close] of Object.entries(PAIR_OPEN)) {
    if (!f.includes(open)) continue;
    const innerMatch = f.match(new RegExp(`${escapeRe(open)}([^${escapeRe(close)}]+)${escapeRe(close)}?`));
    if (!innerMatch) continue;
    const inner = innerMatch[1]!;
    const alreadyBalanced = f.includes(`${open}${inner}${close}`);
    if (alreadyBalanced) continue;

    for (const src of sourceTexts) {
      const balanced = src.match(
        new RegExp(`${escapeRe(open)}${escapeRe(inner)}${escapeRe(close)}`),
      );
      if (balanced) {
        f = balanced[0];
        break;
      }
    }

    if (!f.includes(close)) {
      const closingShard = sourceTexts.some((src) =>
        new RegExp(`^${escapeRe(close)}`).test(src.trim()),
      );
      if (closingShard) {
        f = `${open}${inner}${close}`;
      } else {
        f = inner;
      }
    }
  }

  return f;
}

/** Repair bracket-split fragments; merge orphan 【 / 】 shards via SOURCE. */
export function repairBracketSplitPlanFacts(
  facts: string[],
  productTitle: string,
  sourceTexts: string[] = [],
): string[] {
  const hints = sourcePunctuationHints({ productTitle, extraTexts: sourceTexts });
  const title = productTitle.trim();
  const out: string[] = [];

  for (const raw of facts) {
    const f = raw.trim();
    if (!f) continue;

    if (f.startsWith("】") && title.startsWith("【")) {
      const merged = balanceReaderFacingPunctuation(title, [...hints, f]);
      if (merged && !out.includes(merged)) out.push(merged);
      continue;
    }

    if (f.startsWith("【") && !f.includes("】") && title.includes(f.slice(0, 8))) {
      const merged = balanceReaderFacingPunctuation(f, hints);
      if (merged && !out.includes(merged)) {
        out.push(merged);
        continue;
      }
    }

    const balanced = balanceReaderFacingPunctuation(f, hints);
    if (!out.includes(balanced)) out.push(balanced);
  }

  return out;
}

export function hasOrphanPairedPunctuation(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  for (const [open, close] of Object.entries(PAIR_OPEN)) {
    const opens = (t.match(new RegExp(escapeRe(open), "g")) ?? []).length;
    const closes = (t.match(new RegExp(escapeRe(close), "g")) ?? []).length;
    if (opens !== closes) return true;
  }
  return false;
}
