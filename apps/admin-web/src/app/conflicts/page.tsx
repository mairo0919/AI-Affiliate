"use client";

import { useEffect, useState } from "react";
import type { LearningConflictDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function ConflictsPage() {
  const [items, setItems] = useState<LearningConflictDto[]>([]);
  useEffect(() => {
    api<{ items: LearningConflictDto[] }>("/learning-conflicts")
      .then((r) => setItems(r.items))
      .catch(console.error);
  }, []);
  return (
    <div>
      <h1>Rule Conflicts</h1>
      <p className="muted">AI自動解消は禁止。人間が解消し Audit に残します。</p>
      <button
        onClick={() =>
          void api("/learning-conflicts/detect", { method: "POST", json: {} }).then(() =>
            location.reload(),
          )
        }
      >
        Detect
      </button>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Reason</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <td>{c.conflictType}</td>
              <td>{c.reason}</td>
              <td>{c.status}</td>
              <td>
                <button
                  onClick={async () => {
                    const resolution = window.prompt(
                      "resolution: keep_existing|accept_new_supersede|narrow_scope|suspend_both|reject_new|manual_note",
                    );
                    if (!resolution) return;
                    const note = window.prompt("note") ?? undefined;
                    await api(`/learning-conflicts/${c.id}/resolve`, {
                      method: "POST",
                      json: { resolution, note },
                    });
                    location.reload();
                  }}
                >
                  Resolve
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
