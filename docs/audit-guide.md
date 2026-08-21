# Audit Guide (Admin)

検索: actor / action / resource type / resource ID / job ID

表示: who / when / what / summary / details（scrub 済み）/ correlation

禁止:

- raw token / API key / password の記録・表示
- 本文全文や巨大 payload の無制限 before/after

必要なら hash・差分概要・参照 ID で追跡する。Admin Web `/audit` または `GET /audit-events`。
