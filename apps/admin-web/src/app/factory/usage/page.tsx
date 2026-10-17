"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { countLabel, money, perAdopted } from "../format";

type Usage = {
  estimatedCostUsd: number | null;
  calls: number;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  adopted: number;
  discarded: number;
  failed: number;
  blocked: number;
  byModel: Array<{ name: string; calls: number; estimatedCostUsd: number | null }>;
  byChannel: Array<{ name: string; calls: number; estimatedCostUsd: number | null }>;
  byOperation: Array<{ name: string; calls: number; estimatedCostUsd: number | null }>;
  runs: Array<{ id: string; createdAt: string; channel: string | null; operation: string | null; modelRequested: string | null; executionStatus: string | null; disposition: string | null; estimatedCostUsd: number | null }>;
};

const RANGES = ["today", "7d", "30d"] as const;

export default function FactoryUsagePage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("today");
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api<Usage>(`/factory/usage?range=${range}`).then(setData).catch((e: Error) => setError(e.message));
  }, [range]);

  return (
    <div>
      <h1>AI Usage</h1>
      <p className="muted">ESTIMATED_COST_USD。token が無い行は 0 ではなく UNKNOWN。prompt 本文は表示しない。</p>
      <div className="row">
        {RANGES.map((item) => (
          <button key={item} className={item === range ? "" : "secondary"} onClick={() => setRange(item)}>{item}</button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {!data && !error ? <p>Loading…</p> : null}
      {data ? (
        <>
          <div className="grid">
            <div className="stat"><span>Estimated USD</span><strong>{money(data.estimatedCostUsd)}</strong></div>
            <div className="stat"><span>Calls</span><strong>{data.calls}</strong></div>
            <div className="stat"><span>Input tokens</span><strong>{countLabel(data.inputTokens)}</strong></div>
            <div className="stat"><span>Cached tokens</span><strong>{countLabel(data.cachedTokens)}</strong></div>
            <div className="stat"><span>Output tokens</span><strong>{countLabel(data.outputTokens)}</strong></div>
            <div className="stat"><span>Cost / adopted</span><strong>{perAdopted(data.estimatedCostUsd, data.adopted)}</strong></div>
            <div className="stat"><span>Adopted</span><strong>{data.adopted}</strong></div>
            <div className="stat"><span>Discarded</span><strong>{data.discarded}</strong></div>
            <div className="stat"><span>Failed</span><strong>{data.failed}</strong></div>
            <div className="stat"><span>Blocked</span><strong>{data.blocked}</strong></div>
          </div>
          <Breakdown title="Model" rows={data.byModel} />
          <Breakdown title="Channel" rows={data.byChannel} />
          <Breakdown title="Operation" rows={data.byOperation} />
          <table>
            <thead>
              <tr><th>time</th><th>run</th><th>channel</th><th>operation</th><th>model</th><th>status</th><th>disposition</th><th>USD</th></tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.createdAt}</td>
                  <td><a href={`/factory/usage/${run.id}`}>{run.id}</a></td>
                  <td>{run.channel ?? "UNKNOWN"}</td>
                  <td>{run.operation ?? "UNKNOWN"}</td>
                  <td>{run.modelRequested ?? "UNKNOWN"}</td>
                  <td>{run.executionStatus ?? "UNKNOWN"}</td>
                  <td>{run.disposition ?? "UNKNOWN"}</td>
                  <td>{money(run.estimatedCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ name: string; calls: number; estimatedCostUsd: number | null }> }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.name}>{row.name}: {row.calls} calls / {money(row.estimatedCostUsd)}</li>
        ))}
      </ul>
    </div>
  );
}
