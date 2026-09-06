const UNIQUE_VIOLATION = '23505';

/**
 * True when a PostgreSQL unique-constraint violation is anywhere in the error chain
 * (Drizzle wraps driver errors as DrizzleQueryError with the pg error in `cause`).
 * Use for check-then-insert races: map to CONFLICT instead of a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  return isUniqueViolation((error as { cause?: unknown }).cause);
}
