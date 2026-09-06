import { NextResponse } from 'next/server';

import { apiFor, clearTokens, getStaffContext } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const ctx = await getStaffContext();
  if (ctx)
    await apiFor(ctx.accessToken)
      .auth.logout()
      .catch(() => undefined);
  await clearTokens();
  return NextResponse.redirect(new URL('/sign-in', request.url), 303);
}
