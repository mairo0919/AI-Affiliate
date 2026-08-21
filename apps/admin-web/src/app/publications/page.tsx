"use client";

import { useEffect, useState } from "react";
import type { PublicationTargetDto, XExportPayloadDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function PublicationsPage() {
  const [items, setItems] = useState<PublicationTargetDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [exportPayload, setExportPayload] = useState<XExportPayloadDto | null>(null);

  async function load() {
    const res = await api<{ items: PublicationTargetDto[] }>("/publications");
    setItems(res.items);
  }

  useEffect(() => {
    load().catch((e: Error) => setMsg(e.message));
  }, []);

  async function act(id: string, path: string, body?: unknown) {
    try {
      const result = await api<Record<string, unknown>>(`/publications/${id}/${path}`, {
        method: "POST",
        json: body ?? {},
      });
      if (path === "x-export" && result.export) {
        setExportPayload(result.export as XExportPayloadDto);
      }
      setMsg(`${path} ok`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    }
  }

  return (
    <div>
      <h1>Publication Queue</h1>
      <p className="muted">直接公開ボタンはありません。Draft / Export 中心（ASSISTED）。</p>
      {msg ? <p>{msg}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Status</th>
            <th>External</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.platform}</td>
              <td>{item.status}</td>
              <td>
                {item.publishedUrl ? (
                  <a href={item.publishedUrl} target="_blank" rel="noreferrer">
                    {item.publishedExternalId ?? item.publishedUrl}
                  </a>
                ) : (
                  (item.publishedExternalId ?? "-")
                )}
              </td>
              <td className="row">
                <button onClick={() => act(item.id, "approve")}>Approve</button>
                <button
                  className="danger"
                  onClick={() => {
                    const reason = window.prompt("拒否理由");
                    if (reason) void act(item.id, "reject", { reason });
                  }}
                >
                  Reject
                </button>
                <button className="secondary" onClick={() => act(item.id, "blogger-draft")}>
                  Blogger Draft
                </button>
                <button className="secondary" onClick={() => act(item.id, "x-export")}>
                  X Export
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    const externalUrl = window.prompt("手動投稿後の URL");
                    if (!externalUrl) return;
                    void act(item.id, "register-external", { externalUrl });
                  }}
                >
                  Register URL
                </button>
                <a href={`/publications/${item.id}`}>Detail</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {exportPayload ? (
        <div className="panel">
          <h2>X Copy-ready</h2>
          <p className="muted">chars={exportPayload.characterCount}</p>
          <label>Main post</label>
          <textarea rows={4} readOnly value={exportPayload.mainPost} />
          <button
            className="secondary"
            onClick={() => void navigator.clipboard.writeText(exportPayload.mainPost)}
          >
            Copy main
          </button>
          {exportPayload.reply ? (
            <>
              <label>Reply</label>
              <textarea rows={3} readOnly value={exportPayload.reply} />
            </>
          ) : null}
          <p>Blogger: {exportPayload.bloggerUrl ?? "-"}</p>
          <p>Product: {exportPayload.productUrl ?? "-"}</p>
          <p>Schedule: {exportPayload.scheduledRecommendation ?? "-"}</p>
          {exportPayload.warnings.length > 0 ? (
            <ul>
              {exportPayload.warnings.map((w) => (
                <li key={w} className="error">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
