"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money, perAdopted } from "./format";

type Overview = {
  range: string;
  estimatedCostUsd: number | null;
  calls: number;
  gpt41CostUsd: number | null;
  gpt41MiniCostUsd: number | null;
  wpGenerated: number;
  wpAdopted: number;
  wpDiscarded: number;
  wpPublished: number;
  xGenerated: number;
  xAdopted: number;
  xDiscarded: number;
  xPublished: number;
  xScheduled: number;
  xBlocked: number;
  adopted: number;
  discarded: number;
  success: number;
  failed: number;
  blocked: number;
  stale: number;
  wpEstimatedCostUsd: number | null;
  xEstimatedCostUsd: number | null;
  costPerAdopted: number | null;
  costPerWpAdopted: number | null;
  costPerXAdopted: number | null;
  anomaly: { status: "NORMAL" | "WARNING" | "CRITICAL"; reasons: string[] };
  circuits: Array<{ scopeType: string; scopeKey: string; state: string; reason: string | null }>;
  critical: string[];
  railwayBilling: string;
  learningConnectedToBrain: boolean;
};

const RANGES = ["today", "7d", "30d"] as const;

export default function FactoryOverviewPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("today");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<Overview>(`/factory/overview?range=${range}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [range]);

  return (
    <div>
      <h1>Factory Control</h1>
      <p className="muted">推定コストと成果物。Railway請求額は未接続。Brain learning は OFF。</p>
      <div className="row">
        {RANGES.map((item) => (
          <button key={item} className={item === range ? "" : "secondary"} onClick={() => setRange(item)}>
            {item}
          </button>
        ))}
        <a href="/factory/usage">AI Usage</a>
        <a href="/factory/safety">Safety</a>
        <a href="/factory/performance">Performance</a>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {!data && !error ? <p>Loading…</p> : null}
      {data ? (
        <>
          <div className="grid">
            <div className="stat"><span>Status</span><strong>{data.anomaly.status}</strong></div>
            <div className="stat"><span>Today cost</span><strong>{money(data.estimatedCostUsd)}</strong></div>
            <div className="stat"><span>Today calls</span><strong>{data.calls}</strong></div>
            <div className="stat"><span>Cost / adopted</span><strong>{perAdopted(data.estimatedCostUsd, data.adopted)}</strong></div>
            <div className="stat"><span>Cost / WP adopted</span><strong>{perAdopted(data.wpEstimatedCostUsd, data.wpAdopted)}</strong></div>
            <div className="stat"><span>Cost / X adopted</span><strong>{perAdopted(data.xEstimatedCostUsd, data.xAdopted)}</strong></div>
            <div className="stat"><span>gpt-4.1</span><strong>{money(data.gpt41CostUsd)}</strong></div>
            <div className="stat"><span>gpt-4.1-mini</span><strong>{money(data.gpt41MiniCostUsd)}</strong></div>
            <div className="stat"><span>WP generated</span><strong>{data.wpGenerated}</strong></div>
            <div className="stat"><span>WP adopted</span><strong>{data.wpAdopted}</strong></div>
            <div className="stat"><span>WP discarded</span><strong>{data.wpDiscarded}</strong></div>
            <div className="stat"><span>WP published</span><strong>{data.wpPublished}</strong></div>
            <div className="stat"><span>X generated</span><strong>{data.xGenerated}</strong></div>
            <div className="stat"><span>X adopted</span><strong>{data.xAdopted}</strong></div>
            <div className="stat"><span>X discarded</span><strong>{data.xDiscarded}</strong></div>
            <div className="stat"><span>X scheduled</span><strong>{data.xScheduled}</strong></div>
            <div className="stat"><span>X published</span><strong>{data.xPublished}</strong></div>
            <div className="stat"><span>LLM success</span><strong>{data.success}</strong></div>
            <div className="stat"><span>LLM failed</span><strong>{data.failed}</strong></div>
            <div className="stat"><span>LLM blocked</span><strong>{data.blocked}</strong></div>
            <div className="stat"><span>LLM stale</span><strong>{data.stale}</strong></div>
          </div>
          <div className="panel">
            <h2>Circuit</h2>
            {data.circuits.length === 0 ? <p>CLOSED（記録なし）</p> : (
              <ul>
                {data.circuits.map((row) => (
                  <li key={`${row.scopeType}:${row.scopeKey}`}>{row.scopeType} {row.scopeKey}: {row.state} {row.reason ?? ""}</li>
                ))}
              </ul>
            )}
            <h2>Anomaly</h2>
            <p>{data.anomaly.status}{data.anomaly.reasons.length ? `: ${data.anomaly.reasons.join(", ")}` : ""}</p>
            <h2>Critical</h2>
            {data.critical.length === 0 ? <p>なし</p> : <ul>{data.critical.map((item) => <li key={item}>{item}</li>)}</ul>}
            <p>PV / impressions: NOT_COLLECTED</p>
            <p>Railway: {data.railwayBilling}</p>
            <p>Learning → Brain: {data.learningConnectedToBrain ? "CONNECTED" : "OFF"}</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
