"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { metricLabel } from "../format";

type Metric = { status: string; value: number | null };
type Performance = {
  learningConnectedToBrain: boolean;
  brainLearning: string;
  wp: { analyticsSnapshots: number; pageViews: Metric; visits: Metric; ctaClicks: Metric; articleAttributionCoverage: Metric };
  x: {
    snapshotCount: number;
    lastMeasuredAt: string | null;
    collectionStatus: string;
    tokenStatus: string;
    tokenExpiresAt: string | null;
    lastRefreshErrorCode: string | null;
    impressions: Metric;
    engagement: Metric;
  };
  database?: {
    sizeBytes: string | null;
    productAnalysisTotalBytes: string | null;
    liveRows: number | null;
    deadRows: number | null;
    connectionCount: number | null;
    health: string;
    healthMeaning: string;
    railwayBilling: string;
  };
};

export default function FactoryPerformancePage() {
  const [data, setData] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Performance>("/factory/performance").then(setData).catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  return (
    <div>
      <h1>Performance</h1>
      <p className="muted">Brain learning: {data.brainLearning}. Learning → Brain: {data.learningConnectedToBrain ? "CONNECTED" : "OFF"}</p>
      <div className="panel">
        <h2>WordPress</h2>
        <p>analytics snapshots: {data.wp.analyticsSnapshots}</p>
        <p>PV: {metricLabel(data.wp.pageViews)}</p>
        <p>visits: {metricLabel(data.wp.visits)}</p>
        <p>CTA click: {metricLabel(data.wp.ctaClicks)}</p>
        <p>article attribution coverage: {metricLabel(data.wp.articleAttributionCoverage)}</p>
      </div>
      <div className="panel">
        <h2>DB Health</h2>
        <p>DB size bytes: {data.database?.sizeBytes ?? "UNKNOWN"}</p>
        <p>ProductAnalysis total bytes: {data.database?.productAnalysisTotalBytes ?? "UNKNOWN"}</p>
        <p>live rows: {data.database?.liveRows ?? "UNKNOWN"}</p>
        <p>dead rows: {data.database?.deadRows ?? "UNKNOWN"}</p>
        <p>connections: {data.database?.connectionCount ?? "UNKNOWN"}</p>
        <p>health: {data.database?.health ?? "UNKNOWN"}</p>
        <p>{data.database?.healthMeaning ?? ""}</p>
        <p>Railway billing: {data.database?.railwayBilling ?? "EXTERNAL_BILLING_NOT_CONNECTED"}</p>
      </div>
      <div className="panel">
        <h2>X</h2>
        <p>collection: {data.x.collectionStatus}</p>
        <p>snapshots: {data.x.snapshotCount}</p>
        <p>last measured: {data.x.lastMeasuredAt ?? "NOT_COLLECTED"}</p>
        <p>token: {data.x.tokenStatus} expires {data.x.tokenExpiresAt ?? "UNKNOWN"}</p>
        <p>refresh error: {data.x.lastRefreshErrorCode ?? "none"}</p>
        <p>impressions: {metricLabel(data.x.impressions)}</p>
        <p>engagement: {metricLabel(data.x.engagement)}</p>
      </div>
    </div>
  );
}
