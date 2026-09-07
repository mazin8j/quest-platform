import { NextResponse } from 'next/server';

import { isSameOriginRequest } from '../../../../lib/csrf';
import { apiFor, clearTokens, getStaffContext } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const ctx = await getStaffContext();
  if (ctx)
    await apiFor(ctx.accessToken)
      .auth.logout()
      .catch(() => undefined);
  await clearTokens();
  return NextResponse.redirect(new URL('/sign-in', request.url), 303);
}
