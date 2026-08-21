"use client";

import { useEffect, useState } from "react";
import type { AuditEventDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function AuditPage() {
  const [items, setItems] = useState<AuditEventDto[]>([]);
  const [actor, setActor] = useState("");
  async function load() {
    const q = actor ? `?actor=${encodeURIComponent(actor)}` : "";
    setItems((await api<{ items: AuditEventDto[] }>(`/audit-events${q}`)).items);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);
  return (
    <div>
      <h1>Audit</h1>
      <div className="row">
        <input placeholder="actor filter" value={actor} onChange={(e) => setActor(e.target.value)} />
        <button onClick={() => void load()}>Search</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Target</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{e.createdAt}</td>
              <td>{e.actor}</td>
              <td>{e.action}</td>
              <td>
                {e.targetType}:{e.targetId}
              </td>
              <td>{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
