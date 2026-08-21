"use client";

import { useEffect, useState } from "react";
import type { SecretStatusDto, SystemSettingDto } from "@ai-affiliate/admin-contracts";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettingDto[]>([]);
  const [secrets, setSecrets] = useState<SecretStatusDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: SystemSettingDto[]; secrets: SecretStatusDto[] }>("/settings")
      .then((r) => {
        setSettings(r.settings);
        setSecrets(r.secrets);
      })
      .catch((e: Error) => setMsg(e.message));
  }, []);

  return (
    <div>
      <h1>Settings</h1>
      <p className="muted">秘密情報は configured / not configured のみ。値は表示・編集しません。</p>
      {msg ? <p className="error">{msg}</p> : null}
      <div className="panel">
        <h2>Editable</h2>
        <ul>
          {settings.map((s) => (
            <li key={s.key}>
              <strong>{s.key}</strong>: {JSON.stringify(s.value)}
              <button
                className="secondary"
                style={{ marginLeft: 8 }}
                onClick={async () => {
                  const next = window.prompt("new JSON value", JSON.stringify(s.value));
                  if (next == null) return;
                  await api(`/settings/${s.key}`, {
                    method: "PUT",
                    json: { value: JSON.parse(next) },
                  });
                  location.reload();
                }}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel">
        <h2>Secrets (status only)</h2>
        <ul>
          {secrets.map((s) => (
            <li key={s.key}>
              {s.key}: {s.configured ? "configured" : "not configured"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
