"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money } from "../format";

type Safety = {
  circuits: Array<{ scopeType: string; scopeKey: string; state: string; reason: string | null; consecutiveFailures: number }>;
  budget: { globalDailyUsd: number; gpt41DailyUsd: number; xWriterDailyUsd: number; source: string };
  usedUsd: number | null;
  reservedUsd: number;
  remainingUsd: number | null;
  unknownUsageRuns: number;
  ceilings: { logicalCallLimit: number; httpRetryLimit: number; absoluteTickCap: number; wpArticleTickCap?: number };
  blocked: Array<{ id: string; blockReason: string | null; channel: string | null; operation: string | null }>;
  failures: Array<{ id: string; errorCode: string | null; channel: string | null; operation: string | null }>;
  stale: Array<{ id: string; artifactFingerprint: string | null }>;
  database: { sizeBytes: string | null; activity: Array<{ state: string | null; count: number }> };
  railwayBilling: string;
  mutableSettings: boolean;
};

export default function FactorySafetyPage() {
  const [data, setData] = useState<Safety | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Safety>("/factory/safety").then(setData).catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const grouped = ["GLOBAL", "MODEL", "CHANNEL", "OPERATION"].map((scope) => ({
    scope,
    rows: data.circuits.filter((row) => row.scopeType === scope),
  }));
  return (
    <div>
      <h1>Safety</h1>
      <p className="muted">READ ONLY。設定変更UIはない。{data.budget.source}。Railway: {data.railwayBilling}</p>
      {grouped.map((group) => (
        <div className="panel" key={group.scope}>
          <h2>{group.scope}</h2>
          {group.rows.length === 0 ? <p>CLOSED（記録なし）</p> : (
            <ul>{group.rows.map((row) => <li key={row.scopeKey}>{row.scopeKey}: {row.state} failures={row.consecutiveFailures} {row.reason ?? ""}</li>)}</ul>
          )}
        </div>
      ))}
      <div className="grid">
        <div className="stat"><span>Global budget</span><strong>{money(data.budget.globalDailyUsd)}</strong></div>
        <div className="stat"><span>gpt-4.1 budget</span><strong>{money(data.budget.gpt41DailyUsd)}</strong></div>
        <div className="stat"><span>X writer budget</span><strong>{money(data.budget.xWriterDailyUsd)}</strong></div>
        <div className="stat"><span>Used</span><strong>{money(data.usedUsd)}</strong></div>
        <div className="stat"><span>Reserved</span><strong>{money(data.reservedUsd)}</strong></div>
        <div className="stat"><span>Remaining</span><strong>{money(data.remainingUsd)}</strong></div>
      </div>
      <p className="muted">usage 不明の成功 run: {data.unknownUsageRuns}。不明がある日は Used / Remaining を 0 で埋めない。</p>
      <div className="panel">
        <h2>Ceilings</h2>
        <p>logical {data.ceilings.logicalCallLimit} / HTTP retry {data.ceilings.httpRetryLimit} / X tick {data.ceilings.absoluteTickCap} / WP article tick {data.ceilings.wpArticleTickCap ?? 5}</p>
        <h2>Database</h2>
        <p>size bytes: {data.database.sizeBytes ?? "UNKNOWN"}</p>
        <ul>{data.database.activity.map((row) => <li key={row.state ?? "null"}>{row.state ?? "null"}: {row.count}</li>)}</ul>
      </div>
      <div className="panel">
        <h2>Blocked</h2>
        <ul>{data.blocked.map((row) => <li key={row.id}><a href={`/factory/usage/${row.id}`}>{row.blockReason}</a> {row.channel} {row.operation}</li>)}</ul>
        <h2>Failures</h2>
        <ul>{data.failures.map((row) => <li key={row.id}><a href={`/factory/usage/${row.id}`}>{row.errorCode}</a> {row.channel} {row.operation}</li>)}</ul>
        <h2>Stale</h2>
        <ul>{data.stale.map((row) => <li key={row.id}><a href={`/factory/usage/${row.id}`}>{row.id}</a> {row.artifactFingerprint}</li>)}</ul>
      </div>
    </div>
  );
}
