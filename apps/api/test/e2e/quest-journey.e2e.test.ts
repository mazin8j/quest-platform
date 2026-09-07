/**
 * End-to-end: the client SDK (@quest/api-client — the same code mobile/web/admin use) drives a
 * real HTTP server backed by real PostgreSQL + Redis through the complete Phase 02 journey:
 * draft → assess → publish → discover → accept → start → declare completion, plus the two
 * refusals that matter most (publishing unsafe content, and publishing without an assessment).
 *
 * Requires RUN_INTEGRATION=true (see test/integration/README.md).
 */
import type { AddressInfo } from 'node:net';

import {
  AuthSession,
  InMemoryTokenStorage,
  createApiClient,
  identityApi,
  questsApi,
  withAuthRetry,
} from '@quest/api-client';
import { type QuestContent, questContentSchema } from '@quest/types';
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

const consents = {
  termsOfServiceVersion: '2026-09',
  privacyPolicyVersion: '2026-09',
  ageAttestation: true as const,
};

describe.skipIf(!enabled)('E2E: Quest journey through the client SDK', () => {
  let it_: IntegrationApp | undefined;
  let baseUrl: string;
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
    const identity = identityApi(client);
    const session = new AuthSession({ storage, refresh: (t) => identity.auth.refresh(t) });
    holder.session = session;
    const raw = client.request.bind(client);
    client.request = (path, opts = {}) =>
      raw(path, { ...opts, headers: { ...opts.headers, 'x-forwarded-for': forwardedFor } });
    return { identity, quests: questsApi(client), session };
  }

  /** Registers and verifies an account through the SDK, returning a ready-to-use client. */
  async function member(email: string, ip: string, age = 30) {
    const s = sdk(ip);
    const registered = await s.identity.auth.register({
      email,
      password: 'an end to end passphrase',
      dateOfBirth: dob(age),
      consents,
      country: 'JO',
    });
    await s.session.set(registered.tokens);
    const mail = harness().mailer.lastFor(email, 'VERIFY_EMAIL');
    if (!mail || !('code' in mail.template)) throw new Error(`no verification mail for ${email}`);
    await withAuthRetry(s.session, () =>
      s.identity.auth.verifyEmail((mail.template as { code: string }).code),
    );
    // Email verification changes the principal; a fresh sign-in picks up the new claim.
    const signedIn = await s.identity.auth.login({
      email,
      password: 'an end to end passphrase',
    });
    await s.session.set(signedIn.tokens);
    return { ...s, accountId: signedIn.account.accountId };
  }

  // Parsed through the shared schema so the SDK receives exactly the contract's output shape
  // (defaults applied), the same as any real client that validated before sending.
  const content = (overrides: Record<string, unknown> = {}): QuestContent =>
    questContentSchema.parse({
      title: 'Plant something and watch it grow',
      summary: 'Plant one seed or seedling somewhere it can live, and photograph it.',
      instructions:
        'Choose a pot or a patch of soil. Plant one seed or seedling, water it, and photograph it where it now lives. Come back in a week and look at it again.',
      categoryKey: 'environment',
      difficulty: 'EASY',
      evidence: { types: ['PHOTO'] },
      eligibility: {},
      ...overrides,
    });

  beforeAll(async () => {
    it_ = await createIntegrationApp();
    await it_.app.listen(0, '127.0.0.1');
    const server = it_.app.getHttpServer() as { address(): AddressInfo | string | null };
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await it_?.close();
  });

  it('takes a Quest from draft to a completed attempt, and refuses the unsafe paths on the way', async () => {
    const owner = await member('quest-e2e-owner@example.com', '10.7.0.1');
    const participant = await member('quest-e2e-participant@example.com', '10.7.0.2');

    // The category catalogue is public reference data.
    const categories = await owner.quests.categories();
    expect(categories.data.map((c) => c.key)).toContain('environment');

    // ---- draft ----
    const draft = await withAuthRetry(owner.session, () =>
      owner.quests.create({
        visibility: 'PUBLIC',
        content: content(),
        duration: { effortMinutes: 20, completionWindowHours: 72 },
      }),
    );
    expect(draft.state).toBe('DRAFT');
    expect(draft.owner.accountId).toBe(owner.accountId);
    expect(draft.publishBlockers).toContain('NO_SAFETY_ASSESSMENT');

    // ---- publishing before an assessment is refused, with a reason the UI can act on ----
    await expect(
      withAuthRetry(owner.session, () =>
        owner.quests.publish(draft.questId, draft.contentHash as string),
      ),
    ).rejects.toMatchObject({ status: 409 });

    // ---- assess, then publish ----
    const assessment = await withAuthRetry(owner.session, () => owner.quests.assess(draft.questId));
    expect(assessment.state).toBe('ALLOWED');
    expect(assessment.contentHash).toBe(draft.contentHash);

    const published = await withAuthRetry(owner.session, () =>
      owner.quests.publish(draft.questId, draft.contentHash as string),
    );
    expect(published.state).toBe('PUBLISHED');
    expect(published.publishedVersion).toBe(1);

    // ---- unsafe content never reaches PUBLISHED, whatever the owner does next ----
    const unsafe = await withAuthRetry(owner.session, () =>
      owner.quests.create({
        visibility: 'PUBLIC',
        content: content({
          title: 'Midnight rooftop dare',
          instructions:
            'Climb the fence at the abandoned building on your street and photograph the city from the rooftop before anyone notices you.',
        }),
        duration: { effortMinutes: 30, completionWindowHours: 24 },
      }),
    );
    const unsafeDecision = await withAuthRetry(owner.session, () =>
      owner.quests.assess(unsafe.questId),
    );
    expect(unsafeDecision.state).toBe('REVIEW_REQUIRED');
    await expect(
      withAuthRetry(owner.session, () =>
        owner.quests.publish(unsafe.questId, unsafe.contentHash as string),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const unsafeList = await sdk('10.7.0.9').quests.list({ limit: 50 });
    expect(unsafeList.data.map((q) => q.questId)).not.toContain(unsafe.questId);

    // ---- discovery ----
    const anonymous = await sdk('10.7.0.3').quests.list({ limit: 50 });
    const found = anonymous.data.find((q) => q.questId === published.questId);
    expect(found, 'the published Quest should be discoverable').toBeDefined();
    expect(found?.owner.accountId).toBe(owner.accountId);
    // The discovery card carries no integrity or identity internals.
    expect(JSON.stringify(found)).not.toContain('@example.com');

    const filtered = await sdk('10.7.0.4').quests.list({ categoryKey: 'fitness', limit: 50 });
    expect(filtered.data.map((q) => q.questId)).not.toContain(published.questId);

    // ---- accept → start → declare completion ----
    const accepted = await withAuthRetry(participant.session, () =>
      participant.quests.participation.accept(published.questId, {
        expectedPublishedVersion: published.publishedVersion ?? undefined,
      }),
    );
    expect(accepted.state).toBe('ACCEPTED');
    expect(accepted.questVersion).toBe(1);

    const started = await withAuthRetry(participant.session, () =>
      participant.quests.participation.start(accepted.participationId),
    );
    expect(started.state).toBe('STARTED');
    expect(started.expiresAt).toBeTruthy();

    const completed = await withAuthRetry(participant.session, () =>
      participant.quests.participation.requestCompletion(accepted.participationId, {
        note: 'Planted a basil seedling on the balcony.',
      }),
    );
    expect(completed.state).toBe('COMPLETION_REQUESTED');

    const mine = await withAuthRetry(participant.session, () =>
      participant.quests.participation.mine(),
    );
    expect(mine.data.map((p) => p.participationId)).toContain(accepted.participationId);

    // Phase 02 ends at "completion declared": no XP, badge, level, streak or verification field
    // may appear on the attempt. Checked on the field names, not the serialised body, so a value
    // like `expiresAt` cannot make the assertion pass or fail by accident.
    const fields = Object.keys(completed).map((k) => k.toLowerCase());
    for (const laterPhase of ['xp', 'badge', 'badges', 'points', 'level', 'streak', 'verified']) {
      expect(fields, `Phase 02 must not emit ${laterPhase}`).not.toContain(laterPhase);
    }

    // ---- the owner sees their own Quests in every state ----
    const owned = await withAuthRetry(owner.session, () => owner.quests.mine());
    const ownedIds = owned.data.map((q) => q.questId);
    expect(ownedIds).toContain(published.questId);
    expect(ownedIds).toContain(unsafe.questId);
  });
});
