import { describe, expect, it } from 'vitest';

import { AdminPermission, AdminRole, STAFF_ROLES, can, rolePermissions } from './roles';

describe('admin role-aware authorization (presentation gate, shared vocabulary)', () => {
  it('denies everything when signed out', () => {
    for (const p of Object.values(AdminPermission)) expect(can(null, p)).toBe(false);
  });

  it('applies least privilege per role', () => {
    const mod = { staffId: 's1', roles: [AdminRole.MODERATOR] };
    expect(can(mod, AdminPermission.DECIDE_MODERATION_CASE)).toBe(true);
    expect(can(mod, AdminPermission.SANCTION_USER)).toBe(false);
    expect(can(mod, AdminPermission.MANAGE_STAFF)).toBe(false);
    const ro = { staffId: 's2', roles: [AdminRole.READ_ONLY] };
    expect(can(ro, AdminPermission.VIEW_DASHBOARD)).toBe(true);
    expect(can(ro, AdminPermission.VIEW_MODERATION_QUEUE)).toBe(false);
  });

  it('unions permissions across multiple roles and keeps MANAGE_STAFF to SUPER_ADMIN only', () => {
    const both = { staffId: 's3', roles: [AdminRole.SUPPORT, AdminRole.ANALYST] };
    expect(can(both, AdminPermission.VIEW_ANALYTICS)).toBe(true);
    expect(can(both, AdminPermission.VIEW_USER_SUPPORT_PROFILE)).toBe(true);
    const holders = STAFF_ROLES.filter((r) => rolePermissions[r].has(AdminPermission.MANAGE_STAFF));
    expect(holders).toEqual([AdminRole.SUPER_ADMIN]);
  });

  it('every staff role has VIEW_DASHBOARD and a plain USER has no staff permission', () => {
    for (const r of STAFF_ROLES)
      expect(rolePermissions[r].has(AdminPermission.VIEW_DASHBOARD)).toBe(true);
    expect(can({ staffId: 'u', roles: [AdminRole.USER] }, AdminPermission.VIEW_DASHBOARD)).toBe(
      false,
    );
  });
});
