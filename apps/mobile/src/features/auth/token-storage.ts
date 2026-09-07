import type { TokenStorage } from '@quest/api-client';
import { tokenPairSchema, type TokenPair } from '@quest/types';

import { SecureStorageKey, type SecureStoragePort } from '../../lib/secure-storage';

/**
 * TokenStorage backed by the device secure store (Keychain/Keystore). The pair is split across
 * two entries because each expo-secure-store value is capped at 2 KB; the access token is a JWT
 * and the refresh token is opaque, so neither approaches the limit.
 */
export class SecureTokenStorage implements TokenStorage {
  constructor(private readonly store: SecureStoragePort) {}

  async load(): Promise<TokenPair | null> {
    const [access, meta] = await Promise.all([
      this.store.get(SecureStorageKey.ACCESS_TOKEN),
      this.store.get(SecureStorageKey.REFRESH_TOKEN),
    ]);
    if (!access || !meta) return null;
    try {
      const parsed = tokenPairSchema.safeParse({
        ...(JSON.parse(meta) as object),
        accessToken: access,
      });
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async save(tokens: TokenPair): Promise<void> {
    const { accessToken, ...meta } = tokens;
    await this.store.set(SecureStorageKey.ACCESS_TOKEN, accessToken);
    await this.store.set(SecureStorageKey.REFRESH_TOKEN, JSON.stringify(meta));
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.store.remove(SecureStorageKey.ACCESS_TOKEN),
      this.store.remove(SecureStorageKey.REFRESH_TOKEN),
    ]);
  }
}
