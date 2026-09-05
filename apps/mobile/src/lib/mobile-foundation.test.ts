import { describe, expect, it } from 'vitest';

import { readMobileEnv } from './env';
import {
  FORBIDDEN_PERMISSIONS,
  NoopPermissions,
  PermissionKind,
  permissionPurpose,
} from './permissions';
import {
  InMemorySecureStorage,
  SECURE_STORAGE_MAX_BYTES,
  SecureStorageKey,
} from './secure-storage';

describe('mobile env', () => {
  it('defaults to the local API and validates URLs', () => {
    expect(readMobileEnv({}).EXPO_PUBLIC_API_BASE_URL).toBe('http://localhost:4000');
    expect(() => readMobileEnv({ EXPO_PUBLIC_API_BASE_URL: 'api.quest' })).toThrow(
      /EXPO_PUBLIC_API_BASE_URL/,
    );
  });
});

describe('secure storage abstraction', () => {
  it('round-trips values by closed key set and enforces the size limit', async () => {
    const s = new InMemorySecureStorage();
    expect(await s.get(SecureStorageKey.ACCESS_TOKEN)).toBeNull();
    await s.set(SecureStorageKey.ACCESS_TOKEN, 'tok');
    expect(await s.get(SecureStorageKey.ACCESS_TOKEN)).toBe('tok');
    await s.remove(SecureStorageKey.ACCESS_TOKEN);
    expect(await s.get(SecureStorageKey.ACCESS_TOKEN)).toBeNull();
    await expect(
      s.set(SecureStorageKey.REFRESH_TOKEN, 'x'.repeat(SECURE_STORAGE_MAX_BYTES + 1)),
    ).rejects.toThrow(/limit/);
  });
});

describe('permissions architecture', () => {
  it('declares a purpose for every permission and never includes always-on location or contacts', () => {
    for (const k of Object.values(PermissionKind))
      expect(permissionPurpose[k].length).toBeGreaterThan(20);
    for (const f of FORBIDDEN_PERMISSIONS) expect(Object.values(PermissionKind)).not.toContain(f);
    expect(permissionPurpose.LOCATION_WHEN_IN_USE).toMatch(/never shared/);
  });

  it('Phase 00 default grants nothing', async () => {
    const p = new NoopPermissions();
    expect(await p.status(PermissionKind.CAMERA)).toBe('undetermined');
    expect(await p.request(PermissionKind.CAMERA)).toBe('denied');
  });
});
