import type { AccountView } from '@quest/types';

/** Route groups of the app (expo-router). */
export const Routes = {
  SIGN_IN: '/(auth)/sign-in',
  SIGN_UP: '/(auth)/sign-up',
  VERIFY_EMAIL: '/(onboarding)/verify-email',
  PROFILE: '/(onboarding)/profile',
  INTERESTS: '/(onboarding)/interests',
  HOME: '/(app)',
  DELETION_PENDING: '/(app)/deletion-pending',
} as const;
export type Route = (typeof Routes)[keyof typeof Routes];

/**
 * Where the app should be for a given account, derived purely from the server's account view so
 * the client never re-implements onboarding rules. Null account = signed out.
 */
export function routeForAccount(account: AccountView | null): Route {
  if (!account) return Routes.SIGN_IN;
  if (account.state === 'DELETION_REQUESTED') return Routes.DELETION_PENDING;
  if (account.onboarding.completed) return Routes.HOME;
  switch (account.onboarding.nextStep) {
    case 'VERIFY_EMAIL':
      return Routes.VERIFY_EMAIL;
    case 'PROFILE':
      return Routes.PROFILE;
    case 'INTERESTS':
      return Routes.INTERESTS;
    case 'DONE':
      return Routes.HOME;
  }
}

/** Whether a route belongs to the signed-out area. */
export function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith('/(auth)') || pathname === '/sign-in' || pathname === '/sign-up';
}
