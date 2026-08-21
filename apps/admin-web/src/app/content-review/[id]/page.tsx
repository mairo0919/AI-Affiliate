"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ContentVersionDetailDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function ContentDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ContentVersionDetailDto | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    setDetail(await api<ContentVersionDetailDto>(`/content-versions/${params.id}`));
  }

  useEffect(() => {
    reload().catch((e: Error) => setMsg(e.message));
  }, [params.id]);

  async function decide(decision: string) {
    if (["reject", "abandon"].includes(decision)) {
      if (!reason.trim()) {
        setMsg("理由が必要です");
        return;
      }
      if (!window.confirm(`${decision} を実行しますか？`)) return;
    }
    try {
      await api(`/content-versions/${params.id}/review`, {
        method: "POST",
        json: { decision, reason },
      });
      setMsg(`${decision} 完了`);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    }
  }

  if (!detail) return <p>{msg ?? "Loading…"}</p>;

  return (
    <div>
      <h1>{detail.title}</h1>
      <p className="muted">
        v{detail.versionNumber} / {detail.status} / latest={String(detail.isLatest)} /{" "}
        {detail.revisionType}
      </p>
      {detail.parentDiffSummary ? (
        <p className="panel">Diff: {detail.parentDiffSummary}</p>
      ) : null}
      <div className="panel">
        <h2>Summary</h2>
        <p>{detail.summary}</p>
        <h2>Body</h2>
        <pre style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{detail.body}</pre>
      </div>
      <div className="panel">
        <h2>Claims</h2>
        <ul>
          {detail.claims.map((c) => (
            <li key={c.id}>
              <span className={c.status === "SUPPORTED" ? "" : "error"}>[{c.status}]</span>{" "}
              {c.statement}
              <ul>
                {(c.sources ?? []).map((s, i) => (
                  <li key={i}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.label ?? s.url}
                      </a>
                    ) : (
                      (s.label ?? "-")
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <h2>Reviews</h2>
        <ul>
          {detail.reviews.map((r) => (
            <li key={r.id}>
              <strong
                style={{
                  color: r.result === "FAILED" ? "var(--danger)" : undefined,
                }}
              >
                {r.reviewType}: {r.result}
              </strong>{" "}
              ({r.score ?? "-"})
              {r.findings ? (
                <pre style={{ fontSize: "0.85rem" }}>{JSON.stringify(r.findings, null, 2)}</pre>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <textarea
        placeholder="理由（reject / abandon 必須）"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="row">
        <button onClick={() => decide("approve")}>Approve</button>
        <button className="danger" onClick={() => decide("reject")}>
          Reject
        </button>
        <button className="secondary" onClick={() => decide("request_changes")}>
          Request changes
        </button>
        <button className="secondary" onClick={() => decide("partial_revision")}>
          Partial revision
        </button>
        <button className="secondary" onClick={() => decide("full_regeneration")}>
          Full regeneration
        </button>
        <button className="secondary" onClick={() => decide("additional_research")}>
          Additional research
        </button>
        <button className="danger" onClick={() => decide("abandon")}>
          Abandon
        </button>
      </div>
      {msg ? <p>{msg}</p> : null}
    </div>
  );
}
