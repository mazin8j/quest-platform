import { ApiClientError } from '@quest/api-client';
import { isStaff, loginRequestSchema } from '@quest/types';
import { NextResponse } from 'next/server';

import { isSameOriginRequest } from '../../../../lib/csrf';
import { apiFor, storeTokens } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

/** Staff sign-in: exchanges credentials with the API and stores tokens in httpOnly cookies. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const form = await request.formData();
  const parsed = loginRequestSchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
    client: { platform: 'WEB', installationId: 'admin-console-web' },
  });
  if (!parsed.success)
    return NextResponse.redirect(new URL('/sign-in?error=invalid', request.url), 303);
  try {
    const response = await apiFor().auth.login(parsed.data);
    if (!isStaff(response.account.roles)) {
      // Never keep a non-staff session in the console.
      return NextResponse.redirect(new URL('/sign-in?error=not-staff', request.url), 303);
    }
    await storeTokens(response.tokens);
    return NextResponse.redirect(new URL('/', request.url), 303);
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'UNKNOWN';
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(code)}`, request.url),
      303,
    );
  }
}
