# X Export 運用手順（P4.5 更新）

X 自動投稿は行いません。正本は **手動 Export** です。

## 生成

```bash
pnpm p45:generate-x -- --topic-id=... --strategy-id=... --product-title=... \
  [--product-url=...] [--blogger-url=...] [--claim-ids=a,b]
```

または P3/P4 rule-based:

```bash
pnpm ops:generate-content -- --channel=X ...
pnpm ops:x-export -- --content-version-id=<ID>
```

## ルール

- 日本語は原則 weighted 140 文字以内（LLM の自己申告ではなく決定論バリデータで再検証）
- 本文に必要情報が収まれば返信なし
- 「続きはこちら」のみの低価値返信は拒否
- 未検証 Claim は本文に断定しない
- Blogger 公開済み URL があれば導線優先、未公開なら FANZA 通常商品／公式 URL 可
- Affiliate リンクなしでも Export 可能

## 手動投稿後

Analytics は `ops:analytics-ingest` で手動取り込み。公開待ち状態は PublicationTarget / Queue で確認します。
