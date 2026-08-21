# First Live Content Run

最初の1記事を、Affiliate API / X API なしで **Blogger Draft + X Export** まで運ぶ手順。  
Operation mode: `ASSISTED`。自動公開・自動 X 投稿は行わない。

Fixture ではなく **実公開 URL**（FANZA 通常商品ページ等）を使う。テスト用の露骨な成人向け文言は使わない。

---

## 0. 前提

```bash
pnpm install
pnpm db:migrate && pnpm db:seed
cp .env.example .env   # 必要値を設定
```

必須方針:

- `PRODUCTION_OPERATION_MODE=ASSISTED`
- `BLOGGER_DEFAULT_PUBLISH_MODE=draft`
- `BLOGGER_ALLOW_DIRECT_PUBLISH=false`
- Affiliate API / X API は不要
- `PREFERRED_AFFILIATE_PROVIDER=fanza`

---

## 1. Production Check

```bash
pnpm production:check
```

Admin: `/checklist`

**BLOCKED が1つでもあれば Blogger Draft（外部送信）を止める。** WARNING / NOT_REQUIRED は続行可。

---

## 2. LLM Test（明示確認）

```bash
# 環境: LLM_MODE=api LLM_ALLOW_EXTERNAL_REQUESTS=true LLM_API_KEY=...
pnpm llm:test -- --confirm-external
```

確認: Provider / Model / structured output / token / CostRecord / secret 非露出。  
成功しても運用モードは自動変更しない。

---

## 3. Blogger OAuth Test（明示確認）

```bash
pnpm blogger:auth-status
pnpm blogger:list-blogs          # または既存 blogger OAuth CLI
pnpm blogger:validate-auth
# Blog ID を BLOGGER_BLOG_ID に設定
pnpm blogger:create-test-draft -- --confirm-external --publication-target-id=<TEST_TARGET>
# get status / delete は既存 blogger CLI
```

接続確認用の安全な文章のみ。本番記事は使わない。direct publish は OFF のまま。

---

## 4. Research URL 登録

```bash
pnpm production:research-url -- \
  --url="https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=XXXX/" \
  --confirm-external \
  --register-product \
  --create-topic
```

必要環境: `RESEARCH_ALLOW_EXTERNAL_REQUESTS=true`

取得 HTML 全文は保存しない。正規化フィールド + `normalizedText` のみ。  
SSRF / timeout / size / content-type / redirect 検証あり。

手動ノートのみなら既存:

```bash
pnpm ops:register-research -- --url=... --summary=... --statement=...
```

---

## 5. Research 確認

CLI 出力の `fetchedUrls` / `claims` / `seed` を確認。  
不足なら追加 URL で再実行（動的終了・budget あり。無制限探索しない）。

Admin: Source / Claim 一覧（Content Review 詳細の Claim・出典）。

---

## 6. Strategy 確認

`--create-topic` で Strategy が作られる。または:

```bash
pnpm --filter @ai-affiliate/content-operator lifecycle:create-strategy -- --topic-id=<ID>
```

固定「作品紹介」にせず、Research の pageType / 事実量から切り口を確認。  
ACTIVE LearningRule がある場合のみ Feedback。Claim / Policy より優先しない。

---

## 7. Claims 確認

SUPPORTED 中心を生成に使う。価格・発売日・出演者等は **観測できたものだけ**。  
UNSUPPORTED / 推測は渡さない。

---

## 8. Generate（Blogger）

Admin または generation CLI（P4.5）:

```bash
pnpm --filter @ai-affiliate/content-operator p45:generate-blogger -- \
  --topic-id=... --strategy-id=... --product-title=... --cta-url=<FANZA通常URL> --claim-ids=...
```

CTA 優先: FANZA 通常商品 URL（Affiliate 未取得時）。広告誤認表現禁止。

---

## 9. Quality Gate

```bash
# Admin API
POST /content-versions/:id/quality-gate
```

または生成後の Review パイプライン。スキップ禁止。  
同一 Version・Prompt・body なら Review 再利用（コスト削減）。

---

## 10. Revision 確認

NG なら `partial_revision` / `full_regeneration` / `additional_research` 等。  
公開済み Version は破壊しない（新 Version）。

---

## 11. Content 承認

Admin: **Content Review** → Approve  
（Claim / Review FAILED があると拒否）

---

## 12. Blogger Draft

Admin: **Publication** → Approve → **Blogger Draft**

または:

```bash
pnpm blogger:create-test-draft -- --confirm-external --publication-target-id=<APPROVED_TARGET>
```

本番記事はテスト Draft コマンドではなく、承認済み PublicationTarget から作成。  
Checklist BLOCKED 時は拒否。

追跡: externalId / URL / ContentVersion / PublicationTarget / ProductLinkUsage / ModelRun / Cost / Audit

---

## 13. Blogger 画面で最終確認

Google Blogger の下書き UI で体裁・リンク・年齢注意を確認。

---

## 14. 人間が公開

Blogger UI で公開（システムは direct publish OFF）。

---

## 15. 公開 URL 登録

Admin: Publication → Register external URL（または手動更新）。

---

## 16. X 生成

同じ Topic / Strategy / Claim で **別生成**（Blogger 要約禁止）。

```bash
pnpm --filter @ai-affiliate/content-operator p45:generate-x -- ...
```

---

## 17. X Export

Admin: **Publications** → X Export  
表示: main / reply（必要時）/ Blogger URL / Product URL / Claims / warnings

---

## 18. 人間が X 投稿

Export をコピーして手動投稿。自動投稿なし。

---

## 19. X URL 登録

Admin: Register external（post URL / external id / postedAt）。

---

## 20. Analytics 登録

手動 CSV / Manual analytics（取得できない指標は null。0 にしない）。

```bash
# Admin Analytics Import、または ops ingest
```

---

## 21. Evaluation 確認

Evaluation を確認。最初の数件から強い LearningRule を ACTIVE にしない。  
提案 → 人間承認 → ACTIVE。

---

## Smoke だけのとき

```bash
pnpm p9:vertical          # Mock 全体（外部APIなし）
pnpm llm:test -- --confirm-external
pnpm production:check
```

関連: `docs/migration-p8.md`, `docs/llm-production-setup.md`, `docs/blogger-production-oauth.md`, `docs/initial-operations.md`
