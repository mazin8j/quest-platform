/** Password hashing behind a port so the algorithm/parameters can evolve (rehash on login). */
export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** True when `hash` was produced with outdated parameters and should be re-hashed. */
  needsRehash(hash: string): boolean;
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
