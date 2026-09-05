import type { ReactNode } from 'react';

import { type AdminPermission, type AdminSession, can } from '../lib/authz/roles';

/**
 * Renders children only when the session holds the permission. Presentation-only: the API
 * enforces the real decision. Use for hiding controls the user cannot act on, not for security.
 */
export function RoleGate({
  session,
  permission,
  fallback = null,
  children,
}: {
  session: AdminSession | null;
  permission: AdminPermission;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return can(session, permission) ? <>{children}</> : <>{fallback}</>;
}
