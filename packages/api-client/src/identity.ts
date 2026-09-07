import type {
  AcceptedResponse,
  AccountSupportView,
  AccountView,
  AuthResponse,
  AvatarUploadRequest,
  AvatarUploadResponse,
  BlockView,
  ChangePasswordRequest,
  ConsentRecord,
  ConsentState,
  DataExportRequestView,
  DeletionRequestView,
  DeviceView,
  Interest,
  LoginRequest,
  OnboardingStatus,
  OwnProfileView,
  Paginated,
  PrivacySettings,
  ProviderRegisterRequest,
  ProviderSignInRequest,
  PublicProfileView,
  RecordConsentRequest,
  RegisterDeviceRequest,
  RegisterRequestInput,
  RequestDeletionRequest,
  ResetPasswordRequest,
  SessionView,
  SuspendAccountRequest,
  TokenPair,
  UpdateInterestsRequest,
  UpdatePrivacySettingsRequest,
  UpdateProfileRequest,
  UsernameAvailabilityResponse,
} from '@quest/types';

import { type ApiClient, ApiClientError } from './client';

/**
 * Typed identity/profile endpoints (Phase 01). Thin functions over ApiClient so mobile, web and
 * admin share one contract; paths mirror docs/api/openapi/v1.json.
 */
export function identityApi(client: ApiClient) {
  return {
    auth: {
      register: (body: RegisterRequestInput) => client.post<AuthResponse>('/auth/register', body),
      login: (body: LoginRequest) => client.post<AuthResponse>('/auth/login', body),
      providerSignIn: (body: ProviderSignInRequest) =>
        client.post<AuthResponse>('/auth/provider/sign-in', body),
      providerRegister: (body: ProviderRegisterRequest) =>
        client.post<AuthResponse>('/auth/provider/register', body),
      refresh: (refreshToken: string) =>
        client.post<AuthResponse>('/auth/refresh', { refreshToken }),
      logout: () => client.post<void>('/auth/logout'),
      logoutAll: () => client.post<{ revokedSessions: number }>('/auth/logout-all'),
      verifyEmail: (code: string) => client.post<AccountView>('/auth/email/verify', { code }),
      resendVerification: () => client.post<AcceptedResponse>('/auth/email/resend'),
      changePassword: (body: ChangePasswordRequest) =>
        client.post<void>('/auth/password/change', body),
      forgotPassword: (email: string) =>
        client.post<AcceptedResponse>('/auth/password/forgot', { email }),
      resetPassword: (body: ResetPasswordRequest) =>
        client.post<void>('/auth/password/reset', body),
    },
    me: {
      get: () => client.get<AccountView>('/me'),
      sessions: () => client.get<Paginated<SessionView>>('/me/sessions'),
      revokeSession: (sessionId: string) =>
        client.delete<void>(`/me/sessions/${encodeURIComponent(sessionId)}`),
      devices: () => client.get<Paginated<DeviceView>>('/me/devices'),
      registerDevice: (body: RegisterDeviceRequest) => client.post<DeviceView>('/me/devices', body),
      revokeDevice: (deviceId: string) =>
        client.delete<void>(`/me/devices/${encodeURIComponent(deviceId)}`),
      consents: () => client.get<ConsentState>('/me/consents'),
      consentHistory: () => client.get<Paginated<ConsentRecord>>('/me/consents/history'),
      recordConsent: (body: RecordConsentRequest) =>
        client.post<ConsentState>('/me/consents', body),
      deactivate: () => client.post<void>('/me/deactivate'),
      requestDeletion: (body: RequestDeletionRequest) =>
        client.post<DeletionRequestView>('/me/deletion-request', body),
      deletionStatus: () => client.get<DeletionRequestView>('/me/deletion-request'),
      cancelDeletion: () => client.post<AccountView>('/me/deletion-request/cancel'),
      requestDataExport: () => client.post<DataExportRequestView>('/me/data-export'),
      latestDataExport: () => client.get<DataExportRequestView>('/me/data-export'),
      dataExport: (exportId: string) =>
        client.get<DataExportRequestView>(`/me/data-export/${encodeURIComponent(exportId)}`),
    },
    profile: {
      get: () => client.get<OwnProfileView>('/me/profile'),
      update: (body: UpdateProfileRequest) => client.put<OwnProfileView>('/me/profile', body),
      avatarUpload: (body: AvatarUploadRequest) =>
        client.post<AvatarUploadResponse>('/me/profile/avatar-upload', body),
      interests: () => client.get<{ interestKeys: string[] }>('/me/interests'),
      updateInterests: (body: UpdateInterestsRequest) =>
        client.put<{ interestKeys: string[] }>('/me/interests', body),
      onboarding: () => client.get<OnboardingStatus>('/me/onboarding'),
      completeOnboarding: () => client.post<OnboardingStatus>('/me/onboarding/complete'),
      privacy: () => client.get<PrivacySettings>('/me/privacy'),
      updatePrivacy: (body: UpdatePrivacySettingsRequest) =>
        client.put<PrivacySettings>('/me/privacy', body),
      blocks: () => client.get<Paginated<BlockView>>('/me/blocks'),
      block: (accountId: string) => client.post<void>('/me/blocks', { accountId }),
      unblock: (accountId: string) =>
        client.delete<void>(`/me/blocks/${encodeURIComponent(accountId)}`),
    },
    public: {
      interests: () => client.get<{ data: Interest[] }>('/interests'),
      usernameAvailability: (username: string) =>
        client.get<UsernameAvailabilityResponse>('/profiles/username-availability', {
          query: { username },
        }),
      profile: (username: string) =>
        client.get<PublicProfileView>(`/profiles/${encodeURIComponent(username)}`),
    },
    admin: {
      account: (accountId: string) =>
        client.get<AccountSupportView>(`/admin/accounts/${encodeURIComponent(accountId)}`),
      suspend: (accountId: string, body: SuspendAccountRequest) =>
        client.post<AccountSupportView>(
          `/admin/accounts/${encodeURIComponent(accountId)}/suspend`,
          body,
        ),
      reinstate: (accountId: string) =>
        client.post<AccountSupportView>(
          `/admin/accounts/${encodeURIComponent(accountId)}/reinstate`,
        ),
      grantRole: (accountId: string, role: string) =>
        client.post<AccountSupportView>(`/admin/accounts/${encodeURIComponent(accountId)}/roles`, {
          role,
        }),
      revokeRole: (accountId: string, role: string) =>
        client.post<AccountSupportView>(
          `/admin/accounts/${encodeURIComponent(accountId)}/roles/revoke`,
          { role },
        ),
    },
  };
}
export type IdentityApi = ReturnType<typeof identityApi>;

