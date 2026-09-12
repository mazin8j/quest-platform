import { ApiClientError } from '@quest/api-client';
import { suspendQuestRequestSchema, uuidSchema } from '@quest/types';
import { NextResponse } from 'next/server';

import { isSameOriginRequest } from '../../../../../lib/csrf';
import { getStaffContext, questApiFor } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

/** Withdraws a Quest from visibility. Same-origin asserted before anything else (audit P01-12). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ questId: string }> },
): Promise<Response> {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  const { questId } = await params;
  const id = uuidSchema.safeParse(questId);
  const form = await request.formData();
  const body = suspendQuestRequestSchema.safeParse({ reason: form.get('reason') });
  if (!id.success || !body.success)
    return NextResponse.redirect(new URL('/quests?error=invalid', request.url), 303);
  try {
    await questApiFor(ctx.accessToken).admin.suspend(id.data, body.data);
    return NextResponse.redirect(new URL(`/quests?id=${id.data}`, request.url), 303);
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'UNKNOWN';
    return NextResponse.redirect(new URL(`/quests?id=${id.data}&error=${code}`, request.url), 303);
  }
}
