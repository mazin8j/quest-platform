import { ApiClientError } from '@quest/api-client';
import { suspendAccountRequestSchema, uuidSchema } from '@quest/types';
import { NextResponse } from 'next/server';

import { apiFor, getStaffContext } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  const { accountId } = await params;
  const id = uuidSchema.safeParse(accountId);
  const form = await request.formData();
  const body = suspendAccountRequestSchema.safeParse({ reason: form.get('reason') });
  if (!id.success || !body.success)
    return NextResponse.redirect(new URL('/accounts?error=invalid', request.url), 303);
  try {
    await apiFor(ctx.accessToken).admin.suspend(id.data, body.data);
    return NextResponse.redirect(new URL(`/accounts?id=${id.data}`, request.url), 303);
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'UNKNOWN';
    return NextResponse.redirect(
      new URL(`/accounts?id=${id.data}&error=${code}`, request.url),
      303,
    );
  }
}
