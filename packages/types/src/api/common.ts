import { z } from 'zod';

/** All API timestamps are ISO-8601 in UTC with millisecond precision, e.g. 2026-09-04T18:20:11.123Z */
export const isoDateTimeSchema = z.iso.datetime({ offset: false });
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

/** All entity identifiers are UUIDs (v7 preferred for index locality; v4 accepted). */
export const uuidSchema = z.uuid();
export type Uuid = z.infer<typeof uuidSchema>;

/** BCP-47 language tag, e.g. "en", "ar", "ar-JO". */
export const languageTagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
/** ISO 3166-1 alpha-2 country code, e.g. "JO". */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/**
 * Enum convention: SCREAMING_SNAKE_CASE string enums on the wire; clients must tolerate unknown
 * values (forward compatibility) by treating them as "UNKNOWN" in UI, never by crashing.
 */
export function wireEnum<const V extends readonly [string, ...string[]]>(values: V) {
  return z.enum(values);
}

/** Current API version prefix. Breaking changes require a new prefix; see docs/api/API_CONVENTIONS.md */
export const API_VERSION = 'v1';
