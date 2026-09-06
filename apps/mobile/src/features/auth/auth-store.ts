import {
  ApiClientError,
  AuthSession,
  type IdentityApi,
  type TokenStorage,
  withAuthRetry,
} from '@quest/api-client';
import type { AccountView, AuthResponse, LoginRequest, RegisterRequestInput } from '@quest/types';

export type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; account: AccountView };

type Listener = (state: AuthState) => void;

/**
 * Framework-free auth state machine used by the React provider. Owns the AuthSession (tokens +
 * refresh) and the current AccountView; every mutation goes through the typed identity API.
 */
export class AuthStore {
  private state: AuthState = { status: 'loading' };
  private readonly listeners = new Set<Listener>();
  readonly session: AuthSession;

  constructor(
    private readonly api: IdentityApi,
    storage: TokenStorage,
  ) {
    this.session = new AuthSession({
      storage,
      refresh: (token) => this.api.auth.refresh(token),
      onSignedOut: () => this.setState({ status: 'signedOut' }),
    });
  }

  get current(): AuthState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** App start: restore the session from secure storage and load the account. */
  async bootstrap(): Promise<AuthState> {
    const tokens = await this.session.current();
    if (!tokens) return this.setState({ status: 'signedOut' });
    try {
      const account = await withAuthRetry(this.session, () => this.api.me.get());
      return this.setState({ status: 'signedIn', account });
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
        await this.session.clear();
        return this.setState({ status: 'signedOut' });
      }
      // Offline: keep tokens, report signed out for now; next bootstrap retries.
      return this.setState({ status: 'signedOut' });
    }
  }

  async signUp(input: RegisterRequestInput): Promise<AccountView> {
    return this.adopt(await this.api.auth.register(input));
  }

  async signIn(input: LoginRequest): Promise<AccountView> {
    return this.adopt(await this.api.auth.login(input));
  }

  async signOut(): Promise<void> {
    try {
      await withAuthRetry(this.session, () => this.api.auth.logout());
    } catch {
      // Server-side revocation is best effort; local tokens are always cleared.
    }
    await this.session.clear();
    this.setState({ status: 'signedOut' });
  }

  async verifyEmail(code: string): Promise<AccountView> {
    const account = await withAuthRetry(this.session, () => this.api.auth.verifyEmail(code));
    return this.setAccount(account);
  }

  async resendVerification(): Promise<void> {
    await withAuthRetry(this.session, () => this.api.auth.resendVerification());
  }

  /** Re-reads the account (after profile/interests changes that move onboarding forward). */
  async refreshAccount(): Promise<AccountView> {
    const account = await withAuthRetry(this.session, () => this.api.me.get());
    return this.setAccount(account);
  }

  /** Runs an authenticated call with transparent refresh + retry. */
  call<T>(fn: (api: IdentityApi) => Promise<T>): Promise<T> {
    return withAuthRetry(this.session, () => fn(this.api));
  }

  private async adopt(response: AuthResponse): Promise<AccountView> {
    await this.session.set(response.tokens);
    return this.setAccount(response.account);
  }

  private setAccount(account: AccountView): AccountView {
    this.setState({ status: 'signedIn', account });
    return account;
  }

  private setState(state: AuthState): AuthState {
    this.state = state;
    for (const l of this.listeners) l(state);
    return state;
  }
}
