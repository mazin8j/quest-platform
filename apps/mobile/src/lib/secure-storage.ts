/**
 * Secure storage abstraction. Tokens and other sensitive values go ONLY through this port —
 * never AsyncStorage, never module-level variables. The expo-secure-store adapter backs it on
 * device (Keychain / Keystore); the in-memory adapter backs tests.
 */
export interface SecureStoragePort {
  get(key: SecureStorageKey): Promise<string | null>;
  set(key: SecureStorageKey, value: string): Promise<void>;
  remove(key: SecureStorageKey): Promise<void>;
}

/** Closed set of keys so every secret stored on device is enumerable and auditable. */
export const SecureStorageKey = {
  ACCESS_TOKEN: 'quest.auth.accessToken',
  REFRESH_TOKEN: 'quest.auth.refreshToken',
  DEVICE_ID: 'quest.device.id',
} as const;
export type SecureStorageKey = (typeof SecureStorageKey)[keyof typeof SecureStorageKey];

/** expo-secure-store limits values to 2048 bytes; larger payloads must be split or not stored. */
export const SECURE_STORAGE_MAX_BYTES = 2048;

export function assertStorableValue(value: string): void {
  if (new TextEncoder().encode(value).byteLength > SECURE_STORAGE_MAX_BYTES) {
    throw new Error(`Value exceeds secure storage limit of ${SECURE_STORAGE_MAX_BYTES} bytes`);
  }
}

export class InMemorySecureStorage implements SecureStoragePort {
  private readonly map = new Map<string, string>();
  get(key: SecureStorageKey): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  set(key: SecureStorageKey, value: string): Promise<void> {
    try {
      assertStorableValue(value);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.map.set(key, value);
    return Promise.resolve();
  }
  remove(key: SecureStorageKey): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
}
