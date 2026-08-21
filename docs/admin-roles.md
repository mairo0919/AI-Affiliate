# Admin Roles

Roles are stored on `AdminUser.role` and enforced in Admin API (`roleHasPermission`).

| Permission | ADMIN | OPERATOR | REVIEWER | VIEWER |
| --- | --- | --- | --- | --- |
| read | ✓ | ✓ | ✓ | ✓ |
| content:approve | ✓ | | ✓ | |
| publication:approve | ✓ | | ✓ | |
| learning:approve | ✓ | | ✓ | |
| experiment:approve | ✓ | | ✓ | |
| link-replacement:approve | ✓ | | ✓ | |
| analytics:import | ✓ | ✓ | | |
| analytics:match | ✓ | ✓ | | |
| blogger:draft | ✓ | ✓ | | |
| x:export | ✓ | ✓ | | |
| jobs:run | ✓ | ✓ | | |
| jobs:cancel | ✓ | | | |
| settings:write | ✓ | | | |
| users:write | ✓ | | | |

State checks are enforced in Application Services（例: REVIEWING 以外の ContentVersion 承認拒否）。
