"use client";

import { useEffect, useState } from "react";
import type { ExperimentDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function ExperimentsPage() {
  const [items, setItems] = useState<ExperimentDto[]>([]);
  useEffect(() => {
    api<{ items: ExperimentDto[] }>("/experiments")
      .then((r) => setItems(r.items))
      .catch(console.error);
  }, []);
  return (
    <div>
      <h1>Experiments</h1>
      <p className="muted">自動公開は禁止。承認後も人間が公開フローを進めます。</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Hypothesis</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.status}</td>
              <td>{e.hypothesis}</td>
              <td>
                <button
                  onClick={() =>
                    void api(`/experiments/${e.id}/approve`, { method: "POST", json: {} }).then(
                      () => location.reload(),
                    )
                  }
                >
                  Approve
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
