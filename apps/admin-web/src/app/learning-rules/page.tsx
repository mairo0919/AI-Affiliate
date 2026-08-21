"use client";

import { useEffect, useState } from "react";
import type { LearningRuleDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function LearningRulesPage() {
  const [items, setItems] = useState<LearningRuleDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  async function load() {
    setItems((await api<{ items: LearningRuleDto[] }>("/learning-rules")).items);
  }
  useEffect(() => {
    load().catch((e: Error) => setMsg(e.message));
  }, []);

  async function act(id: string, action: string, body?: unknown) {
    if (["suspend", "deactivate"].includes(action)) {
      const reason = window.prompt("理由");
      if (!reason) return;
      body = { reason };
      if (!window.confirm(`${action}?`)) return;
    }
    if (action === "activate") {
      if (!window.confirm("ACTIVE化しますか？閾値・競合・承認を確認済みですか？")) return;
    }
    await api(`/learning-rules/${id}/${action}`, { method: "POST", json: body ?? {} });
    setMsg(`${action} ok`);
    await load();
  }

  return (
    <div>
      <h1>Learning Rules</h1>
      <p className="muted">status を直接書き換えず、Governance Service 経由で遷移します。</p>
      {msg ? <p>{msg}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Type</th>
            <th>Statement</th>
            <th>n / conf / success</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>{r.status}</td>
              <td>{r.ruleType}</td>
              <td>
                <a href={`/learning-rules/${r.id}`}>{r.statement}</a>
              </td>
              <td>
                {r.sampleCount} / {r.confidence} / {r.successRate ?? "-"}
              </td>
              <td className="row">
                <button onClick={() => void act(r.id, "approve")}>Approve</button>
                <button onClick={() => void act(r.id, "activate")}>Activate</button>
                <button className="danger" onClick={() => void act(r.id, "suspend")}>
                  Suspend
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
