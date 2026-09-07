import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from './argon2-password-hasher';
import { FakeIdentityProvider, StaticIdentityProviderRegistry } from './identity-providers';
import { JoseTokenSigner } from './jose-token-signer';
import { InMemoryMailer, LogMailer } from './mailers';

const SECRET_A = 'a'.repeat(48);
const SECRET_B = 'b'.repeat(48);
const cfg = (secret: string, previous?: string) => ({
  AUTH_JWT_SECRET: secret,
  AUTH_JWT_SECRET_PREVIOUS: previous,
  AUTH_JWT_ISSUER: 'quest-api',
  AUTH_JWT_AUDIENCE: 'quest-clients',
});
const claims = { sub: 'acc-1', sid: 'sess-1', roles: ['USER' as const], jti: 'jti-1' };

describe('JoseTokenSigner', () => {
  it('signs and verifies HS256 tokens with issuer/audience pinned', async () => {
    const signer = new JoseTokenSigner(cfg(SECRET_A));
    const token = await signer.sign(claims, 60);
    const verified = await signer.verify(token);
    expect(verified).toMatchObject({ sub: 'acc-1', sid: 'sess-1', roles: ['USER'], jti: 'jti-1' });
    expect(verified!.exp - verified!.iat).toBe(60);
  });

  it('rejects tokens signed with another secret, tampered tokens and expired tokens', async () => {
    const a = new JoseTokenSigner(cfg(SECRET_A));
    const b = new JoseTokenSigner(cfg(SECRET_B));
    const token = await a.sign(claims, 60);
    expect(await b.verify(token)).toBeNull();
    const [h, p] = token.split('.');
    expect(await a.verify(`${h}.${p}.AAAA`)).toBeNull();
    expect(await a.verify('not.a.token')).toBeNull();
    const expired = await a.sign(claims, -100);
    expect(await a.verify(expired)).toBeNull();
    const wrongAudience = new JoseTokenSigner({ ...cfg(SECRET_A), AUTH_JWT_AUDIENCE: 'other' });
    expect(await wrongAudience.verify(token)).toBeNull();
  });

  it('accepts tokens from the previous secret during rotation', async () => {
    const old = new JoseTokenSigner(cfg(SECRET_A));
    const rotated = new JoseTokenSigner(cfg(SECRET_B, SECRET_A));
    expect(await rotated.verify(await old.sign(claims, 60))).not.toBeNull();
    expect(await old.verify(await rotated.sign(claims, 60))).toBeNull();
  });
});

describe('Argon2PasswordHasher', () => {
  it('hashes with argon2id, verifies, and flags weaker parameters for rehash', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong')).toBe(false);
    expect(await hasher.verify('garbage', 'x')).toBe(false);
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(hasher.needsRehash(hash.replace('m=19456', 'm=4096'))).toBe(true);
    expect(hasher.needsRehash('garbage')).toBe(true);
  }, 20_000);
});

describe('identity providers', () => {
  it('fake adapter parses well-formed tokens only', async () => {
    const fake = new FakeIdentityProvider();
    expect(await fake.verifyIdToken('fake:sub-1:User@Example.com')).toEqual({
      provider: 'FAKE',
      subject: 'sub-1',
      email: 'user@example.com',
      emailVerified: true,
    });
    expect(
      (await fake.verifyIdToken('fake:sub-1:user@example.com:unverified'))?.emailVerified,
    ).toBe(false);
    expect(await fake.verifyIdToken('fake:sub-1')).toBeNull();
    expect(await fake.verifyIdToken('fake:s:not-an-email')).toBeNull();
    expect(await fake.verifyIdToken('eyJhbGciOi...')).toBeNull();
  });

  it('registry exposes only configured providers', () => {
    const registry = new StaticIdentityProviderRegistry([new FakeIdentityProvider()]);
    expect(registry.enabled()).toEqual(['FAKE']);
    expect(registry.get('APPLE')).toBeUndefined();
  });
});

describe('mailers', () => {
  it('log adapter redacts the address and hides codes unless explicitly exposed', async () => {
    const lines: unknown[] = [];
    const logger = { log: (obj: unknown) => lines.push(obj) } as unknown as ConstructorParameters<
      typeof LogMailer
    >[0];
    const hidden = new LogMailer(logger, false);
    await hidden.send({
      to: 'ragad@example.com',
      language: 'en',
      template: { name: 'VERIFY_EMAIL', code: '123456', expiresInMinutes: 15 },
    });
    expect(JSON.stringify(lines[0])).not.toContain('123456');
    expect(JSON.stringify(lines[0])).not.toContain('ragad@');
    expect(JSON.stringify(lines[0])).toContain('ra***@example.com');
    const exposed = new LogMailer(logger, true);
    await exposed.send({
      to: 'ragad@example.com',
      language: 'en',
      template: { name: 'VERIFY_EMAIL', code: '123456', expiresInMinutes: 15 },
    });
    expect(JSON.stringify(lines[1])).toContain('123456');
  });

  it('in-memory adapter keeps an outbox for tests', async () => {
    const m = new InMemoryMailer();
    await m.send({ to: 'a@example.com', language: 'en', template: { name: 'PASSWORD_CHANGED' } });
    await m.send({
      to: 'a@example.com',
      language: 'en',
      template: { name: 'VERIFY_EMAIL', code: '000001', expiresInMinutes: 5 },
    });
    expect(m.lastFor('A@example.com')?.template.name).toBe('VERIFY_EMAIL');
    expect(m.lastFor('a@example.com', 'PASSWORD_CHANGED')?.template.name).toBe('PASSWORD_CHANGED');
    m.clear();
    expect(m.outbox).toHaveLength(0);
  });
});
