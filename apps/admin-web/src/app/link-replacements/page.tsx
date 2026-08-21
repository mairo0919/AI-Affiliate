"use client";

import { useEffect, useState } from "react";
import type { LinkReplacementDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function LinkReplacementsPage() {
  const [items, setItems] = useState<LinkReplacementDto[]>([]);
  useEffect(() => {
    api<{ items: LinkReplacementDto[] }>("/link-replacements")
      .then((r) => setItems(r.items))
      .catch(console.error);
  }, []);
  return (
    <div>
      <h1>Affiliate Link Replacements</h1>
      <p className="muted">apply は新 ContentVersion を作成します。本文の直接更新はしません。</p>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Old → New</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{e.replacementStatus}</td>
              <td>
                {e.previousUrl} → {e.nextUrl}
              </td>
              <td className="row">
                <button
                  onClick={() =>
                    void api(`/link-replacements/${e.id}/approve`, {
                      method: "POST",
                      json: {},
                    }).then(() => location.reload())
                  }
                >
                  Approve
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    if (!window.confirm("Apply replacement?")) return;
                    await api(`/link-replacements/${e.id}/apply`, { method: "POST", json: {} });
                    location.reload();
                  }}
                >
                  Apply
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
