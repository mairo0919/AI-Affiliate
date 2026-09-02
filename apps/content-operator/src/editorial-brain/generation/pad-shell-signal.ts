/**
 * R102 pad-shell eligibility — zero-concrete padding only, not reviewer entailment.
 */

const PAD_SHELL_CLOSING_RE =
  /内容となっている|観る者を惹きつけ|見る者を圧倒|一層の熱を加え|熱量を放つ|世界観を深め|雰囲気を醸し|ファンを飽きさせない|見逃せない内容|最大限に引き出|情熱に|見応えがある/;

const PAD_EVAL_CLOSE_RE =
  /おすすめ|必見|見逃せない|楽しめる|堪能|見どころ|魅力を高|魅力的|を惹きつけ|見る者を/;

const PAD_INTERPRETIVE_RE = /見た目とは裏腹|ギャップが|意外に/;

export function hasPadShellSignal(sentence: string): boolean {
  return (
    PAD_SHELL_CLOSING_RE.test(sentence) ||
    PAD_EVAL_CLOSE_RE.test(sentence) ||
    PAD_INTERPRETIVE_RE.test(sentence)
  );
}

export function hasInterpretivePadShell(sentence: string): boolean {
  return PAD_INTERPRETIVE_RE.test(sentence);
}
