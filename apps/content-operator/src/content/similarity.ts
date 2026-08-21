/**
 * Dice coefficient over character bigrams — suitable for Japanese without tokenization.
 */
export function similarityScore(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }

  const bigrams = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    const normalized = text.replace(/\s+/g, "");
    for (let i = 0; i < normalized.length - 1; i += 1) {
      const gram = normalized.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };

  const aMap = bigrams(left);
  const bMap = bigrams(right);
  if (aMap.size === 0 || bMap.size === 0) {
    // Fallback: longest common substring ratio for short texts
    return longestCommonSubstringRatio(left, right);
  }

  let intersection = 0;
  for (const [gram, count] of aMap) {
    const other = bMap.get(gram);
    if (other) {
      intersection += Math.min(count, other);
    }
  }
  const total = [...aMap.values()].reduce((s, n) => s + n, 0) +
    [...bMap.values()].reduce((s, n) => s + n, 0);
  const dice = (2 * intersection) / total;
  const lcs = longestCommonSubstringRatio(left, right);
  return Math.max(dice, lcs);
}

function longestCommonSubstringRatio(a: string, b: string): number {
  const left = a.replace(/\s+/g, "");
  const right = b.replace(/\s+/g, "");
  if (!left || !right) {
    return 0;
  }
  const m = left.length;
  const n = right.length;
  let maxLen = 0;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > maxLen) {
          maxLen = curr[j];
        }
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return maxLen / Math.min(m, n);
}
