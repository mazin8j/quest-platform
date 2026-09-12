/**
 * Phase 01 identity & profiles — integration suite against real PostgreSQL + Redis.
 * Requires RUN_INTEGRATION=true, DATABASE_URL, REDIS_URL, MAIL_PROVIDER=memory,
 * AUTH_FAKE_PROVIDER_ENABLED=true. Drops and recreates the public schema.
 */
import {
  accountViewSchema,
  apiErrorEnvelopeSchema,
  authResponseSchema,
  dataExportBundleSchema,
  ownProfileViewSchema,
  privacySettingsSchema,
  publicProfileViewSchema,
} from '@quest/types';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccountDeletionJob, DataExportService } from '../../src/modules/identity';
import { AccountRepository } from '../../src/modules/identity/infrastructure/account.repository';
import { type IntegrationApp, createIntegrationApp } from './helpers/create-integration-app';

const enabled = process.env.RUN_INTEGRATION === 'true';
const TERMS = process.env.AUTH_TERMS_VERSION ?? '2026-09';
const PRIVACY = process.env.AUTH_PRIVACY_POLICY_VERSION ?? '2026-09';

const consents = {
  termsOfServiceVersion: TERMS,
  privacyPolicyVersion: PRIVACY,
  ageAttestation: true as const,
};
const dob = (age: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
let ipCounter = 10;
/** Each logical client gets its own forwarded IP so per-route throttles do not bleed across tests. */
const nextIp = () => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

describe.skipIf(!enabled)('identity & profiles (real database)', () => {
  let it_: IntegrationApp | undefined;
  let pg: Client | undefined;
  /** Non-null accessors: a test body only runs when `beforeAll` succeeded. */
  const harness = (): IntegrationApp => {
    if (!it_) throw new Error('Integration app was not started');
    return it_;
  };
  const db = (): Client => {
    if (!pg) throw new Error('Database client was not connected');
    return pg;
  };
  const server = () => harness().app.getHttpServer() as Parameters<typeof request>[0];

  interface Actor {
    email: string;
    password: string;
    accessToken: string;
    refreshToken: string;
    accountId: string;
    ip: string;
  }

  async function register(
    email: string,
    age = 30,
    password = 'a very long and unique passphrase',
    extra: Record<string, unknown> = {},
  ): Promise<Actor> {
    const ip = nextIp();
    const res = await request(server())
      .post('/v1/auth/register')
      .set('x-forwarded-for', ip)
      .send({ email, password, dateOfBirth: dob(age), consents, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const parsed = authResponseSchema.parse(res.body);
    return {
      email,
      password,
      accessToken: parsed.tokens.accessToken,
      refreshToken: parsed.tokens.refreshToken,
      accountId: parsed.account.accountId,
      ip,
    };
  }

  function codeFor(
    email: string,
    template: 'VERIFY_EMAIL' | 'RESET_PASSWORD' = 'VERIFY_EMAIL',
  ): string {
    const mail = harness().mailer.lastFor(email, template);
    if (!mail || !('code' in mail.template)) throw new Error(`no ${template} mail for ${email}`);
    return mail.template.code;
  }

  async function verify(actor: Actor): Promise<void> {
    const res = await request(server())
      .post('/v1/auth/email/verify')
      .set('authorization', `Bearer ${actor.accessToken}`)
      .set('x-forwarded-for', actor.ip)
      .send({ code: codeFor(actor.email) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  const auth = (a: Actor) => ({
    authorization: `Bearer ${a.accessToken}`,
    'x-forwarded-for': a.ip,
  });

  beforeAll(async () => {
    it_ = await createIntegrationApp();
    // This suite's own database (see helpers/test-database.ts), never the shared one.
    pg = new Client({ connectionString: harness().databaseUrl });
    await pg.connect();
  });
  afterAll(async () => {
    // Optional chaining keeps a failed beforeAll from adding a misleading teardown error on top
    // of the real one.
    await pg?.end();
    await it_?.close();
  });

  // ------------------------------------------------------------------------ registration ----

  it('registers a new account: pending verification, immutable UUIDv7 id, consents recorded, no DOB exposed', async () => {
    const res = await request(server())
      .post('/v1/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({
        email: '  Ragad.One@Example.com ',
        password: 'a very long and unique passphrase',
        dateOfBirth: dob(30),
        consents: { ...consents, analytics: true },
        language: 'ar',
        country: 'JO',
        client: {
          platform: 'IOS',
          installationId: 'install-0001',
          appVersion: '1.0.0',
          deviceName: 'Test iPhone',
        },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = authResponseSchema.parse(res.body);
    expect(body.account.email).toBe('ragad.one@example.com');
    expect(body.account.state).toBe('PENDING_VERIFICATION');
    expect(body.account.emailVerified).toBe(false);
    expect(body.account.ageBand).toBe('ADULT');
    expect(body.account.roles).toEqual(['USER']);
    expect(body.account.onboarding).toEqual({ completed: false, nextStep: 'VERIFY_EMAIL' });
    expect(body.account.accountId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(res.body)).not.toContain(dob(30));
    expect(body.tokens.tokenType).toBe('Bearer');
    expect(body.tokens.accessTokenExpiresIn).toBe(900);

    const rows = await db().query<{ consent_type: string; granted: boolean }>(
      'SELECT consent_type, granted FROM consent_record WHERE account_id = $1 ORDER BY consent_type',
      [body.account.accountId],
    );
    expect(rows.rows).toEqual([
      { consent_type: 'AGE_ATTESTATION', granted: true },
      { consent_type: 'ANALYTICS', granted: true },
      { consent_type: 'MARKETING', granted: false },
      { consent_type: 'PERSONALISATION', granted: false },
      { consent_type: 'PRIVACY_POLICY', granted: true },
      { consent_type: 'TERMS_OF_SERVICE', granted: true },
    ]);
    const cred = await db().query<{ password_hash: string }>(
      'SELECT password_hash FROM account_credential WHERE account_id = $1',
      [body.account.accountId],
    );
    expect(cred.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    const profile = await db().query<{
      language: string;
      country: string;
      account_active: boolean;
    }>('SELECT language, country, account_active FROM profile WHERE account_id = $1', [
      body.account.accountId,
    ]);
    expect(profile.rows[0]).toEqual({ language: 'ar', country: 'JO', account_active: false });
    const device = await db().query<{ platform: string; device_name: string }>(
      'SELECT platform, device_name FROM device WHERE account_id = $1',
      [body.account.accountId],
    );
    expect(device.rows[0]).toEqual({ platform: 'IOS', device_name: 'Test iPhone' });
    expect(harness().mailer.lastFor('ragad.one@example.com', 'VERIFY_EMAIL')).toBeDefined();
  });

  it('refuses duplicate emails (case-insensitively), weak passwords, wrong consent versions and under-age users', async () => {
    const dup = await request(server())
      .post('/v1/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({
        email: 'RAGAD.ONE@example.com',
        password: 'another very long passphrase',
        dateOfBirth: dob(30),
        consents,
      });
    expect(dup.status).toBe(409);

    const weak = await request(server())
      .post('/v1/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({ email: 'weak@example.com', password: 'password123', dateOfBirth: dob(30), consents });
    expect(weak.status).toBe(400);
    expect(
      apiErrorEnvelopeSchema.parse(weak.body).error.issues?.some((i) => i.path === 'password'),
    ).toBe(true);

    const oldTerms = await request(server())
      .post('/v1/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({
        email: 'terms@example.com',
        password: 'another very long passphrase',
        dateOfBirth: dob(30),
        consents: { ...consents, termsOfServiceVersion: '2020-01' },
      });
    expect(oldTerms.status).toBe(400);

    const child = await request(server())
      .post('/v1/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({
        email: 'child@example.com',
        password: 'another very long passphrase',
        dateOfBirth: dob(12),
        consents,
      });
    expect(child.status).toBe(403);
    const stored = await db().query('SELECT 1 FROM account WHERE email = $1', [
      'child@example.com',
    ]);
    expect(stored.rowCount).toBe(0);
  });

  // ------------------------------------------------------------- verification & onboarding ----

  it('verifies the email with the mailed code (wrong code rejected), then completes onboarding', async () => {
    const a = await register('onboard@example.com');
    const wrong = await request(server())
      .post('/v1/auth/email/verify')
      .set(auth(a))
      .send({ code: '000000' });
    expect(wrong.status).toBe(400);

    const early = await request(server()).post('/v1/me/onboarding/complete').set(auth(a));
    expect(early.status).toBe(403); // email not verified

    await verify(a);
    const me = accountViewSchema.parse((await request(server()).get('/v1/me').set(auth(a))).body);
    expect(me.state).toBe('ACTIVE');
    expect(me.emailVerified).toBe(true);
    expect(me.onboarding.nextStep).toBe('PROFILE');

    const avail = await request(server())
      .get('/v1/profiles/username-availability?username=Onboard_One')
      .set('x-forwarded-for', a.ip);
    expect(avail.body).toEqual({ username: 'onboard_one', available: true, reason: null });
    const reserved = await request(server())
      .get('/v1/profiles/username-availability?username=admin')
      .set('x-forwarded-for', a.ip);
    expect(reserved.body.reason).toBe('RESERVED');

    const profile = await request(server()).put('/v1/me/profile').set(auth(a)).send({
      username: 'Onboard_One',
      displayName: 'Onboard One',
      bio: 'I do things.',
      timezone: 'Asia/Amman',
    });
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);
    expect(ownProfileViewSchema.parse(profile.body).username).toBe('onboard_one');

    const incomplete = await request(server()).post('/v1/me/onboarding/complete').set(auth(a));
    expect(incomplete.status).toBe(400);
    expect(apiErrorEnvelopeSchema.parse(incomplete.body).error.issues?.map((i) => i.path)).toEqual([
      'INTERESTS',
    ]);

    const catalogue = await request(server()).get('/v1/interests').set('x-forwarded-for', a.ip);
    expect(catalogue.status).toBe(200);
    expect(catalogue.body.data.length).toBeGreaterThanOrEqual(20);

    const unknown = await request(server())
      .put('/v1/me/interests')
      .set(auth(a))
      .send({ interestKeys: ['fitness', 'nope-not-real'] });
    expect(unknown.status).toBe(400);
    const interests = await request(server())
      .put('/v1/me/interests')
      .set(auth(a))
      .send({ interestKeys: ['fitness', 'hiking', 'volunteering'] });
    expect(interests.status).toBe(200);

    const done = await request(server()).post('/v1/me/onboarding/complete').set(auth(a));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ completed: true, nextStep: 'DONE', missing: [] });
    const meAfter = accountViewSchema.parse(
      (await request(server()).get('/v1/me').set(auth(a))).body,
    );
    expect(meAfter.onboarding).toEqual({ completed: true, nextStep: 'DONE' });
  });

  it('enforces username uniqueness with CONFLICT under concurrency', async () => {
    const a = await register('uniq-a@example.com');
    const b = await register('uniq-b@example.com');
    const first = await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ username: 'shared_handle', displayName: 'A' });
    expect(first.status).toBe(200);
    const second = await request(server())
      .put('/v1/me/profile')
      .set(auth(b))
      .send({ username: 'shared_handle', displayName: 'B' });
    expect(second.status).toBe(409);
    const availability = await request(server())
      .get('/v1/profiles/username-availability?username=shared_handle')
      .set('x-forwarded-for', b.ip);
    expect(availability.body.reason).toBe('TAKEN');
  });

  // ---------------------------------------------------------------- privacy & public profile ----

  it('applies adult privacy defaults, hides limited profiles, and respects visibility + block precedence', async () => {
    const owner = await register('owner@example.com');
    await verify(owner);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(owner))
      .send({ username: 'owner_one', displayName: 'Owner', bio: 'hello', country: 'JO' });
    await request(server())
      .put('/v1/me/interests')
      .set(auth(owner))
      .send({ interestKeys: ['art'] });
    const viewer = await register('viewer@example.com');
    await verify(viewer);

    const privacy = privacySettingsSchema.parse(
      (await request(server()).get('/v1/me/privacy').set(auth(owner))).body,
    );
    expect(privacy).toMatchObject({
      profileVisibility: 'PUBLIC',
      locationVisibility: 'CITY',
      challengeInvitesFrom: 'EVERYONE',
      discoverable: true,
      lockedByPolicy: [],
    });

    const full = publicProfileViewSchema.parse(
      (await request(server()).get('/v1/profiles/owner_one').set(auth(viewer))).body,
    );
    expect(full).toMatchObject({
      username: 'owner_one',
      displayName: 'Owner',
      bio: 'hello',
      country: 'JO',
      isLimited: false,
      interests: ['art'],
    });
    expect(full).not.toHaveProperty('email');
    expect(full).not.toHaveProperty('dateOfBirth');

    const anonymous = await request(server())
      .get('/v1/profiles/owner_one')
      .set('x-forwarded-for', nextIp());
    expect(anonymous.status).toBe(200);

    const toPrivate = await request(server())
      .put('/v1/me/privacy')
      .set(auth(owner))
      .send({ profileVisibility: 'PRIVATE', locationVisibility: 'HIDDEN' });
    expect(toPrivate.status).toBe(200);
    const limited = publicProfileViewSchema.parse(
      (await request(server()).get('/v1/profiles/owner_one').set(auth(viewer))).body,
    );
    expect(limited).toMatchObject({ isLimited: true, bio: '', country: null, interests: [] });
    const self = publicProfileViewSchema.parse(
      (await request(server()).get('/v1/profiles/owner_one').set(auth(owner))).body,
    );
    expect(self.isLimited).toBe(false);

    // Blocks: neither side can see the other; self-block refused; unblock restores.
    const selfBlock = await request(server())
      .post('/v1/me/blocks')
      .set(auth(owner))
      .send({ accountId: owner.accountId });
    expect(selfBlock.status).toBe(400);
    const block = await request(server())
      .post('/v1/me/blocks')
      .set(auth(owner))
      .send({ accountId: viewer.accountId });
    expect(block.status).toBe(204);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(viewer))
      .send({ username: 'viewer_one', displayName: 'Viewer' });
    expect((await request(server()).get('/v1/profiles/owner_one').set(auth(viewer))).status).toBe(
      404,
    );
    expect((await request(server()).get('/v1/profiles/viewer_one').set(auth(owner))).status).toBe(
      404,
    );
    const list = await request(server()).get('/v1/me/blocks').set(auth(owner));
    expect(list.body.data).toEqual([
      expect.objectContaining({ accountId: viewer.accountId, username: 'viewer_one' }),
    ]);
    expect(
      (await request(server()).delete(`/v1/me/blocks/${viewer.accountId}`).set(auth(owner))).status,
    ).toBe(204);
    expect((await request(server()).get('/v1/profiles/viewer_one').set(auth(owner))).status).toBe(
      200,
    );

    // Unverified / inactive accounts are never visible to others.
    const pending = await register('pending@example.com');
    await request(server())
      .put('/v1/me/profile')
      .set(auth(pending))
      .send({ username: 'pending_one', displayName: 'Pending' });
    expect((await request(server()).get('/v1/profiles/pending_one').set(auth(viewer))).status).toBe(
      404,
    );
  });

  it('applies the minor policy: elevated defaults and locked settings by age band', async () => {
    const teen = await register('teen16@example.com', 16);
    const teenPrivacy = privacySettingsSchema.parse(
      (await request(server()).get('/v1/me/privacy').set(auth(teen))).body,
    );
    expect(teenPrivacy).toMatchObject({
      profileVisibility: 'PRIVATE',
      locationVisibility: 'HIDDEN',
      discoverable: false,
      lockedByPolicy: [],
    });
    const neighbourhood = await request(server())
      .put('/v1/me/privacy')
      .set(auth(teen))
      .send({ locationVisibility: 'NEIGHBOURHOOD' });
    expect(neighbourhood.status).toBe(403);
    const city = await request(server())
      .put('/v1/me/privacy')
      .set(auth(teen))
      .send({ locationVisibility: 'CITY', profileVisibility: 'PUBLIC' });
    expect(city.status).toBe(200);
    const me = accountViewSchema.parse(
      (await request(server()).get('/v1/me').set(auth(teen))).body,
    );
    expect(me.ageBand).toBe('TEEN_16_17');

    const young = await register('teen13@example.com', 13);
    const youngPrivacy = privacySettingsSchema.parse(
      (await request(server()).get('/v1/me/privacy').set(auth(young))).body,
    );
    expect(youngPrivacy.lockedByPolicy).toEqual(['locationVisibility', 'discoverable']);
    expect(
      (
        await request(server())
          .put('/v1/me/privacy')
          .set(auth(young))
          .send({ profileVisibility: 'PUBLIC' })
      ).status,
    ).toBe(403);
    expect(
      (await request(server()).put('/v1/me/privacy').set(auth(young)).send({ discoverable: true }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(server())
          .put('/v1/me/privacy')
          .set(auth(young))
          .send({ profileVisibility: 'FOLLOWERS' })
      ).status,
    ).toBe(200);
  });

  // ---------------------------------------------------------------- sessions and tokens ----

  it('rotates refresh tokens, detects reuse, lists and revokes sessions, and invalidates on sign-out', async () => {
    const a = await register('sessions@example.com');
    const login = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', a.ip)
      .send({
        email: a.email,
        password: a.password,
        client: { platform: 'ANDROID', installationId: 'install-android-1' },
      });
    expect(login.status).toBe(200);
    const second = authResponseSchema.parse(login.body).tokens;

    const list = await request(server()).get('/v1/me/sessions').set(auth(a));
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    // Rotation
    const refreshed = await request(server())
      .post('/v1/auth/refresh')
      .set('x-forwarded-for', a.ip)
      .send({ refreshToken: second.refreshToken });
    expect(refreshed.status).toBe(200);
    const rotated = authResponseSchema.parse(refreshed.body).tokens;
    expect(rotated.refreshToken).not.toBe(second.refreshToken);
    expect(rotated.sessionId).toBe(second.sessionId);

    // Reuse of the rotated-out token revokes the whole session, including the fresh access token.
    const reuse = await request(server())
      .post('/v1/auth/refresh')
      .set('x-forwarded-for', a.ip)
      .send({ refreshToken: second.refreshToken });
    expect(reuse.status).toBe(401);
    const afterReuse = await request(server())
      .get('/v1/me')
      .set('authorization', `Bearer ${rotated.accessToken}`)
      .set('x-forwarded-for', a.ip);
    expect(afterReuse.status).toBe(401);
    const rotatedAgain = await request(server())
      .post('/v1/auth/refresh')
      .set('x-forwarded-for', a.ip)
      .send({ refreshToken: rotated.refreshToken });
    expect(rotatedAgain.status).toBe(401);

    // Revoke by id: another live session of the same account dies; a foreign session id is a no-op.
    const third = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', a.ip)
          .send({ email: a.email, password: a.password })
      ).body,
    ).tokens;
    const stranger = await register('sessions-stranger@example.com');
    const strangerSessionId = (await request(server()).get('/v1/me/sessions').set(auth(stranger)))
      .body.data[0].sessionId;
    expect(
      (await request(server()).delete(`/v1/me/sessions/${strangerSessionId}`).set(auth(a))).status,
    ).toBe(204);
    expect((await request(server()).get('/v1/me').set(auth(stranger))).status).toBe(200); // untouched
    expect(
      (await request(server()).delete(`/v1/me/sessions/${third.sessionId}`).set(auth(a))).status,
    ).toBe(204);
    expect(
      (
        await request(server())
          .get('/v1/me')
          .set('authorization', `Bearer ${third.accessToken}`)
          .set('x-forwarded-for', a.ip)
      ).status,
    ).toBe(401);
    const remaining = await request(server()).get('/v1/me/sessions').set(auth(a));
    expect(remaining.body.data).toHaveLength(1);
    const logout = await request(server()).post('/v1/auth/logout').set(auth(a));
    expect(logout.status).toBe(204);
    expect((await request(server()).get('/v1/me').set(auth(a))).status).toBe(401);
    expect(
      (
        await request(server())
          .post('/v1/auth/refresh')
          .set('x-forwarded-for', a.ip)
          .send({ refreshToken: a.refreshToken })
      ).status,
    ).toBe(401);
  });

  it('rejects forged, expired-session and cross-account tokens', async () => {
    const a = await register('forge@example.com');
    const [h, p] = a.accessToken.split('.');
    const forged = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(
      (
        await request(server())
          .get('/v1/me')
          .set('authorization', `Bearer ${forged}`)
          .set('x-forwarded-for', a.ip)
      ).status,
    ).toBe(401);
    const none = `${h}.${p}.`;
    expect(
      (
        await request(server())
          .get('/v1/me')
          .set('authorization', `Bearer ${none}`)
          .set('x-forwarded-for', a.ip)
      ).status,
    ).toBe(401);
  });

  // ------------------------------------------------------------------- credential abuse ----

  it('answers unknown emails and wrong passwords identically and locks after repeated failures', async () => {
    const a = await register('lockout@example.com');
    const unknown = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', a.ip)
      .send({ email: 'nobody@example.com', password: 'whatever whatever' });
    const wrong = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', a.ip)
      .send({ email: a.email, password: 'whatever whatever' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(apiErrorEnvelopeSchema.parse(unknown.body).error.message).toBe(
      apiErrorEnvelopeSchema.parse(wrong.body).error.message,
    );

    const max = Number(process.env.AUTH_LOGIN_MAX_FAILURES ?? 10);
    for (let i = 1; i < max; i += 1) {
      await request(server())
        .post('/v1/auth/login')
        .set('x-forwarded-for', nextIp())
        .send({ email: a.email, password: 'whatever whatever' });
    }
    const locked = await db().query<{ locked_until: Date | null; failed_attempts: number }>(
      'SELECT locked_until, failed_attempts FROM account_credential WHERE account_id = $1',
      [a.accountId],
    );
    expect(locked.rows[0]?.failed_attempts).toBe(max);
    expect(locked.rows[0]?.locked_until).not.toBeNull();
    const correctWhileLocked = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ email: a.email, password: a.password });
    expect(correctWhileLocked.status).toBe(401);
    expect(apiErrorEnvelopeSchema.parse(correctWhileLocked.body).error.message).toBe(
      apiErrorEnvelopeSchema.parse(wrong.body).error.message,
    );
  });

  it('rate limits sign-in per client', async () => {
    const ip = nextIp();
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      const r = await request(server())
        .post('/v1/auth/login')
        .set('x-forwarded-for', ip)
        .send({ email: 'ratelimit@example.com', password: 'whatever whatever' });
      last = r.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  // ------------------------------------------------------------------------ passwords ----

  it('changes and resets passwords, revoking other sessions each time', async () => {
    const a = await register('passwords@example.com');
    const other = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', a.ip)
          .send({ email: a.email, password: a.password })
      ).body,
    ).tokens;

    const badCurrent = await request(server())
      .post('/v1/auth/password/change')
      .set(auth(a))
      .send({ currentPassword: 'not it at all really', newPassword: 'brand new long passphrase' });
    expect(badCurrent.status).toBe(401);
    const change = await request(server())
      .post('/v1/auth/password/change')
      .set(auth(a))
      .send({ currentPassword: a.password, newPassword: 'brand new long passphrase' });
    expect(change.status).toBe(204);
    expect((await request(server()).get('/v1/me').set(auth(a))).status).toBe(200); // current session kept
    expect(
      (
        await request(server())
          .get('/v1/me')
          .set('authorization', `Bearer ${other.accessToken}`)
          .set('x-forwarded-for', a.ip)
      ).status,
    ).toBe(401);
    expect(harness().mailer.lastFor(a.email, 'PASSWORD_CHANGED')).toBeDefined();
    expect(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', nextIp())
          .send({ email: a.email, password: a.password })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', nextIp())
          .send({ email: a.email, password: 'brand new long passphrase' })
      ).status,
    ).toBe(200);

    // Forgot/reset: always 202, code by mail, sessions revoked afterwards.
    const unknownForgot = await request(server())
      .post('/v1/auth/password/forgot')
      .set('x-forwarded-for', nextIp())
      .send({ email: 'ghost@example.com' });
    expect(unknownForgot.status).toBe(202);
    const forgot = await request(server())
      .post('/v1/auth/password/forgot')
      .set('x-forwarded-for', nextIp())
      .send({ email: a.email });
    expect(forgot.status).toBe(202);
    const badReset = await request(server())
      .post('/v1/auth/password/reset')
      .set('x-forwarded-for', nextIp())
      .send({ email: a.email, code: '123456', newPassword: 'reset passphrase number one' });
    expect(badReset.status).toBe(400);
    const reset = await request(server())
      .post('/v1/auth/password/reset')
      .set('x-forwarded-for', nextIp())
      .send({
        email: a.email,
        code: codeFor(a.email, 'RESET_PASSWORD'),
        newPassword: 'reset passphrase number one',
      });
    expect(reset.status, JSON.stringify(reset.body)).toBe(204);
    expect((await request(server()).get('/v1/me').set(auth(a))).status).toBe(401);
    expect(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', nextIp())
          .send({ email: a.email, password: 'reset passphrase number one' })
      ).status,
    ).toBe(200);
    // A consumed code cannot be replayed.
    const replay = await request(server())
      .post('/v1/auth/password/reset')
      .set('x-forwarded-for', nextIp())
      .send({
        email: a.email,
        code: codeFor(a.email, 'RESET_PASSWORD'),
        newPassword: 'reset passphrase number two',
      });
    expect(replay.status).toBe(400);
  });

  // ------------------------------------------------------------------ identity providers ----

  it('signs up and in through the provider adapter without production credentials', async () => {
    const ip = nextIp();
    const unknown = await request(server())
      .post('/v1/auth/provider/sign-in')
      .set('x-forwarded-for', ip)
      .send({ provider: 'FAKE', idToken: 'fake:subject-1:prov@example.com' });
    expect(unknown.status).toBe(404);
    const bad = await request(server())
      .post('/v1/auth/provider/sign-in')
      .set('x-forwarded-for', ip)
      .send({ provider: 'FAKE', idToken: 'garbage' });
    expect(bad.status).toBe(401);
    const unverified = await request(server())
      .post('/v1/auth/provider/register')
      .set('x-forwarded-for', ip)
      .send({
        provider: 'FAKE',
        idToken: 'fake:subject-1:prov@example.com:unverified',
        dateOfBirth: dob(30),
        consents,
      });
    expect(unverified.status).toBe(400);
    const reg = await request(server())
      .post('/v1/auth/provider/register')
      .set('x-forwarded-for', ip)
      .send({
        provider: 'FAKE',
        idToken: 'fake:subject-1:prov@example.com',
        dateOfBirth: dob(30),
        consents,
      });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const regBody = authResponseSchema.parse(reg.body);
    expect(regBody.account.state).toBe('ACTIVE');
    expect(regBody.account.emailVerified).toBe(true);
    const dup = await request(server())
      .post('/v1/auth/provider/register')
      .set('x-forwarded-for', ip)
      .send({
        provider: 'FAKE',
        idToken: 'fake:subject-1:prov@example.com',
        dateOfBirth: dob(30),
        consents,
      });
    expect(dup.status).toBe(409);
    const signIn = await request(server())
      .post('/v1/auth/provider/sign-in')
      .set('x-forwarded-for', ip)
      .send({ provider: 'FAKE', idToken: 'fake:subject-1:prov@example.com' });
    expect(signIn.status).toBe(200);
    expect(authResponseSchema.parse(signIn.body).account.accountId).toBe(regBody.account.accountId);
    // Provider accounts have no password: password login is refused generically.
    expect(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', ip)
          .send({ email: 'prov@example.com', password: 'anything at all here' })
      ).status,
    ).toBe(401);
    const apple = await request(server())
      .post('/v1/auth/provider/sign-in')
      .set('x-forwarded-for', ip)
      .send({ provider: 'APPLE', idToken: 'x'.repeat(40) });
    expect(apple.status).toBe(400); // not enabled in this environment
  });

  // ------------------------------------------------------------- consents, devices, avatar ----

  it('keeps an append-only consent history with reprompt detection', async () => {
    const a = await register('consent@example.com');
    const state = await request(server()).get('/v1/me/consents').set(auth(a));
    expect(state.body.requiresReprompt).toEqual([]);
    expect(state.body.current.MARKETING.granted).toBe(false);
    const grant = await request(server())
      .post('/v1/me/consents')
      .set(auth(a))
      .send({ type: 'MARKETING', granted: true });
    expect(grant.status).toBe(200);
    expect(grant.body.current.MARKETING.granted).toBe(true);
    const withdraw = await request(server())
      .post('/v1/me/consents')
      .set(auth(a))
      .send({ type: 'MARKETING', granted: false });
    expect(withdraw.body.current.MARKETING.granted).toBe(false);
    const history = await request(server()).get('/v1/me/consents/history').set(auth(a));
    expect(history.body.data.filter((c: { type: string }) => c.type === 'MARKETING')).toHaveLength(
      3,
    );
    expect(
      (
        await request(server())
          .post('/v1/me/consents')
          .set(auth(a))
          .send({ type: 'TERMS_OF_SERVICE', granted: false })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server())
          .post('/v1/me/consents')
          .set(auth(a))
          .send({ type: 'AGE_ATTESTATION', granted: true })
      ).status,
    ).toBe(400);
  });

  it('registers devices without ever returning push tokens, and issues avatar uploads bound to the account', async () => {
    const a = await register('devices@example.com');
    await verify(a);
    const reg = await request(server()).post('/v1/me/devices').set(auth(a)).send({
      installationId: 'install-dev-1',
      platform: 'ANDROID',
      pushToken: 'fcm-token-1234567890abcdef',
      locale: 'ar-JO',
      timezone: 'Asia/Amman',
    });
    expect(reg.status).toBe(200);
    expect(reg.body).toMatchObject({ platform: 'ANDROID', pushEnabled: true });
    expect(JSON.stringify(reg.body)).not.toContain('fcm-token');
    const list = await request(server()).get('/v1/me/devices').set(auth(a));
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('fcm-token');
    expect(
      (await request(server()).delete(`/v1/me/devices/${reg.body.deviceId}`).set(auth(a))).status,
    ).toBe(204);
    expect((await request(server()).get('/v1/me/devices').set(auth(a))).body.data).toHaveLength(0);

    const upload = await request(server())
      .post('/v1/me/profile/avatar-upload')
      .set(auth(a))
      .send({ contentType: 'image/png', sizeBytes: 1024 });
    expect(upload.status).toBe(200);
    expect(upload.body.objectKey).toMatch(
      new RegExp(`^avatars/${a.accountId}/[0-9a-f-]{36}\\.png$`),
    );
    const notUploaded = await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ avatarObjectKey: upload.body.objectKey });
    expect(notUploaded.status).toBe(400);
    harness().storage.simulateUpload(upload.body.objectKey, 'image/png');
    const set = await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ avatarObjectKey: upload.body.objectKey });
    expect(set.status).toBe(200);
    expect(set.body.avatarUrl).toContain(upload.body.objectKey);
    const foreign = await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({
        avatarObjectKey: `avatars/${'0'.repeat(8)}-0000-7000-8000-000000000000/${'0'.repeat(8)}-0000-7000-8000-000000000000.png`,
      });
    expect(foreign.status).toBe(403);
  });

  // ------------------------------------------------------------------- lifecycle ----

  it('deactivates and reactivates on sign-in', async () => {
    const a = await register('deactivate@example.com');
    await verify(a);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ username: 'deact_one', displayName: 'Deact' });
    expect((await request(server()).post('/v1/me/deactivate').set(auth(a))).status).toBe(204);
    expect((await request(server()).get('/v1/me').set(auth(a))).status).toBe(401);
    expect(
      (await request(server()).get('/v1/profiles/deact_one').set('x-forwarded-for', nextIp()))
        .status,
    ).toBe(404);
    const login = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ email: a.email, password: a.password });
    expect(login.status).toBe(200);
    expect(authResponseSchema.parse(login.body).account.state).toBe('ACTIVE');
    expect(
      (await request(server()).get('/v1/profiles/deact_one').set('x-forwarded-for', nextIp()))
        .status,
    ).toBe(200);
  });

  it('requests, cancels and finally executes account deletion with a full cascade', async () => {
    const a = await register('delete@example.com');
    await verify(a);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ username: 'delete_me', displayName: 'Delete Me', bio: 'bye' });
    await request(server())
      .put('/v1/me/interests')
      .set(auth(a))
      .send({ interestKeys: ['art', 'music', 'reading'] });
    await request(server()).post('/v1/me/devices').set(auth(a)).send({
      installationId: 'install-del',
      platform: 'IOS',
      pushToken: 'apns-token-1234567890abcdef',
    });

    expect(
      (await request(server()).post('/v1/me/deletion-request').set(auth(a)).send({})).status,
    ).toBe(401);
    const req = await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(a))
      .send({ currentPassword: a.password, reason: 'testing' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.status).toBe('PENDING');
    const me = accountViewSchema.parse((await request(server()).get('/v1/me').set(auth(a))).body);
    expect(me.state).toBe('DELETION_REQUESTED');
    expect(me.deletionScheduledFor).toBe(req.body.scheduledFor);
    expect((await request(server()).get('/v1/me/profile').set(auth(a))).status).toBe(403);
    expect(
      (await request(server()).get('/v1/profiles/delete_me').set('x-forwarded-for', nextIp()))
        .status,
    ).toBe(404);
    expect(harness().mailer.lastFor(a.email, 'DELETION_REQUESTED')).toBeDefined();

    const cancel = await request(server()).post('/v1/me/deletion-request/cancel').set(auth(a));
    expect(cancel.status).toBe(200);
    expect(accountViewSchema.parse(cancel.body).state).toBe('ACTIVE');
    expect(
      (await request(server()).get('/v1/profiles/delete_me').set('x-forwarded-for', nextIp()))
        .status,
    ).toBe(200);

    // Two export bundles and an avatar exist in storage before the cascade.
    const exportService = harness().app.get(DataExportService);
    const firstExport = await request(server()).post('/v1/me/data-export').set(auth(a));
    expect(firstExport.status).toBe(202);
    expect((await exportService.processOpen()).processed).toBe(1);
    await db().query(
      "UPDATE data_export_request SET requested_at = now() - interval '2 days' WHERE account_id = $1",
      [a.accountId],
    );
    expect((await request(server()).post('/v1/me/data-export').set(auth(a))).status).toBe(202);
    expect((await exportService.processOpen()).processed).toBe(1);
    const upload = await request(server())
      .post('/v1/me/profile/avatar-upload')
      .set(auth(a))
      .send({ contentType: 'image/jpeg', sizeBytes: 100 });
    harness().storage.simulateUpload(upload.body.objectKey);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ avatarObjectKey: upload.body.objectKey });
    expect(
      [...harness().storage.objects.keys()].filter((k) => k.includes(a.accountId)),
    ).toHaveLength(3);

    // Request again and run the job: not due yet → nothing; due → cascade.
    const again = await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(a))
      .send({ currentPassword: a.password });
    expect(again.status).toBe(201);
    const job = harness().app.get(AccountDeletionJob);
    expect(await job.processDue(new Date())).toEqual({ deleted: 0, failed: 0, paused: 0 });
    const due = new Date(new Date(again.body.scheduledFor).getTime() + 1000);
    expect(await job.processDue(due)).toEqual({ deleted: 1, failed: 0, paused: 0 });
    expect(await job.processDue(due)).toEqual({ deleted: 0, failed: 0, paused: 0 }); // idempotent

    const row = await db().query<{
      email: string | null;
      email_tombstone: string | null;
      state: string;
      date_of_birth: string;
    }>('SELECT email, email_tombstone, state, date_of_birth::text FROM account WHERE id = $1', [
      a.accountId,
    ]);
    expect(row.rows[0]).toMatchObject({
      email: null,
      state: 'DELETED',
      date_of_birth: '1900-01-01',
    });
    expect(row.rows[0]?.email_tombstone).toMatch(/^[0-9a-f]{64}$/);
    for (const [table, col] of [
      ['account_credential', 'account_id'],
      ['account_identity', 'account_id'],
      ['auth_session', 'account_id'],
      ['device', 'account_id'],
      ['verification_code', 'account_id'],
      ['data_export_request', 'account_id'],
      ['account_interest', 'account_id'],
      ['privacy_settings', 'account_id'],
    ] as const) {
      const r = await db().query(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [a.accountId]);
      expect(r.rowCount, table).toBe(0);
    }
    const profile = await db().query<{
      username: string | null;
      display_name: string | null;
      bio: string;
      erased_at: Date | null;
    }>('SELECT username, display_name, bio, erased_at FROM profile WHERE account_id = $1', [
      a.accountId,
    ]);
    expect(profile.rows[0]).toMatchObject({ username: null, display_name: null, bio: '' });
    expect(profile.rows[0]?.erased_at).not.toBeNull();
    // Every storage object the account produced (avatar + all export bundles) is gone.
    expect([...harness().storage.objects.keys()].filter((k) => k.includes(a.accountId))).toEqual(
      [],
    );
    const suspension = await db().query<{ suspended_at: Date | null; suspended_by: string | null }>(
      'SELECT suspended_at, suspended_by FROM account WHERE id = $1',
      [a.accountId],
    );
    expect(suspension.rows[0]).toEqual({ suspended_at: null, suspended_by: null });
    const consentsKept = await db().query('SELECT 1 FROM consent_record WHERE account_id = $1', [
      a.accountId,
    ]);
    expect(consentsKept.rowCount).toBeGreaterThan(0);
    const audit = await db().query<{ event_type: string }>(
      "SELECT event_type FROM identity_audit_ledger WHERE account_id = $1 AND event_type = 'DELETION_COMPLETED'",
      [a.accountId],
    );
    expect(audit.rowCount).toBe(1);

    expect((await request(server()).get('/v1/me').set(auth(a))).status).toBe(401);
    expect(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', nextIp())
          .send({ email: a.email, password: a.password })
      ).status,
    ).toBe(401);
    // The email address is free again.
    const reuse = await register('delete@example.com');
    expect(reuse.accountId).not.toBe(a.accountId);
  });

  it('produces a downloadable data-export bundle with one section per context', async () => {
    const a = await register('export@example.com');
    await verify(a);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ username: 'export_one', displayName: 'Export' });
    const req = await request(server()).post('/v1/me/data-export').set(auth(a));
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    expect(req.body.status).toBe('REQUESTED');
    expect((await request(server()).post('/v1/me/data-export').set(auth(a))).status).toBe(409);

    const service = harness().app.get(DataExportService);
    expect(await service.processOpen()).toEqual({ processed: 1, failed: 0, expired: 0 });
    const ready = await request(server())
      .get(`/v1/me/data-export/${req.body.exportId}`)
      .set(auth(a));
    expect(ready.body.status).toBe('READY');
    expect(ready.body.downloadUrl).toContain(`exports/${a.accountId}/${req.body.exportId}.json`);
    const stored = harness().storage.objects.get(
      `exports/${a.accountId}/${req.body.exportId}.json`,
    );
    expect(stored).toBeDefined();
    const bundle = dataExportBundleSchema.parse(JSON.parse(stored?.body.toString('utf8') ?? '{}'));
    // One section per bounded context that stores account-linked data; Quest joined in Phase 02.
    expect(bundle.sections.map((s) => s.context).sort()).toEqual(['identity', 'profiles', 'quest']);
    const identity = bundle.sections.find((s) => s.context === 'identity')?.data as {
      account: { email: string };
      consents: unknown[];
    };
    expect(identity.account.email).toBe(a.email);
    expect(identity.consents.length).toBeGreaterThan(0);
    expect(JSON.stringify(bundle)).not.toMatch(/password_hash|refresh_token|\$argon2/);
    const profiles = bundle.sections.find((s) => s.context === 'profiles')?.data as {
      profile: { username: string };
    };
    expect(profiles.profile.username).toBe('export_one');
    expect(harness().mailer.lastFor(a.email, 'DATA_EXPORT_READY')).toBeDefined();
    // Cannot read someone else's export.
    const b = await register('export-b@example.com');
    expect(
      (await request(server()).get(`/v1/me/data-export/${req.body.exportId}`).set(auth(b))).status,
    ).toBe(404);
  });

  // ------------------------------------------------------------------------- staff ----

  it('enforces RBAC for staff endpoints and attributes suspensions to the acting staff account', async () => {
    const user = await register('citizen@example.com');
    await verify(user);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(user))
      .send({ username: 'citizen', displayName: 'Citizen' });
    const staff = await register('staff@example.com');
    await verify(staff);
    // Bootstrap the first SUPER_ADMIN the way the operator CLI does (no API path exists by design).
    await harness().app.get(AccountRepository).grantRole(staff.accountId, 'SUPER_ADMIN', null);
    // Roles are embedded in the access token: sign in again to pick them up.
    const staffLogin = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', staff.ip)
          .send({ email: staff.email, password: staff.password })
      ).body,
    );
    expect(staffLogin.account.roles).toEqual(['USER', 'SUPER_ADMIN']);
    staff.accessToken = staffLogin.tokens.accessToken;

    expect(
      (await request(server()).get(`/v1/admin/accounts/${user.accountId}`).set(auth(user))).status,
    ).toBe(403);
    const support = await request(server())
      .get(`/v1/admin/accounts/${user.accountId}`)
      .set(auth(staff));
    expect(support.status).toBe(200);
    expect(support.body).toMatchObject({
      accountId: user.accountId,
      state: 'ACTIVE',
      username: 'citizen',
      ageBand: 'ADULT',
    });
    expect(support.body).not.toHaveProperty('dateOfBirth');

    const suspend = await request(server())
      .post(`/v1/admin/accounts/${user.accountId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'abuse investigation' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.state).toBe('SUSPENDED');
    expect((await request(server()).get('/v1/me').set(auth(user))).status).toBe(401);
    const blocked = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ email: user.email, password: user.password });
    expect(blocked.status).toBe(401);
    expect(
      (await request(server()).get('/v1/profiles/citizen').set('x-forwarded-for', nextIp())).status,
    ).toBe(404);
    const suspendedBy = await db().query<{ suspended_by: string }>(
      'SELECT suspended_by FROM account WHERE id = $1',
      [user.accountId],
    );
    expect(suspendedBy.rows[0]?.suspended_by).toBe(staff.accountId);

    const reinstate = await request(server())
      .post(`/v1/admin/accounts/${user.accountId}/reinstate`)
      .set(auth(staff));
    expect(reinstate.body.state).toBe('ACTIVE');
    expect(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', nextIp())
          .send({ email: user.email, password: user.password })
      ).status,
    ).toBe(200);

    // SUPPORT can view but not sanction; MANAGE_STAFF is SUPER_ADMIN only.
    const grant = await request(server())
      .post(`/v1/admin/accounts/${user.accountId}/roles`)
      .set(auth(staff))
      .send({ role: 'SUPPORT' });
    expect(grant.body.roles).toEqual(['USER', 'SUPPORT']);
    const supportLogin = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', nextIp())
          .send({ email: user.email, password: user.password })
      ).body,
    );
    const asSupport = {
      authorization: `Bearer ${supportLogin.tokens.accessToken}`,
      'x-forwarded-for': user.ip,
    };
    expect(
      (await request(server()).get(`/v1/admin/accounts/${staff.accountId}`).set(asSupport)).status,
    ).toBe(200);
    expect(
      (
        await request(server())
          .post(`/v1/admin/accounts/${staff.accountId}/suspend`)
          .set(asSupport)
          .send({ reason: 'nope' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(server())
          .post(`/v1/admin/accounts/${staff.accountId}/roles`)
          .set(asSupport)
          .send({ role: 'SUPPORT' })
      ).status,
    ).toBe(403);
    const revoke = await request(server())
      .post(`/v1/admin/accounts/${user.accountId}/roles/revoke`)
      .set(auth(staff))
      .send({ role: 'SUPPORT' });
    expect(revoke.body.roles).toEqual(['USER']);
    expect(
      (await request(server()).get(`/v1/admin/accounts/${staff.accountId}`).set(asSupport)).status,
    ).toBe(401); // sessions revoked on role loss
    expect(
      (
        await request(server())
          .post(`/v1/admin/accounts/${staff.accountId}/suspend`)
          .set(auth(staff))
          .send({ reason: 'self' })
      ).status,
    ).toBe(400);
  });

  it('restores the pre-request state when a deletion is cancelled, and keeps staff powers during the grace period', async () => {
    // Unverified account → request → cancel → still PENDING_VERIFICATION (never ACTIVE unverified).
    const pending = await register('cancel-pending@example.com');
    const req = await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(pending))
      .send({ currentPassword: pending.password });
    expect(req.status).toBe(201);
    const cancelled = await request(server())
      .post('/v1/me/deletion-request/cancel')
      .set(auth(pending));
    expect(cancelled.status).toBe(200);
    expect(accountViewSchema.parse(cancelled.body).state).toBe('PENDING_VERIFICATION');
    const invariant = await db().query(
      "SELECT 1 FROM account WHERE state = 'ACTIVE' AND email_verified_at IS NULL",
    );
    expect(invariant.rowCount).toBe(0);

    // Staff can suspend an account in the grace period; the request is paused and resumes on reinstate.
    const user = await register('cancel-suspend@example.com');
    await verify(user);
    const staff = await register('cancel-staff@example.com');
    await verify(staff);
    await harness().app.get(AccountRepository).grantRole(staff.accountId, 'SUPER_ADMIN', null);
    const staffTokens = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', staff.ip)
          .send({ email: staff.email, password: staff.password })
      ).body,
    ).tokens;
    staff.accessToken = staffTokens.accessToken;
    const userReq = await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(user))
      .send({ currentPassword: user.password });
    expect(userReq.status).toBe(201);
    const suspend = await request(server())
      .post(`/v1/admin/accounts/${user.accountId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'investigation during grace period' });
    expect(suspend.status, JSON.stringify(suspend.body)).toBe(200);
    expect(suspend.body.state).toBe('SUSPENDED');
    expect(suspend.body.deletionScheduledFor).toBe(userReq.body.scheduledFor);
    // Paused: the job does not delete a suspended account even when the grace period elapsed.
    const due = new Date(new Date(userReq.body.scheduledFor).getTime() + 1000);
    expect(await harness().app.get(AccountDeletionJob).processDue(due)).toEqual({
      deleted: 0,
      failed: 0,
      // Paused erasures are counted and reported instead of occupying the batch window (P01-06).
      paused: 1,
    });
    expect(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', nextIp())
          .send({ email: user.email, password: user.password })
      ).status,
    ).toBe(401);
    const reinstate = await request(server())
      .post(`/v1/admin/accounts/${user.accountId}/reinstate`)
      .set(auth(staff));
    expect(reinstate.body.state).toBe('DELETION_REQUESTED');
    expect(await harness().app.get(AccountDeletionJob).processDue(due)).toEqual({
      deleted: 1,
      failed: 0,
      paused: 0,
    });
  });

  it('lets provider-only accounts request deletion without a password and re-picks stale export work', async () => {
    const ip = nextIp();
    const reg = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/provider/register')
          .set('x-forwarded-for', ip)
          .send({
            provider: 'FAKE',
            idToken: 'fake:subject-del:provdel@example.com',
            dateOfBirth: dob(30),
            consents,
          })
      ).body,
    );
    expect(reg.account.hasPassword).toBe(false);
    expect(reg.account.linkedProviders).toEqual(['FAKE']);
    const asProv = { authorization: `Bearer ${reg.tokens.accessToken}`, 'x-forwarded-for': ip };
    const exp = await request(server()).post('/v1/me/data-export').set(asProv);
    expect(exp.status).toBe(202);
    // Simulate a worker that crashed mid-export: PROCESSING with a stale start time.
    await db().query(
      "UPDATE data_export_request SET status = 'PROCESSING', started_at = now() - interval '1 hour' WHERE id = $1",
      [exp.body.exportId],
    );
    const service = harness().app.get(DataExportService);
    expect((await service.processOpen()).processed).toBe(1);
    expect(
      (await request(server()).get(`/v1/me/data-export/${exp.body.exportId}`).set(asProv)).body
        .status,
    ).toBe('READY');
    // Expiry sweep removes the object once past the TTL.
    await db().query(
      "UPDATE data_export_request SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [exp.body.exportId],
    );
    expect((await service.processOpen()).expired).toBe(1);
    expect(
      harness().storage.objects.has(`exports/${reg.account.accountId}/${exp.body.exportId}.json`),
    ).toBe(false);
    expect(
      (await request(server()).get(`/v1/me/data-export/${exp.body.exportId}`).set(asProv)).body
        .status,
    ).toBe('EXPIRED');

    const del = await request(server()).post('/v1/me/deletion-request').set(asProv).send({});
    expect(del.status, JSON.stringify(del.body)).toBe(201);
  });

  it('hides non-public profiles from anonymous callers and strips the photo from limited cards', async () => {
    const owner = await register('limited-owner@example.com');
    await verify(owner);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(owner))
      .send({ username: 'limited_owner', displayName: 'Limited' });
    const upload = await request(server())
      .post('/v1/me/profile/avatar-upload')
      .set(auth(owner))
      .send({ contentType: 'image/png', sizeBytes: 10 });
    harness().storage.simulateUpload(upload.body.objectKey, 'image/png');
    await request(server())
      .put('/v1/me/profile')
      .set(auth(owner))
      .send({ avatarObjectKey: upload.body.objectKey });
    await request(server())
      .put('/v1/me/privacy')
      .set(auth(owner))
      .send({ profileVisibility: 'PRIVATE' });
    const viewer = await register('limited-viewer@example.com');
    const anonymous = await request(server())
      .get('/v1/profiles/limited_owner')
      .set('x-forwarded-for', nextIp());
    expect(anonymous.status).toBe(404);
    const limited = publicProfileViewSchema.parse(
      (await request(server()).get('/v1/profiles/limited_owner').set(auth(viewer))).body,
    );
    expect(limited).toMatchObject({ isLimited: true, avatarUrl: null, bio: '', interests: [] });
    const own = publicProfileViewSchema.parse(
      (await request(server()).get('/v1/profiles/limited_owner').set(auth(owner))).body,
    );
    expect(own.avatarUrl).toContain(upload.body.objectKey);
  });

  // ------------------------------------------------------------- audit repairs (P01-xx) ----

  it('refuses to execute a deletion the user already cancelled (audit P01-01)', async () => {
    const a = await register('race-cancel@example.com');
    await verify(a);
    const req = await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(a))
      .send({ currentPassword: a.password });
    expect(req.status).toBe(201);
    const requestId = (
      await db().query<{ id: string }>(
        'SELECT id FROM account_deletion_request WHERE account_id=$1',
        [a.accountId],
      )
    ).rows[0]!.id;
    const login = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', a.ip)
          .send({ email: a.email, password: a.password })
      ).body,
    );
    a.accessToken = login.tokens.accessToken;
    expect(
      (await request(server()).post('/v1/me/deletion-request/cancel').set(auth(a))).status,
    ).toBe(200);
    // The job holds a stale view of the request: it must abort, not erase a live account.
    expect(await harness().app.get(AccountDeletionJob).deleteAccount(a.accountId, requestId)).toBe(
      false,
    );
    const row = await db().query<{ state: string; email: string | null }>(
      'SELECT state, email FROM account WHERE id=$1',
      [a.accountId],
    );
    expect(row.rows[0]).toMatchObject({ state: 'ACTIVE', email: a.email });
    expect(
      (await db().query('SELECT 1 FROM account_credential WHERE account_id=$1', [a.accountId]))
        .rowCount,
    ).toBe(1);
  });

  it('keeps a deactivated account hidden when its deletion request is cancelled (audit P01-05)', async () => {
    const a = await register('cancel-deactivated@example.com');
    await verify(a);
    await request(server())
      .put('/v1/me/profile')
      .set(auth(a))
      .send({ username: 'hidden_one', displayName: 'Hidden' });
    const req = await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(a))
      .send({ currentPassword: a.password });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    // A request recorded from DEACTIVATED (staff/CLI paths, and any future client that may
    // request erasure from a hidden account): cancelling it must not republish the profile.
    await db().query(
      "UPDATE account_deletion_request SET previous_state='DEACTIVATED' WHERE account_id=$1",
      [a.accountId],
    );
    await db().query('UPDATE account SET deactivated_at = now() WHERE id=$1', [a.accountId]);
    const relogin = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', a.ip)
          .send({ email: a.email, password: a.password })
      ).body,
    );
    a.accessToken = relogin.tokens.accessToken;
    const cancelled = await request(server()).post('/v1/me/deletion-request/cancel').set(auth(a));
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(accountViewSchema.parse(cancelled.body).state).toBe('DEACTIVATED');
    expect(
      (
        await db().query('SELECT 1 FROM account WHERE id=$1 AND deactivated_at IS NOT NULL', [
          a.accountId,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (await request(server()).get('/v1/profiles/hidden_one').set('x-forwarded-for', nextIp()))
        .status,
    ).toBe(404);
  });

  it('requires staff-management to sanction another staff account (audit P01-07)', async () => {
    const lead = await register('sanction-lead@example.com');
    await verify(lead);
    const moderator = await register('sanction-mod@example.com');
    await verify(moderator);
    const repo = harness().app.get(AccountRepository);
    await repo.grantRole(lead.accountId, 'TRUST_SAFETY_LEAD', null);
    await repo.grantRole(moderator.accountId, 'MODERATOR', null);
    const leadTokens = authResponseSchema.parse(
      (
        await request(server())
          .post('/v1/auth/login')
          .set('x-forwarded-for', lead.ip)
          .send({ email: lead.email, password: lead.password })
      ).body,
    ).tokens;
    lead.accessToken = leadTokens.accessToken;
    const onStaff = await request(server())
      .post(`/v1/admin/accounts/${moderator.accountId}/suspend`)
      .set(auth(lead))
      .send({ reason: 'attempt to sanction a colleague' });
    expect(onStaff.status).toBe(403);
    const onSelf = await request(server())
      .post(`/v1/admin/accounts/${lead.accountId}/suspend`)
      .set(auth(lead))
      .send({ reason: 'attempt to sanction self' });
    expect(onSelf.status).toBe(400);
    // An ordinary user is still sanctionable by the same staff account.
    const user = await register('sanction-user@example.com');
    await verify(user);
    expect(
      (
        await request(server())
          .post(`/v1/admin/accounts/${user.accountId}/suspend`)
          .set(auth(lead))
          .send({ reason: 'ordinary user sanction' })
      ).status,
    ).toBe(200);
  });

  it('keeps the reset code usable when the new password is rejected (audit P01-10)', async () => {
    const a = await register('reset-order@example.com');
    await verify(a);
    const ip = nextIp();
    expect(
      (
        await request(server())
          .post('/v1/auth/password/forgot')
          .set('x-forwarded-for', ip)
          .send({ email: a.email })
      ).status,
    ).toBe(202);
    const code = codeFor(a.email, 'RESET_PASSWORD');
    const rejected = await request(server())
      .post('/v1/auth/password/reset')
      .set('x-forwarded-for', ip)
      .send({ email: a.email, code, newPassword: `reset-order plus more words` });
    expect(rejected.status).toBe(400);
    // The one-time code survives a rejected password: it was never consumed.
    const accepted = await request(server())
      .post('/v1/auth/password/reset')
      .set('x-forwarded-for', ip)
      .send({ email: a.email, code, newPassword: 'an entirely different passphrase' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(204);
  });

  it('pages the consent history instead of returning the whole ledger (audit P01-14)', async () => {
    const a = await register('paged-consents@example.com');
    await verify(a);
    for (let i = 0; i < 4; i += 1) {
      const res = await request(server())
        .post('/v1/me/consents')
        .set(auth(a))
        .send({ type: 'ANALYTICS', granted: i % 2 === 0 });
      expect(res.status).toBe(200);
    }
    const first = await request(server()).get('/v1/me/consents/history?limit=2').set(auth(a));
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.pageInfo.hasMore).toBe(true);
    expect(first.body.pageInfo.nextCursor).toBeTruthy();
    const second = await request(server())
      .get(
        `/v1/me/consents/history?limit=2&cursor=${encodeURIComponent(first.body.pageInfo.nextCursor)}`,
      )
      .set(auth(a));
    expect(second.status).toBe(200);
    const ids = new Set([
      ...first.body.data.map((c: { consentId: string }) => c.consentId),
      ...second.body.data.map((c: { consentId: string }) => c.consentId),
    ]);
    expect(ids.size).toBe(first.body.data.length + second.body.data.length);
    expect(
      (await request(server()).get('/v1/me/consents/history?cursor=not-a-cursor').set(auth(a)))
        .status,
    ).toBe(400);
    // The current-consent view stays complete even though the history is paged.
    const state = await request(server()).get('/v1/me/consents').set(auth(a));
    expect(Object.keys(state.body.current).sort()).toContain('ANALYTICS');
  });

  it('never exposes secrets or the date of birth through any identity response', async () => {
    const a = await register('leak@example.com');
    await verify(a);
    const bodies = await Promise.all([
      request(server()).get('/v1/me').set(auth(a)),
      request(server()).get('/v1/me/profile').set(auth(a)),
      request(server()).get('/v1/me/sessions').set(auth(a)),
      request(server()).get('/v1/me/consents').set(auth(a)),
      request(server()).get('/v1/me/privacy').set(auth(a)),
    ]);
    for (const res of bodies) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/dateOfBirth|passwordHash|refreshTokenHash|\$argon2|pushToken/);
      expect(text).not.toContain(dob(30));
    }
  });
});
