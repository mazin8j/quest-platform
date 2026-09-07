/**
 * End-to-end: the client SDK (@quest/api-client — the same code mobile/web/admin use) drives a
 * real HTTP server backed by real PostgreSQL + Redis through the complete Phase 01 journey:
 * sign up → verify email → profile → interests → privacy → sign out → sign in → block → export.
 * Requires RUN_INTEGRATION=true (see test/integration/README.md).
 */
import type { AddressInfo } from 'node:net';

import {
  ApiClientError,
  AuthSession,
  InMemoryTokenStorage,
  createApiClient,
  identityApi,
  withAuthRetry,
} from '@quest/api-client';
import { INTERESTS_MIN_FOR_ONBOARDING } from '@quest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type IntegrationApp,
  createIntegrationApp,
} from '../integration/helpers/create-integration-app';

const enabled = process.env.RUN_INTEGRATION === 'true';
const dob = (age: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!enabled)('E2E: onboarding journey through the client SDK', () => {
  let it_: IntegrationApp | undefined;
  let baseUrl: string;
  /** Non-null accessor: a test body only runs when `beforeAll` succeeded. */
  const harness = (): IntegrationApp => {
    if (!it_) throw new Error('Integration app was not started');
    return it_;
  };

  function sdk(forwardedFor: string) {
    const storage = new InMemoryTokenStorage();
    const holder: { session?: AuthSession } = {};
    const client = createApiClient({
      baseUrl,
      getAccessToken: () => holder.session?.accessToken() ?? null,
      timeoutMs: 10_000,
    });
    const api = identityApi(client);
    const session = new AuthSession({ storage, refresh: (t) => api.auth.refresh(t) });
    holder.session = session;
    // Distinct forwarded IP per SDK instance keeps per-route throttles independent.
    const raw = client.request.bind(client);
    client.request = (path, opts = {}) =>
      raw(path, { ...opts, headers: { ...opts.headers, 'x-forwarded-for': forwardedFor } });
    return { api, session, storage };
  }

  beforeAll(async () => {
    it_ = await createIntegrationApp();
    await it_.app.listen(0, '127.0.0.1');
    const server = it_.app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    // Optional chaining keeps a failed beforeAll from producing a second, misleading error
    // ("Cannot read properties of undefined (reading 'close')") that hides the real cause.
    await it_?.close();
  });

  it('lets a new user onboard, exercise privacy controls, sign out and back in', async () => {
    const { api, session } = sdk('10.9.0.1');
    const consents = {
      termsOfServiceVersion: '2026-09',
      privacyPolicyVersion: '2026-09',
      ageAttestation: true as const,
    };

    // Sign up
    const registered = await api.auth.register({
      email: 'e2e@example.com',
      password: 'an end to end passphrase',
      dateOfBirth: dob(28),
      consents,
      client: { platform: 'IOS', installationId: 'e2e-install-1', appVersion: '1.0.0' },
    });
    await session.set(registered.tokens);
    expect(registered.account.onboarding.nextStep).toBe('VERIFY_EMAIL');

    // Verify email using the code the mailer delivered
    const mail = harness().mailer.lastFor('e2e@example.com', 'VERIFY_EMAIL');
    if (!mail || !('code' in mail.template)) throw new Error('no verification mail');
    const verified = await withAuthRetry(session, () =>
      api.auth.verifyEmail((mail.template as { code: string }).code),
    );
    expect(verified.state).toBe('ACTIVE');

    // Profile + interests + onboarding
    const availability = await api.public.usernameAvailability('e2e_user');
    expect(availability.available).toBe(true);
    const profile = await withAuthRetry(session, () =>
      api.profile.update({
        username: 'e2e_user',
        displayName: 'E2E User',
        bio: 'testing',
        country: 'JO',
      }),
    );
    expect(profile.username).toBe('e2e_user');
    const catalogue = await api.public.interests();
    const keys = catalogue.data.slice(0, INTERESTS_MIN_FOR_ONBOARDING).map((i) => i.key);
    await withAuthRetry(session, () => api.profile.updateInterests({ interestKeys: keys }));
    const onboarding = await withAuthRetry(session, () => api.profile.completeOnboarding());
    expect(onboarding).toMatchObject({ completed: true, nextStep: 'DONE' });

    // Privacy controls
    const privacy = await withAuthRetry(session, () =>
      api.profile.updatePrivacy({ profileVisibility: 'PRIVATE' }),
    );
    expect(privacy.profileVisibility).toBe('PRIVATE');
    // Anonymous callers never see a non-public profile; a signed-in stranger sees a limited card.
    await expect(sdk('10.9.0.2').api.public.profile('e2e_user')).rejects.toMatchObject({
      status: 404,
    });
    const stranger = sdk('10.9.0.5');
    const strangerReg = await stranger.api.auth.register({
      email: 'e2e-stranger@example.com',
      password: 'a stranger end to end passphrase',
      dateOfBirth: dob(31),
      consents,
    });
    await stranger.session.set(strangerReg.tokens);
    const asStranger = await withAuthRetry(stranger.session, () =>
      stranger.api.public.profile('e2e_user'),
    );
    expect(asStranger).toMatchObject({ isLimited: true, avatarUrl: null, bio: '' });
    await withAuthRetry(session, () => api.profile.updatePrivacy({ profileVisibility: 'PUBLIC' }));
    expect((await sdk('10.9.0.3').api.public.profile('e2e_user')).isLimited).toBe(false);

    // Sign out → token invalid → sign in again → refresh works
    await withAuthRetry(session, () => api.auth.logout());
    await expect(api.me.get()).rejects.toMatchObject({ status: 401 });
    const login = await api.auth.login({
      email: 'e2e@example.com',
      password: 'an end to end passphrase',
    });
    await session.set(login.tokens);
    const me = await withAuthRetry(session, () => api.me.get());
    expect(me.onboarding.completed).toBe(true);
    const refreshed = await session.refresh();
    expect(refreshed?.accessToken).not.toBe(login.tokens.accessToken);
    expect(
      (await withAuthRetry(session, () => api.me.sessions())).data.some((s) => s.current),
    ).toBe(true);

    // Block precedence through the SDK
    const other = sdk('10.9.0.4');
    const otherReg = await other.api.auth.register({
      email: 'e2e-other@example.com',
      password: 'another end to end passphrase',
      dateOfBirth: dob(35),
      consents,
    });
    await other.session.set(otherReg.tokens);
    await withAuthRetry(session, () => api.profile.block(otherReg.account.accountId));
    await expect(
      withAuthRetry(other.session, () => other.api.public.profile('e2e_user')),
    ).rejects.toMatchObject({ status: 404 });
    const blocks = await withAuthRetry(session, () => api.profile.blocks());
    expect(blocks.data.map((b) => b.accountId)).toEqual([otherReg.account.accountId]);
    await withAuthRetry(session, () => api.profile.unblock(otherReg.account.accountId));
    expect(
      (await withAuthRetry(other.session, () => other.api.public.profile('e2e_user'))).username,
    ).toBe('e2e_user');

    // Data export request + status
    const exportReq = await withAuthRetry(session, () => api.me.requestDataExport());
    expect(exportReq.status).toBe('REQUESTED');
    const status = await withAuthRetry(session, () => api.me.dataExport(exportReq.exportId));
    expect(['REQUESTED', 'PROCESSING', 'READY']).toContain(status.status);

    // Errors arrive as typed envelopes
    try {
      await api.auth.login({ email: 'e2e@example.com', password: 'wrong password entirely' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).code).toBe('UNAUTHENTICATED');
      expect((error as ApiClientError).correlationId).toBeDefined();
    }
  }, 60_000);
});
