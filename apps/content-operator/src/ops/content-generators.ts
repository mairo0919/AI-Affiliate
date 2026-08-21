/**
 * Rule-based Blogger / X draft generation.
 *
 * Role (P4.5+): Mock / fallback / test fixture / LLM-outage human-review draft only.
 * Must not be used as an implicit production publish path.
 * Callers must mark output as manual_review_required (OpsService does this).
 */

export interface GeneratedArticleDraft {
  title: string;
  summary: string;
  body: string;
  seo: {
    metaDescription: string;
    labels: string[];
    canonicalCandidate: string | null;
  };
  channel: "BLOGGER";
}

export interface GeneratedXPostDraft {
  title: string;
  summary: string;
  body: string;
  weightedLengthApprox: number;
  channel: "X";
}

function clampXBody(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if ([...normalized].length <= max) return normalized;
  return `${[...normalized].slice(0, max - 1).join("")}…`;
}

export function generateBloggerArticle(input: {
  productTitle: string;
  productUrl?: string | null;
  topicTitle: string;
  claimStatements?: string[];
  unmonetized?: boolean;
}): GeneratedArticleDraft {
  const title = `${input.productTitle} の概要と選び方のポイント`;
  const ctaUrl = input.productUrl?.trim() || null;
  const claims = (input.claimStatements ?? []).slice(0, 3);
  const claimBlock =
    claims.length > 0
      ? ["", "## 確認できた点", ...claims.map((c) => `- ${c}`)].join("\n")
      : "";

  const body = [
    `# ${title}`,
    "",
    `${input.topicTitle} に関連するカタログ情報の整理です。`,
    "本記事はアフィリエイト広告を含む場合があります。",
    "",
    "## 概要",
    `${input.productTitle} について、公開情報ベースの要点をまとめます。`,
    "露骨な描写や未確認の断定は行いません。",
    claimBlock,
    "",
    "## 導線",
    ctaUrl
      ? `詳細は次のページを参照してください: ${ctaUrl}`
      : "現時点では確定した商品リンクがありません（未収益化／リンク準備中）。",
    "",
    "## 注意",
    "18歳未満の方は対象外です。利用規約と表示内容を確認のうえご利用ください。",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return {
    title,
    summary: `${input.productTitle} の概要記事（抽象ドラフト）`,
    body,
    seo: {
      metaDescription: `${input.productTitle} の概要と注意点。アフィリエイト表記あり。`,
      labels: ["catalog", "overview", input.unmonetized ? "unmonetized" : "affiliate"],
      canonicalCandidate: ctaUrl,
    },
    channel: "BLOGGER",
  };
}

export function generateXPost(input: {
  productTitle: string;
  productUrl?: string | null;
  bloggerUrl?: string | null;
}): GeneratedXPostDraft {
  const link = input.bloggerUrl?.trim() || input.productUrl?.trim() || "";
  const core = link
    ? `${input.productTitle} の概要をまとめました。詳細はこちら ${link} ※アフィリエイト広告を含む場合があります`
    : `${input.productTitle} の概要メモ。リンク準備中 ※アフィリエイト広告を含む場合があります`;
  const body = clampXBody(core, 140);
  return {
    title: `X: ${input.productTitle}`,
    summary: "Short X post draft",
    body,
    weightedLengthApprox: [...body].length,
    channel: "X",
  };
}
