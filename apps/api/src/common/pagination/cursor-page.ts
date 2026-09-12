import { z } from 'zod';

import type { Paginated } from '@quest/types';

import { ApiError } from '../filters/api-error';

/**
 * Cursor pagination helpers for keyset-paged list endpoints (audit P01-14).
 *
 * Before this, list endpoints returned every row and always claimed `hasMore: false`; the consent
 * ledger is append-only and block lists are user-controlled, so both grow without bound. A page is
 * read with `limit + 1` rows: the extra row is the proof that another page exists, and the last
 * returned row becomes the next cursor. Cursors are opaque to clients (base64 of the sort key).
 */
export const listPageQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListPageQuery = z.infer<typeof listPageQuerySchema>;

/** Sort key of the last row of a page: a timestamp plus a unique id tiebreaker. */
export interface PageCursor {
  at: Date;
  id: string;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

/** The id half of a cursor reaches SQL as a `::uuid` cast, so it is validated, not just non-empty. */
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(raw: string | undefined): PageCursor | undefined {
  if (raw === undefined) return undefined;
  const [at, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const parsed = at ? new Date(at) : undefined;
  if (!parsed || Number.isNaN(parsed.getTime()) || !id || !CURSOR_ID.test(id) || rest.length > 0) {
    throw ApiError.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
  return { at: parsed, id };
}

/**
 * Turns `limit + 1` rows into a page. `cursorOf` extracts the sort key of a row; the caller must
 * have queried with the same ordering the cursor comparison uses.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => PageCursor,
): Paginated<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    pageInfo: {
      nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
      hasMore,
    },
  };
}

/**
 * A page whose rows were filtered **after** the query, where "fewer rows than asked for" therefore
 * does not mean "no more rows".
 *
 * `toPage` derives `hasMore` from the row count, which is correct only when the query returns
 * exactly what the response contains. Discovery filters on facts that are not columns — owner
 * account state, safety decisions, blocks — so it can return a short or empty page while the
 * catalogue continues. Reporting that as end-of-feed stranded every Quest behind a long run of
 * concealed rows (final delta audit P1-1).
 *
 * So the scan reports where it actually reached, and:
 *  - more survivors than the limit → an ordinary page, continuing from the last returned row;
 *  - not exhausted → `hasMore: true` continuing from the last row **scanned**, which may be far
 *    ahead of the last row returned. The page may legitimately be empty: the client pays for the
 *    concealed run in requests rather than in lost catalogue;
 *  - exhausted → `hasMore: false`, and only then.
 *
 * Continuing from the last *scanned* row rather than the last survivor is what guarantees progress:
 * a survivor's cursor would re-read the concealed run on every subsequent request.
 */
export function toScannedPage<T>(
  scan: { rows: T[]; scannedThrough: PageCursor | null; exhausted: boolean },
  limit: number,
  cursorOf: (row: T) => PageCursor,
): Paginated<T> {
  const full = scan.rows.length > limit;
  const data = full ? scan.rows.slice(0, limit) : scan.rows;
  if (full) {
    const last = data[data.length - 1];
    return {
      data,
      pageInfo: { nextCursor: last ? encodeCursor(cursorOf(last)) : null, hasMore: true },
    };
  }
  if (!scan.exhausted && scan.scannedThrough) {
    return {
      data,
      pageInfo: { nextCursor: encodeCursor(scan.scannedThrough), hasMore: true },
    };
  }
  return { data, pageInfo: { nextCursor: null, hasMore: false } };
}

/** Page of a naturally bounded collection (sessions are capped, devices are per install). */
export function fullPage<T>(data: T[]): Paginated<T> {
  return { data, pageInfo: { nextCursor: null, hasMore: false } };
}
