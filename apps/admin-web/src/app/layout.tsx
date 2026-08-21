import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "AI Affiliate Ops Console",
  description: "Internal operations console (P7)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="shell">
          <aside className="nav">
            <div className="brand">AI Affiliate Ops</div>
            <a href="/">Dashboard</a>
            <a href="/content-review">Content Review</a>
            <a href="/publications">Publications</a>
            <a href="/analytics">Analytics</a>
            <a href="/attributions">Attributions</a>
            <a href="/learning-rules">Learning Rules</a>
            <a href="/conflicts">Rule Conflicts</a>
            <a href="/experiments">Experiments</a>
            <a href="/link-replacements">Link Replacements</a>
            <a href="/jobs">Jobs</a>
            <a href="/audit">Audit</a>
            <a href="/settings">Settings</a>
            <a href="/checklist">Checklist</a>
            <a href="/login">Login</a>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
