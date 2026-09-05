/**
 * Role-aware authorization architecture for the admin console.
 *
 * IMPORTANT: this is a *presentation-side* gate only (what to render). The API is the authority
 * and re-checks every action server-side (docs/security/SECURITY_ARCHITECTURE.md, "Authorization").
 * Roles and permissions are defined here so admin UI built in Phase 01+ has one vocabulary; the
 * server-side RBAC model (Identity, Phase 01) must use the same names.
 */
export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  TRUST_SAFETY_LEAD: 'TRUST_SAFETY_LEAD',
  MODERATOR: 'MODERATOR',
  SUPPORT: 'SUPPORT',
  ANALYST: 'ANALYST',
  READ_ONLY: 'READ_ONLY',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const AdminPermission = {
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  VIEW_MODERATION_QUEUE: 'VIEW_MODERATION_QUEUE',
  DECIDE_MODERATION_CASE: 'DECIDE_MODERATION_CASE',
  ESCALATE_CASE: 'ESCALATE_CASE',
  VIEW_USER_SUPPORT_PROFILE: 'VIEW_USER_SUPPORT_PROFILE',
  SANCTION_USER: 'SANCTION_USER',
  VIEW_ANALYTICS: 'VIEW_ANALYTICS',
  MANAGE_STAFF: 'MANAGE_STAFF',
  MANAGE_POLICY: 'MANAGE_POLICY',
} as const;
export type AdminPermission = (typeof AdminPermission)[keyof typeof AdminPermission];

const P = AdminPermission;

/** Least privilege by default; SUPER_ADMIN is explicit, not a wildcard, so audits can list it. */
export const rolePermissions: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  SUPER_ADMIN: new Set(Object.values(P)),
  TRUST_SAFETY_LEAD: new Set([
    P.VIEW_DASHBOARD,
    P.VIEW_MODERATION_QUEUE,
    P.DECIDE_MODERATION_CASE,
    P.ESCALATE_CASE,
    P.SANCTION_USER,
    P.MANAGE_POLICY,
    P.VIEW_ANALYTICS,
  ]),
  MODERATOR: new Set([
    P.VIEW_DASHBOARD,
    P.VIEW_MODERATION_QUEUE,
    P.DECIDE_MODERATION_CASE,
    P.ESCALATE_CASE,
  ]),
  SUPPORT: new Set([P.VIEW_DASHBOARD, P.VIEW_USER_SUPPORT_PROFILE, P.ESCALATE_CASE]),
  ANALYST: new Set([P.VIEW_DASHBOARD, P.VIEW_ANALYTICS]),
  READ_ONLY: new Set([P.VIEW_DASHBOARD]),
};

export interface AdminSession {
  staffId: string;
  roles: ReadonlyArray<AdminRole>;
}

export function can(
  session: AdminSession | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!session) return false;
  return session.roles.some((r) => rolePermissions[r]?.has(permission) ?? false);
}

/**
 * Session accessor placeholder: no admin identity exists in Phase 00, so every request is treated
 * as signed-out (deny). Replaced by the real session lookup when admin identity ships.
 */
export function getAdminSession(): AdminSession | null {
  return null;
}
