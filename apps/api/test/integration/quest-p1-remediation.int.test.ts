/**
 * Regression suite for the three P1 findings of the Phase 02 final delta audit
 * (`docs/governance/PHASE_02_FINAL_DELTA_AUDIT_2026-09-12.md`).
 *
 * Each `it` below failed against the branch as audited and passes after the repair. They live in
 * their own file rather than in `quests.int.test.ts` so the fail-before evidence is a single
 * command, and because two of them need a direct INSERT into the append-only assessment ledger —
 * which is what the Phase 14 moderation queue and the Phase 06 AI decider will do, and which no
 * Phase 02 HTTP route can yet produce.
 *
 * P1-1 discovery continuation, P1-2 human-decision authority, P1-3 live takedown.
 */
import {
  authResponseSchema,
  participationViewSchema,
  questDetailSchema,
  questListSchema,
  questSupportViewSchema,
} from '@quest/types';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { uuidv7 } from '../../src/common/ids/uuid-v7';
import { AccountService } from '../../src/modules/identity/application/account.service';
import { AccountRepository } from '../../src/modules/identity/infrastructure/account.repository';
import { MAX_DISCOVERY_PASSES } from '../../src/modules/quests/application/quest-view.service';
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
const nextIp = () => `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

/** Content the deterministic rule engine allows outright, so RULES always answers ALLOWED. */
const benign = (overrides: Record<string, unknown> = {}) => ({
  title: 'Write a thank-you letter',
  summary: 'Write a short letter to someone who helped you and post it this week.',
  instructions: 'Write a short letter to someone who helped you recently, and post it this week.',
  categoryKey: 'kindness',
  difficulty: 'EASY',
  evidence: { types: ['TEXT_NOTE'], minimumItems: 1, requiresLocationAttestation: false },
  eligibility: {
    minimumAgeBand: 'TEEN_13_15',
    requiresVerifiedEmail: true,
    allowedCountries: [],
    blockedCountries: [],
  },
  ...overrides,
});
const duration = () => ({ effortMinutes: 20, completionWindowHours: 24 });

interface Actor {
  email: string;
  password: string;
  accessToken: string;
  accountId: string;
  ip: string;
}

describe.skipIf(!enabled)('Phase 02 P1 remediation (real database)', () => {
  let it_: IntegrationApp | undefined;
  let pg: Client | undefined;
  const harness = () => {
    if (!it_) throw new Error('integration app not ready');
    return it_;
  };
  const server = (): ReturnType<IntegrationApp['app']['getHttpServer']> =>
    harness().app.getHttpServer();
  const db = () => {
    if (!pg) throw new Error('pg not ready');
    return pg;
  };
  const auth = (a: Actor) => ({
    authorization: `Bearer ${a.accessToken}`,
    'x-forwarded-for': a.ip,
  });

  async function signIn(actor: Actor): Promise<Actor> {
    const res = await request(server())
      .post('/v1/auth/login')
      .set('x-forwarded-for', actor.ip)
      .send({ email: actor.email, password: actor.password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    actor.accessToken = authResponseSchema.parse(res.body).tokens.accessToken;
    return actor;
  }

  async function member(email: string, age = 30): Promise<Actor> {
    const ip = nextIp();
    const password = 'a very long and unique passphrase';
    const reg = await request(server())
      .post('/v1/auth/register')
      .set('x-forwarded-for', ip)
      .send({ email, password, dateOfBirth: dob(age), consents });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const parsed = authResponseSchema.parse(reg.body);
    const actor: Actor = {
      email,
      password,
      ip,
      accessToken: parsed.tokens.accessToken,
      accountId: parsed.account.accountId,
    };
    const mail = harness().mailer.lastFor(email, 'VERIFY_EMAIL');
    if (!mail || !('code' in mail.template)) throw new Error(`no verify mail for ${email}`);
    const verified = await request(server())
      .post('/v1/auth/email/verify')
      .set(auth(actor))
      .send({ code: mail.template.code });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    return signIn(actor);
  }

  async function staffActor(email: string): Promise<Actor> {
    const staff = await member(email);
    await harness().app.get(AccountRepository).grantRole(staff.accountId, 'SUPER_ADMIN', null);
    return signIn(staff);
  }

  /** Draft → assess → publish, asserting each step. */
  async function publishQuest(owner: Actor, body: Record<string, unknown> = {}) {
    const created = await request(server())
      .post('/v1/quests')
      .set(auth(owner))
      .send({ visibility: 'PUBLIC', content: benign(), duration: duration(), ...body });
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

  /**
   * Records a decision straight into the append-only ledger, the way a moderation queue or an AI
   * decider will. Deliberately not through an HTTP route: Phase 02 has none that can produce a
   * HUMAN decision other than a staff suspension, and the invariant under test must hold for every
   * writer, not only for the one route that exists today.
   */
  async function recordDecision(
    questId: string,
    contentHash: string,
    state: string,
    decidedBy: 'RULES' | 'AI' | 'HUMAN',
  ): Promise<string> {
    const id = uuidv7();
    await db().query(
      `INSERT INTO quest_safety_assessment
         (id, quest_id, content_hash, state, signals, policy_version, decided_by)
       VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6)`,
      [id, questId, contentHash, state, `audit-probe@1`, decidedBy],
    );
    return id;
  }

  const questRow = async (questId: string) =>
    (
      await db().query<{
        state: string;
        content_hash: string;
        published_content_hash: string | null;
        published_assessment_id: string | null;
      }>(
        `SELECT state, content_hash, published_content_hash, published_assessment_id
           FROM quest WHERE id = $1`,
        [questId],
      )
    ).rows[0];

  /** Every public surface for one Quest and one caller. */
  async function surfaces(questId: string, viewer: Actor | null) {
    const headers = viewer ? auth(viewer) : {};
    const detail = await request(server()).get(`/v1/quests/${questId}`).set(headers);
    const list = await request(server()).get('/v1/quests?limit=50').set(headers);
    const accept = await request(server())
      .post(`/v1/quests/${questId}/participation`)
      .set(headers)
      .send({});
    const body = questListSchema.parse(list.body);
    return {
      detailStatus: detail.status,
      detailBody: detail.body as unknown,
      inDiscovery: body.data.some((q) => q.questId === questId),
      acceptStatus: accept.status,
      badge: (detail.body as { safety?: { state?: string } | null }).safety ?? null,
    };
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

  // ------------------------------------------------------------ P1-1 discovery continuation ----

  /**
   * The refill loop scans at most `MAX_DISCOVERY_PASSES × limit` rows. Before the repair, exiting
   * on that bound threw the scan position away and the controller derived `hasMore` from the
   * survivor count, so a long enough run of concealed rows reported end-of-feed and made the rest
   * of the catalogue unreachable — the P02-19 failure mode, bounded rather than removed.
   */
  it('keeps the catalogue reachable behind a run of concealed rows longer than the scan budget', async () => {
    const accounts = harness().app.get(AccountRepository);
    const viewer = await member('p11-viewer@example.com');

    // Published first, so these sit at the TAIL of a newest-first feed.
    const keeper = await member('p11-keeper@example.com');
    const eligible: string[] = [];
    for (let i = 0; i < 3; i += 1) eligible.push((await publishQuest(keeper)).questId);

    // Then a run of newer Quests whose owners are suspended, exceeding the scan budget.
    const limit = 2;
    const concealed: string[] = [];
    const runLength = MAX_DISCOVERY_PASSES * (limit + 1) + 3;
    for (let i = 0; i < runLength; i += 1) {
      const owner = await member(`p11-concealed-${i}@example.com`);
      concealed.push((await publishQuest(owner)).questId);
      await accounts.update(owner.accountId, { state: 'SUSPENDED' });
    }

    // Walk the feed the way a conforming client does: stop only when told there is no more.
    const seen: string[] = [];
    let cursor: string | undefined;
    let requests = 0;
    for (let page = 0; page < 40; page += 1) {
      const res = await request(server())
        .get(`/v1/quests?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        .set(auth(viewer));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      requests += 1;
      const body = questListSchema.parse(res.body);
      seen.push(...body.data.map((q) => q.questId));
      if (!body.pageInfo.hasMore) break;
      // A page that says "more" must say where to continue, or the client cannot.
      expect(body.pageInfo.nextCursor, 'hasMore without a cursor is unfollowable').not.toBeNull();
      cursor = body.pageInfo.nextCursor ?? undefined;
    }

    // Every eligible Quest reachable, exactly once, and nothing concealed leaked.
    for (const id of eligible) {
      expect(
        seen.filter((q) => q === id),
        `eligible Quest ${id} reachable exactly once`,
      ).toHaveLength(1);
    }
    for (const id of concealed) {
      expect(seen, `concealed Quest ${id} must never be listed`).not.toContain(id);
    }
    // The client had to make more than one request to get past the concealed run — which is the
    // point of the fix: concealment costs requests, not catalogue.
    expect(requests).toBeGreaterThan(1);
  }, 300_000);

  it('still reports end-of-feed when the database really is exhausted', async () => {
    const viewer = await member('p11-exhausted-viewer@example.com');
    const owner = await member('p11-exhausted-owner@example.com');
    await publishQuest(owner);

    // A large limit guarantees the first pass reads every row there is.
    const res = await request(server()).get('/v1/quests?limit=50').set(auth(viewer));
    const body = questListSchema.parse(res.body);
    expect(body.pageInfo.hasMore, 'true exhaustion must not claim continuation').toBe(false);
    expect(body.pageInfo.nextCursor).toBeNull();
  }, 120_000);

  it('does not fall back to per-Quest Identity lookups while paging past concealed rows', async () => {
    // The continuation fix must not be paid for with an N+1: the batch lookup is still the only
    // way discovery may ask Identity about owners.
    const accounts = harness().app.get(AccountService);
    const repo = harness().app.get(AccountRepository);
    const viewer = await member('p11-n1-viewer@example.com');
    const keeper = await member('p11-n1-keeper@example.com');
    await publishQuest(keeper);
    for (let i = 0; i < 8; i += 1) {
      const owner = await member(`p11-n1-concealed-${i}@example.com`);
      await publishQuest(owner);
      await repo.update(owner.accountId, { state: 'DEACTIVATED' });
    }

    let single = 0;
    const realSingle = accounts.isPublicationEligible.bind(accounts);
    const spy = vi.spyOn(accounts, 'isPublicationEligible').mockImplementation(async (id) => {
      single += 1;
      return realSingle(id);
    });
    try {
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const res = await request(server())
          .get(`/v1/quests?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
          .set(auth(viewer));
        const body = questListSchema.parse(res.body);
        if (!body.pageInfo.hasMore) break;
        cursor = body.pageInfo.nextCursor ?? undefined;
      }
    } finally {
      spy.mockRestore();
    }
    expect(single, 'discovery must not ask Identity per Quest').toBe(0);
  }, 300_000);

  // ---------------------------------------------------------- P1-2 human decision authority ----

  /**
   * Sanction laundering. A staff suspension records a HUMAN REVIEW_REQUIRED for the content hash;
   * reinstatement returns the Quest to DRAFT; before the repair the owner could then call the
   * ordinary assessment route on byte-identical content, the deterministic engine answered
   * ALLOWED, that row won on `seq`, and publish succeeded. State-based blocking is not enough,
   * because after REINSTATE the state is DRAFT.
   */
  it('refuses to republish unchanged content a human blocked, even after reinstatement', async () => {
    const owner = await member('p12-owner@example.com');
    const staff = await staffActor('p12-staff@example.com');
    const quest = await publishQuest(owner);
    const hashBefore = (await questRow(quest.questId))?.content_hash;

    const suspended = await request(server())
      .post(`/v1/admin/quests/${quest.questId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'Human sanction for the P1-2 regression' });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);

    const reinstated = await request(server())
      .post(`/v1/admin/quests/${quest.questId}/reinstate`)
      .set(auth(staff));
    expect(reinstated.status, JSON.stringify(reinstated.body)).toBe(200);
    expect(questSupportViewSchema.parse(reinstated.body).state).toBe('DRAFT');

    // Unchanged content: the hash must be the one the human decided about.
    const row = await questRow(quest.questId);
    expect(row?.content_hash).toBe(hashBefore);

    // The owner mints a fresh machine decision over identical content.
    const reassessed = await request(server())
      .post(`/v1/quests/${quest.questId}/assessment`)
      .set(auth(owner));
    expect(reassessed.status, JSON.stringify(reassessed.body)).toBe(200);
    // The row is recorded — a moderator needs to see that the engine disagrees — but it does not
    // decide, so the re-assessment parks the Quest in review rather than leaving it looking like an
    // ordinary publishable draft. Without this the owner sees no sign that anything is wrong.
    expect(
      (await questRow(quest.questId))?.state,
      'a re-assessment over a human block must park the Quest, not clear it',
    ).toBe('IN_REVIEW');

    // ...and publish must still be refused, naming the human decision as the blocker.
    const republish = await request(server())
      .post(`/v1/quests/${quest.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: row?.content_hash });
    expect(republish.status, JSON.stringify(republish.body)).toBe(409);
    expect(JSON.stringify(republish.body)).toContain('SAFETY_REVIEW_REQUIRED');

    // And it is not publicly back.
    const anon = await surfaces(quest.questId, null);
    expect(anon.detailStatus).toBe(404);
    expect(anon.inDiscovery).toBe(false);
    expect((await questRow(quest.questId))?.state).not.toBe('PUBLISHED');
  }, 180_000);

  it('does not let an AI decision override a human block on unchanged content', async () => {
    const owner = await member('p12-ai-owner@example.com');
    const staff = await staffActor('p12-ai-staff@example.com');
    const quest = await publishQuest(owner);
    await request(server())
      .post(`/v1/admin/quests/${quest.questId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'Human sanction, AI override attempt' });
    await request(server()).post(`/v1/admin/quests/${quest.questId}/reinstate`).set(auth(staff));
    const row = await questRow(quest.questId);
    await recordDecision(quest.questId, row!.content_hash, 'ALLOWED', 'AI');

    const republish = await request(server())
      .post(`/v1/quests/${quest.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: row!.content_hash });
    expect(republish.status, JSON.stringify(republish.body)).toBe(409);
    expect((await questRow(quest.questId))?.state).not.toBe('PUBLISHED');
  }, 180_000);

  it('lets a later human decision clear an earlier human block', async () => {
    const owner = await member('p12-clear-owner@example.com');
    const staff = await staffActor('p12-clear-staff@example.com');
    const quest = await publishQuest(owner);
    await request(server())
      .post(`/v1/admin/quests/${quest.questId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'Sanction later cleared by a human' });
    await request(server()).post(`/v1/admin/quests/${quest.questId}/reinstate`).set(auth(staff));
    const row = await questRow(quest.questId);

    // A moderator clears this exact content.
    await recordDecision(quest.questId, row!.content_hash, 'ALLOWED', 'HUMAN');

    const republish = await request(server())
      .post(`/v1/quests/${quest.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: row!.content_hash });
    expect(republish.status, JSON.stringify(republish.body)).toBe(200);
    expect((await questRow(quest.questId))?.state).toBe('PUBLISHED');
  }, 180_000);

  it('lets a safety-relevant edit start afresh, because the hash changes', async () => {
    const owner = await member('p12-edit-owner@example.com');
    const staff = await staffActor('p12-edit-staff@example.com');
    const quest = await publishQuest(owner);
    await request(server())
      .post(`/v1/admin/quests/${quest.questId}/suspend`)
      .set(auth(staff))
      .send({ reason: 'Sanction the owner then edits away from' });
    await request(server()).post(`/v1/admin/quests/${quest.questId}/reinstate`).set(auth(staff));

    // A real content change: a new hash, so no previous decision — human or machine — applies.
    const before = await questRow(quest.questId);
    const edited = await request(server())
      .put(`/v1/quests/${quest.questId}`)
      .set(auth(owner))
      .send({
        visibility: 'PUBLIC',
        content: benign({ summary: 'A completely rewritten summary for the edited version here.' }),
        duration: duration(),
        expectedRevision: 1,
      });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const after = await questRow(quest.questId);
    expect(after?.content_hash).not.toBe(before?.content_hash);

    await request(server()).post(`/v1/quests/${quest.questId}/assessment`).set(auth(owner));
    const published = await request(server())
      .post(`/v1/quests/${quest.questId}/publish`)
      .set(auth(owner))
      .send({ expectedContentHash: after?.content_hash });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
  }, 180_000);

  it('still publishes an ordinary RULES-only Quest', async () => {
    const owner = await member('p12-plain-owner@example.com');
    const quest = await publishQuest(owner);
    expect((await questRow(quest.questId))?.state).toBe('PUBLISHED');
    const anon = await surfaces(quest.questId, null);
    expect(anon.detailStatus).toBe(200);
    expect(anon.inDiscovery).toBe(true);
  }, 120_000);

  // -------------------------------------------------------------------- P1-3 live takedown ----

  /**
   * A blocking decision about the content that is actually published must remove it, whoever
   * recorded it. Before the repair the read path only displayed the latest decision as a badge:
   * a HUMAN REJECTED left the Quest PUBLISHED, listed, and acceptable, while the API showed the
   * viewer a badge reading REJECTED — the badge and the access disagreed.
   */
  const blocking: Array<[string, 'HUMAN' | 'AI']> = [
    ['REJECTED', 'HUMAN'],
    ['REVIEW_REQUIRED', 'HUMAN'],
    ['ESCALATED', 'HUMAN'],
    ['REJECTED', 'AI'],
  ];

  for (const [state, decidedBy] of blocking) {
    it(`takes a live Quest down when a ${decidedBy} ${state} decision lands on its published content`, async () => {
      const owner = await member(`p13-${state}-${decidedBy}-owner@example.com`.toLowerCase());
      const viewer = await member(`p13-${state}-${decidedBy}-viewer@example.com`.toLowerCase());
      const quest = await publishQuest(owner);

      // Baseline: really public, really acceptable.
      const before = await surfaces(quest.questId, viewer);
      expect(before.detailStatus).toBe(200);
      expect(before.inDiscovery).toBe(true);

      const row = await questRow(quest.questId);
      expect(row?.published_content_hash).toBe(row?.content_hash);
      await recordDecision(quest.questId, row!.published_content_hash!, state, decidedBy);

      const after = await surfaces(quest.questId, viewer);
      expect(after.detailStatus, 'detail must conceal a blocked Quest').toBe(404);
      expect(after.inDiscovery, 'discovery must exclude a blocked Quest').toBe(false);
      expect(after.acceptStatus, 'accept must be refused as not found').toBe(404);

      // Anonymous callers too.
      const anon = await surfaces(quest.questId, null);
      expect(anon.detailStatus).toBe(404);
      expect(anon.inDiscovery).toBe(false);
    }, 180_000);
  }

  it('never shows a safety badge that disagrees with the access it grants', async () => {
    const owner = await member('p13-badge-owner@example.com');
    const viewer = await member('p13-badge-viewer@example.com');
    const quest = await publishQuest(owner);
    const row = await questRow(quest.questId);
    await recordDecision(quest.questId, row!.published_content_hash!, 'REJECTED', 'HUMAN');

    // Before the repair this returned 200 with `safety.state === 'REJECTED'` — a response that
    // told the viewer the content was rejected and handed it to them anyway.
    const res = await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(viewer));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('REJECTED');
  }, 180_000);

  it('freezes an attempt in flight, and still lets the participant abandon it', async () => {
    const owner = await member('p13-part-owner@example.com');
    const participant = await member('p13-part-participant@example.com');
    const quest = await publishQuest(owner);
    const accepted = await request(server())
      .post(`/v1/quests/${quest.questId}/participation`)
      .set(auth(participant))
      .send({});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const participationId = participationViewSchema.parse(accepted.body).participationId;

    const row = await questRow(quest.questId);
    await recordDecision(quest.questId, row!.published_content_hash!, 'REJECTED', 'HUMAN');

    // Documented policy, the same one ADR-014 set for an ineligible owner: the attempt cannot be
    // advanced, and can always be abandoned. Nobody is trapped in an attempt they can neither
    // finish nor close because of a decision about someone else's content.
    const started = await request(server())
      .post(`/v1/me/participations/${participationId}/start`)
      .set(auth(participant));
    expect(started.status, JSON.stringify(started.body)).toBe(409);
    expect(started.body).toMatchObject({
      error: { message: 'This Quest is no longer available' },
    });
    const completion = await request(server())
      .post(`/v1/me/participations/${participationId}/completion-request`)
      .set(auth(participant))
      .send({});
    expect(completion.status).toBe(409);

    const cancelled = await request(server())
      .post(`/v1/me/participations/${participationId}/cancel`)
      .set(auth(participant));
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(participationViewSchema.parse(cancelled.body).state).toBe('CANCELLED');
  }, 180_000);

  it('keeps the owner and support able to see a Quest a decision took down', async () => {
    const owner = await member('p13-view-owner@example.com');
    const staff = await staffActor('p13-view-staff@example.com');
    const quest = await publishQuest(owner);
    const row = await questRow(quest.questId);
    await recordDecision(quest.questId, row!.published_content_hash!, 'REJECTED', 'HUMAN');

    const ownerView = await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(owner));
    expect(ownerView.status, 'the author must still see their own work').toBe(200);
    const supportView = await request(server())
      .get(`/v1/admin/quests/${quest.questId}`)
      .set(auth(staff));
    expect(supportView.status, 'moderation must see what it took down').toBe(200);
  }, 180_000);

  it('restores nothing on a machine decision, and only on an explicit human clearance', async () => {
    const owner = await member('p13-restore-owner@example.com');
    const viewer = await member('p13-restore-viewer@example.com');
    const quest = await publishQuest(owner);
    const row = await questRow(quest.questId);
    const hash = row!.published_content_hash!;
    await recordDecision(quest.questId, hash, 'REJECTED', 'HUMAN');
    expect((await surfaces(quest.questId, viewer)).detailStatus).toBe(404);

    // A machine "allowed" must not resurrect it.
    await recordDecision(quest.questId, hash, 'ALLOWED', 'RULES');
    expect(
      (await surfaces(quest.questId, viewer)).detailStatus,
      'a RULES allow must not overturn a human rejection',
    ).toBe(404);

    // A human clearance of the same content does, and needs no republish: the row was never
    // disturbed, so visibility resumes the moment the decision in force permits it again. This is
    // the same shape ADR-014 chose for owner eligibility — visibility is computed per request from
    // authoritative state, never stored and then repaired.
    await recordDecision(quest.questId, hash, 'ALLOWED', 'HUMAN');
    const restored = await surfaces(quest.questId, viewer);
    expect(restored.detailStatus, 'a human clearance restores the Quest').toBe(200);
    expect(restored.inDiscovery).toBe(true);
    expect(restored.acceptStatus).toBe(201);
    // And the badge now agrees with the access, as it did when it was concealed.
    expect(restored.badge?.state).toBe('ALLOWED');
  }, 240_000);

  it('reports the blocked Quest to its owner without pretending it is publicly live', async () => {
    // The row keeps `state = PUBLISHED` — concealment is a read-time decision, not a mutation — so
    // the owner's own view must still carry the blocking decision, or they cannot tell why their
    // Quest has gone quiet.
    const owner = await member('p13-ownerbadge-owner@example.com');
    const quest = await publishQuest(owner);
    const row = await questRow(quest.questId);
    await recordDecision(quest.questId, row!.published_content_hash!, 'REJECTED', 'HUMAN');

    const own = await request(server()).get(`/v1/quests/${quest.questId}`).set(auth(owner));
    expect(own.status).toBe(200);
    expect((own.body as { safety: { state: string } }).safety.state).toBe('REJECTED');
  }, 180_000);
});
