import {
  Permission,
  Role,
  STAFF_ROLES,
  hasPermission,
  rolePermissions as sharedRolePermissions,
} from '@quest/types';

/**
 * Role-aware authorization for the admin console — the SAME vocabulary the API enforces
 * (`@quest/types` Role / Permission, Phase 01). This remains a *presentation-side* gate: the API
 * re-checks every action server-side (docs/security/SECURITY_ARCHITECTURE.md, "Authorization").
 */
export const AdminRole = Role;
export type AdminRole = Role;
export const AdminPermission = Permission;
export type AdminPermission = Permission;
export const rolePermissions = sharedRolePermissions;
export { STAFF_ROLES };

export interface AdminSession {
  /** The staff member's immutable account id. */
  staffId: string;
  roles: ReadonlyArray<AdminRole>;
}

export function can(
  session: AdminSession | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!session) return false;
  return hasPermission(session.roles, permission);
}
