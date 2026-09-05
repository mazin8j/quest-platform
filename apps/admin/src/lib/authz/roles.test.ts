import { describe, expect, it } from 'vitest';

import { AdminPermission, AdminRole, can, getAdminSession, rolePermissions } from './roles';

describe('admin role-aware authorization (presentation gate)', () => {
  it('denies everything when signed out (Phase 00 default)', () => {
    expect(getAdminSession()).toBeNull();
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
    const holders = Object.entries(rolePermissions)
      .filter(([, perms]) => perms.has(AdminPermission.MANAGE_STAFF))
      .map(([r]) => r);
    expect(holders).toEqual([AdminRole.SUPER_ADMIN]);
  });

  it('every role has at least VIEW_DASHBOARD and every permission is grantable by some role', () => {
    for (const perms of Object.values(rolePermissions))
      expect(perms.has(AdminPermission.VIEW_DASHBOARD)).toBe(true);
    for (const p of Object.values(AdminPermission)) {
      expect(Object.values(rolePermissions).some((s) => s.has(p))).toBe(true);
    }
  });
});
