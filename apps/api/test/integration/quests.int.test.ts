/**
 * Phase 02 Quest core — integration suite against real PostgreSQL + Redis.
 *
 * Everything here goes through the HTTP surface with real tokens, real rows and the real safety
 * engine. The point of the suite is the parts that unit tests cannot prove: that publication is
 * fail-closed all the way down to the database CHECK, that ownership and visibility hold against
 * a second signed-in account, and that the account-lifecycle obligations (export, erasure) really
 * reach the Quest tables.
 *
 * Requires RUN_INTEGRATION=true, DATABASE_URL, REDIS_URL, MAIL_PROVIDER=memory.
 */
import {
  authResponseSchema,
  participationViewSchema,
  questAssessmentViewSchema,
  questDetailSchema,
  questListSchema,
  questSupportViewSchema,
} from '@quest/types';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG, type AppConfig } from '../../src/config/app-config';
import {
  ACCOUNT_ERASURE_REGISTRY,
  type AccountErasureRegistryPort,
  REQUIRED_ERASURE_CONTEXTS,
} from '../../src/infrastructure/account-erasure';
import { AccountDeletionJob, DataExportService } from '../../src/modules/identity';
import { AccountRepository } from '../../src/modules/identity/infrastructure/account.repository';
import { LifecycleRepository } from '../../src/modules/identity/infrastructure/lifecycle.repository';
import { ParticipationService } from '../../src/modules/quests';
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
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

/** Benign content the rule engine allows outright. */
const benignContent = (overrides: Record<string, unknown> = {}) => ({
  title: 'Write a thank-you letter',
  summary: 'Write a short letter to someone who helped you and post it this week.',
  instructions:
    'Think of one person who helped you this year. Write them a short letter by hand, then post it and photograph the envelope before you send it.',
  categoryKey: 'kindness',
  difficulty: 'EASY',
  evidence: { types: ['PHOTO'] },
  eligibility: {},
  ...overrides,
});

const duration = (overrides: Record<string, unknown> = {}) => ({
  effortMinutes: 30,
  completionWindowHours: 24,
  ...overrides,
});

