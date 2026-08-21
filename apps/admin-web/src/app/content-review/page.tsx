"use client";

import { useEffect, useState } from "react";
import type { ContentVersionListItemDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function ContentReviewPage() {
  const [items, setItems] = useState<ContentVersionListItemDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: ContentVersionListItemDto[] }>("/content-versions?status=REVIEWING")
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Content Review Queue</h1>
      <p className="muted">REVIEWING の最新 ContentVersion のみ承認してください。</p>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Version</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <a href={`/content-review/${item.id}`}>{item.title}</a>
              </td>
              <td>v{item.versionNumber}</td>
              <td>{item.status}</td>
              <td>{item.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
