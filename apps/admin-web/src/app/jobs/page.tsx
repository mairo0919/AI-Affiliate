"use client";

import { useEffect, useState } from "react";
import type { AdminJobViewDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

function statusTone(status: string): string | undefined {
  if (status === "FAILED" || status.includes("BUDGET")) return "var(--danger)";
  if (status === "MANUAL_REVIEW_REQUIRED") return "#8a6d3b";
  if (status === "COMPLETED") return "var(--ok, #2f6f4e)";
  return undefined;
}

export default function JobsPage() {
  const [items, setItems] = useState<AdminJobViewDto[]>([]);
  useEffect(() => {
    api<{ items: AdminJobViewDto[] }>("/operation-jobs")
      .then((r) => setItems(r.items))
      .catch(console.error);
  }, []);
  return (
    <div>
      <h1>Jobs</h1>
      <p className="muted">OperationJob / ResearchJob の共通一覧。progress と failure reason を確認できます。</p>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Type</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Failure</th>
            <th>Error</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((j) => (
            <tr key={`${j.sourceModel}:${j.jobId}`}>
              <td>{j.sourceModel}</td>
              <td>{j.jobType}</td>
              <td style={{ color: statusTone(j.status) }}>
                {j.status}
                {j.manualActionRequired ? " · manual" : ""}
              </td>
              <td>{j.progress == null ? "-" : `${Math.round(j.progress * 100)}%`}</td>
              <td>{j.failureClassification ?? "-"}</td>
              <td title={j.errorSummary ?? undefined}>{j.errorSummary ?? "-"}</td>
              <td className="row">
                <a href={`/jobs/${j.jobId}`}>Detail</a>
                {j.sourceModel === "OperationJob" ? (
                  <>
                    <button
                      onClick={() =>
                        void api(`/operation-jobs/${j.jobId}/resume`, {
                          method: "POST",
                          json: {},
                        }).then(() => location.reload())
                      }
                    >
                      Resume
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        void api(`/operation-jobs/${j.jobId}/retry`, {
                          method: "POST",
                          json: {},
                        }).then(() => location.reload())
                      }
                    >
                      Retry
                    </button>
                    <button
                      className="danger"
                      onClick={async () => {
                        const reason = window.prompt("キャンセル理由");
                        if (!reason) return;
                        await api(`/operation-jobs/${j.jobId}/cancel`, {
                          method: "POST",
                          json: { reason },
                        });
                        location.reload();
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
