# Learning Governance UI Guide

Admin Web の Learning Rules / Conflicts は `LearningGovernanceService` を呼び出す。

- Approve → Activate（ACTIVE 前に確認）
- Suspend / Deactivate は理由必須
- Conflict は人間解消のみ（AI 自動解消禁止）
- Expiration: ACTIVE の `validUntil` 到来で EXPIRED（削除しない）。再有効化は再承認が必要
- `/learning-rules/expire-due` または日次 OperationJob から期限確認可能

ACTIVE 化確認項目: 適用範囲 / sampleCount / confidence / successRate / 有効期間 / 競合 / 既存 ACTIVE への影響。
