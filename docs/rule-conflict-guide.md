# Rule Conflict Guide (P6)

Detected conflict types include:

- opposite directives in same platform/contentType/genre
- CTA density conflicts
- title length conflicts
- timing conflicts
- low-sample rule overriding high-sample ACTIVE rule

Conflicts are stored as `LearningRuleConflict` with status `manual_review_required`. Automatic Strategy injection skips unsafe activation.
