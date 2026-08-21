"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

interface JobDetail {
  job?: {
    id: string;
    cycleType?: string;
    status?: string;
    error?: string | null;
    errorClass?: string | null;
    attempts?: number;
    startedAt?: string | null;
    completedAt?: string | null;
    result?: unknown;
    payload?: unknown;
  };
  checkpoints?: Array<{
    stepKey: string;
    status: string;
    createdAt?: string;
  }>;
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<JobDetail | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  useEffect(() => {
    api(`/operation-jobs/${params.id}`)
      .then((r) => {
        setRaw(r);
        setData(r as JobDetail);
      })
      .catch(console.error);
  }, [params.id]);

  const job = data?.job;
  const checkpoints = data?.checkpoints ?? [];

  return (
    <div>
      <h1>Job Detail</h1>
      {job ? (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <p>
            <strong>Status:</strong> {job.status}
          </p>
          <p>
            <strong>Type:</strong> {job.cycleType ?? "-"}
          </p>
          <p>
            <strong>Attempts:</strong> {job.attempts ?? 0}
          </p>
          <p>
            <strong>Failure:</strong> {job.errorClass ?? "-"}
          </p>
          <p>
            <strong>Error:</strong> {job.error ?? "-"}
          </p>
          <p>
            <strong>Started:</strong> {job.startedAt ?? "-"}
          </p>
          <p>
            <strong>Finished:</strong> {job.completedAt ?? "-"}
          </p>
          {checkpoints.length > 0 ? (
            <>
              <h2>Progress</h2>
              <ol>
                {checkpoints.map((cp) => (
                  <li key={`${cp.stepKey}-${cp.createdAt ?? ""}`}>
                    {cp.stepKey} — {cp.status}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      ) : null}
      <details>
        <summary>Raw JSON</summary>
        <pre className="panel">{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </div>
  );
}