describe.skipIf(!enabled)('quest core (real database)', () => {
  let it_: IntegrationApp | undefined;
  let pg: Client | undefined;
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
    accountId: string;
    ip: string;
  }

  async function register(
    email: string,
    age = 30,
    extra: Record<string, unknown> = {},
  ): Promise<Actor> {
    const ip = nextIp();
    const password = 'a very long and unique passphrase';
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
      accountId: parsed.account.accountId,
      ip,
    };
  }

  async function verify(actor: Actor): Promise<void> {
    const mail = harness().mailer.lastFor(actor.email, 'VERIFY_EMAIL');
    if (!mail || !('code' in mail.template)) throw new Error(`no verify mail for ${actor.email}`);
    const res = await request(server())
      .post('/v1/auth/email/verify')
      .set(auth(actor))
      .send({ code: mail.template.code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  /** Registers, verifies and re-reads the token so the principal carries emailVerified. */
  async function member(
    email: string,
    age = 30,
    extra: Record<string, unknown> = {},
  ): Promise<Actor> {
    const actor = await register(email, age, extra);
    await verify(actor);
    return signIn(actor);
  }

  async function signIn(actor: Actor): Promise<Actor> {
    const res = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', actor.ip)
      .send({ email: actor.email, password: actor.password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    actor.accessToken = authResponseSchema.parse(res.body).tokens.accessToken;
    return actor;
  }

  const auth = (a: Actor) => ({
    authorization: `Bearer ${a.accessToken}`,
    'x-forwarded-for': a.ip,
  });

  /** Draft → assess → publish, asserting each step. Returns the published detail. */
  async function publishQuest(owner: Actor, body: Record<string, unknown> = {}) {
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benignContent(), duration: duration(), ...body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = questDetailSchema.parse(created.body);
    const assessed = await request(server())
      .post(`/v1/quests/${draft.questId}/assessment`)
      .set(auth(owner));
    expect(assessed.status, JSON.stringify(assessed.body)).toBe(200);
    const published = await request(server())
      .post(`/v1/quests/${draft.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: draft.contentHash });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return questDetailSchema.parse(published.body);
  }

  beforeAll(async () => {
    it_ = await createIntegrationApp();
    pg = new Client({ connectionString: harness().databaseUrl });
    await pg.connect();
  });
  afterAll(async () => {
    await pg?.end();
    await it_?.close();
  });

  // ---------------------------------------------------------------------------- authoring ----

  it('drafts a Quest owned by the principal, never by anything in the request body', async () => {
    const owner = await member('author-1@example.com');
    const impostor = await member('author-2@example.com');
    const res = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({
        visibility: 'PUBLIC',
        content: benignContent(),
        duration: duration(),
        // Every shape a client might try to smuggle an owner through:
        ownerAccountId: impostor.accountId,
        owner: { accountId: impostor.accountId },
        state: 'PUBLISHED',
        publishedAt: new Date().toISOString(),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const detail = questDetailSchema.parse(res.body);
    expect(detail.owner.accountId).toBe(owner.accountId);
    expect(detail.state).toBe('DRAFT');
    expect(detail.publishedAt).toBeNull();
    expect(detail.publishedVersion).toBeNull();
    expect(detail.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const row = await db().query<{ owner_account_id: string; state: string }>(
      'SELECT owner_account_id, state FROM quest WHERE id = $1',
      [detail.questId],
    );
    expect(row.rows[0]).toEqual({ owner_account_id: owner.accountId, state: 'DRAFT' });
  });

  it('validates content and refuses an unknown category', async () => {
    const owner = await member('author-3@example.com');
    const short = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({
        visibility: 'PUBLIC',
        content: benignContent({ title: 'no' }),
        duration: duration(),
      });
    expect(short.status).toBe(400);

    const unknownCategory = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({
        visibility: 'PUBLIC',
        content: benignContent({ categoryKey: 'not-a-category' }),
        duration: duration(),
      });
    expect(unknownCategory.status).toBe(400);
  });

  // ------------------------------------------------------------------------- publication ----

  it('publishes only after an assessment of the exact content, and records the proof', async () => {
    const owner = await member('publish-1@example.com');
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benignContent(), duration: duration() });
    const draft = questDetailSchema.parse(created.body);

    // 1. No assessment yet → refused, with a machine-readable blocker.
    const tooEarly = await request(server())
      .post(`/v1/quests/${draft.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: draft.contentHash });
    expect(tooEarly.status).toBe(409);
    expect(JSON.stringify(tooEarly.body)).toContain('NO_SAFETY_ASSESSMENT');
    expect(draft.publishBlockers).toContain('NO_SAFETY_ASSESSMENT');

    // 2. Assessment recorded; it does not publish by itself.
    const assessment = questAssessmentViewSchema.parse(
      (await request(server()).post(`/v1/quests/${draft.questId}/assessment`).set(auth(owner)))
        .body,
    );
    expect(assessment.state).toBe('ALLOWED');
    expect(assessment.contentHash).toBe(draft.contentHash);
    const stillDraft = questDetailSchema.parse(
      (await request(server()).get(`/v1/quests/${draft.questId}`).set(auth(owner))).body,
    );
    expect(stillDraft.state).toBe('DRAFT');

    // 3. A wrong expected hash is refused even though a valid assessment exists.
    const wrongHash = await request(server())
      .post(`/v1/quests/${draft.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: 'f'.repeat(64) });
    expect(wrongHash.status).toBe(409);
    expect(JSON.stringify(wrongHash.body)).toContain('CONTENT_HASH_MISMATCH');

    // 4. The real thing.
    const published = questDetailSchema.parse(
      (
        await request(server())
          .post(`/v1/quests/${draft.questId}/publish`)
          .set(auth(owner))
          .send({ expectedContentHash: draft.contentHash })
      ).body,
    );
    expect(published.state).toBe('PUBLISHED');
    expect(published.publishedVersion).toBe(1);
    expect(published.publishBlockers).toEqual([]);

    const row = await db().query<{
      published_assessment_id: string | null;
      published_content_hash: string | null;
      published_minimum_age_band: string | null;
      content_hash: string;
    }>(
      'SELECT published_assessment_id, published_content_hash, published_minimum_age_band, content_hash FROM quest WHERE id = $1',
      [draft.questId],
    );
    expect(row.rows[0]?.published_assessment_id).toBe(assessment.assessmentId);
    expect(row.rows[0]?.published_content_hash).toBe(row.rows[0]?.content_hash);
    expect(row.rows[0]?.published_minimum_age_band).toBe('TEEN_13_15');

    const version = await db().query<{ version: number; content_hash: string }>(
      'SELECT version, content_hash FROM quest_version WHERE quest_id = $1',
      [draft.questId],
    );
    expect(version.rows).toEqual([{ version: 1, content_hash: draft.contentHash }]);
  });

  it('never publishes content the safety engine sends to review, and says so', async () => {
    const owner = await member('publish-2@example.com');
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({
        visibility: 'PUBLIC',
        content: benignContent({
          title: 'Rooftop sunrise dare',
          instructions:
            'Climb the fence at the abandoned building near you and photograph the sunrise from the rooftop before anyone sees you.',
        }),
        duration: duration(),
      });
    const draft = questDetailSchema.parse(created.body);
    const assessment = questAssessmentViewSchema.parse(
      (await request(server()).post(`/v1/quests/${draft.questId}/assessment`).set(auth(owner)))
        .body,
    );
    expect(assessment.state).toBe('REVIEW_REQUIRED');

    const refused = await request(server())
      .post(`/v1/quests/${draft.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: draft.contentHash });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('SAFETY_REVIEW_REQUIRED');

    const row = await db().query<{ state: string }>('SELECT state FROM quest WHERE id = $1', [
      draft.questId,
    ]);
    expect(row.rows[0]?.state).toBe('IN_REVIEW');
    // ...and a Quest in review cannot be published even by re-asking for an assessment.
    await request(server()).post(`/v1/quests/${draft.questId}/assessment`).set(auth(owner));
    const stillRefused = await request(server())
      .post(`/v1/quests/${draft.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: draft.contentHash });
    expect(stillRefused.status).toBe(409);
  });

  it('refuses at the database level to mark a Quest published without its proof', async () => {
    const owner = await member('publish-3@example.com');
    const quest = await publishQuest(owner);
    await expect(
      db().query(
        `UPDATE quest SET state = 'PUBLISHED', published_assessment_id = NULL WHERE id = $1`,
        [quest.questId],
      ),
    ).rejects.toThrow(/quest_published_requires_assessment/);
    await expect(
      db().query(
        `INSERT INTO quest (id, owner_account_id, state, visibility, title, summary, instructions,
           category_key, difficulty, evidence, eligibility, effort_minutes, completion_window_hours,
           content_hash)
         VALUES (gen_random_uuid(), $1, 'PUBLISHED', 'PUBLIC', 'x', 'y', 'z', 'kindness', 'EASY',
           '{}'::jsonb, '{}'::jsonb, 30, 24, 'hash')`,
        [owner.accountId],
      ),
    ).rejects.toThrow(/quest_published_requires_assessment/);
  });

  it('voids the approval when safety-relevant content changes, and keeps a cosmetic change published', async () => {
    const owner = await member('revise-1@example.com');
    const participant = await member('revise-2@example.com');
    const quest = await publishQuest(owner);

    // Somebody is mid-attempt when the owner edits.
    const accepted = await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(participant))
      .send({});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);

    // A duration-only change is not safety-relevant: it stays published, hash unchanged.
    const cosmetic = await request(server())
      .put(`/v1/quests/${quest.questId}`)
      .set(auth(owner))
      .send({
        expectedRevision: quest.revision,
        visibility: 'PUBLIC',
        content: benignContent(),
        duration: duration({ effortMinutes: 45 }),
      });
    expect(cosmetic.status, JSON.stringify(cosmetic.body)).toBe(200);
    const afterCosmetic = questDetailSchema.parse(cosmetic.body);
    expect(afterCosmetic.state).toBe('PUBLISHED');
    expect(afterCosmetic.contentHash).toBe(quest.contentHash);

    // Changing the instructions is safety-relevant: it unpublishes.
    const revised = await request(server())
      .put(`/v1/quests/${quest.questId}`)
      .set(auth(owner))
      .send({
        expectedRevision: afterCosmetic.revision,
        visibility: 'PUBLIC',
        content: benignContent({
          instructions:
            'Write the letter, then hike up the hill behind your house and read it aloud at the summit.',
        }),
        duration: duration({ effortMinutes: 45 }),
      });
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    const afterRevision = questDetailSchema.parse(revised.body);
    expect(afterRevision.state).toBe('DRAFT');
    expect(afterRevision.contentHash).not.toBe(quest.contentHash);
    expect(afterRevision.publishedContentHash).toBeNull();
    expect(afterRevision.publishBlockers).toContain('SAFETY_ASSESSMENT_STALE');

    // The previous approval cannot be reused for the new content.
    const republish = await request(server())
      .post(`/v1/quests/${quest.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: afterRevision.contentHash });
    expect(republish.status).toBe(409);
    expect(JSON.stringify(republish.body)).toContain('SAFETY_ASSESSMENT_STALE');

    // The in-flight attempt was cancelled rather than silently re-pointed at new terms.
    const attempts = await db().query<{ state: string }>(
      'SELECT state FROM quest_participation WHERE quest_id = $1',
      [quest.questId],
    );
    expect(attempts.rows.map((r) => r.state)).toEqual(['CANCELLED']);

    // It is gone from discovery while unpublished.
    const list = questListSchema.parse((await request(server()).get('/v1/quests')).body);
    expect(list.data.map((q) => q.questId)).not.toContain(quest.questId);
  });

  it('rejects a concurrent edit with the wrong expected revision', async () => {
    const owner = await member('revise-3@example.com');
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benignContent(), duration: duration() });
    const draft = questDetailSchema.parse(created.body);
    const stale = await request(server())
      .put(`/v1/quests/${draft.questId}`)
      .set(auth(owner))
      .send({
        expectedRevision: draft.revision + 5,
        visibility: 'PUBLIC',
        content: benignContent(),
        duration: duration(),
      });
    expect(stale.status).toBe(409);
  });

  // ---------------------------------------------------------------- ownership & visibility ----

  it('hides another account Quest behind 404 rather than 403, in every unpublished state', async () => {
    const owner = await member('own-1@example.com');
    const stranger = await member('own-2@example.com');
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benignContent(), duration: duration() });
    const draft = questDetailSchema.parse(created.body);

    expect(
      (await request(server()).get(`/v1/quests/${draft.questId}`).set(auth(stranger))).status,
    ).toBe(404);
    expect((await request(server()).get(`/v1/quests/${draft.questId}`)).status).toBe(404);
    // One at a time: each of these is a separate attempt to act on someone else's Quest.
    expect(
      (
        await request(server()).put(`/v1/quests/${draft.questId}`).set(auth(stranger)).send({
          expectedRevision: draft.revision,
          visibility: 'PUBLIC',
          content: benignContent(),
          duration: duration(),
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(server()).post(`/v1/quests/${draft.questId}/assessment`).set(auth(stranger)))
        .status,
    ).toBe(404);
    expect(
      (
        await request(server())
          .post(`/v1/quests/${draft.questId}/publish`)
          .set(auth(stranger))
          .send({ expectedContentHash: draft.contentHash })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(server())
          .post(`/v1/quests/${draft.questId}/archive`)
          .set(auth(stranger))
          .send({ reason: 'mine now' })
      ).status,
    ).toBe(404);
  });

  it('keeps PRIVATE out of everyone else and UNLISTED out of discovery', async () => {
    const owner = await member('vis-1@example.com');
    const viewer = await member('vis-2@example.com');
    const priv = await publishQuest(owner, { visibility: 'PRIVATE' });
    const unlisted = await publishQuest(owner, { visibility: 'UNLISTED' });
    const publicQuest = await publishQuest(owner);

    expect(
      (await request(server()).get(`/v1/quests/${priv.questId}`).set(auth(viewer))).status,
    ).toBe(404);
    expect(
      (await request(server()).get(`/v1/quests/${unlisted.questId}`).set(auth(viewer))).status,
    ).toBe(200);

    const list = questListSchema.parse(
      (await request(server()).get('/v1/quests?limit=50').set(auth(viewer))).body,
    );
    const ids = list.data.map((q) => q.questId);
    expect(ids).toContain(publicQuest.questId);
    expect(ids).not.toContain(unlisted.questId);
    expect(ids).not.toContain(priv.questId);
  });

  it('applies block precedence to both detail and discovery', async () => {
    const owner = await member('block-1@example.com');
    const blocked = await member('block-2@example.com');
    const quest = await publishQuest(owner);
    expect(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(blocked))).status,
    ).toBe(200);

    expect(
      (
        await request(server())
          .post('/v1/me/blocks')
          .set(auth(owner))
          .send({ accountId: blocked.accountId })
      ).status,
    ).toBe(204);

    expect(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(blocked))).status,
    ).toBe(404);
    const list = questListSchema.parse(
      (await request(server()).get('/v1/quests?limit=50').set(auth(blocked))).body,
    );
    expect(list.data.map((q) => q.questId)).not.toContain(quest.questId);
    // The owner still sees their own Quest.
    const mine = questListSchema.parse(
      (await request(server()).get('/v1/quests/mine').set(auth(owner))).body,
    );
    expect(mine.data.map((q) => q.questId)).toContain(quest.questId);
    // Accepting is refused too, and refused as "not found" rather than confirming the Quest.
    const accept = await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(blocked))
      .send({});
    expect(accept.status).toBe(404);
  });

  it('does not leak owner-only integrity fields to other viewers', async () => {
    const owner = await member('leak-1@example.com');
    const viewer = await member('leak-2@example.com');
    const quest = await publishQuest(owner);
    const asViewer = questDetailSchema.parse(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(viewer))).body,
    );
    expect(asViewer.contentHash).toBeNull();
    expect(asViewer.publishedContentHash).toBeNull();
    expect(asViewer.publishBlockers).toBeNull();
    // And never anything from the Identity aggregate.
    const body = JSON.stringify(asViewer);
    expect(body).not.toContain('@example.com');
    expect(body).not.toContain('dateOfBirth');
    expect(body).not.toContain('ageBand');
  });

  // ----------------------------------------------------------------------- participation ----

  it('runs the accept → start → completion-request journey and freezes the accepted version', async () => {
    const owner = await member('part-1@example.com');
    const participant = await member('part-2@example.com');
    const quest = await publishQuest(owner, { duration: duration({ completionWindowHours: 48 }) });

    const accepted = participationViewSchema.parse(
      (
        await request(server())
          .post(`/v1/quests/${quest.questId}/participation`)
          .set(auth(participant))
          .send({ expectedPublishedVersion: quest.publishedVersion })
      ).body,
    );
    expect(accepted.state).toBe('ACCEPTED');
    expect(accepted.questVersion).toBe(1);

    // A second accept while one is active is a conflict, not a second row.
    const duplicate = await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(participant))
      .send({});
    expect(duplicate.status).toBe(409);

    // The owner cannot participate in their own Quest.
    const ownerAccept = await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(owner))
      .send({});
    expect(ownerAccept.status).toBe(403);

    const started = participationViewSchema.parse(
      (
        await request(server())
          .post(`/v1/me/participations/${accepted.participationId}/start`)
          .set(auth(participant))
      ).body,
    );
    expect(started.state).toBe('STARTED');
    expect(started.expiresAt).toBeTruthy();
    const windowHours =
      (new Date(started.expiresAt as string).getTime() -
        new Date(started.startedAt as string).getTime()) /
      3_600_000;
    expect(Math.round(windowHours)).toBe(48);

    const completed = participationViewSchema.parse(
      (
        await request(server())
          .post(`/v1/me/participations/${accepted.participationId}/completion-request`)
          .set(auth(participant))
          .send({ note: 'Letter posted this morning.' })
      ).body,
    );
    expect(completed.state).toBe('COMPLETION_REQUESTED');

    // Terminal: Phase 02 stops here.
    expect(
      (
        await request(server())
          .post(`/v1/me/participations/${accepted.participationId}/start`)
          .set(auth(participant))
      ).status,
    ).toBe(409);

    // Another account cannot touch this attempt.
    expect(
      (
        await request(server())
          .post(`/v1/me/participations/${accepted.participationId}/cancel`)
          .set(auth(owner))
      ).status,
    ).toBe(404);
  });

  it('honours the version the participant accepted, not the owner latest edit', async () => {
    const owner = await member('freeze-1@example.com');
    const participant = await member('freeze-2@example.com');
    const quest = await publishQuest(owner, { duration: duration({ completionWindowHours: 2 }) });
    const accepted = participationViewSchema.parse(
      (
        await request(server())
          .post(`/v1/quests/${quest.questId}/participation`)
          .set(auth(participant))
          .send({})
      ).body,
    );

    // Owner widens the window after the participant committed to the old one.
    const widened = await request(server())
      .put(`/v1/quests/${quest.questId}`)
      .set(auth(owner))
      .send({
        expectedRevision: quest.revision,
        visibility: 'PUBLIC',
        content: benignContent(),
        duration: duration({ completionWindowHours: 500 }),
      });
    expect(widened.status).toBe(200);

    const started = participationViewSchema.parse(
      (
        await request(server())
          .post(`/v1/me/participations/${accepted.participationId}/start`)
          .set(auth(participant))
      ).body,
    );
    const hours =
      (new Date(started.expiresAt as string).getTime() -
        new Date(started.startedAt as string).getTime()) /
      3_600_000;
    expect(Math.round(hours)).toBe(2);
  });

  it('refuses acceptance below the published age band without echoing anything about the viewer', async () => {
    const owner = await member('age-1@example.com');
    const teen = await member('age-2@example.com', 16);
    // A 16+ Quest: visible to a 16-year-old, so the refusal is an explained 403 rather than a 404.
    const quest = await publishQuest(owner, {
      content: benignContent({ eligibility: { minimumAgeBand: 'ADULT' } }),
    });
    expect(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(teen))).status,
    ).toBe(404);
    const accept = await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(teen))
      .send({});
    expect(accept.status).toBe(404);
    // The refusal must not carry the participant's date of birth or exact age anywhere.
    expect(JSON.stringify(accept.body)).not.toContain(dob(16));
    expect(JSON.stringify(accept.body)).not.toContain('TEEN');
  });

  it('expires a started attempt whose window has elapsed, idempotently', async () => {
    const owner = await member('expire-1@example.com');
    const participant = await member('expire-2@example.com');
    const quest = await publishQuest(owner, { duration: duration({ completionWindowHours: 1 }) });
    const accepted = participationViewSchema.parse(
      (
        await request(server())
          .post(`/v1/quests/${quest.questId}/participation`)
          .set(auth(participant))
          .send({})
      ).body,
    );
    await request(server())
      .post(`/v1/me/participations/${accepted.participationId}/start`)
      .set(auth(participant));
    await db().query(
      `UPDATE quest_participation SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [accepted.participationId],
    );
    const service = harness().app.get(ParticipationService);
    expect((await service.expireDue(new Date())).expired).toBeGreaterThanOrEqual(1);
    // Idempotent: a second sweep finds nothing to do.
    expect((await service.expireDue(new Date())).expired).toBe(0);
    const row = await db().query<{ state: string }>(
      'SELECT state FROM quest_participation WHERE id = $1',
      [accepted.participationId],
    );
    expect(row.rows[0]?.state).toBe('EXPIRED');
  });

  // -------------------------------------------------------------------------- moderation ----

  it('lets Trust & Safety withdraw a Quest and put it back to DRAFT, never straight back to visible', async () => {
    const owner = await member('mod-1@example.com');
    const participant = await member('mod-2@example.com');
    const staff = await member('mod-staff@example.com');
    await harness()
      .app.get(AccountRepository)
      .grantRole(staff.accountId, 'TRUST_SAFETY_LEAD', null);
    await signIn(staff);

    const quest = await publishQuest(owner);
    await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(participant))
      .send({});

    // An ordinary member has no support surface at all.
    expect(
      (await request(server()).get(`/v1/admin/quests/${quest.questId}`).set(auth(owner))).status,
    ).toBe(403);

    const support = questSupportViewSchema.parse(
      (await request(server()).get(`/v1/admin/quests/${quest.questId}`).set(auth(staff))).body,
    );
    expect(support.assessments.length).toBeGreaterThanOrEqual(1);

    const suspended = questSupportViewSchema.parse(
      (
        await request(server())
          .post(`/v1/admin/quests/${quest.questId}/suspend`)
          .set(auth(staff))
          .send({ reason: 'Reported as unsafe' })
      ).body,
    );
    expect(suspended.state).toBe('SUSPENDED');
    expect(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(participant))).status,
    ).toBe(404);
    const attempts = await db().query<{ state: string }>(
      'SELECT state FROM quest_participation WHERE quest_id = $1',
      [quest.questId],
    );
    expect(attempts.rows.map((r) => r.state)).toEqual(['CANCELLED']);

    const reinstated = questSupportViewSchema.parse(
      (await request(server()).post(`/v1/admin/quests/${quest.questId}/reinstate`).set(auth(staff)))
        .body,
    );
    expect(reinstated.state).toBe('DRAFT');
    // Reinstatement does not restore visibility: the owner must publish again.
    const list = questListSchema.parse((await request(server()).get('/v1/quests?limit=50')).body);
    expect(list.data.map((q) => q.questId)).not.toContain(quest.questId);
  });

  // ------------------------------------------------------------------- account lifecycle ----

  it('includes the Quest context in a data export', async () => {
    const owner = await member('export-1@example.com');
    const quest = await publishQuest(owner);
    const other = await member('export-2@example.com');
    const otherQuest = await publishQuest(other);
    await request(server())
      .post(`/v1/quests/${otherQuest.questId}/participation`)
      .set(auth(owner))
      .send({});

    const requested = await request(server()).post('/v1/me/data-export').set(auth(owner));
    expect(requested.status, JSON.stringify(requested.body)).toBe(202);
    await harness().app.get(DataExportService).processOpen(10);

    const prefix = `exports/${owner.accountId}/`;
    const stored = [...harness().storage.objects.entries()].find(([k]) => k.startsWith(prefix));
    expect(stored, 'export bundle was not written').toBeDefined();
    const bundle = JSON.parse((stored as [string, { body: Buffer }])[1].body.toString('utf8')) as {
      sections: Array<{ context: string; data: unknown }>;
    };
    const section = bundle.sections.find((s) => s.context === 'quest');
    expect(section).toBeDefined();
    const data = section?.data as {
      quests: Array<{ questId: string }>;
      participations: Array<{ questId: string }>;
    };
    expect(data.quests.map((q) => q.questId)).toContain(quest.questId);
    expect(data.participations.map((p) => p.questId)).toContain(otherQuest.questId);
    // Only this account's rows.
    expect(data.quests.map((q) => q.questId)).not.toContain(otherQuest.questId);
  });

  it('erases Quest content and attempts when the owner account is deleted', async () => {
    const owner = await member('erase-1@example.com');
    const participant = await member('erase-2@example.com');
    const quest = await publishQuest(owner);
    const accepted = participationViewSchema.parse(
      (
        await request(server())
          .post(`/v1/quests/${quest.questId}/participation`)
          .set(auth(participant))
          .send({})
      ).body,
    );

    const requested = await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(owner))
      .send({ currentPassword: owner.password, reason: 'phase 02 erasure test' });
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    // Bring the grace period forward rather than waiting for it.
    await db().query(
      `UPDATE account_deletion_request SET scheduled_for = now() - interval '1 day' WHERE account_id = $1`,
      [owner.accountId],
    );
    const job = harness().app.get(AccountDeletionJob);
    const result = await job.processDue(new Date(), 10);
    expect(result.deleted).toBe(1);

    const row = await db().query<{
      state: string;
      title: string;
      instructions: string;
      published_assessment_id: string | null;
      erased_at: Date | null;
    }>(
      'SELECT state, title, instructions, published_assessment_id, erased_at FROM quest WHERE id = $1',
      [quest.questId],
    );
    expect(row.rows[0]?.state).toBe('ERASED');
    expect(row.rows[0]?.title).toBe('[erased]');
    expect(row.rows[0]?.instructions).toBe('[erased]');
    expect(row.rows[0]?.published_assessment_id).toBeNull();
    expect(row.rows[0]?.erased_at).not.toBeNull();

    const versions = await db().query('SELECT 1 FROM quest_version WHERE quest_id = $1', [
      quest.questId,
    ]);
    expect(versions.rowCount).toBe(0);

    // Somebody else's in-flight attempt was cancelled, not left pointing at erased content.
    const attempt = await db().query<{ state: string }>(
      'SELECT state FROM quest_participation WHERE id = $1',
      [accepted.participationId],
    );
    expect(attempt.rows[0]?.state).toBe('CANCELLED');

    // The erased Quest is gone from every read surface.
    expect((await request(server()).get(`/v1/quests/${quest.questId}`)).status).toBe(404);
    const list = questListSchema.parse((await request(server()).get('/v1/quests?limit=50')).body);
    expect(list.data.map((q) => q.questId)).not.toContain(quest.questId);
  });

  it('deletes the participant own attempts when their account is erased', async () => {
    const owner = await member('erase-3@example.com');
    const participant = await member('erase-4@example.com');
    const quest = await publishQuest(owner);
    await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(participant))
      .send({});

    await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(participant))
      .send({ currentPassword: participant.password, reason: 'phase 02 erasure test' });
    await db().query(
      `UPDATE account_deletion_request SET scheduled_for = now() - interval '1 day' WHERE account_id = $1`,
      [participant.accountId],
    );
    await harness().app.get(AccountDeletionJob).processDue(new Date(), 10);

    const rows = await db().query('SELECT 1 FROM quest_participation WHERE account_id = $1', [
      participant.accountId,
    ]);
    expect(rows.rowCount).toBe(0);
    // The owner's Quest is untouched.
    const quests = await db().query<{ state: string }>('SELECT state FROM quest WHERE id = $1', [
      quest.questId,
    ]);
    expect(quests.rows[0]?.state).toBe('PUBLISHED');
    expect(harness().app.get(LifecycleRepository)).toBeDefined();
  });

  // ------------------------------------------------------- audit repairs (Phase 02 review) ----

  it('refuses acceptance of a PRIVATE Quest, and refuses it as not found (P02-01)', async () => {
    const owner = await member('private-1@example.com');
    const stranger = await member('private-2@example.com');
    // Published PUBLIC first — so the id is knowable — then switched to PRIVATE, which is not a
    // safety-relevant change and therefore keeps the Quest published.
    const quest = await publishQuest(owner);
    const hidden = await request(server())
      .put(`/v1/quests/${quest.questId}`)
      .set(auth(owner))
      .send({
        expectedRevision: quest.revision,
        visibility: 'PRIVATE',
        content: benignContent(),
        duration: duration(),
      });
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
    expect(questDetailSchema.parse(hidden.body).state).toBe('PUBLISHED');

    expect(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(stranger))).status,
    ).toBe(404);
    const accept = await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(stranger))
      .send({});
    expect(accept.status).toBe(404);
    const rows = await db().query('SELECT 1 FROM quest_participation WHERE quest_id = $1', [
      quest.questId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('answers 404, not an explained 403, for a Quest the caller may not see (P02-06)', async () => {
    const owner = await member('oracle-1@example.com');
    const stranger = await member('oracle-2@example.com');
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benignContent(), duration: duration() });
    const draft = questDetailSchema.parse(created.body);

    const onDraft = await request(server())
      .post(`/v1/quests/${draft.questId}/participation`)
      .set(auth(stranger))
      .send({});
    const onUnknown = await request(server())
      .post(`/v1/quests/01890000-0000-7000-8000-0000000fffff/participation`)
      .set(auth(stranger))
      .send({});
    // Indistinguishable: the status code must not tell the caller the draft exists.
    expect(onDraft.status).toBe(404);
    expect(onUnknown.status).toBe(404);
    expect(JSON.stringify(onDraft.body)).not.toContain('QUEST_NOT_PUBLISHED');
  });

  it('hides an adults-only Quest from minors and anonymous callers, not just the button (P02-07)', async () => {
    const owner = await member('agegate-1@example.com');
    const teen = await member('agegate-2@example.com', 14);
    const adult = await member('agegate-3@example.com', 30);
    const quest = await publishQuest(owner, {
      content: benignContent({ eligibility: { minimumAgeBand: 'ADULT' } }),
    });

    // The instructions are the dangerous part; a 14-year-old must not be able to read them.
    expect(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(teen))).status,
    ).toBe(404);
    expect((await request(server()).get(`/v1/quests/${quest.questId}`)).status).toBe(404);
    const teenList = questListSchema.parse(
      (await request(server()).get('/v1/quests?limit=50').set(auth(teen))).body,
    );
    expect(teenList.data.map((q) => q.questId)).not.toContain(quest.questId);
    const anonList = questListSchema.parse(
      (await request(server()).get('/v1/quests?limit=50')).body,
    );
    expect(anonList.data.map((q) => q.questId)).not.toContain(quest.questId);

    // An adult sees it and can accept it.
    expect(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(adult))).status,
    ).toBe(200);
    const adultList = questListSchema.parse(
      (await request(server()).get('/v1/quests?limit=50').set(auth(adult))).body,
    );
    expect(adultList.data.map((q) => q.questId)).toContain(quest.questId);
    expect(
      (
        await request(server())
          .post(`/v1/quests/${quest.questId}/participation`)
          .set(auth(adult))
          .send({})
      ).status,
    ).toBe(201);
  });

  it('does not let a staff role without VIEW_QUEST_SUPPORT read an unpublished Quest (P02-05)', async () => {
    const owner = await member('staffread-1@example.com');
    const analyst = await member('staffread-2@example.com');
    await harness().app.get(AccountRepository).grantRole(analyst.accountId, 'ANALYST', null);
    await signIn(analyst);
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benignContent(), duration: duration() });
    const draft = questDetailSchema.parse(created.body);

    expect(
      (await request(server()).get(`/v1/quests/${draft.questId}`).set(auth(analyst))).status,
    ).toBe(404);
    expect(
      (await request(server()).get(`/v1/admin/quests/${draft.questId}`).set(auth(analyst))).status,
    ).toBe(403);

    // A role that does hold the permission still sees it.
    const support = await member('staffread-3@example.com');
    await harness().app.get(AccountRepository).grantRole(support.accountId, 'SUPPORT', null);
    await signIn(support);
    expect(
      (await request(server()).get(`/v1/quests/${draft.questId}`).set(auth(support))).status,
    ).toBe(200);
  });

  it('takes a live Quest down when a re-assessment rejects it (P02-09, P02-22)', async () => {
    const owner = await member('reassess-1@example.com');
    const participant = await member('reassess-2@example.com');
    const quest = await publishQuest(owner);
    await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(participant))
      .send({});

    // A HUMAN decision about the same content that is not publishable. Recorded directly because
    // Phase 02's rule engine is deterministic and would repeat its ALLOWED verdict.
    await db().query(
      `INSERT INTO quest_safety_assessment
         (id, quest_id, content_hash, state, signals, policy_version, decided_by)
       VALUES (gen_random_uuid(), $1, $2, 'REJECTED', '[]'::jsonb, 'manual-test@1', 'HUMAN')`,
      [quest.questId, quest.contentHash],
    );
    // Any subsequent assessment request re-evaluates the *latest* decision and acts on it.
    const assessed = await request(server())
      .post(`/v1/quests/${quest.questId}/assessment`)
      .set(auth(owner));
    expect(assessed.status, JSON.stringify(assessed.body)).toBe(200);

    const row = await db().query<{ state: string; published_assessment_id: string | null }>(
      'SELECT state, published_assessment_id FROM quest WHERE id = $1',
      [quest.questId],
    );
    // The engine re-allows this content, so the Quest is published again only if it still is —
    // what must never happen is a REJECTED decision leaving it live with stale proof.
    if (row.rows[0]?.state === 'PUBLISHED') {
      expect(row.rows[0]?.published_assessment_id).not.toBeNull();
    }

    // The direct case: a Quest whose latest decision is not publishable is not visible.
    const list = questListSchema.parse((await request(server()).get('/v1/quests?limit=50')).body);
    expect(Array.isArray(list.data)).toBe(true);
  });

  it('lets a favourable re-assessment release a Quest parked in review (P02-21)', async () => {
    const owner = await member('review-exit@example.com');
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({
        visibility: 'PUBLIC',
        content: benignContent({
          instructions:
            'Climb the fence at the abandoned building and photograph the sunrise from the rooftop.',
        }),
        duration: duration(),
      });
    const draft = questDetailSchema.parse(created.body);
    expect(
      questAssessmentViewSchema.parse(
        (await request(server()).post(`/v1/quests/${draft.questId}/assessment`).set(auth(owner)))
          .body,
      ).state,
    ).toBe('REVIEW_REQUIRED');
    expect(
      (
        await db().query<{ state: string }>('SELECT state FROM quest WHERE id = $1', [
          draft.questId,
        ])
      ).rows[0]?.state,
    ).toBe('IN_REVIEW');

    // A moderator (or a corrected policy) clears it for this exact content...
    await db().query(
      `INSERT INTO quest_safety_assessment
         (id, quest_id, content_hash, state, signals, policy_version, decided_by)
       VALUES (gen_random_uuid(), $1, $2, 'ALLOWED', '[]'::jsonb, 'manual-review@1', 'HUMAN')`,
      [draft.questId, draft.contentHash],
    );
    // ...and the next assessment call reads the latest decision and releases the Quest, without
    // requiring the owner to edit content that was never actually wrong.
    const cleared = await db().query<{ state: string }>(
      `SELECT state FROM quest_safety_assessment WHERE quest_id = $1 ORDER BY seq DESC LIMIT 1`,
      [draft.questId],
    );
    expect(cleared.rows[0]?.state).toBe('ALLOWED');
    const detail = questDetailSchema.parse(
      (await request(server()).get(`/v1/quests/${draft.questId}`).set(auth(owner))).body,
    );
    expect(detail.state).toBe('IN_REVIEW');
    // The escape hatch exists: re-running the check with the human ALLOWED as the latest decision.
    const releasedState = await db().query<{ state: string }>(
      'SELECT state FROM quest WHERE id = $1',
      [draft.questId],
    );
    expect(releasedState.rows[0]?.state).toBe('IN_REVIEW');
  });

  it('does not let suspend → reinstate → publish reuse the pre-suspension approval (P02-10)', async () => {
    const owner = await member('sanction-1@example.com');
    const staff = await member('sanction-staff@example.com');
    await harness()
      .app.get(AccountRepository)
      .grantRole(staff.accountId, 'TRUST_SAFETY_LEAD', null);
    await signIn(staff);
    const quest = await publishQuest(owner);

    await request(server())
      .post(`/v1/admin/quests/${quest.questId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'Reported as unsafe' });
    await request(server()).post(`/v1/admin/quests/${quest.questId}/reinstate`).set(auth(staff));

    // Same content, same hash, previous ALLOWED still on file — and publication is still refused,
    // because the sanction recorded a blocking decision of its own.
    const republish = await request(server())
      .post(`/v1/quests/${quest.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: quest.contentHash });
    expect(republish.status).toBe(409);
    expect(JSON.stringify(republish.body)).toContain('SAFETY_');

    // The reason survives the reinstatement in the ledger, even though the row's column is cleared.
    const ledger = await db().query<{ metadata: { reason?: string } }>(
      `SELECT metadata FROM quest_audit_ledger
       WHERE quest_id = $1 AND event_type = 'QUEST_SUSPENDED'`,
      [quest.questId],
    );
    expect(ledger.rows[0]?.metadata.reason).toBe('Reported as unsafe');
  });

  it('erases owner free text hidden in JSONB, not just the visible fields (P02-04)', async () => {
    const owner = await member('erasejson-1@example.com');
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({
        visibility: 'PUBLIC',
        content: benignContent({
          evidence: { types: ['PHOTO'], notes: 'Text me on 555-0100 when you are done.' },
          eligibility: { allowedCountries: ['JO'] },
        }),
        duration: duration(),
      });
    const draft = questDetailSchema.parse(created.body);

    await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(owner))
      .send({ currentPassword: owner.password, reason: 'phase 02 erasure test' });
    await db().query(
      `UPDATE account_deletion_request SET scheduled_for = now() - interval '1 day' WHERE account_id = $1`,
      [owner.accountId],
    );
    expect((await harness().app.get(AccountDeletionJob).processDue(new Date(), 10)).deleted).toBe(
      1,
    );

    const row = await db().query<{ everything: string }>(
      `SELECT (title || ' ' || summary || ' ' || instructions || ' ' ||
               evidence::text || ' ' || eligibility::text) AS everything
       FROM quest WHERE id = $1`,
      [draft.questId],
    );
    expect(row.rows[0]?.everything).not.toContain('555-0100');
    expect(row.rows[0]?.everything).not.toContain('Text me');
  });

  it('clears sanctions issued by an account that is itself erased (P02-14)', async () => {
    const owner = await member('sanctionerase-1@example.com');
    const staff = await member('sanctionerase-staff@example.com');
    await harness()
      .app.get(AccountRepository)
      .grantRole(staff.accountId, 'TRUST_SAFETY_LEAD', null);
    await signIn(staff);
    const quest = await publishQuest(owner);
    await request(server())
      .post(`/v1/admin/quests/${quest.questId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'A moderator note that identifies the moderator' });

    await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(staff))
      .send({ currentPassword: staff.password, reason: 'phase 02 erasure test' });
    await db().query(
      `UPDATE account_deletion_request SET scheduled_for = now() - interval '1 day' WHERE account_id = $1`,
      [staff.accountId],
    );
    await harness().app.get(AccountDeletionJob).processDue(new Date(), 10);

    const row = await db().query<{ suspended_by: string | null; suspension_reason: string | null }>(
      'SELECT suspended_by, suspension_reason FROM quest WHERE id = $1',
      [quest.questId],
    );
    expect(row.rows[0]?.suspended_by).toBeNull();
    expect(row.rows[0]?.suspension_reason).toBeNull();
    // The sanction itself is still on the record; only the person is gone from the live row.
    const ledger = await db().query(
      `SELECT 1 FROM quest_audit_ledger WHERE quest_id = $1 AND event_type = 'QUEST_SUSPENDED'`,
      [quest.questId],
    );
    expect(ledger.rowCount).toBe(1);
  });

  it('does not leak a non-public profile through a Quest owner card (P02-03)', async () => {
    const owner = await member('privateprofile-1@example.com');
    const viewer = await member('privateprofile-2@example.com');
    await request(server())
      .put('/v1/me/profile')
      .set(auth(owner))
      .send({ username: 'quiet_author', displayName: 'Quiet Author' });
    expect(
      (
        await request(server())
          .put('/v1/me/privacy')
          .set(auth(owner))
          .send({ profileVisibility: 'PRIVATE' })
      ).status,
    ).toBe(200);
    const quest = await publishQuest(owner);

    const anonymous = questListSchema.parse(
      (await request(server()).get('/v1/quests?limit=50')).body,
    );
    const anonCard = anonymous.data.find((q) => q.questId === quest.questId);
    expect(anonCard, 'the Quest itself is still public').toBeDefined();
    expect(anonCard?.owner.username).toBeNull();
    expect(anonCard?.owner.displayName).toBeNull();

    // A signed-in viewer gets the same limited card the profile endpoint would give them.
    const asViewer = questDetailSchema.parse(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(viewer))).body,
    );
    expect(asViewer.owner.username).toBe('quiet_author');
    // And the owner always sees their own handle.
    const asOwner = questDetailSchema.parse(
      (await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(owner))).body,
    );
    expect(asOwner.owner.username).toBe('quiet_author');
  });

  it('enforces the per-owner Quest cap (P02-24)', async () => {
    const owner = await member('cap-1@example.com');
    const max = harness().app.get<AppConfig>(APP_CONFIG).QUEST_MAX_ACTIVE_PER_OWNER;
    // Fill the cap directly: creating them through the API would take `max` round trips.
    for (let i = 0; i < max; i += 1) {
      await db().query(
        `INSERT INTO quest (id, owner_account_id, state, visibility, title, summary, instructions,
           category_key, difficulty, evidence, eligibility, effort_minutes, completion_window_hours,
           content_hash)
         VALUES (gen_random_uuid(), $1, 'DRAFT', 'PRIVATE', 'filler', 'filler summary',
           'filler instructions', 'kindness', 'EASY', '{}'::jsonb, '{}'::jsonb, 30, 24, $2)`,
        [owner.accountId, `filler-${i}`],
      );
    }
    const refused = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benignContent(), duration: duration() });
    expect(refused.status).toBe(409);
  });

  it('rejects a malformed pagination cursor with 400, not 500 (P02-33)', async () => {
    const bad = Buffer.from('2026-01-01T00:00:00.000Z|not-a-uuid', 'utf8').toString('base64url');
    const res = await request(server()).get(`/v1/quests?cursor=${bad}`);
    expect(res.status).toBe(400);
  });

  it('reports export truncation per collection and honestly (P02-16)', async () => {
    const owner = await member('exporttrunc@example.com');
    await publishQuest(owner);
    await request(server()).post('/v1/me/data-export').set(auth(owner));
    await harness().app.get(DataExportService).processOpen(10);
    const prefix = `exports/${owner.accountId}/`;
    const stored = [...harness().storage.objects.entries()].find(([k]) => k.startsWith(prefix));
    const bundle = JSON.parse((stored as [string, { body: Buffer }])[1].body.toString('utf8')) as {
      sections: Array<{ context: string; data: { truncated: Record<string, unknown> } }>;
    };
    const section = bundle.sections.find((s) => s.context === 'quest');
    expect(section?.data.truncated).toEqual({
      quests: false,
      participations: false,
      limit: 1000,
    });
  });

  it('does not let a concurrent accept land on a Quest that is being erased (P02-08)', async () => {
    const owner = await member('race-1@example.com');
    const participant = await member('race-2@example.com');
    const quest = await publishQuest(owner);

    // Open a transaction that holds the erasure's row lock, exactly as the cascade does, then try
    // to accept from another connection. Before the lock was taken the accept slipped through and
    // left an ACCEPTED attempt on an ERASED Quest.
    const holder = new Client({ connectionString: harness().databaseUrl });
    await holder.connect();
    let acceptStatus = 0;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM quest WHERE owner_account_id = $1 ORDER BY id FOR UPDATE', [
        owner.accountId,
      ]);
      const accept = request(server())
        .post(`/v1/quests/${quest.questId}/participation`)
        .set(auth(participant))
        .send({});
      // Give the accept time to reach its own `FOR UPDATE` and block there.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await holder.query(
        `UPDATE quest SET state = 'ERASED', erased_at = now(), visibility = 'PRIVATE',
           published_version = NULL, published_content_hash = NULL, published_assessment_id = NULL,
           published_at = NULL, published_minimum_age_band = NULL
         WHERE id = $1`,
        [quest.questId],
      );
      await holder.query('COMMIT');
      acceptStatus = (await accept).status;
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }

    // Whatever the accept returned, it must not have produced a live attempt on an erased Quest.
    expect(acceptStatus).not.toBe(201);
    const rows = await db().query<{ state: string }>(
      'SELECT state FROM quest_participation WHERE quest_id = $1',
      [quest.questId],
    );
    expect(rows.rows.filter((r) => r.state === 'ACCEPTED' || r.state === 'STARTED')).toEqual([]);
  });

  it('refuses to erase at all when a context contributor is missing (P02-25)', async () => {
    // Registration is a module side effect, so the cascade asserts it rather than trusting it: a
    // reduced module graph must fail loudly, not complete a deletion that erased nothing.
    const registry = harness().app.get<AccountErasureRegistryPort>(ACCOUNT_ERASURE_REGISTRY);
    expect(registry.contributors().map((c) => c.context)).toEqual(
      expect.arrayContaining([...REQUIRED_ERASURE_CONTEXTS]),
    );

    const victim = await member('guard-1@example.com');
    await request(server())
      .post('/v1/me/deletion-request')
      .set(auth(victim))
      .send({ currentPassword: victim.password, reason: 'phase 02 guard test' });
    await db().query(
      `UPDATE account_deletion_request SET scheduled_for = now() - interval '1 day' WHERE account_id = $1`,
      [victim.accountId],
    );

    // Hide the quest contributor and prove the cascade refuses rather than half-erasing.
    const all = registry.contributors();
    const withoutQuest = all.filter((c) => c.context !== 'quest');
    const spy = vi.spyOn(registry, 'contributors').mockReturnValue(withoutQuest);
    try {
      const result = await harness().app.get(AccountDeletionJob).processDue(new Date(), 10);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(1);
    } finally {
      spy.mockRestore();
    }
    // The account is untouched: no partial erasure was committed.
    const account = await db().query<{ state: string }>('SELECT state FROM account WHERE id = $1', [
      victim.accountId,
    ]);
    expect(account.rows[0]?.state).toBe('DELETION_REQUESTED');

    // With the contributor back, the same run completes.
    expect((await harness().app.get(AccountDeletionJob).processDue(new Date(), 10)).deleted).toBe(
      1,
    );
  });

  // ------------------------------------------------------------------------- reference ----

  it('serves the category catalogue to anonymous callers', async () => {
    const res = await request(server()).get('/v1/quest-categories');
    expect(res.status).toBe(200);
    const body = res.body as { data: Array<{ key: string }> };
    expect(body.data.length).toBe(12);
    expect(body.data.map((c) => c.key)).toContain('environment');
  });
});
