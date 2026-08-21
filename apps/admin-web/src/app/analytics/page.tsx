"use client";

import { useState } from "react";
import type { ImportPreviewDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function AnalyticsPage() {
  const [content, setContent] = useState(
    "externalId,impressions,clicks\nexample,100,5\n",
  );
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function runPreview() {
    setPreview(
      await api<ImportPreviewDto>("/analytics/preview", {
        method: "POST",
        json: { format, content, platform: "BLOGGER" },
      }),
    );
  }

  async function runImport() {
    if (!preview) {
      setMsg("先に preview してください");
      return;
    }
    const result = await api<{ batchId: string; duplicateFile: boolean }>("/analytics/import", {
      method: "POST",
      json: {
        format,
        content,
        platform: "BLOGGER",
        confirmPreviewHash: preview.fileHash,
      },
    });
    setMsg(`imported batch=${result.batchId} duplicate=${result.duplicateFile}`);
  }

  return (
    <div>
      <h1>Analytics Import</h1>
      <p className="muted">
        rawファイルは既定で永続保存しません。hash / batch / validation のみ保存可能です。
      </p>
      <label>
        Format
        <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
      </label>
      <textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="row">
        <button onClick={() => void runPreview()}>Dry-run Preview</button>
        <button onClick={() => void runImport()}>Import</button>
      </div>
      {preview ? <pre className="panel">{JSON.stringify(preview, null, 2)}</pre> : null}
      {msg ? <p>{msg}</p> : null}
    </div>
  );
}
