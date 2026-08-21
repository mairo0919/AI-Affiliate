# Approval Operations (Admin)

危険操作は理由入力 + 確認ダイアログ（Web）と API 側バリデーションの両方で保護する。

| 対象 | 操作 | 必要ロール | 状態条件 |
| --- | --- | --- | --- |
| ContentVersion | approve | REVIEWER+ | REVIEWING + latest + review not FAILED + claims ok |
| ContentVersion | reject / abandon | REVIEWER+ | reason required |
| PublicationTarget | approve | REVIEWER+ | AWAITING_APPROVAL / DRAFT |
| LearningRule | approve → activate | REVIEWER+ | thresholds + approval + no open conflict |
| Experiment | approve | REVIEWER+ | awaiting approval statuses |
| LinkReplacement | approve → apply | REVIEWER+ | APPROVED before apply; apply creates new ContentVersion |
| OperationJob | retry | OPERATOR+ | FAILED + retryable only |
| OperationJob | cancel | ADMIN | reason required |

すべての重要操作は `AuditEvent` / `ApprovalDecision` に actor・reason・correlationId を残す。
