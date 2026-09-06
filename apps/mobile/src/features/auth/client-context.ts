import type { ClientContext } from '@quest/types';
import { Platform } from 'react-native';

import { SecureStorageKey, type SecureStoragePort } from '../../lib/secure-storage';

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  let out = '';
  while (out.length < 32) out += Math.random().toString(36).slice(2);
  return out.slice(0, 32);
}

/**
 * Stable per-installation id (never a hardware identifier) kept in secure storage so sessions
 * and push registrations can be tied to this install across sign-ins.
 */
export async function getInstallationId(store: SecureStoragePort): Promise<string> {
  const existing = await store.get(SecureStorageKey.DEVICE_ID);
  if (existing) return existing;
  const created = randomId();
  await store.set(SecureStorageKey.DEVICE_ID, created);
  return created;
}

export async function buildClientContext(
  store: SecureStoragePort,
  appVersion?: string,
): Promise<ClientContext> {
  return {
    platform: Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB',
    installationId: await getInstallationId(store),
    ...(appVersion ? { appVersion } : {}),
  };
}
