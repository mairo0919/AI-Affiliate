"use client";

import { useEffect, useState } from "react";
import type { DashboardDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

const LINKS: Array<{ key: keyof DashboardDto; label: string; href: string }> = [
  { key: "awaitingContentApprovals", label: "Content承認待ち", href: "/content-review" },
  { key: "awaitingPublicationApprovals", label: "Publication承認待ち", href: "/publications" },
  { key: "unmatchedAttributions", label: "Attribution未照合", href: "/attributions" },
  { key: "awaitingLearningRules", label: "LearningRule承認待ち", href: "/learning-rules" },
  { key: "openRuleConflicts", label: "Rule競合", href: "/conflicts" },
  { key: "awaitingExperiments", label: "Experiment承認待ち", href: "/experiments" },
  { key: "awaitingLinkReplacements", label: "リンク差し替え承認待ち", href: "/link-replacements" },
  { key: "manualReviewJobs", label: "MANUAL_REVIEW Jobs", href: "/jobs" },
  { key: "failedJobs", label: "FAILED Jobs", href: "/jobs" },
  { key: "bloggerDraftPending", label: "Blogger Draft待ち", href: "/publications" },
  { key: "xExportPending", label: "X Export待ち", href: "/publications" },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardDto>("/dashboard")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div>
        <h1>Dashboard</h1>
        <p className="error">{error}</p>
        <a href="/login">Login</a>
      </div>
    );
  }
  if (!data) return <p>Loading…</p>;

  return (
    <div>
      <h1>Operations Dashboard</h1>
      <p className="muted">承認・照合・Job復旧の判断キュー。華美な売上BIはここでは扱いません。</p>
      <div className="grid">
        {LINKS.map((item) => (
          <a key={item.key} className="stat" href={item.href}>
            <span>{item.label}</span>
            <strong>{String(data[item.key] ?? 0)}</strong>
          </a>
        ))}
        <div className="stat">
          <span>Budget ({data.budget.currency})</span>
          <strong>
            {data.budget.spentToday}
            {data.budget.hardLimit != null ? ` / ${data.budget.hardLimit}` : ""}
          </strong>
        </div>
      </div>
      <div className="panel">
        <h2>MonetizationStatus</h2>
        <ul>
          {Object.entries(data.monetizationCounts).map(([k, v]) => (
            <li key={k}>
              {k}: {v}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
