"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Item {
  key: string;
  label: string;
  status: string;
  detail: string;
}

export default function ChecklistPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Item[] }>("/production/checklist")
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Production Checklist</h1>
      <p className="muted">初回運用前の確認。BLOCKED がある場合は起動・公開を止めてください。</p>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Item</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              <td
                style={{
                  color:
                    i.status === "BLOCKED"
                      ? "var(--danger)"
                      : i.status === "WARNING"
                        ? "#8a6d3b"
                        : undefined,
                }}
              >
                {i.status}
              </td>
              <td>{i.label}</td>
              <td>{i.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
