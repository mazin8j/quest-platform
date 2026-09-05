import * as SecureStore from 'expo-secure-store';

import {
  type SecureStorageKey,
  type SecureStoragePort,
  assertStorableValue,
} from './secure-storage';

/** Device-backed implementation (iOS Keychain / Android Keystore via expo-secure-store). */
export class ExpoSecureStorage implements SecureStoragePort {
  get(key: SecureStorageKey): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }
  async set(key: SecureStorageKey, value: string): Promise<void> {
    assertStorableValue(value);
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  remove(key: SecureStorageKey): Promise<void> {
    return SecureStore.deleteItemAsync(key);
  }
}

export const secureStorage: SecureStoragePort = new ExpoSecureStorage();
