export type AdminRole = "ADMIN" | "OPERATOR" | "REVIEWER" | "VIEWER";

export type AdminPermission =
  | "settings:write"
  | "users:write"
  | "jobs:run"
  | "jobs:cancel"
  | "analytics:import"
  | "analytics:match"
  | "blogger:draft"
  | "x:export"
  | "content:approve"
  | "publication:approve"
  | "learning:approve"
  | "experiment:approve"
  | "link-replacement:approve"
  | "read";

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  ADMIN: [
    "settings:write",
    "users:write",
    "jobs:run",
    "jobs:cancel",
    "analytics:import",
    "analytics:match",
    "blogger:draft",
    "x:export",
    "content:approve",
    "publication:approve",
    "learning:approve",
    "experiment:approve",
    "link-replacement:approve",
    "read",
  ],
  OPERATOR: [
    "jobs:run",
    "analytics:import",
    "analytics:match",
    "blogger:draft",
    "x:export",
    "read",
  ],
  REVIEWER: [
    "content:approve",
    "publication:approve",
    "learning:approve",
    "experiment:approve",
    "link-replacement:approve",
    "read",
  ],
  VIEWER: ["read"],
};

export function permissionsForRole(role: AdminRole): AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return permissionsForRole(role).includes(permission);
}
