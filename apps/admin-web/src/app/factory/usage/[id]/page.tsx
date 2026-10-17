"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { countLabel, money } from "../../format";

type RunDetail = {
  id: string;
  createdAt: string;
  requestedAt: string | null;
  finishedAt: string | null;
  canonicalCid: string | null;
  channel: string | null;
  operation: string | null;
  modelRequested: string | null;
  modelActual: string | null;
  promptIdentifier: string | null;
  promptVersion: string | null;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  estimatedCostUsd: number | null;
  logicalAttempt: number | null;
  httpAttempt: number | null;
  executionStatus: string | null;
  disposition: string | null;
  artifactFingerprint: string | null;
  contentVersionId: string | null;
  xPublicationId: string | null;
  errorCode: string | null;
  errorType: string | null;
  httpStatus: number | null;
  failureStage: string | null;
  blockReason: string | null;
  usageKnown: boolean | null;
};

export default function FactoryRunPage() {
  const params = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    api<RunDetail>(`/factory/usage/${params.id}`).then(setRun).catch((e: Error) => setError(e.message));
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!run) return <p>Loading…</p>;

  const rows: Array<[string, string]> = [
    ["timestamp", run.createdAt],
    ["requestedAt", run.requestedAt ?? "UNKNOWN"],
    ["finishedAt", run.finishedAt ?? "UNKNOWN"],
    ["runId", run.id],
    ["CID", run.canonicalCid ?? "UNKNOWN"],
    ["channel", run.channel ?? "UNKNOWN"],
    ["operation", run.operation ?? "UNKNOWN"],
    ["model requested", run.modelRequested ?? "UNKNOWN"],
    ["model actual", run.modelActual ?? "UNKNOWN"],
    ["prompt", `${run.promptIdentifier ?? "UNKNOWN"} @ ${run.promptVersion ?? "UNKNOWN"}`],
    ["input tokens", countLabel(run.inputTokens)],
    ["cached tokens", countLabel(run.cachedTokens)],
    ["output tokens", countLabel(run.outputTokens)],
    ["reasoning tokens", countLabel(run.reasoningTokens)],
    ["usage known", run.usageKnown == null ? "UNKNOWN" : String(run.usageKnown)],
    ["estimated cost", money(run.estimatedCostUsd)],
    ["logical attempt", countLabel(run.logicalAttempt)],
    ["HTTP attempt", countLabel(run.httpAttempt)],
    ["status", run.executionStatus ?? "UNKNOWN"],
    ["disposition", run.disposition ?? "UNKNOWN"],
    ["artifact fingerprint", run.artifactFingerprint ?? "UNKNOWN"],
    ["content version", run.contentVersionId ?? "UNKNOWN"],
    ["X publication", run.xPublicationId ?? "UNKNOWN"],
    ["error", run.errorCode ?? run.errorType ?? "none"],
    ["http status", run.httpStatus == null ? "UNKNOWN" : String(run.httpStatus)],
    ["failure stage", run.failureStage ?? "none"],
    ["block reason", run.blockReason ?? "none"],
  ];

  return (
    <div>
      <h1>LLM Run</h1>
      <p className="muted">prompt 本文は表示しない。</p>
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}><th>{label}</th><td>{value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
