import { z } from 'zod';

/**
 * Roles and permissions (server-side RBAC, Identity context). The API is the authority: every
 * protected endpoint declares a required permission and the PermissionsGuard denies by default.
 * The admin console imports this same vocabulary for its presentation gate (`RoleGate`).
 *
 * `USER` is implicit for every account and carries the self-service permissions. Staff roles are
 * granted explicitly (`account_role` ledger) and can only be granted by MANAGE_STAFF holders or
 * the operator CLI. SUPER_ADMIN is explicit, not a wildcard, so audits can list what it can do.
 */
export const Role = {
  USER: 'USER',
  SUPER_ADMIN: 'SUPER_ADMIN',
  TRUST_SAFETY_LEAD: 'TRUST_SAFETY_LEAD',
  MODERATOR: 'MODERATOR',
  SUPPORT: 'SUPPORT',
  ANALYST: 'ANALYST',
  READ_ONLY: 'READ_ONLY',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const roleSchema = z.enum(Object.values(Role) as [Role, ...Role[]]);

/** Roles that may be granted/revoked through the staff endpoints. USER is implicit. */
export const STAFF_ROLES: ReadonlyArray<Role> = [
  Role.SUPER_ADMIN,
  Role.TRUST_SAFETY_LEAD,
  Role.MODERATOR,
  Role.SUPPORT,
  Role.ANALYST,
  Role.READ_ONLY,
];
export const staffRoleSchema = z.enum(STAFF_ROLES as [Role, ...Role[]]);

export const Permission = {
  // ---- self-service (every account) ----
  MANAGE_OWN_ACCOUNT: 'MANAGE_OWN_ACCOUNT',
  MANAGE_OWN_PROFILE: 'MANAGE_OWN_PROFILE',
  MANAGE_OWN_PRIVACY: 'MANAGE_OWN_PRIVACY',
  MANAGE_OWN_SESSIONS: 'MANAGE_OWN_SESSIONS',
  MANAGE_OWN_DEVICES: 'MANAGE_OWN_DEVICES',
  MANAGE_OWN_BLOCKS: 'MANAGE_OWN_BLOCKS',
  REQUEST_OWN_DATA_EXPORT: 'REQUEST_OWN_DATA_EXPORT',
  REQUEST_OWN_DELETION: 'REQUEST_OWN_DELETION',
  /** Author and manage one's own Quests (Phase 02). */
  MANAGE_OWN_QUESTS: 'MANAGE_OWN_QUESTS',
  /** Accept, start and complete Quests authored by others (Phase 02). */
  PARTICIPATE_IN_QUESTS: 'PARTICIPATE_IN_QUESTS',
  // ---- staff ----
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  VIEW_MODERATION_QUEUE: 'VIEW_MODERATION_QUEUE',
  DECIDE_MODERATION_CASE: 'DECIDE_MODERATION_CASE',
  ESCALATE_CASE: 'ESCALATE_CASE',
  VIEW_USER_SUPPORT_PROFILE: 'VIEW_USER_SUPPORT_PROFILE',
  SANCTION_USER: 'SANCTION_USER',
  /** Read any Quest with its assessment history (support/moderation, Phase 02). */
  VIEW_QUEST_SUPPORT: 'VIEW_QUEST_SUPPORT',
  /** Withdraw a Quest from visibility and reinstate it to DRAFT (Phase 02). */
  SANCTION_QUEST: 'SANCTION_QUEST',
  VIEW_ANALYTICS: 'VIEW_ANALYTICS',
  MANAGE_STAFF: 'MANAGE_STAFF',
  MANAGE_POLICY: 'MANAGE_POLICY',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const permissionSchema = z.enum(Object.values(Permission) as [Permission, ...Permission[]]);

const P = Permission;

const SELF_SERVICE: ReadonlyArray<Permission> = [
  P.MANAGE_OWN_ACCOUNT,
  P.MANAGE_OWN_PROFILE,
  P.MANAGE_OWN_PRIVACY,
  P.MANAGE_OWN_SESSIONS,
  P.MANAGE_OWN_DEVICES,
  P.MANAGE_OWN_BLOCKS,
  P.REQUEST_OWN_DATA_EXPORT,
  P.REQUEST_OWN_DELETION,
  P.MANAGE_OWN_QUESTS,
  P.PARTICIPATE_IN_QUESTS,
];

const STAFF_ALL: ReadonlyArray<Permission> = [
  P.VIEW_DASHBOARD,
  P.VIEW_MODERATION_QUEUE,
  P.DECIDE_MODERATION_CASE,
  P.ESCALATE_CASE,
  P.VIEW_USER_SUPPORT_PROFILE,
  P.SANCTION_USER,
  P.VIEW_QUEST_SUPPORT,
  P.SANCTION_QUEST,
  P.VIEW_ANALYTICS,
  P.MANAGE_STAFF,
  P.MANAGE_POLICY,
];

/** Least privilege by default. Staff roles do not include self-service by themselves; USER does. */
export const rolePermissions: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  USER: new Set(SELF_SERVICE),
  SUPER_ADMIN: new Set(STAFF_ALL),
  TRUST_SAFETY_LEAD: new Set([
    P.VIEW_DASHBOARD,
    P.VIEW_MODERATION_QUEUE,
    P.DECIDE_MODERATION_CASE,
    P.ESCALATE_CASE,
    P.VIEW_USER_SUPPORT_PROFILE,
    P.SANCTION_USER,
    P.VIEW_QUEST_SUPPORT,
    P.SANCTION_QUEST,
    P.MANAGE_POLICY,
    P.VIEW_ANALYTICS,
  ]),
  MODERATOR: new Set([
    P.VIEW_DASHBOARD,
    P.VIEW_MODERATION_QUEUE,
    P.DECIDE_MODERATION_CASE,
    P.ESCALATE_CASE,
    P.VIEW_QUEST_SUPPORT,
    P.SANCTION_QUEST,
  ]),
  SUPPORT: new Set([
    P.VIEW_DASHBOARD,
    P.VIEW_USER_SUPPORT_PROFILE,
    P.VIEW_QUEST_SUPPORT,
    P.ESCALATE_CASE,
  ]),
  ANALYST: new Set([P.VIEW_DASHBOARD, P.VIEW_ANALYTICS]),
  READ_ONLY: new Set([P.VIEW_DASHBOARD]),
};

export function permissionsForRoles(roles: ReadonlyArray<Role>): ReadonlySet<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) for (const p of rolePermissions[role] ?? []) out.add(p);
  return out;
}

export function hasPermission(roles: ReadonlyArray<Role>, permission: Permission): boolean {
  return roles.some((r) => rolePermissions[r]?.has(permission) ?? false);
}

/** True when any role is a staff role (drives elevated audit logging and MFA requirements later). */
export function isStaff(roles: ReadonlyArray<Role>): boolean {
  return roles.some((r) => r !== Role.USER);
}
