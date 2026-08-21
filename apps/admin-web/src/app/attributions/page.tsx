"use client";

import { useEffect, useState } from "react";
import type { AnalyticsAttributionDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function AttributionsPage() {
  const [items, setItems] = useState<AnalyticsAttributionDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setItems((await api<{ items: AnalyticsAttributionDto[] }>("/analytics-attributions")).items);
  }
  useEffect(() => {
    load().catch((e: Error) => setMsg(e.message));
  }, []);

  return (
    <div>
      <h1>Attribution Queue</h1>
      <p className="muted">曖昧な候補は自動確定しません。人間が照合してください。</p>
      {msg ? <p>{msg}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>External</th>
            <th>Confidence</th>
            <th>Reason</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.status}</td>
              <td>{item.externalPublicationId ?? "-"}</td>
              <td>{item.confidence}</td>
              <td>{item.matchReason}</td>
              <td className="row">
                <button
                  onClick={async () => {
                    const contentId = window.prompt("contentId");
                    if (!contentId) return;
                    await api(`/analytics-attributions/${item.id}/match`, {
                      method: "POST",
                      json: { contentId },
                    });
                    setMsg("matched");
                    await load();
                  }}
                >
                  Match
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    const reason = window.prompt("理由");
                    if (!reason) return;
                    await api(`/analytics-attributions/${item.id}/reject`, {
                      method: "POST",
                      json: { reason },
                    });
                    await load();
                  }}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
