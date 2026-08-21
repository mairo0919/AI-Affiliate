# Job Recovery Guide (Admin)

Jobs 画面は `AdminJobView` として OperationJob / ResearchJob を共通一覧表示する。

書き込み:

- OperationJob: resume / retry / cancel → OrchestrationService / P6Repository
- ResearchJob: 既存 Job Service（表示中心。詳細操作は CLI 互換を維持）

制約:

- FAILED 以外の無制限 retry 禁止
- 重複実行防止（idempotency）維持
- checkpoint / audit を Detail で確認
