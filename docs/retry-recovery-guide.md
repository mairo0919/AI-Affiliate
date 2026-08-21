# Retry / Recovery Guide (P6)

## Retryable

timeout, temporary network, rate limit, temporary DB, temporary external API, lock conflict

## Non-retryable

invalid config, auth failure, schema validation, policy block, unsupported claim, missing approval, malformed permanent input

Resume uses `OperationCheckpoint` reusable refs so ContentVersion / PublicationRecord / AnalyticsSnapshot are not duplicated for completed steps.