// ---------------------------------------------------------------------------------------------
// Session management (token storage + transparent refresh)
// ---------------------------------------------------------------------------------------------

/** Where tokens live: secure storage on device, httpOnly cookies/server memory on web. */
export interface TokenStorage {
  load(): Promise<TokenPair | null>;
  save(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryTokenStorage implements TokenStorage {
  private tokens: TokenPair | null = null;
  load(): Promise<TokenPair | null> {
    return Promise.resolve(this.tokens);
  }
  save(tokens: TokenPair): Promise<void> {
    this.tokens = tokens;
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.tokens = null;
    return Promise.resolve();
  }
}

export interface AuthSessionOptions {
  storage: TokenStorage;
  /** Called by the session to perform the refresh call (usually `identityApi(client).auth.refresh`). */
  refresh: (refreshToken: string) => Promise<AuthResponse>;
  /** Invoked when the session is definitively lost (refresh failed); clients route to sign-in. */
  onSignedOut?: () => void;
  /** Seconds before expiry at which the access token is proactively refreshed. */
  refreshSkewSeconds?: number;
  now?: () => number;
}

/**
 * Holds the current token pair and refreshes it transparently. Single-flight: concurrent callers
 * share one refresh; a failed refresh clears storage (refresh reuse detection on the server means
 * a stale token must never be retried).
 */
export class AuthSession {
  private tokens: TokenPair | null = null;
  private loaded = false;
  private issuedAt = 0;
  private refreshing: Promise<TokenPair | null> | null = null;

  constructor(private readonly options: AuthSessionOptions) {}

  async current(): Promise<TokenPair | null> {
    if (!this.loaded) {
      this.tokens = await this.options.storage.load();
      this.issuedAt = this.tokens ? (this.options.now ?? Date.now)() : 0;
      this.loaded = true;
    }
    return this.tokens;
  }

  async set(tokens: TokenPair): Promise<void> {
    this.tokens = tokens;
    this.issuedAt = (this.options.now ?? Date.now)();
    this.loaded = true;
    await this.options.storage.save(tokens);
  }

  async clear(): Promise<void> {
    this.tokens = null;
    this.loaded = true;
    await this.options.storage.clear();
  }

  /** Access token for the next request, refreshing first when it is about to expire. */
  async accessToken(): Promise<string | null> {
    const tokens = await this.current();
    if (!tokens) return null;
    const skew = (this.options.refreshSkewSeconds ?? 30) * 1000;
    const now = (this.options.now ?? Date.now)();
    if (now - this.issuedAt + skew >= tokens.accessTokenExpiresIn * 1000) {
      const refreshed = await this.refresh();
      return refreshed?.accessToken ?? null;
    }
    return tokens.accessToken;
  }

  /** Forces a refresh (after a 401). Returns null when the session is gone. */
  refresh(): Promise<TokenPair | null> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<TokenPair | null> {
    const tokens = await this.current();
    if (!tokens) return null;
    try {
      const response = await this.options.refresh(tokens.refreshToken);
      await this.set(response.tokens);
      return response.tokens;
    } catch (error) {
      if (error instanceof ApiClientError && error.isRetryable) throw error; // network: keep tokens
      await this.clear();
      this.options.onSignedOut?.();
      return null;
    }
  }
}

/**
 * Wraps a request so a 401 triggers exactly one refresh + retry. Use for authenticated calls:
 *   withAuthRetry(session, () => api.me.get())
 */
export async function withAuthRetry<T>(session: AuthSession, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401) throw error;
    const refreshed = await session.refresh();
    if (!refreshed) throw error;
    return call();
  }
}
